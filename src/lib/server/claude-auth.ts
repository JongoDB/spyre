import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { getDb } from './db';
import { getEnvConfig } from './env-config';
import { getConnection } from './ssh-pool';
import { sshExec } from './tmux-controller';
import type { ClaudeAuthState, ClaudeCliStatus } from '$lib/types/claude';

// =============================================================================
// OAuth Constants
// =============================================================================

const OAUTH_TOKEN_URL = 'https://console.anthropic.com/v1/oauth/token';
const OAUTH_AUTHORIZE_URL = 'https://claude.ai/oauth/authorize';
const OAUTH_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const OAUTH_REDIRECT_URI = 'https://console.anthropic.com/oauth/code/callback';
const OAUTH_SCOPES = 'org:create_api_key user:profile user:inference';

/** Refresh 5 minutes before actual expiry */
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

/** Mutex: prevent concurrent refresh requests (refresh tokens are single-use) */
let refreshInFlight: Promise<OAuthTokens | null> | null = null;

// =============================================================================
// OAuth Types
// =============================================================================

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scopes?: string[];
  subscriptionType?: string;
  rateLimitTier?: string;
}

export interface OAuthFlowParams {
  authorizeUrl: string;
  codeVerifier: string;
  state: string;
}

export interface TokenRefreshResult {
  success: boolean;
  expiresAt?: number;
  error?: string;
}

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
// OAuth Token Management
// =============================================================================

/**
 * Read OAuth tokens from the controller's credential file.
 */
export function readOAuthTokens(): OAuthTokens | null {
  const path = resolveAuthJsonPath();
  if (!existsSync(path)) return null;

  try {
    const raw = readFileSync(path, 'utf-8');
    const data = JSON.parse(raw) as Record<string, unknown>;
    const oauth = (data.claudeAiOauth ?? data.oauthAccount) as OAuthTokens | undefined;
    if (!oauth?.accessToken || !oauth?.refreshToken) return null;
    return oauth;
  } catch {
    return null;
  }
}

/**
 * Write updated OAuth tokens back to the credential file.
 * Preserves other fields in the file.
 */
function writeOAuthTokens(tokens: OAuthTokens): void {
  const path = resolveAuthJsonPath();

  let existing: Record<string, unknown> = {};
  if (existsSync(path)) {
    try {
      existing = JSON.parse(readFileSync(path, 'utf-8'));
    } catch {
      // Start fresh if file is corrupt
    }
  }

  existing.claudeAiOauth = {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresAt: tokens.expiresAt,
    scopes: tokens.scopes ?? ['user:inference', 'user:profile'],
    subscriptionType: tokens.subscriptionType,
    rateLimitTier: tokens.rateLimitTier,
  };

  writeFileSync(path, JSON.stringify(existing, null, 2));
}

/**
 * Check if the access token is expired (or expiring within the buffer window).
 */
export function isTokenExpired(tokens: OAuthTokens): boolean {
  return tokens.expiresAt < (Date.now() + TOKEN_REFRESH_BUFFER_MS);
}

/**
 * Exchange a refresh token for a new access token via Anthropic's OAuth endpoint.
 * Refresh tokens are single-use — the response includes a new refresh token.
 */
async function refreshAccessToken(refreshToken: string): Promise<OAuthTokens | null> {
  try {
    const response = await fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: OAUTH_CLIENT_ID,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.error(`[spyre] Token refresh failed: ${response.status} ${response.statusText} — ${body.slice(0, 300)}`);
      return null;
    }

    const data = await response.json() as Record<string, unknown>;
    return {
      accessToken: data.access_token as string,
      refreshToken: data.refresh_token as string,
      expiresAt: Date.now() + (data.expires_in as number) * 1000,
      scopes: typeof data.scope === 'string' ? (data.scope as string).split(' ') : undefined,
    };
  } catch (err) {
    console.error('[spyre] Token refresh error:', err);
    return null;
  }
}

/**
 * Ensure the controller has a fresh (non-expired) access token.
 * Automatically refreshes via the OAuth endpoint if expired.
 * Uses a mutex to prevent concurrent refresh races (single-use refresh tokens).
 */
export async function ensureFreshToken(): Promise<TokenRefreshResult> {
  const tokens = readOAuthTokens();
  if (!tokens) {
    return { success: false, error: 'No OAuth credentials found on controller' };
  }

  if (!isTokenExpired(tokens)) {
    return { success: true, expiresAt: tokens.expiresAt };
  }

  // Prevent concurrent refresh (refresh tokens are single-use)
  if (refreshInFlight) {
    const result = await refreshInFlight;
    if (result) return { success: true, expiresAt: result.expiresAt };
    return { success: false, error: 'Token refresh failed (concurrent request)' };
  }

  refreshInFlight = (async () => {
    try {
      console.log('[spyre] Access token expired, refreshing via OAuth endpoint...');
      const refreshed = await refreshAccessToken(tokens.refreshToken);
      if (!refreshed) return null;

      // Preserve subscription metadata
      refreshed.subscriptionType = tokens.subscriptionType;
      refreshed.rateLimitTier = tokens.rateLimitTier;

      writeOAuthTokens(refreshed);
      console.log(`[spyre] Token refreshed, new expiry: ${new Date(refreshed.expiresAt).toISOString()}`);

      // Update auth state
      setState({
        status: 'authenticated',
        lastAuthenticated: new Date().toISOString(),
        tokenExpiresAt: new Date(refreshed.expiresAt).toISOString(),
        error: null,
      });
      logAuthEvent('token_refreshed', { expiresAt: refreshed.expiresAt });

      return refreshed;
    } finally {
      refreshInFlight = null;
    }
  })();

  const result = await refreshInFlight;
  if (result) return { success: true, expiresAt: result.expiresAt };
  return { success: false, error: 'Token refresh failed — user may need to re-authenticate' };
}

// =============================================================================
// OAuth PKCE Flow (for client-browser auth)
// =============================================================================

/**
 * Generate OAuth PKCE parameters for a new authorization flow.
 * The client browser opens the authorizeUrl, user authorizes on claude.ai,
 * then provides the resulting authorization code back to Spyre.
 */
export function generateOAuthFlow(): OAuthFlowParams {
  const verifierBytes = randomBytes(32);
  const codeVerifier = verifierBytes
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const codeChallenge = createHash('sha256')
    .update(codeVerifier)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  const state = codeVerifier;

  const params = new URLSearchParams({
    code: 'true',
    client_id: OAUTH_CLIENT_ID,
    response_type: 'code',
    redirect_uri: OAUTH_REDIRECT_URI,
    scope: OAUTH_SCOPES,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
  });

  return {
    authorizeUrl: `${OAUTH_AUTHORIZE_URL}?${params.toString()}`,
    codeVerifier,
    state,
  };
}

/**
 * Exchange an authorization code for tokens (completes the PKCE flow).
 * Called after the user authorizes in their browser and provides the code.
 */
export async function exchangeAuthCode(
  code: string,
  codeVerifier: string
): Promise<TokenRefreshResult> {
  try {
    const response = await fetch(OAUTH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        state: codeVerifier,
        grant_type: 'authorization_code',
        client_id: OAUTH_CLIENT_ID,
        redirect_uri: OAUTH_REDIRECT_URI,
        code_verifier: codeVerifier,
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.error(`[spyre] OAuth code exchange failed: ${response.status} — ${body.slice(0, 300)}`);
      return { success: false, error: `Code exchange failed (${response.status})` };
    }

    const data = await response.json() as Record<string, unknown>;
    const tokens: OAuthTokens = {
      accessToken: data.access_token as string,
      refreshToken: data.refresh_token as string,
      expiresAt: Date.now() + (data.expires_in as number) * 1000,
      scopes: typeof data.scope === 'string' ? (data.scope as string).split(' ') : undefined,
    };

    writeOAuthTokens(tokens);

    setState({
      status: 'authenticated',
      oauthUrl: null,
      lastAuthenticated: new Date().toISOString(),
      tokenExpiresAt: new Date(tokens.expiresAt).toISOString(),
      authMethod: 'oauth',
      error: null,
    });
    logAuthEvent('authenticated', { method: 'oauth_pkce' });

    console.log(`[spyre] OAuth authorization complete, expires: ${new Date(tokens.expiresAt).toISOString()}`);
    return { success: true, expiresAt: tokens.expiresAt };
  } catch (err) {
    console.error('[spyre] OAuth code exchange error:', err);
    return { success: false, error: 'Code exchange request failed' };
  }
}

// =============================================================================
// Environment Propagation
// =============================================================================

/**
 * Propagate the controller's current credentials to a running environment via SSH.
 */
export async function propagateCredentialsToEnv(envId: string): Promise<void> {
  const credsPath = resolveAuthJsonPath();
  if (!existsSync(credsPath)) {
    throw new Error('No credentials file on controller');
  }

  const credsContent = readFileSync(credsPath, 'utf-8');
  JSON.parse(credsContent); // validate

  const client = await getConnection(envId);

  // Write ~/.claude/.credentials.json
  await sshExec(client, 'mkdir -p /root/.claude', 10000);
  const writeCmd = `cat > /root/.claude/.credentials.json << 'SPYRE_CREDS_EOF'\n${credsContent}\nSPYRE_CREDS_EOF`;
  await sshExec(client, writeCmd, 10000);
  await sshExec(client, 'chmod 600 /root/.claude/.credentials.json', 5000);

  // Write ~/.claude.json with the controller's cachedGrowthBookFeatures.
  // Without this cache, Claude CLI makes a blocking Statsig fetch on startup
  // that stalls for 28+ seconds from container IPs.
  const homeConfig = buildHomeConfigForEnv();
  if (homeConfig) {
    const homeContent = JSON.stringify(homeConfig, null, 2);
    const writeHome = `cat > /root/.claude.json << 'SPYRE_HOMECFG_EOF'\n${homeContent}\nSPYRE_HOMECFG_EOF`;
    await sshExec(client, writeHome, 10000);
    await sshExec(client, 'chmod 600 /root/.claude.json', 5000);
  }
}

/**
 * Build ~/.claude.json for containers from the controller's config.
 * Includes cachedGrowthBookFeatures (critical — without this, Claude CLI
 * makes a blocking network call on startup that stalls for 28+ seconds),
 * onboarding bypass, and install metadata. Strips controller-specific fields.
 */
function buildHomeConfigForEnv(): Record<string, unknown> | null {
  const home = process.env.HOME ?? '/root';

  // First try ~/.claude/.claude.json (inside .claude dir)
  const claudeDirConfig = resolveAuthJsonPath().replace(/\.credentials\.json$/, '.claude.json');
  // Then ~/.claude.json (home root)
  const homeConfig = `${home}/.claude.json`;

  // Merge configs: read both files, prefer the one with cachedGrowthBookFeatures.
  // The feature flags cache is typically in ~/.claude/.claude.json (the larger file).
  let source: Record<string, unknown> = {};
  for (const path of [claudeDirConfig, homeConfig]) {
    if (existsSync(path)) {
      try {
        const data = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
        // Merge — later files fill in missing keys but don't overwrite
        source = { ...data, ...source };
      } catch { /* skip unreadable */ }
    }
  }

  const config: Record<string, unknown> = {
    hasCompletedOnboarding: true,
    theme: source.theme ?? 'dark',
    installMethod: 'native',
    autoUpdates: false,
    autoUpdatesProtectedForNative: true,
    numStartups: source.numStartups ?? 5,
    firstStartTime: source.firstStartTime ?? new Date().toISOString(),
    opusProMigrationComplete: true,
    sonnet1m45MigrationComplete: true,
    lastOnboardingVersion: source.lastOnboardingVersion ?? '2.1.50',
    lastReleaseNotesSeen: source.lastReleaseNotesSeen ?? '2.1.50',
    hasSeenTasksHint: true,
    showSpinnerTree: false,
  };

  // Copy the feature flags cache — this is what prevents the 28s startup stall
  if (source.cachedGrowthBookFeatures) {
    config.cachedGrowthBookFeatures = source.cachedGrowthBookFeatures;
  }
  if (source.clientDataCache) {
    config.clientDataCache = source.clientDataCache;
  }
  if (source.oauthAccount) {
    config.oauthAccount = source.oauthAccount;
  }

  return config;
}

/**
 * Ensure fresh token on controller, then propagate to the target environment.
 * Called automatically before task dispatch.
 */
export async function ensureAndPropagateAuth(envId: string): Promise<void> {
  const result = await ensureFreshToken();
  if (!result.success) {
    throw new Error(result.error ?? 'Token refresh failed');
  }

  await propagateCredentialsToEnv(envId);
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
        logAuthEvent('orphan_found', { pid: ptyPid });
        try {
          process.kill(ptyPid, 'SIGTERM');
          logAuthEvent('orphan_killed', { pid: ptyPid });
          // Brief delay after killing to let credentials file settle
          await new Promise(r => setTimeout(r, 1000));
        } catch {
          // Process may have already exited
        }
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

  // Kill any orphaned PTY wrapper processes left over from HMR or crashes
  try {
    execFile('pkill', ['-f', 'claude-auth-pty'], { timeout: 5000 }, () => {
      // Non-critical — fire and forget
    });
  } catch {
    // Non-critical — no orphans to clean up
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
