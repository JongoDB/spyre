import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSession, cancelOrchestrator } from '$lib/server/orchestrator';
import { listAgents } from '$lib/server/agent-manager';

/**
 * GET /api/orchestrator/:id — Get orchestrator session details with agents.
 */
export const GET: RequestHandler = async ({ params }) => {
	const session = getSession(params.id);
	if (!session) throw error(404, 'Orchestrator session not found');

	const agents = listAgents(session.env_id, session.id);

	return json({
		...session,
		agents,
	});
};

/**
 * DELETE /api/orchestrator/:id — Cancel an orchestrator session.
 */
export const DELETE: RequestHandler = async ({ params }) => {
	const cancelled = await cancelOrchestrator(params.id);
	if (!cancelled) {
		const session = getSession(params.id);
		if (!session) throw error(404, 'Orchestrator session not found');
		throw error(400, 'Session is not in a cancellable state');
	}
	return json({ success: true, session_id: params.id });
};
