import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { spawnAgent, listAgents } from '$lib/server/agent-manager';

/**
 * GET /api/agents?envId=xxx&orchestratorId=yyy — List lightweight agents.
 */
export const GET: RequestHandler = async ({ url }) => {
	const envId = url.searchParams.get('envId');
	if (!envId) throw error(400, 'envId query parameter is required');

	const orchestratorId = url.searchParams.get('orchestratorId') ?? undefined;
	return json(listAgents(envId, orchestratorId));
};

/**
 * POST /api/agents — Spawn a single lightweight agent.
 * Body: { env_id, name, role?, persona_id?, task, model?, context? }
 */
export const POST: RequestHandler = async ({ request }) => {
	let body: Record<string, unknown>;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON in request body');
	}

	const envId = body.env_id as string;
	if (!envId) throw error(400, 'env_id is required');
	if (!body.name) throw error(400, 'name is required');
	if (!body.task) throw error(400, 'task is required');

	try {
		const agent = await spawnAgent({
			envId,
			orchestratorId: body.orchestrator_id as string | undefined,
			name: body.name as string,
			role: body.role as string | undefined,
			personaId: body.persona_id as string | undefined,
			taskPrompt: body.task as string,
			model: body.model as 'haiku' | 'sonnet' | 'opus' | undefined,
			context: body.context as Record<string, unknown> | undefined,
		});
		return json(agent, { status: 201 });
	} catch (err: unknown) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		const e = err as { message?: string };
		throw error(500, e.message ?? 'Failed to spawn agent');
	}
};
