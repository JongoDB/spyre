import { getDb } from './db';
import { dispatch, getActiveTaskForEnv } from './claude-bridge';
import type { ClaudeTaskQueueItem } from '$lib/types/claude';

// =============================================================================
// Claude Queue Consumer — Auto-dispatches queued tasks
// =============================================================================

const POLL_INTERVAL = 10_000; // 10s
let pollTimer: ReturnType<typeof setInterval> | null = null;
let processing = false;

// =============================================================================
// Core Logic
// =============================================================================

async function processQueue(): Promise<void> {
  if (processing) return;
  processing = true;

  try {
    const db = getDb();

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

        await dispatch({ envId: item.env_id, prompt: item.prompt });
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
