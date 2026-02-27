import { EventEmitter } from 'node:events';
import { v4 as uuid } from 'uuid';
import { getDb } from './db';
import { dispatch as claudeDispatch, getEmitter as getClaudeEmitter, cancelTask, getTask } from './claude-bridge';
import { getPersona } from './personas';
import { getProgressForEnv } from './claude-poller';
import { getEnvironment } from './environments';
import type { LightweightAgent, LightweightAgentWithPersona, SpawnAgentRequest, SpawnAgentsBatchRequest } from '$lib/types/agent';

// =============================================================================
// Agent Manager — Lightweight agent spawn/wait/cancel engine
// =============================================================================
// Manages dynamic CLI-subprocess agents spawned by the orchestrator.
// Each agent is a Claude CLI process dispatched via claude-bridge.

const globalKey = '__spyre_agent_emitter__';
const globalObj = globalThis as Record<string, unknown>;
if (!globalObj[globalKey]) {
  const e = new EventEmitter();
  e.setMaxListeners(100);
  globalObj[globalKey] = e;
}
const emitter = globalObj[globalKey] as EventEmitter;

export function getEmitter(): EventEmitter {
  return emitter;
}

// =============================================================================
// Spawn a single lightweight agent
// =============================================================================

export interface SpawnAgentOptions {
  envId: string;
  orchestratorId?: string;
  name: string;
  role?: string;
  personaId?: string;
  taskPrompt: string;
  model?: 'haiku' | 'sonnet' | 'opus';
  waveId?: string;
  wavePosition?: number;
  context?: Record<string, unknown>;
}

export async function spawnAgent(opts: SpawnAgentOptions): Promise<LightweightAgent> {
  const db = getDb();
  const agentId = uuid();
  const now = new Date().toISOString();

  // Resolve persona for prompt framing
  const persona = opts.personaId ? getPersona(opts.personaId) ?? null : null;
  const model = opts.model ?? (persona as Record<string, unknown> | null)?.default_model as string ?? 'sonnet';

  // Create DB record
  db.prepare(`
    INSERT INTO lightweight_agents
      (id, env_id, orchestrator_id, name, role, persona_id, task_prompt, model,
       status, wave_id, wave_position, context, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)
  `).run(
    agentId, opts.envId, opts.orchestratorId ?? null,
    opts.name, opts.role ?? null, opts.personaId ?? null,
    opts.taskPrompt, model,
    opts.waveId ?? null, opts.wavePosition ?? null,
    opts.context ? JSON.stringify(opts.context) : null,
    now, now
  );

  const agent = getAgent(agentId)!;
  emitter.emit(`agent:${agentId}:spawned`, { agent });

  // Update status to spawning
  db.prepare(
    "UPDATE lightweight_agents SET status = 'spawning', spawned_at = ?, updated_at = ? WHERE id = ?"
  ).run(now, now, agentId);

  // Resolve environment for project context
  const env = getEnvironment(opts.envId);
  const projectContext = env ? {
    projectDir: env.project_dir ?? undefined,
    repoUrl: env.repo_url ?? null,
    gitBranch: env.git_branch ?? undefined,
  } : null;

  // Build framed prompt
  const framedPrompt = buildAgentPrompt(opts.taskPrompt, persona, opts.context, projectContext);

  // Dispatch via claude-bridge — run in project dir so CLAUDE.md is accessible
  try {
    const taskId = await claudeDispatch({
      envId: opts.envId,
      prompt: framedPrompt,
      model: model as 'haiku' | 'sonnet' | 'opus',
      lightweightAgentId: agentId,
      workingDir: projectContext?.projectDir,
    });

    db.prepare(
      "UPDATE lightweight_agents SET task_id = ?, status = 'running', updated_at = datetime('now') WHERE id = ?"
    ).run(taskId, agentId);

    emitter.emit(`agent:${agentId}:running`, { agentId });

    // Forward claude-bridge task events to agent events
    const claudeEmitter = getClaudeEmitter();

    const onTaskEvent = (event: Record<string, unknown>) => {
      emitter.emit(`agent:${agentId}:output`, { agentId, event });
    };

    const onTaskComplete = (event: Record<string, unknown>) => {
      claudeEmitter.removeListener(`task:${taskId}:event`, onTaskEvent);
      claudeEmitter.removeListener(`task:${taskId}:complete`, onTaskComplete);

      const task = getTask(taskId);
      const costUsd = task?.cost_usd ?? null;
      const result = task?.result ?? null;
      const resultSummary = result ? (typeof result === 'string' ? result.slice(0, 500) : String(result).slice(0, 500)) : null;

      const status = (event.status === 'complete') ? 'completed' : 'error';
      const errorMessage = status === 'error' ? (event.error as string ?? 'Unknown error') : null;

      db.prepare(`
        UPDATE lightweight_agents
        SET status = ?, result_summary = ?, result_full = ?, cost_usd = ?,
            error_message = ?, completed_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ?
      `).run(status, resultSummary, result, costUsd, errorMessage, agentId);

      const updatedAgent = getAgent(agentId)!;
      emitter.emit(`agent:${agentId}:complete`, { agent: updatedAgent });

      // Update orchestrator counters if linked
      if (opts.orchestratorId) {
        try {
          db.prepare(`
            UPDATE orchestrator_sessions
            SET total_cost_usd = total_cost_usd + ?,
                updated_at = datetime('now')
            WHERE id = ?
          `).run(costUsd ?? 0, opts.orchestratorId);
        } catch { /* non-critical */ }
      }

      // Check if wave is complete
      if (opts.waveId) {
        checkWaveComplete(opts.waveId);
      }
    };

    claudeEmitter.on(`task:${taskId}:event`, onTaskEvent);
    claudeEmitter.on(`task:${taskId}:complete`, onTaskComplete);

  } catch (err) {
    const message = err instanceof Error ? err.message : String((err as { message?: string }).message ?? err);
    db.prepare(
      "UPDATE lightweight_agents SET status = 'error', error_message = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(message, agentId);
    emitter.emit(`agent:${agentId}:error`, { agentId, error: message });
  }

  return getAgent(agentId)!;
}

// =============================================================================
// Batch spawn (wave)
// =============================================================================

export async function spawnAgents(
  envId: string,
  orchestratorId: string | undefined,
  batch: SpawnAgentsBatchRequest
): Promise<{ waveId: string; agents: LightweightAgent[] }> {
  const waveId = uuid();
  const db = getDb();

  // Increment wave count on orchestrator
  if (orchestratorId) {
    db.prepare(`
      UPDATE orchestrator_sessions
      SET wave_count = wave_count + 1,
          agent_count = agent_count + ?,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(batch.agents.length, orchestratorId);
  }

  const agents = await Promise.all(
    batch.agents.map((req, idx) =>
      spawnAgent({
        envId,
        orchestratorId,
        name: req.name,
        role: req.role,
        personaId: req.persona_id,
        taskPrompt: req.task,
        model: req.model,
        waveId,
        wavePosition: idx,
        context: req.context,
      })
    )
  );

  return { waveId, agents };
}

// =============================================================================
// Wait for agents
// =============================================================================

export function waitForAgents(
  agentIds: string[],
  timeoutMs = 600000
): Promise<LightweightAgent[]> {
  return new Promise((resolve, reject) => {
    const results = new Map<string, LightweightAgent>();
    const listeners: Array<() => void> = [];

    const timer = setTimeout(() => {
      cleanup();
      // Return whatever we have so far + mark pending as timed out
      const agents = agentIds.map(id => results.get(id) ?? getAgent(id)!);
      resolve(agents);
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      for (const unsub of listeners) unsub();
    }

    function checkDone() {
      if (results.size >= agentIds.length) {
        cleanup();
        resolve(agentIds.map(id => results.get(id)!));
      }
    }

    for (const id of agentIds) {
      // Check if already terminal
      const existing = getAgent(id);
      if (existing && isTerminalStatus(existing.status)) {
        results.set(id, existing);
        continue;
      }

      const onComplete = (data: { agent: LightweightAgent }) => {
        results.set(id, data.agent);
        checkDone();
      };

      const onError = () => {
        const agent = getAgent(id);
        if (agent) results.set(id, agent);
        checkDone();
      };

      emitter.on(`agent:${id}:complete`, onComplete);
      emitter.on(`agent:${id}:error`, onError);
      listeners.push(() => {
        emitter.removeListener(`agent:${id}:complete`, onComplete);
        emitter.removeListener(`agent:${id}:error`, onError);
      });
    }

    // Check if all are already done
    checkDone();
  });
}

// =============================================================================
// Query / Cancel
// =============================================================================

export function getAgent(id: string): LightweightAgent | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM lightweight_agents WHERE id = ?').get(id) as LightweightAgent) ?? null;
}

export function getAgentWithPersona(id: string): LightweightAgentWithPersona | null {
  const db = getDb();
  return (db.prepare(`
    SELECT la.*, p.name as persona_name, p.role as persona_role, p.avatar as persona_avatar
    FROM lightweight_agents la
    LEFT JOIN personas p ON la.persona_id = p.id
    WHERE la.id = ?
  `).get(id) as LightweightAgentWithPersona) ?? null;
}

export function listAgents(
  envId: string,
  orchestratorId?: string
): LightweightAgentWithPersona[] {
  const db = getDb();
  const conditions = ['la.env_id = ?'];
  const params: unknown[] = [envId];

  if (orchestratorId) {
    conditions.push('la.orchestrator_id = ?');
    params.push(orchestratorId);
  }

  return db.prepare(`
    SELECT la.*, p.name as persona_name, p.role as persona_role, p.avatar as persona_avatar
    FROM lightweight_agents la
    LEFT JOIN personas p ON la.persona_id = p.id
    WHERE ${conditions.join(' AND ')}
    ORDER BY la.created_at ASC
  `).all(...params) as LightweightAgentWithPersona[];
}

export function cancelAgent(id: string): boolean {
  const db = getDb();
  const agent = getAgent(id);
  if (!agent) return false;

  if (isTerminalStatus(agent.status)) return false;

  // Cancel underlying claude task
  if (agent.task_id) {
    cancelTask(agent.task_id);
  }

  db.prepare(
    "UPDATE lightweight_agents SET status = 'cancelled', completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
  ).run(id);

  emitter.emit(`agent:${id}:complete`, { agent: getAgent(id) });
  return true;
}

// =============================================================================
// Helpers
// =============================================================================

function isTerminalStatus(status: string): boolean {
  return status === 'completed' || status === 'error' || status === 'cancelled';
}

function buildAgentPrompt(
  taskPrompt: string,
  persona: ReturnType<typeof getPersona> | null,
  context?: Record<string, unknown> | null,
  projectContext?: { projectDir?: string; repoUrl?: string | null; gitBranch?: string } | null
): string {
  const parts: string[] = [];

  if (persona) {
    parts.push(`You are ${persona.name}, a ${persona.role}.`);
    parts.push('');
    if (persona.instructions.trim()) {
      parts.push(persona.instructions);
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

  if (context && Object.keys(context).length > 0) {
    parts.push('## Context from Prior Agents');
    for (const [key, value] of Object.entries(context)) {
      const valStr = typeof value === 'string' ? value : JSON.stringify(value);
      parts.push(`- ${key}: ${valStr.slice(0, 1000)}`);
    }
    parts.push('');
  }

  parts.push('## Task');
  parts.push(taskPrompt);

  return parts.join('\n');
}

function checkWaveComplete(waveId: string): void {
  const db = getDb();
  const pending = db.prepare(
    "SELECT COUNT(*) as count FROM lightweight_agents WHERE wave_id = ? AND status NOT IN ('completed', 'error', 'cancelled')"
  ).get(waveId) as { count: number };

  if (pending.count === 0) {
    const agents = db.prepare(
      'SELECT * FROM lightweight_agents WHERE wave_id = ? ORDER BY wave_position ASC'
    ).all(waveId) as LightweightAgent[];

    emitter.emit(`wave:${waveId}:complete`, { waveId, agents });
  }
}
