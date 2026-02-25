import { handler } from './build/handler.js';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { WebSocketServer } from 'ws';
import { Client as SshClient } from 'ssh2';
import Database from 'better-sqlite3';

// =============================================================================
// Configuration
// =============================================================================

const configPath = resolve(process.cwd(), 'environment.yaml');
const config = parse(readFileSync(configPath, 'utf-8'));
const dbPath = resolve(process.cwd(), config.controller.db_path);
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function getEnvironment(id) {
  return db.prepare('SELECT * FROM environments WHERE id = ?').get(id);
}

// =============================================================================
// SSH Pool
// =============================================================================

const sshPool = new Map();

function readPrivateKey() {
  const keyPath = config.controller.ssh_key_path.replace('~', process.env.HOME ?? '');
  try {
    return readFileSync(keyPath);
  } catch {
    return null;
  }
}

function getConnection(envId) {
  const env = getEnvironment(envId);
  if (!env) return Promise.reject(new Error('Environment not found'));
  if (!env.ip_address) return Promise.reject(new Error('No IP address'));

  const host = env.ip_address;
  const port = env.ssh_port || 22;
  const user = env.ssh_user || 'root';

  let password;
  if (env.metadata) {
    try { password = JSON.parse(env.metadata).root_password; } catch { /* ignore */ }
  }

  const existing = sshPool.get(envId);
  if (existing && existing.ready && existing.host === host) {
    return Promise.resolve(existing.client);
  }

  if (existing) {
    try { existing.client.end(); } catch { /* ignore */ }
    sshPool.delete(envId);
  }

  return new Promise((resolve, reject) => {
    const client = new SshClient();
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        client.end();
        sshPool.delete(envId);
        reject(new Error('SSH connection timed out'));
      }
    }, 10000);

    client.on('ready', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sshPool.set(envId, { client, host, ready: true });
      resolve(client);
    });

    client.on('error', (err) => {
      if (!settled) { settled = true; clearTimeout(timer); sshPool.delete(envId); reject(err); }
    });

    client.on('close', () => {
      const e = sshPool.get(envId);
      if (e?.client === client) sshPool.delete(envId);
    });

    client.on('end', () => {
      const e = sshPool.get(envId);
      if (e?.client === client) sshPool.delete(envId);
    });

    const privateKey = readPrivateKey();
    client.connect({
      host, port, username: user,
      privateKey, password,
      keepaliveInterval: 30000, keepaliveCountMax: 5, readyTimeout: 10000,
      hostVerifier: () => true
    });
  });
}

// =============================================================================
// tmux Controller
// =============================================================================

function sshExec(client, command, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('SSH exec timeout')), timeoutMs);
    client.exec(command, (err, stream) => {
      if (err) { clearTimeout(timer); reject(err); return; }
      let stdout = '', stderr = '';
      stream.on('data', (d) => { stdout += d.toString(); });
      stream.stderr.on('data', (d) => { stderr += d.toString(); });
      stream.on('close', (code) => { clearTimeout(timer); resolve({ code: code ?? 0, stdout, stderr }); });
    });
  });
}

async function ensureSession(client, sessionName = 'spyre') {
  await sshExec(client, 'which tmux >/dev/null 2>&1 || (apt-get update -qq && apt-get install -y -qq tmux 2>/dev/null) || (apk add tmux 2>/dev/null) || true', 30000);
  const check = await sshExec(client, `tmux has-session -t ${sessionName} 2>/dev/null`);
  if (check.code !== 0) {
    await sshExec(client, `tmux new-session -d -s ${sessionName}`);
  }
  // Enable mouse mode so clicking selects panes, resizes panes, and scrolls
  await sshExec(client, `tmux set-option -t ${sessionName} mouse on 2>/dev/null`);
  // Use vi copy-mode keys for manual Ctrl+B [ usage
  await sshExec(client, `tmux set-window-option -t ${sessionName} mode-keys vi 2>/dev/null`);
  // Make search highlights clearly visible
  await sshExec(client, `tmux set-option -t ${sessionName} copy-mode-match-style 'bg=yellow,fg=black' 2>/dev/null`);
  await sshExec(client, `tmux set-option -t ${sessionName} copy-mode-current-match-style 'bg=magenta,fg=white,bold' 2>/dev/null`);
}

function attachToWindow(client, sessionName = 'spyre', windowIndex) {
  return new Promise((resolve, reject) => {
    client.shell({ rows: 24, cols: 80, term: 'xterm-256color' }, (err, stream) => {
      if (err) { reject(err); return; }
      const target = windowIndex !== undefined ? `${sessionName}:${windowIndex}` : sessionName;
      stream.write(`tmux attach-session -t ${target}\n`);
      resolve(stream);
    });
  });
}

// =============================================================================
// Terminal Manager
// =============================================================================

function sendJson(ws, data) {
  if (ws.readyState === 1) ws.send(JSON.stringify(data));
}

async function attachTerminal(ws, options) {
  const { envId, windowIndex, cols, rows } = options;

  const env = getEnvironment(envId);
  if (!env) { sendJson(ws, { type: 'error', message: 'Environment not found' }); ws.close(); return; }
  if (env.status !== 'running') { sendJson(ws, { type: 'error', message: `Environment is ${env.status}` }); ws.close(); return; }
  if (!env.ip_address) { sendJson(ws, { type: 'error', message: 'No IP address' }); ws.close(); return; }

  let client;
  try { client = await getConnection(envId); }
  catch (err) { sendJson(ws, { type: 'error', message: `SSH failed: ${err.message}` }); ws.close(); return; }

  let channel;
  let sessionRestored = false;
  try {
    const hasCheck = await sshExec(client, 'tmux has-session -t spyre 2>/dev/null');
    sessionRestored = hasCheck.code === 0;
    await ensureSession(client);
    channel = await attachToWindow(client, 'spyre', windowIndex);
  } catch (err) { sendJson(ws, { type: 'error', message: `tmux failed: ${err.message}` }); ws.close(); return; }

  if (cols && rows) channel.setWindow(rows, cols, 0, 0);
  sendJson(ws, { type: 'connected', windowIndex: windowIndex ?? 0, sessionRestored });

  channel.on('data', (data) => { if (ws.readyState === 1) ws.send(data); });

  ws.on('message', (data) => {
    if (typeof data === 'string') {
      try {
        const msg = JSON.parse(data);
        if (msg.type === 'resize' && msg.cols && msg.rows) { channel.setWindow(msg.rows, msg.cols, 0, 0); return; }
      } catch { /* not JSON */ }
      channel.write(data);
    } else {
      channel.write(data);
    }
  });

  channel.on('close', () => { sendJson(ws, { type: 'disconnected', reason: 'Channel closed' }); if (ws.readyState === 1) ws.close(); });
  channel.on('error', (err) => { sendJson(ws, { type: 'error', message: err.message }); });
  ws.on('close', () => { try { channel.close(); } catch { /* ignore */ } });
  ws.on('error', () => { try { channel.close(); } catch { /* ignore */ } });

  try { db.prepare("UPDATE environments SET last_accessed = datetime('now') WHERE id = ?").run(envId); } catch { /* non-critical */ }
}

// =============================================================================
// HTTP + WebSocket Server
// =============================================================================

const PORT = parseInt(process.env.PORT || '3000', 10);
const server = createServer(handler);
const wss = new WebSocketServer({ noServer: true });

// =============================================================================
// Claude Bridge — import dynamically to access EventEmitter from build
// =============================================================================

let claudeBridgeEmitter = null;

async function getClaudeBridgeEmitter() {
  if (claudeBridgeEmitter) return claudeBridgeEmitter;
  try {
    const mod = await import('./build/server/chunks/claude-bridge.js').catch(() => null);
    if (mod?.getEmitter) {
      claudeBridgeEmitter = mod.getEmitter();
      return claudeBridgeEmitter;
    }
  } catch { /* not available */ }
  return null;
}

function attachClaudeStream(ws, taskId) {
  // Check task exists
  const task = db.prepare('SELECT * FROM claude_tasks WHERE id = ?').get(taskId);
  if (!task) {
    sendJson(ws, { type: 'error', message: 'Task not found' });
    ws.close();
    return;
  }

  // If task already completed, send stored events then final state
  if (task.status === 'complete' || task.status === 'error' || task.status === 'cancelled') {
    // Send stored structured events
    try {
      const events = db.prepare(
        'SELECT seq, event_type, summary, data, created_at FROM claude_task_events WHERE task_id = ? ORDER BY seq ASC'
      ).all(taskId);
      for (const evt of events) {
        sendJson(ws, {
          type: 'event',
          seq: evt.seq,
          eventType: evt.event_type,
          summary: evt.summary,
          data: evt.data ? JSON.parse(evt.data) : {},
          timestamp: evt.created_at
        });
      }
    } catch { /* non-critical */ }
    sendJson(ws, { type: 'complete', taskId, status: task.status, result: task.result });
    ws.close();
    return;
  }

  // For running/pending tasks: send stored events so far (reconnect case)
  try {
    const events = db.prepare(
      'SELECT seq, event_type, summary, data, created_at FROM claude_task_events WHERE task_id = ? ORDER BY seq ASC'
    ).all(taskId);
    for (const evt of events) {
      sendJson(ws, {
        type: 'event',
        seq: evt.seq,
        eventType: evt.event_type,
        summary: evt.summary,
        data: evt.data ? JSON.parse(evt.data) : {},
        timestamp: evt.created_at
      });
    }
  } catch { /* non-critical */ }

  // Also send accumulated raw output for backward compat
  if (task.output) {
    sendJson(ws, { type: 'output', data: task.output, taskId });
  }

  // Subscribe to live events
  getClaudeBridgeEmitter().then((emitter) => {
    if (!emitter) {
      sendJson(ws, { type: 'error', message: 'Claude bridge not available' });
      ws.close();
      return;
    }

    const onOutput = (event) => {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify(event));
      }
    };

    const onEvent = (event) => {
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

    const onComplete = (event) => {
      if (ws.readyState === 1) {
        ws.send(JSON.stringify({ type: 'complete', ...event }));
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
  });
}

server.on('upgrade', (req, socket, head) => {
  const url = req.url;
  if (!url) return;

  // Terminal WebSocket: /api/terminal/{envId}
  const terminalMatch = url.match(/^\/api\/terminal\/([^/?]+)/);
  if (terminalMatch && !url.includes('/windows')) {
    const envId = terminalMatch[1];
    const queryStart = url.indexOf('?');
    const params = new URLSearchParams(queryStart >= 0 ? url.slice(queryStart) : '');
    const windowIndex = params.get('windowIndex') ? parseInt(params.get('windowIndex'), 10) : undefined;
    const cols = params.get('cols') ? parseInt(params.get('cols'), 10) : undefined;
    const rows = params.get('rows') ? parseInt(params.get('rows'), 10) : undefined;

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
      attachTerminal(ws, { envId, windowIndex, cols, rows });
    });
    return;
  }

  // Claude task stream WebSocket: /api/claude/tasks/{taskId}/stream
  const claudeMatch = url.match(/^\/api\/claude\/tasks\/([^/?]+)\/stream/);
  if (claudeMatch) {
    const taskId = claudeMatch[1];
    wss.handleUpgrade(req, socket, head, (ws) => {
      attachClaudeStream(ws, taskId);
    });
    return;
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[spyre] Production server listening on http://0.0.0.0:${PORT}`);
});

// Cleanup on shutdown
process.on('SIGTERM', () => {
  for (const [, entry] of sshPool) {
    try { entry.client.end(); } catch { /* ignore */ }
  }
  server.close();
  db.close();
});
