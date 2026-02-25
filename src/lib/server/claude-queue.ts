import { getDb } from './db';
import { dispatch, getActiveTaskForEnv } from './claude-bridge';
import type { ClaudeTaskQueueItem } from '$lib/types/claude';

// =============================================================================
// Claude Queue Consumer — Auto-dispatches queued tasks
// =============================================================================

const POLL_INTERVAL = 10_000; // 10s
const STUCK_MULTIPLIER = 2; // Task is stuck if running for 2x the timeout
const RETRY_BACKOFF_BASE = 30_000; // 30s base backoff per retry
let pollTimer: ReturnType<typeof setInterval> | null = null;
let processing = false;

// Retryable error codes (must match categorizeError output)
const RETRYABLE_CODES = new Set([
  'RATE_LIMITED', 'NETWORK_ERROR', 'TIMEOUT', 'SSH_ERROR', 'PROCESS_CRASH', 'STUCK'
]);

// =============================================================================
// Core Logic
// =============================================================================

async function processQueue(): Promise<void> {
  if (processing) return;
  processing = true;

  try {
    const db = getDb();

    // --- Stuck task detection ---
    // Default timeout is 600000ms (10 min). Stuck = 2x that = 20 min.
    const stuckThresholdMinutes = Math.ceil((600000 * STUCK_MULTIPLIER) / 60000);
    const stuckTasks = db.prepare(
      `SELECT id FROM claude_tasks
       WHERE status = 'running'
       AND started_at IS NOT NULL
       AND datetime(started_at, '+${stuckThresholdMinutes} minutes') < datetime('now')`
    ).all() as Array<{ id: string }>;

    for (const stuck of stuckTasks) {
      db.prepare(
        `UPDATE claude_tasks
         SET status = 'error', error_code = 'STUCK', error_message = 'Task exceeded maximum runtime',
             completed_at = datetime('now'), updated_at = datetime('now')
         WHERE id = ? AND status = 'running'`
      ).run(stuck.id);
      console.warn(`[spyre] Marked stuck task ${stuck.id} as error`);
    }

    // --- Auto-retry for failed tasks with retryable errors ---
    const retryableTasks = db.prepare(
      `SELECT * FROM claude_tasks
       WHERE status IN ('error')
       AND error_code IS NOT NULL
       AND retry_count < max_retries
       AND max_retries > 0
       AND env_id IS NOT NULL`
    ).all() as Array<{
      id: string; env_id: string; prompt: string;
      retry_count: number; max_retries: number; error_code: string;
      completed_at: string | null; parent_task_id: string | null;
    }>;

    for (const task of retryableTasks) {
      if (!RETRYABLE_CODES.has(task.error_code)) continue;

      // Check backoff: 30s * retry_count since completion
      const backoffMs = RETRY_BACKOFF_BASE * (task.retry_count + 1);
      if (task.completed_at) {
        const completedAt = new Date(task.completed_at).getTime();
        if (Date.now() - completedAt < backoffMs) continue;
      }

      // Check no active task for this env
      const active = getActiveTaskForEnv(task.env_id);
      if (active) continue;

      try {
        // Create a retry task with incremented retry_count
        const retryCount = task.retry_count + 1;
        const parentId = task.parent_task_id ?? task.id;

        // Mark original as fully consumed (won't be retried again)
        db.prepare(
          `UPDATE claude_tasks SET retry_count = max_retries, updated_at = datetime('now') WHERE id = ?`
        ).run(task.id);

        // Dispatch new task
        const newTaskId = await dispatch({
          envId: task.env_id,
          prompt: task.prompt,
          maxRetries: task.max_retries
        });

        // Update the new task with retry metadata
        db.prepare(
          `UPDATE claude_tasks SET retry_count = ?, parent_task_id = ?, updated_at = datetime('now') WHERE id = ?`
        ).run(retryCount, parentId, newTaskId);

        console.log(`[spyre] Auto-retried task ${task.id} → ${newTaskId} (attempt ${retryCount}/${task.max_retries})`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[spyre] Auto-retry failed for task ${task.id}:`, message);
      }
    }

    // --- Normal queue dispatch ---
    // Get all queued items grouped by env, lowest position first
    const queuedItems = db.prepare(
      "SELECT * FROM claude_task_queue WHERE status = 'queued' ORDER BY position ASC"
    ).all() as ClaudeTaskQueueItem[];

    // Group by env_id
    const byEnv = new Map<string, ClaudeTaskQueueItem[]>();
    for (const item of queuedItems) {
      const existing = byEnv.get(item.env_id);
      if (existing) {
        existing.push(item);
      } else {
        byEnv.set(item.env_id, [item]);
      }
    }

    for (const [envId, items] of byEnv) {
      // Check if there's already an active task for this env
      const activeTask = getActiveTaskForEnv(envId);
      if (activeTask) continue;

      // Pick the first (lowest position) queued item
      const item = items[0];

      try {
        // Mark as dispatched before dispatching (prevents double-dispatch)
        db.prepare(
          "UPDATE claude_task_queue SET status = 'dispatched' WHERE id = ?"
        ).run(item.id);

        // Queue-dispatched tasks get max_retries = 2
        await dispatch({ envId: item.env_id, prompt: item.prompt, maxRetries: 2 });
      } catch (err) {
        // Dispatch failed — mark queue item as error
        const message = err instanceof Error ? err.message
          : (err as { message?: string })?.message ?? String(err);
        db.prepare(
          "UPDATE claude_task_queue SET status = 'error' WHERE id = ?"
        ).run(item.id);
        console.error(`[spyre] Queue dispatch failed for ${item.id}:`, message);
      }
    }
  } catch (err) {
    console.error('[spyre] Queue processing error:', err);
  } finally {
    processing = false;
  }
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Start the queue consumer polling loop.
 * Safe to call multiple times — only one timer will run.
 */
export function startQueueConsumer(): void {
  if (pollTimer) return;
  pollTimer = setInterval(() => processQueue(), POLL_INTERVAL);
}

/**
 * Stop the queue consumer polling loop.
 */
export function stopQueueConsumer(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

/**
 * Trigger immediate queue processing for a specific environment.
 * Call this after adding a queue item to avoid waiting for the next poll.
 */
export async function processQueueForEnv(envId: string): Promise<void> {
  // Ensure the polling loop is running
  startQueueConsumer();

  // Process immediately
  await processQueue();
}
