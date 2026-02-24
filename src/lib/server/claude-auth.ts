import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { getDb } from './db';
import { getEnvConfig } from './env-config';
import type { ClaudeAuthState } from '$lib/types/claude';

// =============================================================================
// Claude Auth Relay — Manages OAuth lifecycle for Claude CLI
// =============================================================================

type StateSubscriber = (state: ClaudeAuthState) => void;

let _state: ClaudeAuthState = {
  status: 'idle',
  oauthUrl: null,
  localPort: null,
  error: null,
  lastAuthenticated: null,
  tokenExpiresAt: null
};

let _authProcess: ChildProcess | null = null;
let _healthTimer: ReturnType<typeof setInterval> | null = null;
const _subscribers = new Set<StateSubscriber>();

function setState(partial: Partial<ClaudeAuthState>): void {
  _state = { ..._state, ...partial };
  for (const sub of _subscribers) {
    try {
      sub(_state);
    } catch {
      _subscribers.delete(sub);
    }
  }
}

function logAuthEvent(
  event: string,
  details?: Record<string, unknown>
): void {
  try {
    const db = getDb();
    db.prepare(
      'INSERT INTO claude_auth_log (event, details) VALUES (?, ?)'
    ).run(event, details ? JSON.stringify(details) : null);
  } catch {
    // Non-critical
  }
}

// =============================================================================
// Auth JSON Reading
// =============================================================================

function resolveAuthJsonPath(): string {
  const config = getEnvConfig();
  const authPath = config.claude?.auth_json_path ?? '~/.claude/.credentials.json';
  return authPath.replace('~', process.env.HOME ?? '/root');
}

function readAuthJson(): { authenticated: boolean; expiresAt: string | null } {
  try {
    const authPath = resolveAuthJsonPath();
    if (!existsSync(authPath)) {
      return { authenticated: false, expiresAt: null };
    }
    const raw = readFileSync(authPath, 'utf-8');
    const data = JSON.parse(raw);

    // Claude credentials file may have different structures
    if (data.claudeAiOauth) {
      const token = data.claudeAiOauth;
      const expiresAt = token.expiresAt ?? token.expires_at ?? null;
      if (expiresAt) {
        const expiry = new Date(expiresAt);
        if (expiry <= new Date()) {
          return { authenticated: false, expiresAt };
        }
      }
      return { authenticated: true, expiresAt };
    }

    // Fallback: check for any token-like field
    if (data.accessToken || data.access_token || data.token) {
      return { authenticated: true, expiresAt: data.expiresAt ?? data.expires_at ?? null };
    }

    return { authenticated: false, expiresAt: null };
  } catch {
    return { authenticated: false, expiresAt: null };
  }
}

// =============================================================================
// Health Check
// =============================================================================

async function healthCheck(): Promise<void> {
  const auth = readAuthJson();

  if (auth.authenticated) {
    if (_state.status !== 'authenticated' &&
        _state.status !== 'waiting_for_oauth' &&
        _state.status !== 'waiting_for_callback') {
      setState({
        status: 'authenticated',
        lastAuthenticated: new Date().toISOString(),
        tokenExpiresAt: auth.expiresAt,
        error: null
      });
      logAuthEvent('health_check', { result: 'authenticated' });
    }

    // Check for expiring soon
    if (auth.expiresAt) {
      const expiry = new Date(auth.expiresAt);
      const hoursUntilExpiry = (expiry.getTime() - Date.now()) / (1000 * 60 * 60);
      if (hoursUntilExpiry < 24 && hoursUntilExpiry > 0) {
        logAuthEvent('token_expiring_soon', { hours_remaining: hoursUntilExpiry });
      }
    }
  } else if (_state.status === 'authenticated') {
    setState({ status: 'idle', lastAuthenticated: _state.lastAuthenticated });
    logAuthEvent('expired');
  }
}

function startHealthCheck(): void {
  if (_healthTimer) return;
  const config = getEnvConfig();
  const interval = config.claude?.health_check_interval ?? 60000;
  healthCheck();
  _healthTimer = setInterval(healthCheck, interval);
}

function stopHealthCheck(): void {
  if (_healthTimer) {
    clearInterval(_healthTimer);
    _healthTimer = null;
  }
}

// =============================================================================
// Public API
// =============================================================================

export function getState(): ClaudeAuthState {
  return { ..._state };
}

export function subscribe(callback: StateSubscriber): () => void {
  _subscribers.add(callback);
  if (_subscribers.size === 1) {
    startHealthCheck();
  }
  return () => {
    _subscribers.delete(callback);
    if (_subscribers.size === 0) {
      stopHealthCheck();
    }
  };
}

export async function initiateAuth(): Promise<{ oauthUrl: string | null }> {
  if (_authProcess) {
    cancelAuth();
  }

  logAuthEvent('initiated');
  setState({
    status: 'waiting_for_oauth',
    oauthUrl: null,
    error: null
  });

  return new Promise((resolve) => {
    let oauthUrl: string | null = null;
    let output = '';

    _authProcess = spawn('claude', ['login', '--method', 'oauth'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env }
    });

    const timeout = setTimeout(() => {
      if (_authProcess) {
        _authProcess.kill();
        _authProcess = null;
        setState({ status: 'error', error: 'Auth process timed out' });
        logAuthEvent('error', { reason: 'timeout' });
        resolve({ oauthUrl: null });
      }
    }, 120000);

    _authProcess.stdout?.on('data', (data: Buffer) => {
      output += data.toString();
      // Look for OAuth URL in output
      const urlMatch = output.match(/https:\/\/[^\s]+/);
      if (urlMatch && !oauthUrl) {
        oauthUrl = urlMatch[0];
        setState({
          status: 'waiting_for_callback',
          oauthUrl
        });
        resolve({ oauthUrl });
      }
    });

    _authProcess.stderr?.on('data', (data: Buffer) => {
      output += data.toString();
      // Also check stderr for URL
      const urlMatch = output.match(/https:\/\/[^\s]+/);
      if (urlMatch && !oauthUrl) {
        oauthUrl = urlMatch[0];
        setState({
          status: 'waiting_for_callback',
          oauthUrl
        });
        resolve({ oauthUrl });
      }
    });

    _authProcess.on('close', (code) => {
      clearTimeout(timeout);
      _authProcess = null;

      if (code === 0) {
        const auth = readAuthJson();
        if (auth.authenticated) {
          setState({
            status: 'authenticated',
            oauthUrl: null,
            lastAuthenticated: new Date().toISOString(),
            tokenExpiresAt: auth.expiresAt,
            error: null
          });
          logAuthEvent('authenticated');
        } else {
          setState({
            status: 'idle',
            oauthUrl: null,
            error: null
          });
        }
      } else {
        setState({
          status: 'error',
          oauthUrl: null,
          error: `Auth process exited with code ${code}`
        });
        logAuthEvent('error', { code, output: output.slice(-500) });
      }

      if (!oauthUrl) {
        resolve({ oauthUrl: null });
      }
    });

    _authProcess.on('error', (err) => {
      clearTimeout(timeout);
      _authProcess = null;
      setState({
        status: 'error',
        error: `Failed to start claude CLI: ${err.message}`
      });
      logAuthEvent('error', { reason: err.message });
      resolve({ oauthUrl: null });
    });
  });
}

export async function handleCallback(params: URLSearchParams): Promise<boolean> {
  logAuthEvent('callback_received', { params: Object.fromEntries(params) });

  // Wait briefly for claude login process to handle the callback
  await new Promise(r => setTimeout(r, 2000));

  const auth = readAuthJson();
  if (auth.authenticated) {
    setState({
      status: 'authenticated',
      oauthUrl: null,
      lastAuthenticated: new Date().toISOString(),
      tokenExpiresAt: auth.expiresAt,
      error: null
    });
    logAuthEvent('authenticated');
    return true;
  }

  return false;
}

export async function checkAuthStatus(): Promise<ClaudeAuthState> {
  await healthCheck();
  return getState();
}

export function cancelAuth(): void {
  if (_authProcess) {
    _authProcess.kill();
    _authProcess = null;
  }
  setState({
    status: 'idle',
    oauthUrl: null,
    error: null
  });
  logAuthEvent('cancelled');
}

export function getAuthLog(limit = 50): Array<{ id: number; event: string; details: string | null; timestamp: string }> {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM claude_auth_log ORDER BY timestamp DESC LIMIT ?'
  ).all(limit) as Array<{ id: number; event: string; details: string | null; timestamp: string }>;
}

// Initialize: check auth status on import
startHealthCheck();
