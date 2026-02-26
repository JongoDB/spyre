import { EventEmitter } from 'node:events';
import { v4 as uuid } from 'uuid';
import { getDb } from './db';
import { getEnvironment } from './environments';
import { dispatch as claudeDispatch, getEmitter as getClaudeEmitter, getTask as getClaudeTask } from './claude-bridge';
import { getConnection } from './ssh-pool';
import { scanAndStoreServices } from './service-detector';
import type {
  Pipeline,
  PipelineStep,
  PipelineStepWithContext,
  PipelineWithSteps,
  PipelineTemplate,
  PipelineTemplateStep,
  CreatePipelineRequest,
  GateDecisionRequest
} from '$lib/types/pipeline';

// =============================================================================
// Pipeline Engine — Multi-Agent Workflow Orchestrator
// =============================================================================

const MAX_ITERATION = 3;

// Use globalThis singleton to survive Vite SSR module reloads (same fix as claude-bridge)
const EMITTER_KEY = '__spyre_pipeline_emitter__';
const LISTENERS_KEY = '__spyre_pipeline_listeners__';
const g = globalThis as Record<string, unknown>;
if (!g[EMITTER_KEY]) {
  const e = new EventEmitter();
  e.setMaxListeners(50);
  g[EMITTER_KEY] = e;
}
if (!g[LISTENERS_KEY]) {
  g[LISTENERS_KEY] = new Map<string, () => void>();
}
const pipelineEmitter = g[EMITTER_KEY] as EventEmitter;

// Track active task listeners so we can clean up on cancel/restart
const activeListeners = g[LISTENERS_KEY] as Map<string, () => void>;

// =============================================================================
// Event Emitter
// =============================================================================

export function getEmitter(): EventEmitter {
  return pipelineEmitter;
}

function emitPipelineEvent(pipelineId: string, event: string, data?: Record<string, unknown>): void {
  pipelineEmitter.emit(`pipeline:${pipelineId}`, {
    event,
    pipelineId,
    timestamp: new Date().toISOString(),
    ...data
  });
}

// =============================================================================
// CRUD — Pipelines
// =============================================================================

export function getPipeline(id: string): Pipeline | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM pipelines WHERE id = ?').get(id) as Pipeline) ?? null;
}

export function getPipelineWithSteps(id: string): PipelineWithSteps | null {
  const pipeline = getPipeline(id);
  if (!pipeline) return null;

  const db = getDb();
  const steps = db.prepare(`
    SELECT
      ps.*,
      p.name as persona_name,
      p.role as persona_role,
      p.avatar as persona_avatar,
      dc.service_name as devcontainer_service,
      ct.status as task_status
    FROM pipeline_steps ps
    LEFT JOIN personas p ON ps.persona_id = p.id
    LEFT JOIN devcontainers dc ON ps.devcontainer_id = dc.id
    LEFT JOIN claude_tasks ct ON ps.task_id = ct.id
    WHERE ps.pipeline_id = ?
    ORDER BY ps.position ASC, ps.id ASC
  `).all(id) as PipelineStepWithContext[];

  return { ...pipeline, steps };
}

export function listPipelines(envId: string): Array<Pipeline & { step_count: number; completed_count: number }> {
  const db = getDb();
  return db.prepare(`
    SELECT p.*,
      (SELECT COUNT(*) FROM pipeline_steps WHERE pipeline_id = p.id) as step_count,
      (SELECT COUNT(*) FROM pipeline_steps WHERE pipeline_id = p.id AND status IN ('completed','skipped')) as completed_count
    FROM pipelines p
    WHERE p.env_id = ?
    ORDER BY p.created_at DESC
  `).all(envId) as Array<Pipeline & { step_count: number; completed_count: number }>;
}

export function createPipeline(req: CreatePipelineRequest): Pipeline {
  const db = getDb();
  const id = uuid();

  const env = getEnvironment(req.env_id);
  if (!env) throw { code: 'NOT_FOUND', message: 'Environment not found' };

  const insertPipeline = db.prepare(`
    INSERT INTO pipelines (id, env_id, template_id, name, description, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'draft', datetime('now'), datetime('now'))
  `);

  const insertStep = db.prepare(`
    INSERT INTO pipeline_steps (id, pipeline_id, position, type, label, devcontainer_id, persona_id, prompt_template, gate_instructions, max_retries)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  db.transaction(() => {
    insertPipeline.run(id, req.env_id, req.template_id ?? null, req.name, req.description ?? null);

    for (const step of req.steps) {
      insertStep.run(
        uuid(),
        id,
        step.position,
        step.type,
        step.label,
        step.devcontainer_id ?? null,
        step.persona_id ?? null,
        step.prompt_template ?? null,
        step.gate_instructions ?? null,
        step.max_retries ?? 0
      );
    }
  })();

  return getPipeline(id)!;
}

export function deletePipeline(id: string): void {
  const db = getDb();
  const pipeline = getPipeline(id);
  if (!pipeline) throw { code: 'NOT_FOUND', message: 'Pipeline not found' };
  if (pipeline.status === 'running' || pipeline.status === 'paused') {
    throw { code: 'INVALID_STATE', message: 'Cannot delete a running or paused pipeline. Cancel it first.' };
  }
  db.prepare('DELETE FROM pipelines WHERE id = ?').run(id);
}

// =============================================================================
// Execution — Start / Cancel / Advance
// =============================================================================

export async function startPipeline(id: string): Promise<void> {
  const db = getDb();
  const pipeline = getPipeline(id);
  if (!pipeline) throw { code: 'NOT_FOUND', message: 'Pipeline not found' };
  if (pipeline.status !== 'draft' && pipeline.status !== 'failed') {
    throw { code: 'INVALID_STATE', message: `Pipeline is ${pipeline.status}, can only start from draft or failed` };
  }

  const env = getEnvironment(pipeline.env_id);
  if (!env || env.status !== 'running') {
    throw { code: 'INVALID_STATE', message: 'Environment must be running to start a pipeline' };
  }

  // Find the first position
  const steps = db.prepare(
    'SELECT * FROM pipeline_steps WHERE pipeline_id = ? ORDER BY position ASC'
  ).all(id) as PipelineStep[];

  if (steps.length === 0) {
    throw { code: 'INVALID_STATE', message: 'Pipeline has no steps' };
  }

  const firstPosition = steps[0].position;

  // Reset all steps to pending if restarting from failed
  if (pipeline.status === 'failed') {
    db.prepare(
      "UPDATE pipeline_steps SET status = 'pending', task_id = NULL, result_summary = NULL, gate_result = NULL, gate_feedback = NULL, cost_usd = NULL, started_at = NULL, completed_at = NULL WHERE pipeline_id = ? AND status IN ('error', 'cancelled')"
    ).run(id);
  }

  // Update pipeline status
  db.prepare(
    "UPDATE pipelines SET status = 'running', current_position = ?, started_at = datetime('now'), updated_at = datetime('now'), error_message = NULL WHERE id = ?"
  ).run(firstPosition, id);

  // Capture start snapshot
  await captureGitSnapshot(pipeline, null, 'start');

  emitPipelineEvent(id, 'started', { position: firstPosition });

  // Advance to dispatch the first position's steps
  await advancePipeline(id);
}

export async function cancelPipeline(id: string): Promise<void> {
  const db = getDb();
  const pipeline = getPipeline(id);
  if (!pipeline) throw { code: 'NOT_FOUND', message: 'Pipeline not found' };
  if (pipeline.status !== 'running' && pipeline.status !== 'paused') {
    throw { code: 'INVALID_STATE', message: `Pipeline is ${pipeline.status}, cannot cancel` };
  }

  // Cancel all pending/running/waiting steps
  db.prepare(
    "UPDATE pipeline_steps SET status = 'cancelled', completed_at = datetime('now') WHERE pipeline_id = ? AND status IN ('pending', 'running', 'waiting')"
  ).run(id);

  // Cancel any running tasks
  const runningSteps = db.prepare(
    "SELECT * FROM pipeline_steps WHERE pipeline_id = ? AND task_id IS NOT NULL AND status = 'running'"
  ).all(id) as PipelineStep[];

  for (const step of runningSteps) {
    if (step.task_id) {
      try {
        const { cancelTask } = await import('./claude-bridge');
        cancelTask(step.task_id);
      } catch { /* ignore */ }
    }
  }

  // Clean up listeners
  for (const [key, cleanup] of activeListeners) {
    if (key.startsWith(`${id}:`)) {
      cleanup();
      activeListeners.delete(key);
    }
  }

  db.prepare(
    "UPDATE pipelines SET status = 'cancelled', completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
  ).run(id);

  emitPipelineEvent(id, 'cancelled');
}

// =============================================================================
// State Machine — advancePipeline()
// =============================================================================

async function advancePipeline(pipelineId: string): Promise<void> {
  const db = getDb();
  const pipeline = getPipeline(pipelineId);
  if (!pipeline || (pipeline.status !== 'running' && pipeline.status !== 'paused')) return;

  const allSteps = db.prepare(
    'SELECT * FROM pipeline_steps WHERE pipeline_id = ? ORDER BY position ASC'
  ).all(pipelineId) as PipelineStep[];

  const currentPos = pipeline.current_position;
  if (currentPos == null) return;

  const stepsAtCurrent = allSteps.filter(s => s.position === currentPos);

  // Check if any step is still running or waiting
  if (stepsAtCurrent.some(s => s.status === 'running')) return;
  if (stepsAtCurrent.some(s => s.status === 'waiting')) return;

  // Check for pending steps that need dispatching (initial start, post-revise, or retry)
  const pendingSteps = stepsAtCurrent.filter(s => s.status === 'pending');
  if (pendingSteps.length > 0) {
    let dispatchedAgents = false;
    let hasGate = false;

    for (const step of pendingSteps) {
      if (step.type === 'agent') {
        await dispatchAgentStep(pipeline, step);
        dispatchedAgents = true;
      } else if (step.type === 'gate') {
        db.prepare(
          "UPDATE pipeline_steps SET status = 'waiting', started_at = datetime('now') WHERE id = ?"
        ).run(step.id);
        hasGate = true;
        emitPipelineEvent(pipelineId, 'gate_waiting', { stepId: step.id, label: step.label });
      }
    }

    // If only gates at this position (no agents dispatched), pause for human review
    if (hasGate && !dispatchedAgents) {
      db.prepare(
        "UPDATE pipelines SET status = 'paused', updated_at = datetime('now') WHERE id = ?"
      ).run(pipelineId);
      emitPipelineEvent(pipelineId, 'paused');
    }
    return;
  }

  // Check for errors
  const errorSteps = stepsAtCurrent.filter(s => s.status === 'error');
  if (errorSteps.length > 0) {
    for (const es of errorSteps) {
      if (es.retry_count < es.max_retries) {
        // Auto-retry
        db.prepare(
          "UPDATE pipeline_steps SET retry_count = retry_count + 1, status = 'pending', task_id = NULL, result_summary = NULL WHERE id = ?"
        ).run(es.id);
        await dispatchAgentStep(pipeline, { ...es, status: 'pending', retry_count: es.retry_count + 1 });
        return;
      }
    }
    // No retries left — cancel siblings still running and fail pipeline
    db.prepare(
      "UPDATE pipeline_steps SET status = 'cancelled', completed_at = datetime('now') WHERE pipeline_id = ? AND position = ? AND status IN ('pending', 'running')"
    ).run(pipelineId, currentPos);

    const errMsg = errorSteps.map(s => `Step "${s.label}" failed`).join('; ');
    db.prepare(
      "UPDATE pipelines SET status = 'failed', error_message = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(errMsg, pipelineId);

    emitPipelineEvent(pipelineId, 'failed', { error: errMsg });
    return;
  }

  // All steps at current position are completed or skipped
  if (!stepsAtCurrent.every(s => s.status === 'completed' || s.status === 'skipped')) return;

  // Find next position
  const positions = [...new Set(allSteps.map(s => s.position))].sort((a, b) => a - b);
  const currentIdx = positions.indexOf(currentPos);
  if (currentIdx === -1 || currentIdx === positions.length - 1) {
    // No more positions — pipeline complete
    const totalCost = allSteps.reduce((sum, s) => sum + (s.cost_usd ?? 0), 0);
    db.prepare(
      "UPDATE pipelines SET status = 'completed', current_position = ?, total_cost_usd = ?, completed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
    ).run(currentPos, totalCost, pipelineId);

    // Detect services after pipeline completion
    let detectedServices: Array<{ port: number; name: string }> = [];
    try {
      const services = await scanAndStoreServices(pipeline.env_id);
      detectedServices = services
        .filter(s => s.status === 'up')
        .map(s => ({ port: s.port, name: s.name }));
    } catch (err) {
      console.warn(`[spyre] Service detection after pipeline completion failed:`, err);
    }

    emitPipelineEvent(pipelineId, 'completed', { totalCost, services: detectedServices });
    return;
  }

  const nextPos = positions[currentIdx + 1];
  const stepsAtNext = allSteps.filter(s => s.position === nextPos);

  // Update current position
  db.prepare(
    "UPDATE pipelines SET current_position = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(nextPos, pipelineId);

  // Dispatch each step at next position
  let hasGate = false;
  for (const step of stepsAtNext) {
    if (step.status !== 'pending') continue;

    if (step.type === 'agent') {
      await dispatchAgentStep(pipeline, step);
    } else if (step.type === 'gate') {
      db.prepare(
        "UPDATE pipeline_steps SET status = 'waiting', started_at = datetime('now') WHERE id = ?"
      ).run(step.id);
      hasGate = true;
      emitPipelineEvent(pipelineId, 'gate_waiting', { stepId: step.id, label: step.label });
    }
  }

  if (hasGate) {
    db.prepare(
      "UPDATE pipelines SET status = 'paused', updated_at = datetime('now') WHERE id = ?"
    ).run(pipelineId);
    emitPipelineEvent(pipelineId, 'paused');
  }
}

// =============================================================================
// Agent Step Dispatch
// =============================================================================

async function dispatchAgentStep(pipeline: Pipeline, step: PipelineStep): Promise<void> {
  const db = getDb();

  db.prepare(
    "UPDATE pipeline_steps SET status = 'running', started_at = datetime('now') WHERE id = ?"
  ).run(step.id);

  emitPipelineEvent(pipeline.id, 'step_started', { stepId: step.id, label: step.label });

  try {
    // Wait for devcontainer to be ready (it may still be building)
    if (step.devcontainer_id) {
      const { getDevcontainer } = await import('./devcontainers');
      const maxWaitMs = 300000; // 5 minutes max
      const pollIntervalMs = 3000;
      const deadline = Date.now() + maxWaitMs;

      while (Date.now() < deadline) {
        const dc = getDevcontainer(step.devcontainer_id);
        if (!dc) throw new Error('Devcontainer not found');
        if (dc.status === 'running') break;
        if (dc.status === 'error' || dc.status === 'stopped') {
          throw new Error(`Devcontainer is ${dc.status}: ${dc.error_message ?? 'unknown error'}`);
        }
        // Still creating/pending — wait and poll again
        await new Promise(r => setTimeout(r, pollIntervalMs));
      }

      // Final check after loop
      const dc = getDevcontainer(step.devcontainer_id);
      if (dc && dc.status !== 'running') {
        throw new Error(`Devcontainer not ready after ${maxWaitMs / 1000}s (status: ${dc.status})`);
      }
    }

    const prompt = buildStepPrompt(pipeline, step);

    const taskId = await claudeDispatch({
      envId: pipeline.env_id,
      prompt,
      devcontainerId: step.devcontainer_id ?? undefined
    });

    db.prepare(
      'UPDATE pipeline_steps SET task_id = ? WHERE id = ?'
    ).run(taskId, step.id);

    registerTaskListener(pipeline.id, step.id, taskId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String((err as { message?: string }).message ?? err);
    db.prepare(
      "UPDATE pipeline_steps SET status = 'error', result_summary = ?, completed_at = datetime('now') WHERE id = ?"
    ).run(`Dispatch failed: ${message}`, step.id);

    emitPipelineEvent(pipeline.id, 'step_error', { stepId: step.id, error: message });

    // Trigger advance to handle the error (auto-retry or fail)
    await advancePipeline(pipeline.id);
  }
}

// =============================================================================
// Context Builder — buildStepPrompt()
// =============================================================================

function buildStepPrompt(pipeline: Pipeline, step: PipelineStep): string {
  const parts: string[] = [];

  // 1. Pipeline goal
  parts.push(`# Pipeline: ${pipeline.name}`);
  if (pipeline.description) {
    parts.push(pipeline.description);
  }
  parts.push('');

  // 2. Prior work summary
  const summaries = getCompletedStepSummaries(pipeline.id);
  const priorSteps = summaries.filter(s => s.position < step.position);
  if (priorSteps.length > 0) {
    parts.push('## Prior Work');
    for (const ps of priorSteps) {
      parts.push(`### Step ${ps.position}: ${ps.label} (${ps.persona ?? 'system'})`);
      if (ps.result_summary) {
        parts.push(`Result: ${ps.result_summary}`);
      }
      if (ps.gate_feedback) {
        parts.push(`Reviewer feedback: ${ps.gate_feedback}`);
      }
      parts.push('');
    }
  }

  // 3. Most recent gate feedback (highlighted if 'revised')
  const lastGate = summaries
    .filter(s => s.gate_result === 'revised' && s.position < step.position)
    .pop();
  if (lastGate?.gate_feedback) {
    parts.push('## Reviewer Feedback');
    parts.push(`> ${lastGate.gate_feedback}`);
    parts.push('');
  }

  // 4. Git diff from pipeline start
  const db = getDb();
  const startSnapshot = db.prepare(
    "SELECT git_diff FROM pipeline_context_snapshots WHERE pipeline_id = ? AND snapshot_type = 'start' ORDER BY created_at DESC LIMIT 1"
  ).get(pipeline.id) as { git_diff: string | null } | undefined;

  // Get the latest step_complete snapshot for cumulative diff context
  const latestSnapshot = db.prepare(
    "SELECT git_diff, git_status FROM pipeline_context_snapshots WHERE pipeline_id = ? AND snapshot_type = 'step_complete' ORDER BY created_at DESC LIMIT 1"
  ).get(pipeline.id) as { git_diff: string | null; git_status: string | null } | undefined;

  if (latestSnapshot?.git_diff) {
    const diff = latestSnapshot.git_diff;
    if (diff.length > 0 && diff.length < 5000) {
      parts.push('## Changes Made So Far');
      parts.push('```diff');
      parts.push(diff);
      parts.push('```');
      parts.push('');
    } else if (diff.length >= 5000) {
      parts.push('## Changes Made So Far');
      parts.push('(Large diff truncated — review the git log for full details)');
      parts.push('```diff');
      parts.push(diff.slice(0, 5000));
      parts.push('```');
      parts.push('');
    }
  }

  // 5. This step's prompt
  parts.push('## Your Task');
  parts.push(step.prompt_template ?? 'Complete the next stage of work.');
  parts.push('');

  // 6. Iteration context
  if (step.iteration > 0) {
    parts.push(`**Note:** This is revision #${step.iteration}. Address the reviewer feedback above.`);
    parts.push('');
  }

  return parts.join('\n');
}

function getCompletedStepSummaries(pipelineId: string): Array<{
  position: number;
  label: string;
  persona: string | null;
  result_summary: string | null;
  gate_feedback: string | null;
  gate_result: string | null;
}> {
  const db = getDb();
  return db.prepare(`
    SELECT
      ps.position,
      ps.label,
      p.name as persona,
      ps.result_summary,
      ps.gate_feedback,
      ps.gate_result
    FROM pipeline_steps ps
    LEFT JOIN personas p ON ps.persona_id = p.id
    WHERE ps.pipeline_id = ? AND ps.status IN ('completed', 'skipped')
    ORDER BY ps.position ASC
  `).all(pipelineId) as Array<{
    position: number;
    label: string;
    persona: string | null;
    result_summary: string | null;
    gate_feedback: string | null;
    gate_result: string | null;
  }>;
}

// =============================================================================
// Task Listener — Watches for claude_task completion
// =============================================================================

function registerTaskListener(pipelineId: string, stepId: string, taskId: string): void {
  const listenerKey = `${pipelineId}:${stepId}`;

  // Clean up any existing listener
  const existing = activeListeners.get(listenerKey);
  if (existing) existing();

  const claudeEmitter = getClaudeEmitter();

  const handler = (data: { taskId: string; status: string; result?: string; cost_usd?: number; error?: string }) => {
    if (data.taskId !== taskId) return;
    onStepTaskComplete(pipelineId, stepId, taskId).catch(err => {
      console.error(`[spyre] Pipeline ${pipelineId} step ${stepId} completion handler error:`, err);
    });
  };

  claudeEmitter.on(`task:${taskId}:complete`, handler);

  const cleanup = () => {
    claudeEmitter.removeListener(`task:${taskId}:complete`, handler);
    activeListeners.delete(listenerKey);
  };

  activeListeners.set(listenerKey, cleanup);
}

async function onStepTaskComplete(pipelineId: string, stepId: string, taskId: string): Promise<void> {
  const db = getDb();
  const task = getClaudeTask(taskId);
  if (!task) return;

  // Clean up listener
  const listenerKey = `${pipelineId}:${stepId}`;
  const cleanup = activeListeners.get(listenerKey);
  if (cleanup) cleanup();

  const pipeline = getPipeline(pipelineId);
  if (!pipeline) return;

  if (task.status === 'complete') {
    // Extract result summary (truncate to ~500 chars)
    let summary = task.result ?? '';
    if (summary.length > 500) {
      summary = summary.slice(0, 497) + '...';
    }

    db.prepare(
      "UPDATE pipeline_steps SET status = 'completed', result_summary = ?, cost_usd = ?, completed_at = datetime('now') WHERE id = ?"
    ).run(summary, task.cost_usd, stepId);

    // Update pipeline cost
    db.prepare(
      "UPDATE pipelines SET total_cost_usd = total_cost_usd + COALESCE(?, 0), updated_at = datetime('now') WHERE id = ?"
    ).run(task.cost_usd, pipelineId);

    // Capture post-step snapshot
    await captureGitSnapshot(pipeline, stepId, 'step_complete');

    emitPipelineEvent(pipelineId, 'step_completed', {
      stepId,
      taskId,
      cost: task.cost_usd,
      summary: summary.slice(0, 200)
    });
  } else {
    // Error or other non-complete status
    db.prepare(
      "UPDATE pipeline_steps SET status = 'error', result_summary = ?, cost_usd = ?, completed_at = datetime('now') WHERE id = ?"
    ).run(task.error_message ?? `Task ${task.status}`, task.cost_usd, stepId);

    emitPipelineEvent(pipelineId, 'step_error', {
      stepId,
      taskId,
      error: task.error_message
    });
  }

  // Advance pipeline
  await advancePipeline(pipelineId);
}

// =============================================================================
// Gate Decisions
// =============================================================================

export async function handleGateDecision(
  pipelineId: string,
  stepId: string,
  decision: GateDecisionRequest
): Promise<void> {
  const db = getDb();
  const pipeline = getPipeline(pipelineId);
  if (!pipeline) throw { code: 'NOT_FOUND', message: 'Pipeline not found' };

  // Map action verb to DB enum (approve→approved, reject→rejected, revise→revised)
  const gateResultMap: Record<string, string> = { approve: 'approved', reject: 'rejected', revise: 'revised' };
  const gateResult = gateResultMap[decision.action] ?? decision.action;

  // Atomically check and update step status
  const result = db.prepare(
    "UPDATE pipeline_steps SET gate_result = ?, gate_feedback = ?, gate_decided_at = datetime('now'), status = 'completed', completed_at = datetime('now') WHERE id = ? AND pipeline_id = ? AND status = 'waiting'"
  ).run(gateResult, decision.feedback ?? null, stepId, pipelineId);

  if (result.changes === 0) {
    throw { code: 'CONFLICT', message: 'Step is not in waiting status (may have already been decided)' };
  }

  // Capture gate decision snapshot
  await captureGitSnapshot(pipeline, stepId, 'gate_decision');

  emitPipelineEvent(pipelineId, 'gate_decided', {
    stepId,
    action: decision.action,
    feedback: decision.feedback
  });

  if (decision.action === 'approve') {
    // Resume pipeline
    db.prepare(
      "UPDATE pipelines SET status = 'running', updated_at = datetime('now') WHERE id = ?"
    ).run(pipelineId);
    await advancePipeline(pipelineId);

  } else if (decision.action === 'reject') {
    db.prepare(
      "UPDATE pipelines SET status = 'failed', error_message = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(decision.feedback ?? 'Rejected by reviewer', pipelineId);
    emitPipelineEvent(pipelineId, 'failed', { error: 'Rejected by reviewer' });

  } else if (decision.action === 'revise') {
    // Find target step to revise back to
    const step = db.prepare('SELECT * FROM pipeline_steps WHERE id = ?').get(stepId) as PipelineStep;
    let targetPosition: number;

    if (decision.revise_to_step_id) {
      const targetStep = db.prepare('SELECT * FROM pipeline_steps WHERE id = ? AND pipeline_id = ?').get(decision.revise_to_step_id, pipelineId) as PipelineStep | undefined;
      if (!targetStep) throw { code: 'NOT_FOUND', message: 'Target step for revision not found' };
      targetPosition = targetStep.position;
    } else {
      // Default: revise to the position just before the gate
      const positions = db.prepare(
        'SELECT DISTINCT position FROM pipeline_steps WHERE pipeline_id = ? ORDER BY position ASC'
      ).all(pipelineId) as Array<{ position: number }>;
      const gateIdx = positions.findIndex(p => p.position === step.position);
      targetPosition = gateIdx > 0 ? positions[gateIdx - 1].position : step.position;
    }

    // Check iteration limit on target steps
    const targetSteps = db.prepare(
      'SELECT * FROM pipeline_steps WHERE pipeline_id = ? AND position = ?'
    ).all(pipelineId, targetPosition) as PipelineStep[];

    for (const ts of targetSteps) {
      if (ts.iteration >= MAX_ITERATION) {
        db.prepare(
          "UPDATE pipelines SET status = 'failed', error_message = 'Maximum revision iterations reached', updated_at = datetime('now') WHERE id = ?"
        ).run(pipelineId);
        emitPipelineEvent(pipelineId, 'failed', { error: 'Maximum revision iterations reached' });
        return;
      }
    }

    // Reset all steps from target position through current position
    db.prepare(`
      UPDATE pipeline_steps
      SET status = 'pending',
          task_id = NULL,
          result_summary = NULL,
          gate_result = NULL,
          gate_feedback = NULL,
          gate_decided_at = NULL,
          cost_usd = NULL,
          started_at = NULL,
          completed_at = NULL,
          iteration = iteration + 1
      WHERE pipeline_id = ? AND position >= ? AND position <= ? AND id != ?
    `).run(pipelineId, targetPosition, step.position, stepId);

    // Also reset any steps after the gate
    db.prepare(`
      UPDATE pipeline_steps
      SET status = 'pending',
          task_id = NULL,
          result_summary = NULL,
          gate_result = NULL,
          gate_feedback = NULL,
          gate_decided_at = NULL,
          cost_usd = NULL,
          started_at = NULL,
          completed_at = NULL
      WHERE pipeline_id = ? AND position > ?
    `).run(pipelineId, step.position);

    // Store the feedback on the gate step so buildStepPrompt can find it
    db.prepare(
      "UPDATE pipeline_steps SET gate_feedback = ? WHERE id = ?"
    ).run(decision.feedback ?? null, stepId);

    // Update pipeline to resume from target position
    db.prepare(
      "UPDATE pipelines SET status = 'running', current_position = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(targetPosition, pipelineId);

    await advancePipeline(pipelineId);
  }
}

// =============================================================================
// Skip / Retry
// =============================================================================

export async function skipStep(pipelineId: string, stepId: string): Promise<void> {
  const db = getDb();
  const pipeline = getPipeline(pipelineId);
  if (!pipeline) throw { code: 'NOT_FOUND', message: 'Pipeline not found' };

  const step = db.prepare('SELECT * FROM pipeline_steps WHERE id = ? AND pipeline_id = ?').get(stepId, pipelineId) as PipelineStep | undefined;
  if (!step) throw { code: 'NOT_FOUND', message: 'Step not found' };
  if (step.status !== 'pending' && step.status !== 'waiting' && step.status !== 'error') {
    throw { code: 'INVALID_STATE', message: `Cannot skip step in ${step.status} status` };
  }

  db.prepare(
    "UPDATE pipeline_steps SET status = 'skipped', completed_at = datetime('now') WHERE id = ?"
  ).run(stepId);

  emitPipelineEvent(pipelineId, 'step_skipped', { stepId, label: step.label });

  // If pipeline was paused (gate skip), resume it
  if (pipeline.status === 'paused') {
    db.prepare(
      "UPDATE pipelines SET status = 'running', updated_at = datetime('now') WHERE id = ?"
    ).run(pipelineId);
  }

  await advancePipeline(pipelineId);
}

export async function retryFailedStep(pipelineId: string, stepId: string): Promise<void> {
  const db = getDb();
  const pipeline = getPipeline(pipelineId);
  if (!pipeline) throw { code: 'NOT_FOUND', message: 'Pipeline not found' };
  if (pipeline.status !== 'failed') {
    throw { code: 'INVALID_STATE', message: 'Can only retry steps on a failed pipeline' };
  }

  const step = db.prepare('SELECT * FROM pipeline_steps WHERE id = ? AND pipeline_id = ?').get(stepId, pipelineId) as PipelineStep | undefined;
  if (!step) throw { code: 'NOT_FOUND', message: 'Step not found' };
  if (step.status !== 'error') {
    throw { code: 'INVALID_STATE', message: 'Can only retry steps in error status' };
  }

  // Reset the step
  db.prepare(
    "UPDATE pipeline_steps SET status = 'pending', task_id = NULL, result_summary = NULL, cost_usd = NULL, started_at = NULL, completed_at = NULL WHERE id = ?"
  ).run(stepId);

  // Resume pipeline
  db.prepare(
    "UPDATE pipelines SET status = 'running', error_message = NULL, current_position = ?, updated_at = datetime('now') WHERE id = ?"
  ).run(step.position, pipelineId);

  emitPipelineEvent(pipelineId, 'step_retried', { stepId, label: step.label });

  await advancePipeline(pipelineId);
}

// =============================================================================
// Git Snapshots
// =============================================================================

async function captureGitSnapshot(
  pipeline: Pipeline,
  stepId: string | null,
  type: 'start' | 'step_complete' | 'gate_decision'
): Promise<void> {
  const db = getDb();
  const env = getEnvironment(pipeline.env_id);
  if (!env || !env.ip_address) return;

  let gitDiff: string | null = null;
  let gitStatus: string | null = null;
  let commitHash: string | null = null;

  try {
    const client = await getConnection(pipeline.env_id);
    const projectDir = env.project_dir ?? '/project';

    const result = await new Promise<{ stdout: string }>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), 15000);
      const cmd = `cd '${projectDir}' 2>/dev/null && git diff --stat HEAD 2>/dev/null; echo '---SEP---'; git status --short 2>/dev/null; echo '---SEP---'; git rev-parse HEAD 2>/dev/null`;
      client.exec(cmd, (err, stream) => {
        if (err) { clearTimeout(timer); reject(err); return; }
        let stdout = '';
        stream.on('data', (d: Buffer) => { stdout += d.toString(); });
        stream.stderr.on('data', () => { /* consume */ });
        stream.on('close', () => { clearTimeout(timer); resolve({ stdout }); });
      });
    });

    const parts = result.stdout.split('---SEP---');
    gitDiff = (parts[0] ?? '').trim() || null;
    gitStatus = (parts[1] ?? '').trim() || null;
    commitHash = (parts[2] ?? '').trim() || null;
  } catch {
    // Non-critical — continue without snapshot
  }

  db.prepare(`
    INSERT INTO pipeline_context_snapshots (id, pipeline_id, step_id, snapshot_type, git_diff, git_status, commit_hash)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(uuid(), pipeline.id, stepId, type, gitDiff, gitStatus, commitHash);
}

// =============================================================================
// Startup Recovery
// =============================================================================

export async function recoverPipelines(): Promise<void> {
  const db = getDb();
  const runningPipelines = db.prepare(
    "SELECT * FROM pipelines WHERE status IN ('running', 'paused')"
  ).all() as Pipeline[];

  for (const pipeline of runningPipelines) {
    console.log(`[spyre] Recovering pipeline ${pipeline.id} (${pipeline.name}) — status: ${pipeline.status}`);

    const steps = db.prepare(
      'SELECT * FROM pipeline_steps WHERE pipeline_id = ? ORDER BY position ASC'
    ).all(pipeline.id) as PipelineStep[];

    // Check running steps — see if their tasks completed while we were down
    const runningSteps = steps.filter(s => s.status === 'running' && s.task_id);
    for (const step of runningSteps) {
      const task = getClaudeTask(step.task_id!);
      if (task && (task.status === 'complete' || task.status === 'error' || task.status === 'cancelled')) {
        // Task finished while we were down — process completion
        await onStepTaskComplete(pipeline.id, step.id, step.task_id!);
      } else if (task && (task.status === 'running' || task.status === 'pending')) {
        // Task still running — re-register listener
        registerTaskListener(pipeline.id, step.id, step.task_id!);
      } else {
        // Task not found or in unexpected state — mark step as error
        db.prepare(
          "UPDATE pipeline_steps SET status = 'error', result_summary = 'Task lost during restart' WHERE id = ?"
        ).run(step.id);
      }
    }

    // If pipeline is paused (gate), no action needed — gate steps stay in 'waiting'
    // If all running steps were resolved above, advance
    if (pipeline.status === 'running') {
      try {
        await advancePipeline(pipeline.id);
      } catch (err) {
        console.error(`[spyre] Recovery advance failed for pipeline ${pipeline.id}:`, err);
      }
    }
  }
}

// =============================================================================
// Template CRUD
// =============================================================================

export function getTemplate(id: string): PipelineTemplate | null {
  const db = getDb();
  return (db.prepare('SELECT * FROM pipeline_templates WHERE id = ?').get(id) as PipelineTemplate) ?? null;
}

export function getTemplateWithSteps(id: string): (PipelineTemplate & { steps: PipelineTemplateStep[] }) | null {
  const template = getTemplate(id);
  if (!template) return null;

  const db = getDb();
  const steps = db.prepare(
    'SELECT * FROM pipeline_template_steps WHERE template_id = ? ORDER BY position ASC'
  ).all(id) as PipelineTemplateStep[];

  return { ...template, steps };
}

export function listTemplates(): PipelineTemplate[] {
  const db = getDb();
  return db.prepare('SELECT * FROM pipeline_templates ORDER BY name ASC').all() as PipelineTemplate[];
}

export function createTemplate(name: string, description: string | null, envId: string | null, steps: Array<Omit<PipelineTemplateStep, 'id' | 'template_id'>>): PipelineTemplate {
  const db = getDb();
  const id = uuid();

  const insertTemplate = db.prepare(`
    INSERT INTO pipeline_templates (id, name, description, env_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
  `);

  const insertStep = db.prepare(`
    INSERT INTO pipeline_template_steps (id, template_id, position, type, label, devcontainer_id, persona_id, prompt_template, gate_instructions, max_retries, timeout_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  db.transaction(() => {
    insertTemplate.run(id, name, description, envId);
    for (const step of steps) {
      insertStep.run(
        uuid(), id, step.position, step.type, step.label,
        step.devcontainer_id ?? null, step.persona_id ?? null,
        step.prompt_template ?? null, step.gate_instructions ?? null,
        step.max_retries ?? 0, step.timeout_ms ?? null
      );
    }
  })();

  return getTemplate(id)!;
}

export function deleteTemplate(id: string): void {
  const db = getDb();
  db.prepare('DELETE FROM pipeline_templates WHERE id = ?').run(id);
}

export function saveAsTemplate(pipelineId: string, name: string, description: string | null): PipelineTemplate {
  const pipeline = getPipelineWithSteps(pipelineId);
  if (!pipeline) throw { code: 'NOT_FOUND', message: 'Pipeline not found' };

  const steps = pipeline.steps.map(s => ({
    position: s.position,
    type: s.type,
    label: s.label,
    devcontainer_id: s.devcontainer_id,
    persona_id: s.persona_id,
    prompt_template: s.prompt_template,
    gate_instructions: s.gate_instructions,
    max_retries: s.max_retries,
    timeout_ms: s.timeout_ms
  }));

  return createTemplate(name, description, pipeline.env_id, steps);
}
