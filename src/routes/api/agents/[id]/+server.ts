import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAgentWithPersona, cancelAgent } from '$lib/server/agent-manager';

/**
 * GET /api/agents/:id — Get agent status and details.
 */
export const GET: RequestHandler = async ({ params }) => {
	const agent = getAgentWithPersona(params.id);
	if (!agent) throw error(404, 'Agent not found');
	return json(agent);
};

/**
 * DELETE /api/agents/:id — Cancel a running agent.
 */
export const DELETE: RequestHandler = async ({ params }) => {
	const cancelled = cancelAgent(params.id);
	if (!cancelled) {
		const agent = getAgentWithPersona(params.id);
		if (!agent) throw error(404, 'Agent not found');
		throw error(400, 'Agent is not in a cancellable state');
	}
	return json({ success: true, agent_id: params.id });
};
