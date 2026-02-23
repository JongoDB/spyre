import type { Server as HttpServer, IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import { attachTerminal } from './terminal-manager';

export function createTerminalWsServer(httpServer: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = req.url;
    if (!url) {
      socket.destroy();
      return;
    }

    // Match /api/terminal/{envId}
    const match = url.match(/^\/api\/terminal\/([^/?]+)/);
    if (!match) {
      socket.destroy();
      return;
    }

    const envId = match[1];

    // Don't handle the windows API path
    if (url.includes('/windows')) {
      socket.destroy();
      return;
    }

    // Parse query parameters
    const queryStart = url.indexOf('?');
    const params = new URLSearchParams(queryStart >= 0 ? url.slice(queryStart) : '');
    const windowIndex = params.get('windowIndex') ? parseInt(params.get('windowIndex')!, 10) : undefined;
    const cols = params.get('cols') ? parseInt(params.get('cols')!, 10) : undefined;
    const rows = params.get('rows') ? parseInt(params.get('rows')!, 10) : undefined;

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
      attachTerminal(ws, { envId, windowIndex, cols, rows });
    });
  });

  return wss;
}
