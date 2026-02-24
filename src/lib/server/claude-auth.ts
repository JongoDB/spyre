import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getDb } from './db';
import { getEnvConfig } from './env-config';
import type { ClaudeAuthState, ClaudeCliStatus } from '$lib/types/claude';

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
  tokenExpiresAt: null,
  authMethod: null,
  email: null,
  subscriptionType: null,
  cliInstalled: false
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
// CLI Detection & Install
// =============================================================================

/**
 * Strip CLAUDECODE env var to avoid "nested session" errors.
 */
function cleanEnvVars(): NodeJS.ProcessEnv {
  const { CLAUDECODE: _, ...cleanEnv } = process.env;
  return cleanEnv;
}

/**
 * Check if the Claude CLI is installed on the controller.
 */
export function getClaudeCliStatus(): Promise<ClaudeCliStatus> {
  return new Promise((resolve) => {
    execFile('claude', ['--version'], { env: cleanEnvVars(), timeout: 10000 }, (err, stdout) => {
      if (err) {
        resolve({ installed: false, version: null, path: null });
        return;
      }
      const version = stdout.trim() || null;
      // Resolve the path
      execFile('which', ['claude'], { timeout: 5000 }, (whichErr, whichOut) => {
        resolve({
          installed: true,
          version,
          path: whichErr ? null : whichOut.trim()
        });
      });
    });
  });
}

/**
 * Install Claude CLI on the controller via the official install script.
 */
export function installClaudeCli(): Promise<{ success: boolean; output: string; error?: string }> {
  return new Promise((resolve) => {
    const proc = spawn('sh', ['-c', 'curl -fsSL https://claude.ai/install.sh | sh'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: cleanEnvVars(),
      timeout: 180000
    });

    let output = '';
    proc.stdout?.on('data', (data: Buffer) => { output += data.toString(); });
    proc.stderr?.on('data', (data: Buffer) => { output += data.toString(); });

    proc.on('close', (code) => {
      if (code === 0) {
        logAuthEvent('cli_installed', { output: output.slice(-500) });
        resolve({ success: true, output });
      } else {
        logAuthEvent('cli_install_failed', { code, output: output.slice(-500) });
        resolve({ success: false, output, error: `Install script exited with code ${code}` });
      }
    });

    proc.on('error', (err) => {
      resolve({ success: false, output, error: err.message });
    });
  });
}

// =============================================================================
// Token Auth
// =============================================================================

/**
 * Set up Claude auth via a token. Spawns `claude auth login --api-key` and pipes the token.
 */
export async function setupToken(token: string): Promise<{ success: boolean; error?: string }> {
  const cliStatus = await getClaudeCliStatus();
  if (!cliStatus.installed) {
    return { success: false, error: 'Claude CLI is not installed. Install it first.' };
  }

  return new Promise((resolve) => {
    let output = '';

    // Try `claude auth login --api-key` which reads the key from stdin
    const proc = spawn('claude', ['auth', 'login', '--api-key'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: cleanEnvVars()
    });

    const timeout = setTimeout(() => {
      proc.kill();
      resolve({ success: false, error: 'Token setup timed out' });
    }, 30000);

    proc.stdout?.on('data', (data: Buffer) => { output += data.toString(); });
    proc.stderr?.on('data', (data: Buffer) => { output += data.toString(); });

    proc.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        const auth = readAuthJson();
        setState({
          status: 'authenticated',
          oauthUrl: null,
          lastAuthenticated: new Date().toISOString(),
          tokenExpiresAt: auth.expiresAt,
          authMethod: 'token',
          error: null
        });
        logAuthEvent('authenticated', { method: 'token' });
        resolve({ success: true });
      } else {
        setState({
          status: 'error',
          error: `Token setup failed (exit ${code})`
        });
        logAuthEvent('error', { method: 'token', code, output: output.slice(-500) });
        resolve({ success: false, error: `Token setup failed (exit ${code}): ${output.slice(-200)}` });
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timeout);
      resolve({ success: false, error: `Failed to start claude CLI: ${err.message}` });
    });

    // Write token to stdin
    proc.stdin?.write(token + '\n');
    proc.stdin?.end();
  });
}

// =============================================================================
// OAuth Code Submission
// =============================================================================

/**
 * Submit the OAuth auth code to the running auth process.
 * Writes the code to the Python PTY wrapper's stdin, which relays it
 * to `claude auth login` running inside a real pseudo-terminal.
 */
export async function submitOauthCode(code: string): Promise<{ success: boolean; error?: string }> {
  // Write the code to the auth process's stdin
  if (_authProcess && !_authProcess.killed && _authProcess.stdin) {
    try {
      _authProcess.stdin.write(code + '\n');
      logAuthEvent('code_submitted', { hasProcess: true });
    } catch (err) {
      logAuthEvent('code_submit_error', { error: String(err) });
      // Fall through to polling
    }

    // Wait for the process to exit or for credentials to appear.
    for (let i = 0; i < 30; i++) {
      await new Promise(r => setTimeout(r, 1000));

      // Check if initiateAuth's close handler already updated state
      if (_state.status === 'authenticated') {
        return { success: true };
      }

      // Also check the credential file directly
      const auth = readAuthJson();
      if (auth.authenticated) {
        setState({
          status: 'authenticated',
          oauthUrl: null,
          lastAuthenticated: new Date().toISOString(),
          tokenExpiresAt: auth.expiresAt,
          authMethod: 'oauth',
          error: null
        });
        logAuthEvent('authenticated', { method: 'oauth_code' });
        return { success: true };
      }

      // If the process exited and we're in an error state, stop waiting
      if (!_authProcess && _state.status === 'error') {
        return { success: false, error: _state.error ?? 'Auth process failed' };
      }
    }

    return { success: false, error: 'Auth code was sent but authentication did not complete. The code may be invalid or expired.' };
  }

  // No running auth process — try to find an orphaned PTY wrapper and
  // write the code directly. This handles HMR restarts where the module
  // state was lost but the process is still alive.
  logAuthEvent('code_submitted', { hasProcess: false, state: _state.status });
  try {
    const { execSync } = await import('node:child_process');
    const pidOutput = execSync("pgrep -f 'claude-auth-pty'", { timeout: 5000 }).toString().trim();
    if (pidOutput) {
      const ptyPid = parseInt(pidOutput.split('\n')[0], 10);
      if (!isNaN(ptyPid)) {
        // Found an orphaned PTY process. Spawn a new Python wrapper connected
        // to the same PTY? No — we can't write to the orphan's stdin.
        // Instead, kill the orphan and start fresh.
        logAuthEvent('orphan_found', { pid: ptyPid });
      }
    }
  } catch {
    // No orphan found, that's fine
  }

  // Check if credentials already exist (auth may have completed externally)
  const auth = readAuthJson();
  if (auth.authenticated) {
    setState({
      status: 'authenticated',
      oauthUrl: null,
      lastAuthenticated: new Date().toISOString(),
      tokenExpiresAt: auth.expiresAt,
      authMethod: 'oauth',
      error: null
    });
    logAuthEvent('authenticated', { method: 'oauth_poll' });
    return { success: true };
  }

  return { success: false, error: 'No active OAuth session. The server may have restarted — please start a new OAuth flow.' };
}

// =============================================================================
// Detailed Auth Status
// =============================================================================

/**
 * Get detailed auth status by running `claude auth status` and parsing output.
 */
export async function getDetailedAuthStatus(): Promise<{
  authenticated: boolean;
  email: string | null;
  subscriptionType: string | null;
  expiresAt: string | null;
}> {
  try {
    const result = await new Promise<{ stdout: string; code: number }>((resolve) => {
      execFile('claude', ['auth', 'status'], {
        env: cleanEnvVars(),
        timeout: 10000
      }, (err, stdout) => {
        resolve({ stdout: stdout?.toString() ?? '', code: err ? 1 : 0 });
      });
    });

    if (result.code !== 0) {
      return { authenticated: false, email: null, subscriptionType: null, expiresAt: null };
    }

    const output = result.stdout;

    // Try to parse email from output
    const emailMatch = output.match(/(?:email|account|user)[:\s]+([^\s]+@[^\s]+)/i);
    const email = emailMatch ? emailMatch[1] : null;

    // Try to parse subscription/plan
    const planMatch = output.match(/(?:plan|subscription|tier)[:\s]+([^\n]+)/i);
    const subscriptionType = planMatch ? planMatch[1].trim() : null;

    // Check if authenticated
    const isAuthed = /authenticated|logged in|active/i.test(output);

    const auth = readAuthJson();

    return {
      authenticated: isAuthed || auth.authenticated,
      email,
      subscriptionType,
      expiresAt: auth.expiresAt
    };
  } catch {
    // Fallback to credential file check
    const auth = readAuthJson();
    return { authenticated: auth.authenticated, email: null, subscriptionType: null, expiresAt: auth.expiresAt };
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

export async function initiateAuth(): Promise<{ oauthUrl: string | null; error?: string }> {
  // Guard: check if CLI is installed
  const cliStatus = await getClaudeCliStatus();
  if (!cliStatus.installed) {
    setState({
      status: 'error',
      error: 'Claude CLI is not installed. Install it first from the settings page.'
    });
    return { oauthUrl: null, error: 'Claude CLI is not installed. Install it first.' };
  }

  if (_authProcess) {
    cancelAuth();
  }

  logAuthEvent('initiated');
  setState({
    status: 'waiting_for_oauth',
    oauthUrl: null,
    error: null,
    authMethod: 'oauth'
  });

  // `claude auth login` requires a real TTY to read the auth code from stdin.
  // We use a Python PTY wrapper script that creates a pseudo-terminal,
  // runs the CLI inside it, and relays I/O through piped stdio that Node.js
  // can read/write. The auth code is later sent via submitOauthCode() which
  // writes to this process's stdin.
  const ptyScript = join(process.cwd(), 'scripts', 'claude-auth-pty.py');

  return new Promise((resolve) => {
    let oauthUrl: string | null = null;
    let output = '';

    _authProcess = spawn('python3', ['-u', ptyScript], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: cleanEnvVars()
    });

    // 10-minute timeout
    const timeout = setTimeout(() => {
      if (_authProcess) {
        _authProcess.kill();
        _authProcess = null;
        setState({ status: 'error', error: 'Auth process timed out (10 minutes). Please try again.' });
        logAuthEvent('error', { reason: 'timeout' });
        resolve({ oauthUrl: null });
      }
    }, 600000);

    _authProcess.stdout?.on('data', (data: Buffer) => {
      const chunk = data.toString();
      output += chunk;
      // Strip ANSI escape codes for matching
      const clean = output.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
      const urlMatch = clean.match(/https:\/\/[^\s\x00-\x1f]+/);
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
      const chunk = data.toString();
      output += chunk;
      const clean = output.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
      const urlMatch = clean.match(/https:\/\/[^\s\x00-\x1f]+/);
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
            authMethod: 'oauth',
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
        // Don't overwrite state if already authenticated (race with submitOauthCode)
        if (_state.status !== 'authenticated') {
          setState({
            status: 'error',
            oauthUrl: null,
            error: `Auth process exited with code ${code}`
          });
        }
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
        error: `Failed to start auth process: ${err.message}`
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
