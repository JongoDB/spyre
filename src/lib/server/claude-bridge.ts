import { EventEmitter } from 'node:events';
import { v4 as uuid } from 'uuid';
import { getDb } from './db';
import { getEnvConfig } from './env-config';
import { getConnection } from './ssh-pool';
import { getEnvironment } from './environments';
import type { ClaudeTask, ClaudeDispatchOptions } from '$lib/types/claude';

// =============================================================================
// Claude Bridge — Task Dispatch Engine
// =============================================================================

const MAX_CONCURRENT_TASKS = 5;

const emitter = new EventEmitter();
emitter.setMaxListeners(50);

const activeTasks = new Map<string, {
  taskId: string;
  envId: string;
  channel: { close: () => void } | null;
  aborted: boolean;
}>();

// Track environments with Claude CLI installed (cached)
const claudeInstalledCache = new Set<string>();

// =============================================================================
// Helpers
// =============================================================================

function updateTask(taskId: string, updates: Record<string, unknown>): void {
  const db = getDb();
  const setClauses: string[] = [];
  const values: unknown[] = [];

  for (const [key, value] of Object.entries(updates)) {
    setClauses.push(`${key} = ?`);
    values.push(value);
  }

  setClauses.push("updated_at = datetime('now')");
  values.push(taskId);

  db.prepare(
    `UPDATE claude_tasks SET ${setClauses.join(', ')} WHERE id = ?`
  ).run(...values);
}

async function verifyClaudeInstalled(envId: string): Promise<boolean> {
  if (claudeInstalledCache.has(envId)) return true;

  try {
    const client = await getConnection(envId);
    const result = await new Promise<{ code: number; stdout: string }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), 10000);
      client.exec('which claude 2>/dev/null || command -v claude 2>/dev/null', (err, stream) => {
        if (err) { clearTimeout(timer); reject(err); return; }
        let stdout = '';
        stream.on('data', (d: Buffer) => { stdout += d.toString(); });
        stream.stderr.on('data', () => { /* consume */ });
        stream.on('close', (code: number) => {
          clearTimeout(timer);
          resolve({ code, stdout });
        });
      });
    });

    if (result.code === 0 && result.stdout.trim()) {
      claudeInstalledCache.add(envId);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// =============================================================================
// Public API
// =============================================================================

export function getEmitter(): EventEmitter {
  return emitter;
}

export function getActiveTaskForEnv(envId: string): ClaudeTask | null {
  const db = getDb();
  return (db.prepare(
    "SELECT * FROM claude_tasks WHERE env_id = ? AND status IN ('pending', 'running') ORDER BY created_at DESC LIMIT 1"
  ).get(envId) as ClaudeTask) ?? null;
}

export function getTask(taskId: string): ClaudeTask | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM claude_tasks WHERE id = ?').get(taskId) as ClaudeTask) ?? null;
}

export function listTasks(filters?: { envId?: string; status?: string; limit?: number }): ClaudeTask[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters?.envId) {
    conditions.push('env_id = ?');
    params.push(filters.envId);
  }
  if (filters?.status) {
    conditions.push('status = ?');
    params.push(filters.status);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filters?.limit ?? 50;
  params.push(limit);

  return db.prepare(
    `SELECT * FROM claude_tasks ${where} ORDER BY created_at DESC LIMIT ?`
  ).all(...params) as ClaudeTask[];
}

export async function dispatch(options: ClaudeDispatchOptions): Promise<string> {
  const { envId, prompt, workingDir } = options;

  // Validate environment
  const env = getEnvironment(envId);
  if (!env) throw { code: 'NOT_FOUND', message: 'Environment not found' };
  if (env.status !== 'running') throw { code: 'INVALID_STATE', message: `Environment is ${env.status}, not running` };
  if (!env.ip_address) throw { code: 'INVALID_STATE', message: 'Environment has no IP address' };

  // Check concurrent limit
  if (activeTasks.size >= MAX_CONCURRENT_TASKS) {
    throw { code: 'RATE_LIMITED', message: `Maximum ${MAX_CONCURRENT_TASKS} concurrent tasks reached` };
  }

  // Check no active task for this env
  const existing = getActiveTaskForEnv(envId);
  if (existing && (existing.status === 'running' || existing.status === 'pending')) {
    throw { code: 'ALREADY_RUNNING', message: 'An active task is already running in this environment' };
  }

  // Verify Claude is installed
  const installed = await verifyClaudeInstalled(envId);
  if (!installed) {
    throw { code: 'NOT_INSTALLED', message: 'Claude CLI is not installed in this environment' };
  }

  // Create task record
  const taskId = uuid();
  const db = getDb();
  db.prepare(`
    INSERT INTO claude_tasks (id, env_id, prompt, status, created_at)
    VALUES (?, ?, ?, 'pending', datetime('now'))
  `).run(taskId, envId, prompt);

  // Start async execution
  executeTask(taskId, envId, prompt, workingDir).catch((err) => {
    console.error(`[spyre] Task ${taskId} execution error:`, err);
    try {
      updateTask(taskId, {
        status: 'error',
        error_message: err instanceof Error ? err.message : String(err),
        completed_at: new Date().toISOString()
      });
    } catch {
      // DB update failed — non-critical
    }
    activeTasks.delete(taskId);
    emitter.emit(`task:${taskId}:complete`, { taskId, status: 'error' });
  });

  return taskId;
}

async function executeTask(
  taskId: string,
  envId: string,
  prompt: string,
  workingDir?: string
): Promise<void> {
  const config = getEnvConfig();
  const taskTimeout = config.claude?.task_timeout ?? 600000;

  // Update task status to running
  updateTask(taskId, {
    status: 'running',
    started_at: new Date().toISOString()
  });

  const taskState = {
    taskId,
    envId,
    channel: null as { close: () => void } | null,
    aborted: false
  };
  activeTasks.set(taskId, taskState);

  let accumulatedOutput = '';

  try {
    const client = await getConnection(envId);

    // Build the claude command
    const escapedPrompt = prompt.replace(/'/g, "'\\''");
    let cmd = `claude -p '${escapedPrompt}' --output-format stream-json --dangerously-skip-permissions`;
    if (workingDir) {
      const escapedDir = workingDir.replace(/'/g, "'\\''");
      cmd = `cd '${escapedDir}' && ${cmd}`;
    }

    const result = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
      const timer = setTimeout(() => {
        taskState.aborted = true;
        if (taskState.channel) {
          try { taskState.channel.close(); } catch { /* ignore */ }
        }
        reject(new Error(`Task timed out after ${taskTimeout}ms`));
      }, taskTimeout);

      client.exec(cmd, (err, stream) => {
        if (err) {
          clearTimeout(timer);
          reject(err);
          return;
        }

        taskState.channel = stream;
        let stdout = '';
        let stderr = '';

        stream.on('data', (data: Buffer) => {
          const chunk = data.toString();
          stdout += chunk;
          accumulatedOutput += chunk;

          // Emit chunk for WebSocket streaming
          emitter.emit(`task:${taskId}:output`, {
            type: 'output',
            data: chunk,
            taskId
          });
        });

        stream.stderr.on('data', (data: Buffer) => {
          const chunk = data.toString();
          stderr += chunk;

          // Check for auth errors
          if (chunk.includes('auth') || chunk.includes('login') || chunk.includes('unauthorized')) {
            emitter.emit(`task:${taskId}:output`, {
              type: 'auth_required',
              data: chunk,
              taskId
            });
          }
        });

        stream.on('close', (code: number) => {
          clearTimeout(timer);
          resolve({ code: code ?? 0, stdout, stderr });
        });

        stream.on('error', (streamErr: Error) => {
          clearTimeout(timer);
          reject(streamErr);
        });
      });
    });

    activeTasks.delete(taskId);

    if (taskState.aborted) return;

    // Parse result — try to extract JSON from stream-json output
    let parsedResult: string | null = null;
    let costUsd: number | null = null;
    let sessionId: string | null = null;

    try {
      // stream-json outputs one JSON object per line
      const lines = result.stdout.trim().split('\n');
      for (const line of lines) {
        try {
          const obj = JSON.parse(line);
          if (obj.type === 'result') {
            parsedResult = obj.result ?? obj.text ?? null;
            costUsd = obj.cost_usd ?? obj.costUsd ?? null;
            sessionId = obj.session_id ?? obj.sessionId ?? null;
          }
          if (obj.session_id) sessionId = obj.session_id;
        } catch {
          // Not JSON — continue
        }
      }
    } catch {
      // Failed to parse — use raw output
    }

    if (!parsedResult) {
      parsedResult = result.stdout;
    }

    // Determine final status
    const status = result.code === 0 ? 'complete' : 'error';
    const errorMessage = result.code !== 0 ? (result.stderr || `Exit code ${result.code}`) : null;

    // Check for auth_required in stderr
    const finalStatus = result.stderr.includes('unauthorized') || result.stderr.includes('auth')
      ? 'auth_required'
      : status;

    updateTask(taskId, {
      status: finalStatus,
      result: parsedResult,
      error_message: errorMessage,
      cost_usd: costUsd,
      session_id: sessionId,
      output: accumulatedOutput,
      completed_at: new Date().toISOString()
    });

    emitter.emit(`task:${taskId}:complete`, {
      taskId,
      status: finalStatus,
      result: parsedResult,
      cost_usd: costUsd,
      session_id: sessionId
    });

  } catch (err) {
    activeTasks.delete(taskId);
    const message = err instanceof Error ? err.message : String(err);

    updateTask(taskId, {
      status: 'error',
      error_message: message,
      output: accumulatedOutput,
      completed_at: new Date().toISOString()
    });

    emitter.emit(`task:${taskId}:complete`, {
      taskId,
      status: 'error',
      error: message
    });
  }
}

export function cancelTask(taskId: string): boolean {
  const task = activeTasks.get(taskId);
  if (task) {
    task.aborted = true;
    if (task.channel) {
      try { task.channel.close(); } catch { /* ignore */ }
    }
    activeTasks.delete(taskId);
  }

  const db = getDb();
  const result = db.prepare(
    "UPDATE claude_tasks SET status = 'cancelled', completed_at = datetime('now') WHERE id = ? AND status IN ('pending', 'running')"
  ).run(taskId);

  emitter.emit(`task:${taskId}:complete`, { taskId, status: 'cancelled' });

  return result.changes > 0;
}

export async function resumeTask(taskId: string): Promise<string> {
  const original = getTask(taskId);
  if (!original) throw { code: 'NOT_FOUND', message: 'Task not found' };
  if (!original.session_id) throw { code: 'NO_SESSION', message: 'Task has no session ID for resume' };
  if (!original.env_id) throw { code: 'NO_ENV', message: 'Task has no associated environment' };

  // Create a new task that resumes the session
  const newTaskId = uuid();
  const db = getDb();
  db.prepare(`
    INSERT INTO claude_tasks (id, env_id, prompt, status, session_id, created_at)
    VALUES (?, ?, ?, 'pending', ?, datetime('now'))
  `).run(newTaskId, original.env_id, `[resume] ${original.prompt}`, original.session_id);

  // Execute with --resume flag
  const env = getEnvironment(original.env_id);
  if (!env || env.status !== 'running' || !env.ip_address) {
    throw { code: 'INVALID_STATE', message: 'Environment is not running' };
  }

  executeResumeTask(newTaskId, original.env_id, original.session_id).catch((err) => {
    console.error(`[spyre] Resume task ${newTaskId} error:`, err);
    try {
      updateTask(newTaskId, {
        status: 'error',
        error_message: err instanceof Error ? err.message : String(err),
        completed_at: new Date().toISOString()
      });
    } catch {
      // Non-critical
    }
    activeTasks.delete(newTaskId);
    emitter.emit(`task:${newTaskId}:complete`, { taskId: newTaskId, status: 'error' });
  });

  return newTaskId;
}

async function executeResumeTask(
  taskId: string,
  envId: string,
  sessionId: string
): Promise<void> {
  const config = getEnvConfig();
  const taskTimeout = config.claude?.task_timeout ?? 600000;

  updateTask(taskId, {
    status: 'running',
    started_at: new Date().toISOString()
  });

  const taskState = {
    taskId,
    envId,
    channel: null as { close: () => void } | null,
    aborted: false
  };
  activeTasks.set(taskId, taskState);

  let accumulatedOutput = '';

  try {
    const client = await getConnection(envId);
    const escapedSession = sessionId.replace(/'/g, "'\\''");
    const cmd = `claude --resume '${escapedSession}' --output-format stream-json --dangerously-skip-permissions`;

    const result = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
      const timer = setTimeout(() => {
        taskState.aborted = true;
        if (taskState.channel) {
          try { taskState.channel.close(); } catch { /* ignore */ }
        }
        reject(new Error(`Task timed out after ${taskTimeout}ms`));
      }, taskTimeout);

      client.exec(cmd, (err, stream) => {
        if (err) { clearTimeout(timer); reject(err); return; }

        taskState.channel = stream;
        let stdout = '';
        let stderr = '';

        stream.on('data', (data: Buffer) => {
          const chunk = data.toString();
          stdout += chunk;
          accumulatedOutput += chunk;
          emitter.emit(`task:${taskId}:output`, { type: 'output', data: chunk, taskId });
        });

        stream.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

        stream.on('close', (code: number) => {
          clearTimeout(timer);
          resolve({ code: code ?? 0, stdout, stderr });
        });
      });
    });

    activeTasks.delete(taskId);

    const status = result.code === 0 ? 'complete' : 'error';
    updateTask(taskId, {
      status,
      result: result.stdout,
      error_message: result.code !== 0 ? result.stderr : null,
      output: accumulatedOutput,
      completed_at: new Date().toISOString()
    });

    emitter.emit(`task:${taskId}:complete`, { taskId, status });
  } catch (err) {
    activeTasks.delete(taskId);
    const message = err instanceof Error ? err.message : String(err);
    updateTask(taskId, {
      status: 'error',
      error_message: message,
      output: accumulatedOutput,
      completed_at: new Date().toISOString()
    });
    emitter.emit(`task:${taskId}:complete`, { taskId, status: 'error', error: message });
  }
}

export function getActiveTaskCount(): number {
  return activeTasks.size;
}
