import { EventEmitter } from 'node:events';
import { v4 as uuid } from 'uuid';
import { getDb } from './db';
import { getEnvConfig } from './env-config';
import { getConnection } from './ssh-pool';
import { getEnvironment } from './environments';
import { getPersona } from './personas';
import { getProgressForEnv } from './claude-poller';
import { ensureAndPropagateAuth } from './claude-auth';
import { getDevcontainer, getDevcontainerWithPersona, devcontainerExec, listDevcontainers } from './devcontainers';
import type { ClaudeTask, ClaudeTaskEvent, ClaudeDispatchOptions } from '$lib/types/claude';
import type { Persona } from '$lib/types/persona';

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
// Stream-JSON Parser
// =============================================================================

/**
 * Parses newline-delimited JSON from Claude's --output-format stream-json.
 * Manages mutable buffer state across feed() calls as SSH chunks arrive.
 */
export class StreamJsonParser {
  private buffer = '';
  onEvent: ((raw: Record<string, unknown>) => void) | null = null;

  feed(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    // Keep the last (potentially incomplete) line in the buffer
    this.buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const obj = JSON.parse(trimmed) as Record<string, unknown>;
        this.onEvent?.(obj);
      } catch {
        // Not valid JSON — skip
      }
    }
  }

  flush(): void {
    const trimmed = this.buffer.trim();
    this.buffer = '';
    if (!trimmed) return;
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      this.onEvent?.(obj);
    } catch {
      // Not valid JSON — skip
    }
  }
}

// =============================================================================
// Event Extraction
// =============================================================================

export function summarizeToolInput(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case 'Bash':
      return truncate(String(input.command ?? ''), 100);
    case 'Edit':
    case 'Write':
    case 'Read':
      return truncate(String(input.file_path ?? ''), 100);
    case 'Grep':
      return truncate(`${input.pattern ?? ''} ${input.path ?? ''}`.trim(), 100);
    case 'Glob':
      return truncate(String(input.pattern ?? ''), 100);
    case 'WebFetch':
      return truncate(String(input.url ?? ''), 100);
    case 'Task':
      return truncate(String(input.description ?? ''), 100);
    default:
      return toolName;
  }
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max - 3) + '...';
}

export function extractTaskEvent(
  raw: Record<string, unknown>,
  seq: number
): ClaudeTaskEvent | null {
  const timestamp = new Date().toISOString();

  // type: 'system' → init
  if (raw.type === 'system') {
    return {
      seq,
      type: 'init',
      timestamp,
      summary: 'Session started',
      data: raw
    };
  }

  // type: 'assistant' → check content blocks
  // Claude stream-json wraps content in a 'message' envelope: { type: 'assistant', message: { content: [...] } }
  if (raw.type === 'assistant') {
    const msg = raw.message as Record<string, unknown> | undefined;
    const content = (raw.content ?? msg?.content) as Array<Record<string, unknown>> | undefined;
    if (!content || !Array.isArray(content)) {
      // Fallback: try to extract text from message
      const fallback = typeof raw.message === 'string' ? raw.message : '';
      return {
        seq,
        type: 'text',
        timestamp,
        summary: truncate(fallback, 200),
        data: raw
      };
    }

    // Check for tool_use blocks
    const toolBlocks = content.filter(b => b.type === 'tool_use');
    if (toolBlocks.length > 0) {
      const first = toolBlocks[0];
      const toolName = String(first.name ?? 'unknown');
      const input = (first.input as Record<string, unknown>) ?? {};
      const detail = summarizeToolInput(toolName, input);
      return {
        seq,
        type: 'tool_use',
        timestamp,
        summary: truncate(`${toolName}: ${detail}`, 200),
        data: raw
      };
    }

    // Text-only assistant message
    const textBlocks = content.filter(b => b.type === 'text');
    const text = textBlocks.map(b => String(b.text ?? '')).join('');
    return {
      seq,
      type: 'text',
      timestamp,
      summary: truncate(text, 200),
      data: raw
    };
  }

  // type: 'tool_result'
  if (raw.type === 'tool_result') {
    const content = String(raw.content ?? '');
    return {
      seq,
      type: 'tool_result',
      timestamp,
      summary: truncate(content, 200),
      data: raw
    };
  }

  // type: 'result'
  if (raw.type === 'result') {
    const costUsd = raw.cost_usd ?? raw.costUsd ?? null;
    const duration = raw.duration_ms ?? raw.durationMs ?? null;
    let summary = 'Task complete';
    const parts: string[] = [];
    if (duration != null) parts.push(`${Math.round(Number(duration) / 1000)}s`);
    if (costUsd != null) parts.push(`$${Number(costUsd).toFixed(4)}`);
    if (parts.length > 0) summary = `Complete: ${parts.join(', ')}`;
    return {
      seq,
      type: 'result',
      timestamp,
      summary,
      data: raw
    };
  }

  // Unknown type — still capture it
  return {
    seq,
    type: 'text',
    timestamp,
    summary: truncate(JSON.stringify(raw), 200),
    data: raw
  };
}

// =============================================================================
// Error Categorization
// =============================================================================

interface ErrorCategory {
  code: string;
  status: 'error' | 'auth_required';
  message: string;
  retryable: boolean;
}

export function categorizeError(
  exitCode: number,
  stderr: string,
  stdout: string
): ErrorCategory {
  const lower = (stderr + ' ' + stdout).toLowerCase();

  if (lower.includes('not authenticated') || lower.includes('unauthorized') || lower.includes('invalid api key') || lower.includes('auth_hang')) {
    return { code: 'AUTH_EXPIRED', status: 'auth_required', message: 'Claude authentication expired or missing — re-authenticate via Settings', retryable: false };
  }
  if (lower.includes('rate limit') || lower.includes('429')) {
    return { code: 'RATE_LIMITED', status: 'error', message: 'Rate limited by Claude API', retryable: true };
  }
  if (lower.includes('econnrefused') || lower.includes('econnreset') || lower.includes('etimedout')) {
    return { code: 'NETWORK_ERROR', status: 'error', message: 'Network connection error', retryable: true };
  }
  if (lower.includes('timed out')) {
    return { code: 'TIMEOUT', status: 'error', message: 'Task timed out', retryable: true };
  }
  if (lower.includes('command not found') || lower.includes('no such file')) {
    return { code: 'CLI_NOT_FOUND', status: 'error', message: 'Claude CLI not found', retryable: false };
  }
  if (lower.includes('ssh') && (lower.includes('connection') || lower.includes('refused'))) {
    return { code: 'SSH_ERROR', status: 'error', message: 'SSH connection failed', retryable: true };
  }
  if (exitCode > 1) {
    return { code: 'PROCESS_CRASH', status: 'error', message: `Process exited with code ${exitCode}`, retryable: true };
  }
  if (exitCode === 1) {
    return { code: 'TASK_FAILED', status: 'error', message: stderr || `Exit code ${exitCode}`, retryable: false };
  }

  return { code: 'UNKNOWN', status: 'error', message: stderr || 'Unknown error', retryable: false };
}

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

function insertTaskEvent(taskId: string, event: ClaudeTaskEvent): void {
  try {
    const db = getDb();
    db.prepare(`
      INSERT OR IGNORE INTO claude_task_events (task_id, seq, event_type, summary, data, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      taskId,
      event.seq,
      event.type,
      event.summary,
      JSON.stringify(event.data),
      event.timestamp
    );
  } catch {
    // Non-critical — don't fail the task
  }
}

export function getTaskEvents(taskId: string, afterSeq?: number): ClaudeTaskEvent[] {
  const db = getDb();
  if (afterSeq != null) {
    const rows = db.prepare(
      'SELECT seq, event_type, summary, data, created_at FROM claude_task_events WHERE task_id = ? AND seq > ? ORDER BY seq ASC'
    ).all(taskId, afterSeq) as Array<{ seq: number; event_type: string; summary: string; data: string; created_at: string }>;
    return rows.map(r => ({
      seq: r.seq,
      type: r.event_type as ClaudeTaskEvent['type'],
      timestamp: r.created_at,
      summary: r.summary,
      data: r.data ? JSON.parse(r.data) : {}
    }));
  }
  const rows = db.prepare(
    'SELECT seq, event_type, summary, data, created_at FROM claude_task_events WHERE task_id = ? ORDER BY seq ASC'
  ).all(taskId) as Array<{ seq: number; event_type: string; summary: string; data: string; created_at: string }>;
  return rows.map(r => ({
    seq: r.seq,
    type: r.event_type as ClaudeTaskEvent['type'],
    timestamp: r.created_at,
    summary: r.summary,
    data: r.data ? JSON.parse(r.data) : {}
  }));
}

async function verifyClaudeInstalled(envId: string): Promise<boolean> {
  if (claudeInstalledCache.has(envId)) return true;

  try {
    const client = await getConnection(envId);
    const result = await new Promise<{ code: number; stdout: string }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), 10000);
      client.exec('which claude 2>/dev/null || command -v claude 2>/dev/null || { [ -x /usr/local/bin/claude ] && echo /usr/local/bin/claude; }', (err, stream) => {
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
// Task Execution — Shared stream handling
// =============================================================================

function setupStreamParsing(
  taskId: string,
  parser: StreamJsonParser
): { seq: { value: number }; sessionId: { value: string | null }; costUsd: { value: number | null }; parsedResult: { value: string | null } } {
  const seq = { value: 0 };
  const sessionId = { value: null as string | null };
  const costUsd = { value: null as number | null };
  const parsedResult = { value: null as string | null };

  parser.onEvent = (raw) => {
    seq.value++;
    const event = extractTaskEvent(raw, seq.value);
    if (!event) return;

    // Track key fields from events
    if (raw.session_id) sessionId.value = String(raw.session_id);
    if (raw.type === 'result') {
      parsedResult.value = (raw.result ?? raw.text ?? null) as string | null;
      costUsd.value = (raw.cost_usd ?? raw.costUsd ?? null) as number | null;
      if (raw.session_id) sessionId.value = String(raw.session_id);
    }

    // Persist event to DB
    insertTaskEvent(taskId, event);

    // Emit structured event for WebSocket
    emitter.emit(`task:${taskId}:event`, event);
  };

  return { seq, sessionId, costUsd, parsedResult };
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

export async function dispatch(options: ClaudeDispatchOptions & { maxRetries?: number }): Promise<string> {
  const { envId, prompt, workingDir, devcontainerId } = options;

  // Validate environment
  const env = getEnvironment(envId);
  if (!env) throw { code: 'NOT_FOUND', message: 'Environment not found' };
  if (env.status !== 'running') throw { code: 'INVALID_STATE', message: `Environment is ${env.status}, not running` };
  if (!env.ip_address) throw { code: 'INVALID_STATE', message: 'Environment has no IP address' };

  // Validate devcontainer if specified
  if (devcontainerId) {
    const dc = getDevcontainer(devcontainerId);
    if (!dc) throw { code: 'NOT_FOUND', message: 'Devcontainer not found' };
    if (dc.status !== 'running') throw { code: 'INVALID_STATE', message: `Devcontainer is ${dc.status}, not running` };
    if (dc.env_id !== envId) throw { code: 'INVALID_STATE', message: 'Devcontainer does not belong to this environment' };
  }

  // Check concurrent limit
  if (activeTasks.size >= MAX_CONCURRENT_TASKS) {
    throw { code: 'RATE_LIMITED', message: `Maximum ${MAX_CONCURRENT_TASKS} concurrent tasks reached` };
  }

  // Check no active task for this env (or devcontainer)
  const existing = getActiveTaskForEnv(envId);
  if (existing && (existing.status === 'running' || existing.status === 'pending')) {
    // For devcontainer dispatch, allow if the existing task is for a different devcontainer
    if (!devcontainerId || existing.devcontainer_id === devcontainerId) {
      throw { code: 'ALREADY_RUNNING', message: 'An active task is already running in this environment' };
    }
  }

  // Verify Claude is installed (in the env or devcontainer)
  if (!devcontainerId) {
    const installed = await verifyClaudeInstalled(envId);
    if (!installed) {
      throw { code: 'NOT_INSTALLED', message: 'Claude CLI is not installed in this environment' };
    }
  }

  // Create task record
  const taskId = uuid();
  const db = getDb();
  const maxRetries = options.maxRetries ?? 0;
  db.prepare(`
    INSERT INTO claude_tasks (id, env_id, prompt, status, max_retries, devcontainer_id, created_at)
    VALUES (?, ?, ?, 'pending', ?, ?, datetime('now'))
  `).run(taskId, envId, prompt, maxRetries, devcontainerId ?? null);

  // Route to devcontainer or direct execution
  const execPromise = devcontainerId
    ? executeDevcontainerTask(taskId, envId, devcontainerId, prompt, workingDir)
    : executeTask(taskId, envId, prompt, workingDir);

  execPromise.catch((err) => {
    console.error(`[spyre] Task ${taskId} execution error:`, err);
    try {
      updateTask(taskId, {
        status: 'error',
        error_message: err instanceof Error ? err.message : String(err),
        error_code: 'DISPATCH_ERROR',
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

/**
 * Build a framed prompt that wraps the user's raw prompt with persona context
 * and current progress state. Returns raw prompt unchanged when no persona.
 */
function buildFramedPrompt(
  rawPrompt: string,
  envId: string,
  persona: Persona | null,
  projectContext?: { repoUrl?: string | null; gitBranch?: string; projectDir?: string } | null
): string {
  if (!persona && !projectContext) return rawPrompt;

  const parts: string[] = [];

  if (persona) {
    parts.push(`You are ${persona.name}, a ${persona.role}.`);
    parts.push('');

    // Include a brief reminder of instructions (CLAUDE.md has the full version)
    if (persona.instructions.trim()) {
      const brief = persona.instructions.length > 500
        ? persona.instructions.slice(0, 500) + '...'
        : persona.instructions;
      parts.push(brief);
      parts.push('');
    }
  }

  // Include project context if available
  if (projectContext?.repoUrl || projectContext?.projectDir) {
    parts.push('## Project Context');
    parts.push(`- Project dir: ${projectContext.projectDir ?? '/project'}`);
    parts.push(`- Repository: ${projectContext.repoUrl ?? 'local'}`);
    parts.push(`- Branch: ${projectContext.gitBranch ?? 'main'}`);
    parts.push('');
  }

  // Include current progress state if available
  const progress = getProgressForEnv(envId);
  if (progress) {
    parts.push('## Current State');
    if (progress.current_task) {
      parts.push(`- Last activity: ${progress.current_task}`);
    }
    if (progress.blockers.length > 0) {
      parts.push(`- Blockers: ${progress.blockers.join(', ')}`);
    }
    const activePhase = progress.phases.find(p => p.status === 'in_progress');
    if (activePhase) {
      parts.push(`- Active phase: ${activePhase.name}${activePhase.detail ? ': ' + activePhase.detail : ''}`);
    }
    parts.push('');
  }

  parts.push('## Task');
  parts.push(rawPrompt);

  return parts.join('\n');
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
  const parser = new StreamJsonParser();
  const tracked = setupStreamParsing(taskId, parser);

  try {
    // Pre-dispatch: ensure fresh token and propagate to environment
    try {
      await ensureAndPropagateAuth(envId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[spyre] Pre-dispatch auth propagation failed: ${msg}`);
      // Don't abort — credentials may already be valid on the target
    }

    const client = await getConnection(envId);

    // Look up persona and project context for prompt framing
    const env = getEnvironment(envId);
    const persona = env?.persona_id ? getPersona(env.persona_id) ?? null : null;
    const projectContext = env?.repo_url || env?.project_dir
      ? { repoUrl: env.repo_url, gitBranch: env.git_branch, projectDir: env.project_dir }
      : null;
    const framedPrompt = buildFramedPrompt(prompt, envId, persona, projectContext);

    // Build the claude command.
    // - Use CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 to skip telemetry/update checks
    // - Use --allowedTools instead of --dangerously-skip-permissions (which fails as root)
    const escapedPrompt = framedPrompt.replace(/'/g, "'\\''");
    const allowedTools = 'Bash(command:*),Read,Write(file_path:*),Edit(file_path:*),Glob,Grep,WebFetch,WebSearch,Task';
    const envExports = 'export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 DISABLE_AUTOUPDATER=1 DISABLE_TELEMETRY=1;';
    const cdPart = workingDir ? `cd '${workingDir.replace(/'/g, "'\\''")}' && ` : '';
    const claudeInvocation = `${cdPart}claude -p '${escapedPrompt}' --output-format stream-json --verbose --allowedTools '${allowedTools}'`;
    // Wrap in `script -qc` to provide a PTY. Claude CLI stalls during startup
    // (Statsig feature-flag fetch) when stdout is not a TTY, which happens with
    // ssh2's exec() channel. `script -qc` creates a pseudo-terminal wrapper.
    const cmd = `${envExports} script -qc "${claudeInvocation.replace(/"/g, '\\"')}" /dev/null`;


    const result = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
      const timer = setTimeout(() => {
        taskState.aborted = true;
        if (taskState.channel) {
          try { taskState.channel.close(); } catch { /* ignore */ }
        }
        reject(new Error(`Task timed out after ${taskTimeout}ms`));
      }, taskTimeout);

      // No-output watchdog: if Claude CLI produces zero stdout within 30s,
      // it's likely hung (expired auth token, onboarding wizard, etc.).
      // Proactively check auth and abort with a clear error.
      const noOutputTimeout = config.claude?.no_output_timeout ?? 5000;
      let gotOutput = false;
      let noOutputTimer: ReturnType<typeof setTimeout> | null = null;

      function startNoOutputWatchdog() {
        noOutputTimer = setTimeout(async () => {
          if (gotOutput || taskState.aborted) return;
          console.warn(`[spyre] Task ${taskId}: no output after ${noOutputTimeout}ms — checking auth...`);

          // Check auth status AND token expiry on the environment.
          // `claude auth status` reports loggedIn=true even with expired tokens,
          // so we also read the credentials file to check expiresAt directly.
          try {
            const authCheck = await new Promise<{ code: number; stdout: string }>((res, rej) => {
              const t = setTimeout(() => rej(new Error('auth check timeout')), 10000);
              client.exec(
                'claude auth status 2>&1; echo "---CREDS---"; cat ~/.claude/.credentials.json 2>/dev/null || echo "{}"',
                (e, s) => {
                  if (e) { clearTimeout(t); rej(e); return; }
                  let out = '';
                  s.on('data', (d: Buffer) => { out += d.toString(); });
                  s.stderr.on('data', () => { /* consume */ });
                  s.on('close', (c: number) => { clearTimeout(t); res({ code: c ?? 0, stdout: out }); });
                }
              );
            });

            let isAuthIssue = false;
            const parts = authCheck.stdout.split('---CREDS---');
            const authStatusPart = parts[0] ?? '';
            const credsPart = (parts[1] ?? '').trim();

            // Check auth status output
            try {
              const authData = JSON.parse(authStatusPart.trim());
              if (!authData.loggedIn) isAuthIssue = true;
            } catch {
              const lower = authStatusPart.toLowerCase();
              if (lower.includes('not logged in') || lower.includes('not authenticated') || authCheck.code !== 0) {
                isAuthIssue = true;
              }
            }

            // Check token expiry from credentials file
            if (!isAuthIssue) {
              try {
                const creds = JSON.parse(credsPart);
                // Check both top-level and nested OAuth token formats
                const oauthData = creds.claudeAiOauth ?? creds;
                const expiresAt = oauthData.expiresAt as number | undefined;
                if (expiresAt && expiresAt < Date.now()) {
                  console.warn(`[spyre] Task ${taskId}: OAuth token expired at ${new Date(expiresAt).toISOString()}`);
                  isAuthIssue = true;
                }
              } catch {
                // Can't parse creds — not conclusive
              }
            }

            if (isAuthIssue) {
              taskState.aborted = true;
              clearTimeout(timer);
              if (taskState.channel) {
                try { taskState.channel.close(); } catch { /* ignore */ }
              }
              reject(new Error('AUTH_HANG: Claude CLI not authenticated — token may be expired. Re-authenticate via Settings > Claude Auth.'));
              return;
            }
          } catch {
            // Auth check itself failed — don't abort, let the main timeout handle it
          }

          // Auth looks OK but still no output — could be slow network or large prompt
          console.warn(`[spyre] Task ${taskId}: no output after ${noOutputTimeout}ms but auth looks OK — Claude may be slow`);
        }, noOutputTimeout);
      }

      client.exec(cmd, (err, stream) => {
        if (err) {
          clearTimeout(timer);
          if (noOutputTimer) clearTimeout(noOutputTimer);
          reject(err);
          return;
        }

        taskState.channel = stream;
        let stdout = '';
        let stderr = '';

        startNoOutputWatchdog();

        stream.on('data', (data: Buffer) => {
          const chunk = data.toString();
          stdout += chunk;
          accumulatedOutput += chunk;

          if (!gotOutput) {
            gotOutput = true;
            if (noOutputTimer) { clearTimeout(noOutputTimer); noOutputTimer = null; }
          }

          // Feed to structured parser
          parser.feed(chunk);

          // Keep raw output emission for backward compat
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
          if (noOutputTimer) clearTimeout(noOutputTimer);
          resolve({ code: code ?? 0, stdout, stderr });
        });

        stream.on('error', (streamErr: Error) => {
          clearTimeout(timer);
          if (noOutputTimer) clearTimeout(noOutputTimer);
          reject(streamErr);
        });
      });
    });

    // Flush any remaining buffer
    parser.flush();

    activeTasks.delete(taskId);

    if (taskState.aborted) return;

    // Use parsed values from structured events, falling back to post-hoc parse
    let parsedResult = tracked.parsedResult.value;
    let costUsd = tracked.costUsd.value;
    let sessionId = tracked.sessionId.value;

    // Fallback: parse stdout if structured parsing didn't capture result
    if (!parsedResult) {
      try {
        const lines = result.stdout.trim().split('\n');
        for (const line of lines) {
          try {
            const obj = JSON.parse(line);
            if (obj.type === 'result') {
              parsedResult = obj.result ?? obj.text ?? null;
              costUsd = costUsd ?? obj.cost_usd ?? obj.costUsd ?? null;
              sessionId = sessionId ?? obj.session_id ?? obj.sessionId ?? null;
            }
            if (obj.session_id && !sessionId) sessionId = obj.session_id;
          } catch {
            // Not JSON
          }
        }
      } catch {
        // Failed to parse
      }
    }

    if (!parsedResult) {
      parsedResult = result.stdout;
    }

    // Determine final status using error categorization
    if (result.code === 0) {
      updateTask(taskId, {
        status: 'complete',
        result: parsedResult,
        cost_usd: costUsd,
        session_id: sessionId,
        output: accumulatedOutput,
        completed_at: new Date().toISOString()
      });

      emitter.emit(`task:${taskId}:complete`, {
        taskId,
        status: 'complete',
        result: parsedResult,
        cost_usd: costUsd,
        session_id: sessionId
      });
    } else {
      const errCat = categorizeError(result.code, result.stderr, result.stdout);

      updateTask(taskId, {
        status: errCat.status,
        result: parsedResult,
        error_message: errCat.message,
        error_code: errCat.code,
        cost_usd: costUsd,
        session_id: sessionId,
        output: accumulatedOutput,
        completed_at: new Date().toISOString()
      });

      emitter.emit(`task:${taskId}:complete`, {
        taskId,
        status: errCat.status,
        error: errCat.message,
        error_code: errCat.code
      });
    }

  } catch (err) {
    parser.flush();
    activeTasks.delete(taskId);
    const message = err instanceof Error ? err.message : String(err);

    // Categorize the caught exception
    const errCat = categorizeError(1, message, '');

    updateTask(taskId, {
      status: errCat.status,
      error_message: errCat.message,
      error_code: errCat.code,
      output: accumulatedOutput,
      completed_at: new Date().toISOString()
    });

    emitter.emit(`task:${taskId}:complete`, {
      taskId,
      status: errCat.status,
      error: errCat.message,
      error_code: errCat.code
    });
  }
}

/**
 * Execute a task inside a devcontainer via SSH → docker exec.
 * Similar to executeTask but routes through docker exec instead of direct SSH.
 */
async function executeDevcontainerTask(
  taskId: string,
  envId: string,
  devcontainerId: string,
  prompt: string,
  workingDir?: string
): Promise<void> {
  const config = getEnvConfig();
  const taskTimeout = config.claude?.task_timeout ?? 600000;

  updateTask(taskId, { status: 'running', started_at: new Date().toISOString() });

  const taskState = { taskId, envId, channel: null as { close: () => void } | null, aborted: false };
  activeTasks.set(taskId, taskState);

  let accumulatedOutput = '';
  const parser = new StreamJsonParser();
  const tracked = setupStreamParsing(taskId, parser);

  try {
    const dc = getDevcontainerWithPersona(devcontainerId);
    if (!dc) throw new Error(`Devcontainer ${devcontainerId} not found`);

    // Build framed prompt with devcontainer persona context
    const env = getEnvironment(envId);
    const persona = dc.persona_id ? getPersona(dc.persona_id) ?? null : null;
    const projectContext = env?.repo_url || env?.project_dir
      ? { repoUrl: env.repo_url, gitBranch: env.git_branch, projectDir: env.project_dir }
      : null;

    // Build prompt with awareness of sibling agents
    let framedPrompt: string;
    if (persona || projectContext) {
      const parts: string[] = [];
      if (persona) {
        parts.push(`You are ${persona.name}, a ${persona.role}.`);
        parts.push('');
      }
      if (projectContext) {
        parts.push('## Project Context');
        parts.push(`- Working dir: ${dc.working_dir}`);
        parts.push(`- Repository: ${projectContext.repoUrl ?? 'local'}`);
        parts.push(`- Branch: ${projectContext.gitBranch ?? 'main'}`);
        parts.push('');
      }
      // Sibling agents info
      const siblings = listDevcontainers(envId).filter(d => d.id !== devcontainerId);
      if (siblings.length > 0) {
        parts.push('## Other Active Agents');
        for (const s of siblings) {
          parts.push(`- ${s.persona_name ?? s.service_name} (${s.persona_role ?? 'agent'})`);
        }
        parts.push('');
      }
      parts.push('## Task');
      parts.push(prompt);
      framedPrompt = parts.join('\n');
    } else {
      framedPrompt = prompt;
    }

    // Build the docker exec command
    const escapedPrompt = framedPrompt.replace(/'/g, "'\\''");
    const allowedTools = 'Bash(command:*),Read,Write(file_path:*),Edit(file_path:*),Glob,Grep,WebFetch,WebSearch,Task';
    const cdPart = workingDir ? `cd '${workingDir.replace(/'/g, "'\\''")}' && ` : '';
    const claudeInvocation = `${cdPart}claude -p '${escapedPrompt}' --output-format stream-json --verbose --allowedTools '${allowedTools}'`;
    const envExports = 'export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 DISABLE_AUTOUPDATER=1 DISABLE_TELEMETRY=1;';
    const innerCmd = `${envExports} script -qc "${claudeInvocation.replace(/"/g, '\\"')}" /dev/null`;
    const escaped = innerCmd.replace(/'/g, "'\\''");
    const dockerCmd = `docker exec ${dc.container_name} bash -c '${escaped}'`;

    // Execute via SSH to the LXC
    const client = await getConnection(envId);
    const result = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
      const timer = setTimeout(() => {
        taskState.aborted = true;
        if (taskState.channel) { try { taskState.channel.close(); } catch { /* ignore */ } }
        reject(new Error(`Task timed out after ${taskTimeout}ms`));
      }, taskTimeout);

      client.exec(dockerCmd, (err, stream) => {
        if (err) { clearTimeout(timer); reject(err); return; }
        taskState.channel = stream;
        let stdout = '';
        let stderr = '';

        stream.on('data', (data: Buffer) => {
          const chunk = data.toString();
          stdout += chunk;
          accumulatedOutput += chunk;
          parser.feed(chunk);
          emitter.emit(`task:${taskId}:output`, { type: 'output', data: chunk, taskId });
        });
        stream.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
        stream.on('close', (code: number) => { clearTimeout(timer); resolve({ code: code ?? 0, stdout, stderr }); });
        stream.on('error', (e: Error) => { clearTimeout(timer); reject(e); });
      });
    });

    parser.flush();
    activeTasks.delete(taskId);
    if (taskState.aborted) return;

    const parsedResult = tracked.parsedResult.value ?? result.stdout;
    const costUsd = tracked.costUsd.value;
    const sessionId = tracked.sessionId.value;

    if (result.code === 0) {
      updateTask(taskId, {
        status: 'complete', result: parsedResult, cost_usd: costUsd,
        session_id: sessionId, output: accumulatedOutput, completed_at: new Date().toISOString()
      });
      emitter.emit(`task:${taskId}:complete`, { taskId, status: 'complete', result: parsedResult, cost_usd: costUsd });
    } else {
      const errCat = categorizeError(result.code, result.stderr, result.stdout);
      updateTask(taskId, {
        status: errCat.status, result: parsedResult, error_message: errCat.message,
        error_code: errCat.code, cost_usd: costUsd, session_id: sessionId,
        output: accumulatedOutput, completed_at: new Date().toISOString()
      });
      emitter.emit(`task:${taskId}:complete`, { taskId, status: errCat.status, error: errCat.message });
    }
  } catch (err) {
    parser.flush();
    activeTasks.delete(taskId);
    const message = err instanceof Error ? err.message : String(err);
    const errCat = categorizeError(1, message, '');
    updateTask(taskId, {
      status: errCat.status, error_message: errCat.message, error_code: errCat.code,
      output: accumulatedOutput, completed_at: new Date().toISOString()
    });
    emitter.emit(`task:${taskId}:complete`, { taskId, status: errCat.status, error: errCat.message });
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
        error_code: 'DISPATCH_ERROR',
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
  const parser = new StreamJsonParser();
  const tracked = setupStreamParsing(taskId, parser);

  try {
    // Pre-dispatch: ensure fresh token and propagate
    try {
      await ensureAndPropagateAuth(envId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[spyre] Pre-dispatch auth propagation failed (resume): ${msg}`);
    }

    const client = await getConnection(envId);
    const escapedSession = sessionId.replace(/'/g, "'\\''");
    const allowedTools = 'Bash(command:*),Read,Write(file_path:*),Edit(file_path:*),Glob,Grep,WebFetch,WebSearch,Task';
    const envExports = 'export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 DISABLE_AUTOUPDATER=1 DISABLE_TELEMETRY=1;';
    const resumeInvocation = `claude --resume '${escapedSession}' --output-format stream-json --verbose --allowedTools '${allowedTools}'`;
    const cmd = `${envExports} script -qc "${resumeInvocation.replace(/"/g, '\\"')}" /dev/null`;

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

          parser.feed(chunk);
          emitter.emit(`task:${taskId}:output`, { type: 'output', data: chunk, taskId });
        });

        stream.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

        stream.on('close', (code: number) => {
          clearTimeout(timer);
          resolve({ code: code ?? 0, stdout, stderr });
        });
      });
    });

    parser.flush();
    activeTasks.delete(taskId);

    if (result.code === 0) {
      updateTask(taskId, {
        status: 'complete',
        result: tracked.parsedResult.value ?? result.stdout,
        cost_usd: tracked.costUsd.value,
        session_id: tracked.sessionId.value ?? sessionId,
        output: accumulatedOutput,
        completed_at: new Date().toISOString()
      });
      emitter.emit(`task:${taskId}:complete`, { taskId, status: 'complete' });
    } else {
      const errCat = categorizeError(result.code, result.stderr, result.stdout);
      updateTask(taskId, {
        status: errCat.status,
        result: tracked.parsedResult.value ?? result.stdout,
        error_message: errCat.message,
        error_code: errCat.code,
        output: accumulatedOutput,
        completed_at: new Date().toISOString()
      });
      emitter.emit(`task:${taskId}:complete`, { taskId, status: errCat.status, error_code: errCat.code });
    }
  } catch (err) {
    parser.flush();
    activeTasks.delete(taskId);
    const message = err instanceof Error ? err.message : String(err);
    const errCat = categorizeError(1, message, '');
    updateTask(taskId, {
      status: errCat.status,
      error_message: errCat.message,
      error_code: errCat.code,
      output: accumulatedOutput,
      completed_at: new Date().toISOString()
    });
    emitter.emit(`task:${taskId}:complete`, { taskId, status: errCat.status, error: errCat.message, error_code: errCat.code });
  }
}

export function getActiveTaskCount(): number {
  return activeTasks.size;
}
