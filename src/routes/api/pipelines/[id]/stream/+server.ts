import type { RequestHandler } from './$types';
import { getEmitter, getPipeline } from '$lib/server/pipeline-engine';

export const GET: RequestHandler = ({ params }) => {
  const pipeline = getPipeline(params.id);
  if (!pipeline) {
    return new Response(JSON.stringify({ code: 'NOT_FOUND', message: 'Pipeline not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  let keepaliveTimer: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const emitter = getEmitter();

      const handler = (data: Record<string, unknown>) => {
        try {
          controller.enqueue(`data: ${JSON.stringify(data)}\n\n`);
        } catch {
          cleanup();
        }
      };

      emitter.on(`pipeline:${params.id}`, handler);

      // Keepalive every 15s
      keepaliveTimer = setInterval(() => {
        try {
          controller.enqueue(':\n\n');
        } catch {
          cleanup();
        }
      }, 15_000);

      function cleanup() {
        emitter.removeListener(`pipeline:${params.id}`, handler);
        if (keepaliveTimer) {
          clearInterval(keepaliveTimer);
          keepaliveTimer = null;
        }
      }

      // Store cleanup for cancel
      (controller as unknown as { _cleanup: () => void })._cleanup = cleanup;
    },
    cancel(controller) {
      const ctrl = controller as unknown as { _cleanup?: () => void };
      ctrl._cleanup?.();
      if (keepaliveTimer) {
        clearInterval(keepaliveTimer);
        keepaliveTimer = null;
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
