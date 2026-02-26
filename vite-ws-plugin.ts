import type { Plugin, ViteDevServer } from 'vite';
import { WebSocketServer, type WebSocket } from 'ws';

function sendJson(ws: WebSocket, data: unknown): void {
  if (ws.readyState === 1) ws.send(JSON.stringify(data));
}

export function spyreWebSocket(): Plugin {
  return {
    name: 'spyre-websocket',
    configureServer(viteServer: ViteDevServer) {
      if (!viteServer.httpServer) return;

      // MCP endpoint middleware — intercept /mcp before SvelteKit
      viteServer.middlewares.use(async (req, res, next) => {
        const url = req.url ?? '';
        if (url === '/mcp' || url.startsWith('/mcp?')) {
          try {
            const mod = await viteServer.ssrLoadModule('/src/lib/server/mcp-server.ts');
            await mod.handleMcpRequest(req, res);
          } catch (err) {
            console.error('[spyre] MCP dev request error:', err);
            if (!res.headersSent) {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'MCP server error' }));
            }
          }
          return;
        }
        next();
      });

      const wss = new WebSocketServer({ noServer: true });

      // Cache loaded modules so ssrLoadModule only runs once per module
      let attachTerminal: ((ws: unknown, opts: unknown) => Promise<void>) | null = null;
      let claudeBridge: {
        getTask: (id: string) => unknown;
        getTaskEvents: (id: string) => Array<{ seq: number; type: string; timestamp: string; summary: string; data: Record<string, unknown> }>;
        getEmitter: () => import('node:events').EventEmitter;
      } | null = null;

      viteServer.httpServer.on('upgrade', (req, socket, head) => {
        const url = req.url ?? '';

        // Terminal WebSocket: /api/terminal/{envId}
        const terminalMatch = url.match(/^\/api\/terminal\/([^/?]+)/);
        if (terminalMatch && !url.includes('/windows')) {
          const envId = terminalMatch[1];
          const queryStart = url.indexOf('?');
          const params = new URLSearchParams(queryStart >= 0 ? url.slice(queryStart) : '');
          const windowIndex = params.get('windowIndex') ? parseInt(params.get('windowIndex')!, 10) : undefined;
          const cols = params.get('cols') ? parseInt(params.get('cols')!, 10) : undefined;
          const rows = params.get('rows') ? parseInt(params.get('rows')!, 10) : undefined;

          wss.handleUpgrade(req, socket, head, async (ws) => {
            try {
              if (!attachTerminal) {
                const mod = await viteServer.ssrLoadModule('/src/lib/server/terminal-manager.ts');
                attachTerminal = mod.attachTerminal;
              }
              await attachTerminal!(ws, { envId, windowIndex, cols, rows });
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              try {
                ws.send(JSON.stringify({ type: 'error', message: msg }));
                ws.close();
              } catch { /* socket may already be dead */ }
            }
          });
          return;
        }

        // Claude task stream WebSocket: /api/claude/tasks/{taskId}/stream
        const claudeMatch = url.match(/^\/api\/claude\/tasks\/([^/?]+)\/stream/);
        if (claudeMatch) {
          const taskId = claudeMatch[1];

          wss.handleUpgrade(req, socket, head, async (ws) => {
            try {
              // Lazy-load claude-bridge
              if (!claudeBridge) {
                const mod = await viteServer.ssrLoadModule('/src/lib/server/claude-bridge.ts');
                claudeBridge = {
                  getTask: mod.getTask,
                  getTaskEvents: mod.getTaskEvents,
                  getEmitter: mod.getEmitter
                };
              }

              const task = claudeBridge.getTask(taskId) as Record<string, unknown> | null;
              if (!task) {
                sendJson(ws, { type: 'error', message: 'Task not found' });
                ws.close();
                return;
              }

              const status = task.status as string;

              // Send stored events
              const storedEvents = claudeBridge.getTaskEvents(taskId);
              for (const evt of storedEvents) {
                sendJson(ws, {
                  type: 'event',
                  seq: evt.seq,
                  eventType: evt.type,
                  summary: evt.summary,
                  data: evt.data,
                  timestamp: evt.timestamp
                });
              }

              // If task already completed, send final state and close
              if (status === 'complete' || status === 'error' || status === 'cancelled') {
                sendJson(ws, { type: 'complete', taskId, status, result: task.result });
                ws.close();
                return;
              }

              // For running/pending tasks: also send accumulated raw output
              if (task.output) {
                sendJson(ws, { type: 'output', data: task.output, taskId });
              }

              // Subscribe to live events
              const emitter = claudeBridge.getEmitter();

              const onOutput = (event: unknown) => {
                if (ws.readyState === 1) {
                  ws.send(JSON.stringify(event));
                }
              };

              const onEvent = (event: { seq: number; type: string; summary: string; data: unknown; timestamp: string }) => {
                if (ws.readyState === 1) {
                  sendJson(ws, {
                    type: 'event',
                    seq: event.seq,
                    eventType: event.type,
                    summary: event.summary,
                    data: event.data,
                    timestamp: event.timestamp
                  });
                }
              };

              const onComplete = (event: unknown) => {
                if (ws.readyState === 1) {
                  ws.send(JSON.stringify({ type: 'complete', ...(event as Record<string, unknown>) }));
                  ws.close();
                }
                cleanup();
              };

              function cleanup() {
                emitter.removeListener(`task:${taskId}:output`, onOutput);
                emitter.removeListener(`task:${taskId}:event`, onEvent);
                emitter.removeListener(`task:${taskId}:complete`, onComplete);
              }

              emitter.on(`task:${taskId}:output`, onOutput);
              emitter.on(`task:${taskId}:event`, onEvent);
              emitter.on(`task:${taskId}:complete`, onComplete);

              ws.on('close', cleanup);
              ws.on('error', cleanup);
            } catch (err) {
              const msg = err instanceof Error ? err.message : String(err);
              try {
                sendJson(ws, { type: 'error', message: msg });
                ws.close();
              } catch { /* socket may already be dead */ }
            }
          });
          return;
        }
      });
    }
  };
}
