import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSession, getEmitter as getOrchestratorEmitter } from '$lib/server/orchestrator';
import { listAgents, getEmitter as getAgentEmitter } from '$lib/server/agent-manager';

/**
 * GET /api/orchestrator/:id/stream — SSE stream for real-time orchestrator + agent events.
 */
export const GET: RequestHandler = async ({ params }) => {
	const session = getSession(params.id);
	if (!session) throw error(404, 'Orchestrator session not found');

	const sessionId = params.id;
	const envId = session.env_id;
	const orchEmitter = getOrchestratorEmitter();
	const agentEmitter = getAgentEmitter();

	const stream = new ReadableStream({
		start(controller) {
			const encoder = new TextEncoder();

			function send(event: string, data: unknown) {
				try {
					controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
				} catch { /* stream closed */ }
			}

			// Send current snapshot
			send('snapshot', {
				session,
				agents: listAgents(envId, sessionId),
			});

			// If already terminal, close
			if (session.status === 'completed' || session.status === 'error' || session.status === 'cancelled') {
				send('complete', { session_id: sessionId, status: session.status });
				controller.close();
				return;
			}

			const onEvent = (data: { sessionId: string; event: unknown }) => {
				send('orchestrator-event', data);
			};

			const onAgentSpawn = (data: { agent: unknown }) => {
				send('agent-spawn', data);
			};

			const onAgentComplete = (data: { agent: unknown }) => {
				send('agent-complete', data);
			};

			const onComplete = (data: { sessionId: string; status: string }) => {
				send('complete', data);
				cleanup();
				controller.close();
			};

			const onAskUser = (data: { request: unknown }) => {
				send('ask-user', data);
			};

			function cleanup() {
				orchEmitter.removeListener(`orchestrator:${sessionId}:event`, onEvent);
				orchEmitter.removeListener(`orchestrator:${sessionId}:agent-spawn`, onAgentSpawn);
				orchEmitter.removeListener(`orchestrator:${sessionId}:agent-complete`, onAgentComplete);
				orchEmitter.removeListener(`orchestrator:${sessionId}:complete`, onComplete);
				agentEmitter.removeListener(`ask-user:${envId}`, onAskUser);
			}

			orchEmitter.on(`orchestrator:${sessionId}:event`, onEvent);
			orchEmitter.on(`orchestrator:${sessionId}:agent-spawn`, onAgentSpawn);
			orchEmitter.on(`orchestrator:${sessionId}:agent-complete`, onAgentComplete);
			orchEmitter.on(`orchestrator:${sessionId}:complete`, onComplete);
			agentEmitter.on(`ask-user:${envId}`, onAskUser);
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			'Connection': 'keep-alive',
		},
	});
};
