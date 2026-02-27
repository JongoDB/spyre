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

  // Resolve environment context for the prompt
  const env = getEnvironment(opts.envId);
  const envContext = env ? {
    projectDir: env.project_dir ?? undefined,
    repoUrl: env.repo_url ?? null,
    gitBranch: env.git_branch ?? undefined,
  } : null;

  const systemPrompt = buildOrchestratorPrompt(opts.goal, personas, envContext);

  // Create session record
  db.prepare(`
    INSERT INTO orchestrator_sessions
      (id, env_id, pipeline_id, goal, system_prompt, model, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)
  `).run(sessionId, opts.envId, opts.pipelineId ?? null, opts.goal, systemPrompt, model, now, now);

  // Generate orchestrator MCP token with 'orchestrator' role
  const mcpToken = generateMcpToken(opts.envId, `orch-${sessionId}`, 'orchestrator');

  // Build the MCP config for the orchestrator
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
  personas: Array<{ name: string; role: string; description?: string | null; instructions?: string; id: string }>,
  envContext?: { projectDir?: string; repoUrl?: string | null; gitBranch?: string } | null
): string {
  const parts: string[] = [];

  parts.push('You are an orchestrator managing a development project. You coordinate specialized agents to accomplish complex goals efficiently.');
  parts.push('');
  parts.push('## Your Goal');
  parts.push(goal);
  parts.push('');

  // Environment context
  if (envContext?.repoUrl || envContext?.projectDir) {
    parts.push('## Environment Context');
    parts.push(`- Project directory: ${envContext.projectDir ?? '/project'}`);
    parts.push(`- Repository: ${envContext.repoUrl ?? 'local'}`);
    parts.push(`- Branch: ${envContext.gitBranch ?? 'main'}`);
    parts.push('');
  }

  parts.push('## Available Agent Personas');
  for (const p of personas) {
    parts.push(`- **${p.name}** (${p.role}): ${p.description ?? 'No description'}`);
    // Include brief expertise summary from instructions
    if (p.instructions) {
      const expertise = p.instructions.slice(0, 200).replace(/\n/g, ' ').trim();
      parts.push(`  Expertise: ${expertise}${p.instructions.length > 200 ? '...' : ''}`);
    }
    parts.push(`  [persona_id: ${p.id}]`);
  }
  parts.push('');
  parts.push('## MCP Tools');
  parts.push('- **spyre_spawn_agent**: Spawn a single agent. Params: name, role, task, persona_id, model, context');
  parts.push('- **spyre_spawn_agents**: Spawn a wave of parallel agents. Params: wave_name, agents[]');
  parts.push('- **spyre_wait_for_agents**: Block until specified agents complete. Params: agent_ids[], timeout_ms');
  parts.push('- **spyre_get_agent_status**: Check an agent\'s current status and result. Params: agent_id');
  parts.push('- **spyre_ask_user**: Ask the human operator a question. Params: question');
  parts.push('');
  parts.push('## Execution Pattern');
  parts.push('1. **Analyze**: Decompose the goal into discrete, well-defined tasks. Identify dependencies between tasks.');
  parts.push('2. **Plan waves**: Group independent tasks into parallel waves. Tasks with dependencies go in later waves.');
  parts.push('3. **Spawn Wave 1**: Use spyre_spawn_agents for parallel tasks. Give each agent a clear, self-contained task description with all context it needs.');
  parts.push('4. **Wait and review**: Use spyre_wait_for_agents. Examine each agent\'s output carefully — check for errors, incomplete work, or conflicts.');
  parts.push('5. **Forward context**: Pass relevant outputs from completed agents to downstream agents via the context parameter. Be selective — only forward what the next agent needs.');
  parts.push('6. **Iterate**: Continue spawning waves until the goal is complete. Adapt the plan based on intermediate results.');
  parts.push('7. **Synthesize**: Write a clear summary of what was accomplished, any issues found, and remaining work if applicable.');
  parts.push('');
  parts.push('## Task Design Guidelines');
  parts.push('- **Single-task goals**: If the goal is straightforward (one file, one function, one bug), use a single agent. Don\'t over-decompose.');
  parts.push('- **Multi-task goals**: Break into the smallest independent units. Each agent should be able to work without blocking on another.');
  parts.push('- **Context is critical**: Agents cannot see each other\'s work in real-time. Forward specific file paths, function signatures, or decision summaries — not vague references.');
  parts.push('- **Persona matching**: Match personas to tasks based on their expertise. Use the Architect for design decisions, Backend for API/DB work, Frontend for UI, Tester for validation, Reviewer for code review, DevOps for infrastructure.');
  parts.push('- **Model selection**: Use haiku for simple/routine tasks (file lookups, simple edits), sonnet for standard tasks (feature implementation, testing), opus for complex tasks (architecture, multi-file refactors, subtle bugs).');
  parts.push('');
  parts.push('## Rules');
  parts.push('- Parallelize independent work — never serialize what can run concurrently.');
  parts.push('- Give each agent complete context. Agents run in isolation and cannot ask each other questions.');
  parts.push('- Use spyre_ask_user when requirements are ambiguous — don\'t guess at user intent.');
  parts.push('- If an agent fails or produces poor results, analyze why before retrying. Adjust the task description or persona.');
  parts.push('- When spawning agents, always use persona_id to give them specialized knowledge and instructions.');

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
