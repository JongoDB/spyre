import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { startOrchestrator, listSessions } from '$lib/server/orchestrator';

/**
 * GET /api/orchestrator?envId=xxx — List orchestrator sessions.
 */
export const GET: RequestHandler = async ({ url }) => {
	const envId = url.searchParams.get('envId');
	if (!envId) throw error(400, 'envId query parameter is required');

	return json(listSessions(envId));
};

/**
 * POST /api/orchestrator — Start a new orchestrator session.
 * Body: { env_id, goal, model?, persona_ids? }
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
	if (!body.goal) throw error(400, 'goal is required');

	try {
		const session = await startOrchestrator({
			envId,
			goal: body.goal as string,
			model: body.model as 'haiku' | 'sonnet' | 'opus' | undefined,
			personaIds: body.persona_ids as string[] | undefined,
		});
		return json(session, { status: 201 });
	} catch (err: unknown) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		const e = err as { message?: string };
		throw error(500, e.message ?? 'Failed to start orchestrator');
	}
};
