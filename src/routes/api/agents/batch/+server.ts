import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { spawnAgents } from '$lib/server/agent-manager';
import type { SpawnAgentsBatchRequest } from '$lib/types/agent';

/**
 * POST /api/agents/batch — Batch spawn a wave of parallel agents.
 * Body: { env_id, orchestrator_id?, wave_name?, agents: [...] }
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

	const batch = body as unknown as SpawnAgentsBatchRequest & { env_id: string; orchestrator_id?: string };
	if (!batch.agents || !Array.isArray(batch.agents) || batch.agents.length === 0) {
		throw error(400, 'agents array is required and must not be empty');
	}

	try {
		const result = await spawnAgents(envId, batch.orchestrator_id, {
			wave_name: batch.wave_name,
			agents: batch.agents,
		});
		return json(result, { status: 201 });
	} catch (err: unknown) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		const e = err as { message?: string };
		throw error(500, e.message ?? 'Failed to spawn agent batch');
	}
};
