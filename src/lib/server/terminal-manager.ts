import type { WebSocket } from 'ws';
import type { ClientChannel } from 'ssh2';
import { getConnection, closeConnection } from './ssh-pool';
import { ensureSession, attachToWindow, sessionExists } from './tmux-controller';
import { getEnvironment } from './environments';
import { getDb } from './db';

interface AttachOptions {
  envId: string;
  windowIndex?: number;
  cols?: number;
  rows?: number;
}

function sendJson(ws: WebSocket, data: Record<string, unknown>): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

export async function attachTerminal(
  ws: WebSocket,
  options: AttachOptions
): Promise<void> {
  const { envId, windowIndex, cols, rows } = options;

  // Validate environment
  const env = getEnvironment(envId);
  if (!env) {
    sendJson(ws, { type: 'error', message: 'Environment not found' });
    ws.close();
    return;
  }

  if (env.status !== 'running') {
    sendJson(ws, { type: 'error', message: `Environment is ${env.status}, not running` });
    ws.close();
    return;
  }

  if (!env.ip_address) {
    sendJson(ws, { type: 'error', message: 'Environment has no IP address' });
    ws.close();
    return;
  }

  let client;
  try {
    client = await getConnection(envId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    sendJson(ws, { type: 'error', message: `SSH connection failed: ${msg}` });
    ws.close();
    return;
  }

  let channel: ClientChannel;
  let sessionRestored = false;
  try {
    sessionRestored = await sessionExists(client);
    await ensureSession(client);
    channel = await attachToWindow(client, 'spyre', windowIndex);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    sendJson(ws, { type: 'error', message: `tmux attach failed: ${msg}` });
    ws.close();
    return;
  }

  // Apply initial size
  if (cols && rows) {
    channel.setWindow(rows, cols, 0, 0);
  }

  // Notify client of connection
  sendJson(ws, { type: 'connected', windowIndex: windowIndex ?? 0, sessionRestored });

  // Pipe: SSH channel → WebSocket
  channel.on('data', (data: Buffer) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(data);
    }
  });

  // Pipe: WebSocket → SSH channel
  ws.on('message', (data: Buffer | string) => {
    if (typeof data === 'string') {
      // Try to parse as JSON control message
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'resize' && msg.cols && msg.rows) {
          channel.setWindow(msg.rows, msg.cols, 0, 0);
          return;
        }
      } catch {
        // Not JSON — treat as terminal input
      }
      channel.write(data);
    } else {
      channel.write(data);
    }
  });

  // Handle channel close
  channel.on('close', () => {
    sendJson(ws, { type: 'disconnected', reason: 'Channel closed' });
    if (ws.readyState === ws.OPEN) {
      ws.close();
    }
  });

  channel.on('error', (err: Error) => {
    sendJson(ws, { type: 'error', message: `Channel error: ${err.message}` });
  });

  // Handle WebSocket close — detach but don't kill tmux session
  ws.on('close', () => {
    try { channel.close(); } catch { /* ignore */ }
  });

  ws.on('error', () => {
    try { channel.close(); } catch { /* ignore */ }
  });

  // Update last_accessed
  try {
    const db = getDb();
    db.prepare("UPDATE environments SET last_accessed = datetime('now') WHERE id = ?").run(envId);
  } catch {
    // Non-critical
  }
}
