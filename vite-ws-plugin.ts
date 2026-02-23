import type { Plugin } from 'vite';

export function spyreWebSocket(): Plugin {
  return {
    name: 'spyre-websocket',
    configureServer(server) {
      if (!server.httpServer) return;
      server.httpServer.once('listening', async () => {
        const mod = await server.ssrLoadModule('/src/lib/server/ws-server.ts');
        mod.createTerminalWsServer(server.httpServer);
      });
    }
  };
}
