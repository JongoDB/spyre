import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getAgent, getEmitter } from '$lib/server/agent-manager';

/**
 * GET /api/agents/:id/stream — SSE stream for real-time agent events.
 */
export const GET: RequestHandler = async ({ params }) => {
	const agent = getAgent(params.id);
	if (!agent) throw error(404, 'Agent not found');

	const agentId = params.id;
	const emitter = getEmitter();

	const stream = new ReadableStream({
		start(controller) {
			const encoder = new TextEncoder();

			function send(event: string, data: unknown) {
				try {
					controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
				} catch { /* stream closed */ }
			}

			// Send current state
			send('status', { agent_id: agentId, status: agent.status });

			// If already terminal, send result and close
			if (agent.status === 'completed' || agent.status === 'error' || agent.status === 'cancelled') {
				send('complete', {
					agent_id: agentId,
					status: agent.status,
					result: agent.result_summary,
					cost_usd: agent.cost_usd,
					error: agent.error_message,
				});
				controller.close();
				return;
			}

			const onRunning = () => {
				send('running', { agent_id: agentId });
			};

			const onOutput = (data: { agentId: string; event: unknown }) => {
				send('output', { agent_id: agentId, event: data.event });
			};

			const onComplete = (data: { agent: typeof agent }) => {
				send('complete', {
					agent_id: agentId,
					status: data.agent.status,
					result: data.agent.result_summary,
					cost_usd: data.agent.cost_usd,
					error: data.agent.error_message,
				});
				cleanup();
				controller.close();
			};

			const onError = (data: { agentId: string; error: string }) => {
				send('error', { agent_id: agentId, error: data.error });
				cleanup();
				controller.close();
			};

			function cleanup() {
				emitter.removeListener(`agent:${agentId}:running`, onRunning);
				emitter.removeListener(`agent:${agentId}:output`, onOutput);
				emitter.removeListener(`agent:${agentId}:complete`, onComplete);
				emitter.removeListener(`agent:${agentId}:error`, onError);
			}

			emitter.on(`agent:${agentId}:running`, onRunning);
			emitter.on(`agent:${agentId}:output`, onOutput);
			emitter.on(`agent:${agentId}:complete`, onComplete);
			emitter.on(`agent:${agentId}:error`, onError);
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
