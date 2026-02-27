import { v4 as uuid } from 'uuid';
import { getDb } from './db';
import { getEnvironment } from './environments';
import { listDevcontainers } from './devcontainers';
import { getActiveTaskForEnv, listTasks } from './claude-bridge';
import { getProgressForEnv, getGitActivityForEnv } from './claude-poller';
import { getPipelineWithSteps, listPipelines } from './pipeline-engine';
import { getServicesForEnv } from './service-detector';
import {
  spawnAgent,
  spawnAgents as spawnAgentsBatch,
  waitForAgents,
  getAgentWithPersona,
  listAgents as listLightweightAgents,
  getEmitter as getAgentEmitter,
} from './agent-manager';
import type { McpTokenPayload } from './mcp-auth';

// =============================================================================
// MCP Tool Handlers — Business logic for each Spyre MCP tool
// =============================================================================
// Each function takes auth context (envId, agentId) plus tool-specific params.

/**
 * spyre_get_env_status — Query environment state, IP, resources
 */
export async function getEnvStatus(auth: McpTokenPayload): Promise<Record<string, unknown>> {
  const env = getEnvironment(auth.envId);
  if (!env) {
    return { error: 'Environment not found', envId: auth.envId };
  }

  let metadata: Record<string, unknown> = {};
  if (env.metadata) {
    try {
      metadata = JSON.parse(env.metadata);
      // Strip sensitive fields
      delete metadata.root_password;
    } catch { /* ignore */ }
  }

  return {
    id: env.id,
    name: env.name,
    status: env.status,
    type: env.type,
    ip_address: env.ip_address,
    node: env.node,
    docker_enabled: env.docker_enabled ? true : false,
    repo_url: env.repo_url ?? null,
    git_branch: env.git_branch ?? null,
    project_dir: env.project_dir ?? null,
    project_name: env.project_name ?? null,
    created_at: env.created_at,
    updated_at: env.updated_at,
    metadata,
  };
}

/**
 * spyre_list_agents — All devcontainers + their current tasks
 */
export async function listAgents(auth: McpTokenPayload): Promise<Record<string, unknown>> {
  const devcontainers = listDevcontainers(auth.envId);

  const agents = devcontainers.map((dc) => {
    // Check for active task on this devcontainer
    const db = getDb();
    const activeTask = db.prepare(`
      SELECT id, prompt, status, started_at FROM claude_tasks
      WHERE devcontainer_id = ? AND status IN ('pending', 'running')
      ORDER BY created_at DESC LIMIT 1
    `).get(dc.id) as { id: string; prompt: string; status: string; started_at: string } | undefined;

    // Get cached progress for this devcontainer
    const progressRow = db.prepare(
      'SELECT progress FROM devcontainer_progress WHERE devcontainer_id = ?'
    ).get(dc.id) as { progress: string } | undefined;

    let currentTask: string | null = null;
    if (progressRow?.progress) {
      try {
        const p = JSON.parse(progressRow.progress);
        currentTask = p.current_task ?? null;
      } catch { /* ignore */ }
    }

    return {
      id: dc.id,
      service_name: dc.service_name,
      container_name: dc.container_name,
      status: dc.status,
      persona_name: dc.persona_name ?? null,
      persona_role: dc.persona_role ?? null,
      active_task: activeTask ? {
        id: activeTask.id,
        prompt: activeTask.prompt.slice(0, 200),
        status: activeTask.status,
        started_at: activeTask.started_at,
      } : null,
      current_task: currentTask,
    };
  });

  // Also include lightweight agents
  const lwAgents = listLightweightAgents(auth.envId);
  const lightweightList = lwAgents.map(la => ({
    id: la.id,
    type: 'lightweight',
    name: la.name,
    status: la.status,
    persona_name: la.persona_name ?? null,
    persona_role: la.persona_role ?? null,
    model: la.model,
    wave_id: la.wave_id,
    result: la.result_summary?.slice(0, 200) ?? null,
    cost_usd: la.cost_usd,
    spawned_at: la.spawned_at,
    completed_at: la.completed_at,
  }));

  return { env_id: auth.envId, agents, lightweight_agents: lightweightList };
}

/**
 * spyre_get_pipeline_context — Active pipeline, steps, gate feedback
 */
export async function getPipelineContext(
  auth: McpTokenPayload,
  params: { pipelineId?: string }
): Promise<Record<string, unknown>> {
  if (params.pipelineId) {
    const pipeline = getPipelineWithSteps(params.pipelineId);
    if (!pipeline) {
      return { error: 'Pipeline not found', pipelineId: params.pipelineId };
    }
    return formatPipeline(pipeline);
  }

  // Find the most recent active pipeline for this environment
  const allPipelines = listPipelines(auth.envId);
  const active = allPipelines.find(p => p.status === 'running' || p.status === 'paused');

  if (!active) {
    // Return most recent completed pipeline for context
    const recent = allPipelines[0];
    if (recent) {
      const full = getPipelineWithSteps(recent.id);
      if (full) return { ...formatPipeline(full), note: 'No active pipeline. Showing most recent.' };
    }
    return { message: 'No pipelines found for this environment.' };
  }

  const full = getPipelineWithSteps(active.id);
  if (!full) return { error: 'Pipeline data could not be loaded.' };
  return formatPipeline(full);
}

function formatPipeline(pipeline: ReturnType<typeof getPipelineWithSteps>): Record<string, unknown> {
  if (!pipeline) return {};
  return {
    id: pipeline.id,
    name: pipeline.name,
    description: pipeline.description,
    status: pipeline.status,
    current_position: pipeline.current_position,
    total_cost_usd: pipeline.total_cost_usd,
    auto_approve: pipeline.auto_approve,
    started_at: pipeline.started_at,
    completed_at: pipeline.completed_at,
    steps: pipeline.steps.map(s => ({
      id: s.id,
      position: s.position,
      type: s.type,
      label: s.label,
      status: s.status,
      persona_name: s.persona_name ?? null,
      result_summary: s.result_summary?.slice(0, 500) ?? null,
      gate_result: s.gate_result ?? null,
      gate_feedback: s.gate_feedback?.slice(0, 500) ?? null,
      iteration: s.iteration,
      cost_usd: s.cost_usd,
    })),
  };
}

/**
 * spyre_report_progress — Push structured progress update
 */
export async function reportProgress(
  auth: McpTokenPayload,
  params: { status: string; currentTask: string; details?: string }
): Promise<Record<string, unknown>> {
  const db = getDb();
  const now = new Date().toISOString();

  // Build progress JSON matching .spyre/progress.json schema
  const progress = JSON.stringify({
    plan: params.details ?? null,
    phases: [],
    current_task: params.currentTask,
    blockers: [],
    metrics: {},
    status: params.status,
    updated_at: now,
  });

  // Determine if this is a devcontainer agent or env-level agent
  if (auth.agentId.startsWith('dc-') || !auth.agentId.startsWith('env-')) {
    // Try devcontainer progress first
    const dc = db.prepare(
      'SELECT id FROM devcontainers WHERE id = ? AND env_id = ?'
    ).get(auth.agentId, auth.envId) as { id: string } | undefined;

    if (dc) {
      db.prepare(`
        INSERT OR REPLACE INTO devcontainer_progress (devcontainer_id, progress, fetched_at)
        VALUES (?, ?, datetime('now'))
      `).run(auth.agentId, progress);

      return { success: true, target: 'devcontainer', agentId: auth.agentId, updated_at: now };
    }
  }

  // Fall back to environment-level progress
  db.prepare(`
    INSERT OR REPLACE INTO claude_progress (env_id, progress, fetched_at)
    VALUES (?, ?, datetime('now'))
  `).run(auth.envId, progress);

  return { success: true, target: 'environment', envId: auth.envId, updated_at: now };
}

/**
 * spyre_get_services — Detected web services and ports
 */
export async function getServices(auth: McpTokenPayload): Promise<Record<string, unknown>> {
  const services = getServicesForEnv(auth.envId);
  return {
    env_id: auth.envId,
    services: services.map(s => ({
      id: s.id,
      name: s.name,
      port: s.port,
      protocol: s.protocol,
      status: s.status,
      proxy_url: s.proxy_url ?? null,
    })),
  };
}

/**
 * spyre_get_git_activity — Branch, recent commits, diff stats
 */
export async function getGitActivity(auth: McpTokenPayload): Promise<Record<string, unknown>> {
  const activity = getGitActivityForEnv(auth.envId);
  if (!activity) {
    return { env_id: auth.envId, message: 'No git activity data available yet.' };
  }

  return {
    env_id: auth.envId,
    branch: activity.branch,
    recent_commits: activity.recent_commits,
    diff_stat: activity.diff_stat,
    git_status: activity.git_status,
    fetched_at: activity.fetched_at,
  };
}

/**
 * spyre_get_task_history — Recent Claude tasks for this env
 */
export async function getTaskHistory(
  auth: McpTokenPayload,
  params: { limit?: number }
): Promise<Record<string, unknown>> {
  const limit = Math.min(params.limit ?? 10, 50);
  const tasks = listTasks({ envId: auth.envId, limit });

  return {
    env_id: auth.envId,
    tasks: tasks.map(t => ({
      id: t.id,
      prompt: t.prompt.slice(0, 200),
      status: t.status,
      result: t.result?.slice(0, 500) ?? null,
      cost_usd: t.cost_usd ?? null,
      error_message: t.error_message ?? null,
      devcontainer_id: t.devcontainer_id ?? null,
      started_at: t.started_at,
      completed_at: t.completed_at,
      created_at: t.created_at,
    })),
  };
}

/**
 * spyre_send_message — Post message to another agent's context
 */
export async function sendMessage(
  auth: McpTokenPayload,
  params: { targetAgentId: string; message: string }
): Promise<Record<string, unknown>> {
  const db = getDb();
  const id = uuid();

  db.prepare(`
    INSERT INTO agent_messages (id, env_id, from_agent_id, to_agent_id, message, read, created_at)
    VALUES (?, ?, ?, ?, ?, 0, datetime('now'))
  `).run(id, auth.envId, auth.agentId, params.targetAgentId, params.message);

  return {
    success: true,
    messageId: id,
    from: auth.agentId,
    to: params.targetAgentId,
  };
}

/**
 * Retrieve unread messages for the current agent (used by get_pipeline_context and directly).
 */
export function getUnreadMessages(auth: McpTokenPayload): Array<{ id: string; from: string; message: string; created_at: string }> {
  const db = getDb();
  const messages = db.prepare(`
    SELECT id, from_agent_id, message, created_at
    FROM agent_messages
    WHERE env_id = ? AND to_agent_id = ? AND read = 0
    ORDER BY created_at ASC
  `).all(auth.envId, auth.agentId) as Array<{ id: string; from_agent_id: string; message: string; created_at: string }>;

  // Mark as read
  if (messages.length > 0) {
    const ids = messages.map(m => m.id);
    db.prepare(
      `UPDATE agent_messages SET read = 1 WHERE id IN (${ids.map(() => '?').join(',')})`
    ).run(...ids);
  }

  return messages.map(m => ({
    id: m.id,
    from: m.from_agent_id,
    message: m.message,
    created_at: m.created_at,
  }));
}

// =============================================================================
// Dynamic Agent Orchestration Handlers
// =============================================================================

/**
 * spyre_spawn_agent — Spawn a single lightweight agent
 */
export async function handleSpawnAgent(
  auth: McpTokenPayload,
  params: {
    name: string;
    role?: string;
    persona_id?: string;
    task: string;
    model?: 'haiku' | 'sonnet' | 'opus';
    wait?: boolean;
    context?: Record<string, unknown>;
  }
): Promise<Record<string, unknown>> {
  // Find orchestrator session for this agent (auth.agentId is the orchestrator's task agent ID)
  const db = getDb();
  const orch = db.prepare(
    "SELECT id FROM orchestrator_sessions WHERE env_id = ? AND status = 'running' ORDER BY created_at DESC LIMIT 1"
  ).get(auth.envId) as { id: string } | undefined;

  const agent = await spawnAgent({
    envId: auth.envId,
    orchestratorId: orch?.id,
    name: params.name,
    role: params.role,
    personaId: params.persona_id,
    taskPrompt: params.task,
    model: params.model,
    context: params.context,
  });

  if (params.wait) {
    const [completed] = await waitForAgents([agent.id], 600000);
    return {
      agent_id: completed.id,
      name: completed.name,
      status: completed.status,
      result: completed.result_summary,
      cost_usd: completed.cost_usd,
      error: completed.error_message,
    };
  }

  return {
    agent_id: agent.id,
    name: agent.name,
    status: agent.status,
    message: 'Agent spawned. Use spyre_wait_for_agents or spyre_get_agent_status to check progress.',
  };
}

/**
 * spyre_spawn_agents — Batch spawn a wave of parallel agents
 */
export async function handleSpawnAgents(
  auth: McpTokenPayload,
  params: {
    wave_name?: string;
    agents: Array<{
      name: string;
      role?: string;
      persona_id?: string;
      task: string;
      model?: 'haiku' | 'sonnet' | 'opus';
      context?: Record<string, unknown>;
    }>;
  }
): Promise<Record<string, unknown>> {
  const db = getDb();
  const orch = db.prepare(
    "SELECT id FROM orchestrator_sessions WHERE env_id = ? AND status = 'running' ORDER BY created_at DESC LIMIT 1"
  ).get(auth.envId) as { id: string } | undefined;

  const result = await spawnAgentsBatch(auth.envId, orch?.id, {
    wave_name: params.wave_name,
    agents: params.agents.map(a => ({
      name: a.name,
      role: a.role,
      task: a.task,
      model: a.model,
      persona_id: a.persona_id,
      context: a.context,
    })),
  });

  return {
    wave_id: result.waveId,
    wave_name: params.wave_name ?? null,
    agents: result.agents.map(a => ({
      agent_id: a.id,
      name: a.name,
      status: a.status,
    })),
    message: `${result.agents.length} agents spawned. Use spyre_wait_for_agents with the agent IDs to wait for completion.`,
  };
}

/**
 * spyre_wait_for_agents — Wait for agents to reach terminal status
 */
export async function handleWaitForAgents(
  auth: McpTokenPayload,
  params: { agent_ids: string[]; timeout_seconds?: number }
): Promise<Record<string, unknown>> {
  const timeoutMs = (params.timeout_seconds ?? 600) * 1000;
  const agents = await waitForAgents(params.agent_ids, timeoutMs);

  return {
    agents: agents.map(a => ({
      agent_id: a.id,
      name: a.name,
      status: a.status,
      result: a.result_summary,
      cost_usd: a.cost_usd,
      error: a.error_message,
    })),
    all_completed: agents.every(a => a.status === 'completed'),
  };
}

/**
 * spyre_get_agent_status — Check a single agent's current state
 */
export async function handleGetAgentStatus(
  _auth: McpTokenPayload,
  params: { agent_id: string }
): Promise<Record<string, unknown>> {
  const agent = getAgentWithPersona(params.agent_id);
  if (!agent) {
    return { error: 'Agent not found', agent_id: params.agent_id };
  }

  return {
    agent_id: agent.id,
    name: agent.name,
    role: agent.role,
    persona_name: agent.persona_name,
    status: agent.status,
    model: agent.model,
    result: agent.result_summary,
    cost_usd: agent.cost_usd,
    error: agent.error_message,
    wave_id: agent.wave_id,
    spawned_at: agent.spawned_at,
    completed_at: agent.completed_at,
  };
}

/**
 * spyre_ask_user — Ask the human a question, poll for answer
 */
export async function handleAskUser(
  auth: McpTokenPayload,
  params: { question: string; options?: string[] }
): Promise<Record<string, unknown>> {
  const db = getDb();
  const requestId = uuid();

  // Find orchestrator session
  const orch = db.prepare(
    "SELECT id FROM orchestrator_sessions WHERE env_id = ? AND status = 'running' ORDER BY created_at DESC LIMIT 1"
  ).get(auth.envId) as { id: string } | undefined;

  db.prepare(`
    INSERT INTO ask_user_requests (id, env_id, orchestrator_id, agent_id, question, options, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', datetime('now'))
  `).run(
    requestId, auth.envId, orch?.id ?? null, auth.agentId,
    params.question, params.options ? JSON.stringify(params.options) : null
  );

  // Emit event for frontend notification
  const agentEmitter = getAgentEmitter();
  agentEmitter.emit(`ask-user:${auth.envId}`, {
    request: { id: requestId, question: params.question, options: params.options },
  });

  // Poll for answer (1s interval, 5 min timeout)
  const maxWaitMs = 300000;
  const pollIntervalMs = 1000;
  const deadline = Date.now() + maxWaitMs;

  while (Date.now() < deadline) {
    const row = db.prepare(
      'SELECT status, response FROM ask_user_requests WHERE id = ?'
    ).get(requestId) as { status: string; response: string | null } | undefined;

    if (row?.status === 'answered' && row.response !== null) {
      return { answer: row.response };
    }
    if (row?.status === 'cancelled') {
      return { error: 'Request cancelled by user' };
    }

    await new Promise(r => setTimeout(r, pollIntervalMs));
  }

  // Timeout — mark as expired
  db.prepare(
    "UPDATE ask_user_requests SET status = 'expired' WHERE id = ? AND status = 'pending'"
  ).run(requestId);

  return { error: 'Timed out waiting for user response (5 minutes)' };
}
