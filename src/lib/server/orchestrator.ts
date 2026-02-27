import { EventEmitter } from 'node:events';
import { v4 as uuid } from 'uuid';
import { getDb } from './db';
import { dispatch as claudeDispatch, getEmitter as getClaudeEmitter, cancelTask } from './claude-bridge';
import { getEnvironment } from './environments';
import { getEnvConfig } from './env-config';
import { listPersonas, getPersona } from './personas';
import { cancelAgent, listAgents as listLightweightAgents, getEmitter as getAgentEmitter } from './agent-manager';
import { generateMcpToken } from './mcp-auth';
import type { OrchestratorSession } from '$lib/types/orchestrator';
import type { LightweightAgent } from '$lib/types/agent';

// =============================================================================
// Orchestrator — Dynamic LLM-driven agent orchestration
// =============================================================================
// The orchestrator is itself a Claude session that uses MCP tools
// (spyre_spawn_agent, spyre_wait_for_agents, etc.) to dynamically
// create and coordinate lightweight agent processes.

const globalKey = '__spyre_orchestrator_emitter__';
const globalObj = globalThis as Record<string, unknown>;
if (!globalObj[globalKey]) {
  const e = new EventEmitter();
  e.setMaxListeners(50);
  globalObj[globalKey] = e;
}
const emitter = globalObj[globalKey] as EventEmitter;

export function getEmitter(): EventEmitter {
  return emitter;
}

// =============================================================================
// Start Orchestrator
// =============================================================================

export interface StartOrchestratorOptions {
  envId: string;
  goal: string;
  model?: 'haiku' | 'sonnet' | 'opus';
  personaIds?: string[];
  pipelineId?: string;
}

export async function startOrchestrator(opts: StartOrchestratorOptions): Promise<OrchestratorSession> {
  const db = getDb();
  const sessionId = uuid();
  const now = new Date().toISOString();
  const model = opts.model ?? 'sonnet';

  // Resolve personas for the system prompt
  const personas = opts.personaIds
    ? opts.personaIds.map(id => getPersona(id)).filter((p): p is NonNullable<typeof p> => p != null)
    : listPersonas();

  const systemPrompt = buildOrchestratorPrompt(opts.goal, personas);

  // Create session record
  db.prepare(`
    INSERT INTO orchestrator_sessions
      (id, env_id, pipeline_id, goal, system_prompt, model, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
  `).run(sessionId, opts.envId, opts.pipelineId ?? null, opts.goal, systemPrompt, model, now, now);

  // Generate orchestrator MCP token with 'orchestrator' role
  const mcpToken = generateMcpToken(opts.envId, `orch-${sessionId}`, 'orchestrator');

  // Build the MCP config for the orchestrator
  const env = getEnvironment(opts.envId);
  const controllerUrl = getControllerUrl();
  const mcpConfig = {
    mcpServers: {
      spyre: {
        type: 'http',
        url: `${controllerUrl}/mcp`,
        headers: {
          Authorization: `Bearer ${mcpToken}`
        }
      }
    }
  };

  // Dispatch the orchestrator's Claude task
  try {
    const taskId = await claudeDispatch({
      envId: opts.envId,
      prompt: systemPrompt,
      model: model as 'haiku' | 'sonnet' | 'opus',
      mcpRole: 'orchestrator',
    });

    db.prepare(`
      UPDATE orchestrator_sessions
      SET task_id = ?, status = 'running', started_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?
    `).run(taskId, sessionId);

    // Forward claude-bridge events to orchestrator emitter
    const claudeEmitter = getClaudeEmitter();
    const agentEmitter = getAgentEmitter();

    const onTaskEvent = (event: Record<string, unknown>) => {
      emitter.emit(`orchestrator:${sessionId}:event`, { sessionId, event });
    };

    const onTaskComplete = (event: Record<string, unknown>) => {
      claudeEmitter.removeListener(`task:${taskId}:event`, onTaskEvent);
      claudeEmitter.removeListener(`task:${taskId}:complete`, onTaskComplete);

      const status = (event.status === 'complete') ? 'completed' : 'error';
      const errorMessage = status === 'error' ? (event.error as string ?? 'Orchestrator task failed') : null;
      const result = event.result as string ?? null;

      db.prepare(`
        UPDATE orchestrator_sessions
        SET status = ?, result_summary = ?, error_message = ?,
            completed_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ?
      `).run(status, result?.slice(0, 2000) ?? null, errorMessage, sessionId);

      emitter.emit(`orchestrator:${sessionId}:complete`, {
        sessionId,
        status,
        result,
        error: errorMessage
      });
    };

    claudeEmitter.on(`task:${taskId}:event`, onTaskEvent);
    claudeEmitter.on(`task:${taskId}:complete`, onTaskComplete);

    // Forward agent spawned/complete events as orchestrator events
    const onAgentSpawned = (data: { agent: LightweightAgent }) => {
      if (data.agent.orchestrator_id === sessionId) {
        emitter.emit(`orchestrator:${sessionId}:agent-spawn`, {
          sessionId,
          agent: data.agent
        });
      }
    };

    const onAgentComplete = (data: { agent: LightweightAgent }) => {
      if (data.agent.orchestrator_id === sessionId) {
        emitter.emit(`orchestrator:${sessionId}:agent-complete`, {
          sessionId,
          agent: data.agent
        });
      }
    };

    // Listen for all agent events (using a wildcard-like approach)
    // We subscribe to agent emitter events and filter by orchestrator_id
    agentEmitter.on('agent-spawned-global', onAgentSpawned);
    agentEmitter.on('agent-complete-global', onAgentComplete);

  } catch (err) {
    const message = err instanceof Error ? err.message : String((err as { message?: string }).message ?? err);
    db.prepare(
      "UPDATE orchestrator_sessions SET status = 'error', error_message = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(message, sessionId);
  }

  return getSession(sessionId)!;
}

// =============================================================================
// Cancel Orchestrator
// =============================================================================

export async function cancelOrchestrator(sessionId: string): Promise<boolean> {
  const db = getDb();
  const session = getSession(sessionId);
  if (!session) return false;

  if (session.status === 'completed' || session.status === 'error' || session.status === 'cancelled') {
    return false;
  }

  // Cancel the orchestrator's own task
  if (session.task_id) {
    cancelTask(session.task_id);
  }

  // Cancel all spawned lightweight agents
  const agents = listLightweightAgents(session.env_id, sessionId);
  for (const agent of agents) {
    if (agent.status !== 'completed' && agent.status !== 'error' && agent.status !== 'cancelled') {
      cancelAgent(agent.id);
    }
  }

  db.prepare(
    "UPDATE orchestrator_sessions SET status = 'cancelled', completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
  ).run(sessionId);

  emitter.emit(`orchestrator:${sessionId}:complete`, {
    sessionId,
    status: 'cancelled'
  });

  return true;
}

// =============================================================================
// Query
// =============================================================================

export function getSession(id: string): OrchestratorSession | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM orchestrator_sessions WHERE id = ?').get(id) as OrchestratorSession) ?? null;
}

export function listSessions(envId: string): OrchestratorSession[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM orchestrator_sessions WHERE env_id = ? ORDER BY created_at DESC'
  ).all(envId) as OrchestratorSession[];
}

// =============================================================================
// Helpers
// =============================================================================

function buildOrchestratorPrompt(
  goal: string,
  personas: Array<{ name: string; role: string; description?: string | null; id: string }>
): string {
  const parts: string[] = [];

  parts.push('You are an orchestrator managing a development project.');
  parts.push('');
  parts.push('## Your Goal');
  parts.push(goal);
  parts.push('');
  parts.push('## Available Agent Personas');
  for (const p of personas) {
    parts.push(`- ${p.name} (${p.role}): ${p.description ?? 'No description'} [persona_id: ${p.id}]`);
  }
  parts.push('');
  parts.push('## MCP Tools');
  parts.push('- spyre_spawn_agent: Spawn an agent for a specific task');
  parts.push('- spyre_spawn_agents: Spawn a wave of parallel agents');
  parts.push('- spyre_wait_for_agents: Wait for agents to complete');
  parts.push('- spyre_get_agent_status: Check an agent\'s result');
  parts.push('- spyre_ask_user: Ask the human a question');
  parts.push('');
  parts.push('## Execution Pattern');
  parts.push('1. Analyze the goal, break into parallel workstreams');
  parts.push('2. Spawn Wave 1 for independent tasks (use spyre_spawn_agents)');
  parts.push('3. Wait for Wave 1 (use spyre_wait_for_agents)');
  parts.push('4. Review results, forward context to Wave 2');
  parts.push('5. Continue until complete');
  parts.push('6. Summarize accomplishments');
  parts.push('');
  parts.push('## Rules');
  parts.push('- Parallelize independent work (never serialize what can run concurrently)');
  parts.push('- Forward relevant outputs from completed agents to downstream agents via context');
  parts.push('- Use spyre_ask_user for ambiguous requirements');
  parts.push('- Choose model per-agent: haiku for simple, sonnet for standard, opus for complex');
  parts.push('- When spawning agents, use persona_id to give them specialized knowledge');

  return parts.join('\n');
}

function getControllerUrl(): string {
  try {
    const config = getEnvConfig();
    return config.controller?.url ?? 'http://localhost:3000';
  } catch {
    return 'http://localhost:3000';
  }
}
