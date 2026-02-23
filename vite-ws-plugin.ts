import type { Plugin, ViteDevServer } from 'vite';
import { WebSocketServer } from 'ws';

export function spyreWebSocket(): Plugin {
  return {
    name: 'spyre-websocket',
    configureServer(viteServer: ViteDevServer) {
      if (!viteServer.httpServer) return;

      const wss = new WebSocketServer({ noServer: true });

      // Cache the loaded module so ssrLoadModule only runs once
      let attachTerminal: ((ws: unknown, opts: unknown) => Promise<void>) | null = null;

      viteServer.httpServer.on('upgrade', (req, socket, head) => {
        const url = req.url ?? '';

        // Only handle /api/terminal/{envId} — ignore everything else (Vite HMR, etc.)
        const match = url.match(/^\/api\/terminal\/([^/?]+)/);
        if (!match || url.includes('/windows')) return;

        const envId = match[1];
        const queryStart = url.indexOf('?');
        const params = new URLSearchParams(queryStart >= 0 ? url.slice(queryStart) : '');
        const windowIndex = params.get('windowIndex') ? parseInt(params.get('windowIndex')!, 10) : undefined;
        const cols = params.get('cols') ? parseInt(params.get('cols')!, 10) : undefined;
        const rows = params.get('rows') ? parseInt(params.get('rows')!, 10) : undefined;

        wss.handleUpgrade(req, socket, head, async (ws) => {
          try {
            // Lazy-load terminal-manager on first connection (avoids polluting module graph at startup)
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
      });
    }
  };
}
