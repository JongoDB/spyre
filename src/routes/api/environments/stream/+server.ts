import type { RequestHandler } from './$types';
import { subscribe, getLastData } from '$lib/server/status-poller';
import { subscribeProvisioning } from '$lib/server/provisioning-events';
import type { EnvironmentLiveData } from '$lib/server/status-poller';

export const GET: RequestHandler = () => {
	let unsubscribe: (() => void) | null = null;
	let unsubscribeProvisioning: (() => void) | null = null;
	let keepaliveTimer: ReturnType<typeof setInterval> | null = null;

	const stream = new ReadableStream({
		start(controller) {
			// Send initial data
			const initial = getLastData();
			if (initial.length > 0) {
				controller.enqueue(`data: ${JSON.stringify(initial)}\n\n`);
			}

			// Subscribe to poller updates
			unsubscribe = subscribe((data: EnvironmentLiveData[]) => {
				try {
					controller.enqueue(`data: ${JSON.stringify(data)}\n\n`);
				} catch {
					// Stream closed
					cleanup();
				}
			});

			// Subscribe to provisioning events for real-time updates
			unsubscribeProvisioning = subscribeProvisioning((provEvent) => {
				try {
					controller.enqueue(`event: provisioning\ndata: ${JSON.stringify(provEvent)}\n\n`);
				} catch {
					cleanup();
				}
			});

			// Keepalive comment every 15s to prevent proxy timeouts
			keepaliveTimer = setInterval(() => {
				try {
					controller.enqueue(':\n\n');
				} catch {
					cleanup();
				}
			}, 15_000);

			function cleanup() {
				if (keepaliveTimer) {
					clearInterval(keepaliveTimer);
					keepaliveTimer = null;
				}
				if (unsubscribe) {
					unsubscribe();
					unsubscribe = null;
				}
				if (unsubscribeProvisioning) {
					unsubscribeProvisioning();
					unsubscribeProvisioning = null;
				}
			}
		},
		cancel() {
			if (keepaliveTimer) {
				clearInterval(keepaliveTimer);
				keepaliveTimer = null;
			}
			if (unsubscribe) {
				unsubscribe();
				unsubscribe = null;
			}
			if (unsubscribeProvisioning) {
				unsubscribeProvisioning();
				unsubscribeProvisioning = null;
			}
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive'
		}
	});
};
