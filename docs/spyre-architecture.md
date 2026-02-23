# Spyre — Claude Code Infrastructure Orchestrator

## Architecture & Implementation Blueprint

**Version:** 1.1 | **Date:** 2026-02-22

---

## 1. Naming

**Spyre** — a central tower overseeing everything below. Your controller VM is the spire from which you observe, command, and connect to your entire fleet. Short, sharp, easy to type. CLI commands read naturally: `spyre create`, `spyre connect`, `spyre list`, `spyre destroy`.

---

## 2. System Overview

Spyre is a self-hosted orchestration platform that uses **Claude Code as its AI operations engine** to provision, configure, manage, and interact with development environments running as VMs and LXC containers on Proxmox. A web application serves as the single pane of glass for all operations.

### Core Principles

- **One Claude, Many Targets**: Claude Code is installed and authenticated exactly once, on the Spyre controller VM. It reaches all worker nodes via SSH. No Claude installation or authentication on worker nodes, ever.
- **Declarative Configs, Imperative Execution**: You define what you want (YAML/TOML configs). Spyre figures out how to build it (Proxmox API + Helper Scripts + post-provision playbooks).
- **Session Persistence by Default**: Every remote connection uses tmux. Disconnects are recoverable, work-in-progress is never lost.
- **Browser-Native Operations**: SSH, VNC, RDP, and web service access all happen in-browser through the Spyre web app. No local client software required beyond a browser.

---

## 3. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        USER'S BROWSER                               │
│  ┌───────────┐  ┌──────────┐  ┌─────────┐  ┌────────────────────┐  │
│  │ Dashboard  │  │ Terminal  │  │  VNC/   │  │  Web Service       │  │
│  │ & Config   │  │ (xterm.js)│  │  RDP    │  │  Reverse Proxy     │  │
│  │ Editor     │  │          │  │ (noVNC) │  │  (iframe/embed)    │  │
│  └─────┬─────┘  └────┬─────┘  └────┬────┘  └────────┬───────────┘  │
│        │              │             │                 │              │
└────────┼──────────────┼─────────────┼─────────────────┼──────────────┘
         │     HTTPS / WebSocket      │                 │
         ▼              ▼             ▼                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                SPYRE CONTROLLER VM  (Ubuntu Server)                  │
│                                                                     │
│  ┌──────────────────────────────────┐  ┌─────────────────────────┐  │
│  │      Web App (SvelteKit/Next)    │  │   Claude Code (v2.x+)   │  │
│  │  ┌─────────┐  ┌──────────────┐  │  │   ┌─────────────────┐   │  │
│  │  │ REST API │  │  WebSocket   │  │  │   │  OAuth Session   │   │  │
│  │  │ Server   │  │  Gateway     │  │  │   │  (auth.json)     │   │  │
│  │  └────┬─────┘  └──────┬───────┘  │  │   └────────┬────────┘   │  │
│  │       │               │          │  │            │            │  │
│  │  ┌────┴───────────────┴───────┐  │  │   ┌────────┴────────┐   │  │
│  │  │      Spyre Core Engine     │◄─┼──┼──►│  CLI / Headless  │   │  │
│  │  └────┬──────────┬────────────┘  │  │   │  (-p flag)       │   │  │
│  │       │          │               │  │   └─────────────────┘   │  │
│  └───────┼──────────┼───────────────┘  └─────────────────────────┘  │
│          │          │                                                │
│  ┌───────┴──┐  ┌────┴─────────┐  ┌──────────────┐  ┌────────────┐  │
│  │ Proxmox  │  │ SSH Agent /  │  │  Config      │  │ Reverse    │  │
│  │ API      │  │ Connection   │  │  Store        │  │ Proxy      │  │
│  │ Client   │  │ Pool         │  │  (SQLite +   │  │ (Caddy/    │  │
│  │          │  │              │  │   YAML dir)  │  │  Nginx)    │  │
│  └───┬──────┘  └───┬──────────┘  └──────────────┘  └─────┬──────┘  │
│      │             │                                      │         │
└──────┼─────────────┼──────────────────────────────────────┼─────────┘
       │             │                                      │
       ▼             ▼                                      ▼
┌──────────┐  ┌──────────────────────────────────────────────────────┐
│ Proxmox  │  │              WORKER NODES (VMs / LXCs)               │
│ Host API │  │                                                      │
│ :8006    │  │  ┌──────────┐  ┌──────────┐  ┌──────────┐           │
│          │  │  │ dev-web  │  │ dev-api  │  │ staging  │  ...      │
│          │  │  │ (LXC)   │  │ (VM)     │  │ (VM)     │           │
│          │  │  │          │  │          │  │          │           │
│          │  │  │ ┌──────┐ │  │ ┌──────┐ │  │ ┌──────┐ │           │
│          │  │  │ │ tmux │ │  │ │ tmux │ │  │ │ tmux │ │           │
│          │  │  │ │session│ │  │ │session│ │  │ │session│ │           │
│          │  │  │ └──────┘ │  │ └──────┘ │  │ └──────┘ │           │
│          │  │  │ sshd     │  │ sshd     │  │ sshd     │           │
│          │  │  │ +apps    │  │ +apps    │  │ +apps    │           │
│          │  │  └──────────┘  └──────────┘  └──────────┘           │
│          │  │                                                      │
│          │  └──────────────────────────────────────────────────────┘
└──────────┘
```

---

## 4. Authentication Architecture — OAuth Central Broker

This is the key design decision that solves your "sign in once" requirement while maintaining full capability.

### The Problem

Claude Code authenticates via OAuth, which requires a browser redirect back to the machine running Claude Code. In a headless VM environment (the Spyre controller), there is no local browser. The user's browser is on a completely different machine, accessing Spyre through the web app. The OAuth callback URL needs to reach the Claude Code process on the controller, but the user's browser is the one navigating the OAuth flow.

### The Solution: OAuth Relay with Port-Forward Orchestration

Spyre solves this by acting as a **relay** between the user's browser and the Claude Code OAuth flow running on the controller. The web app proxies the entire OAuth dance so the user never needs to SSH into the controller or deal with port forwarding manually.

```
┌────────────────────────────────────────────────────────────────────────┐
│                     OAUTH RELAY FLOW                                    │
│                                                                        │
│  ┌──────────┐  ① User clicks              ┌───────────────────────┐   │
│  │  Browser  │  "Authenticate Claude"      │  Spyre Web App        │   │
│  │  (User)   │ ───────────────────────────►│  (SvelteKit backend)  │   │
│  └──────────┘                              └───────────┬───────────┘   │
│       │                                                │               │
│       │                              ② Web app spawns `claude /login`  │
│       │                                 on the controller, captures    │
│       │                                 the OAuth URL + local port     │
│       │                                                │               │
│       │                                                ▼               │
│       │                                    ┌───────────────────────┐   │
│       │                                    │  Claude Code Process   │   │
│       │                                    │  Listening on          │   │
│       │                                    │  localhost:PORT        │   │
│       │                                    └───────────┬───────────┘   │
│       │                                                │               │
│       │  ③ Web app returns the OAuth URL               │               │
│       │    to the browser (rewritten so                 │               │
│       │    callback points to Spyre,                    │               │
│       │    not localhost)                               │               │
│       │                                                │               │
│       ▼                                                │               │
│  ┌──────────┐  ④ Browser opens           ┌────────────┐               │
│  │  Browser  │  Anthropic OAuth page     │ Anthropic   │               │
│  │  (User)   │ ─────────────────────────►│ OAuth       │               │
│  └──────────┘                            │ Server      │               │
│       │                                  └──────┬──────┘               │
│       │                                         │                      │
│       │  ⑤ User approves, Anthropic             │                      │
│       │    redirects to Spyre callback:          │                      │
│       │    https://spyre.local/auth/             │                      │
│       │      claude/callback?code=...           │                      │
│       │◄─────────────────────────────────────────┘                      │
│       │                                                                │
│       ▼                                                                │
│  ┌──────────────────────────────────────────────────────────────┐      │
│  │  Spyre Web App receives callback                              │      │
│  │                                                               │      │
│  │  ⑥ Relays the callback (with auth code) to the               │      │
│  │    Claude Code process on localhost:PORT                      │      │
│  │    via internal HTTP proxy                                    │      │
│  │                                                               │      │
│  │  ⑦ Claude Code exchanges code for token,                     │      │
│  │    writes auth.json, confirms success                         │      │
│  │                                                               │      │
│  │  ⑧ Spyre web app receives success signal,                    │      │
│  │    redirects browser back to dashboard                        │      │
│  │    with "Claude authenticated ✓" status                       │      │
│  └──────────────────────────────────────────────────────────────┘      │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

### Implementation: The OAuth Relay Service

This is a dedicated module in the Spyre backend (`lib/server/claude-auth.ts`):

```typescript
// lib/server/claude-auth.ts — OAuth Relay Service

import { spawn } from 'child_process';
import http from 'http';
import { EventEmitter } from 'events';

interface AuthState {
  status: 'idle' | 'waiting_for_oauth' | 'waiting_for_callback' | 'authenticated' | 'error';
  oauthUrl: string | null;
  localPort: number | null;
  claudeProcess: any | null;
  error: string | null;
  lastAuthenticated: Date | null;
  tokenExpiresAt: Date | null;
}

class ClaudeAuthRelay extends EventEmitter {
  private state: AuthState = {
    status: 'idle',
    oauthUrl: null,
    localPort: null,
    claudeProcess: null,
    error: null,
    lastAuthenticated: null,
    tokenExpiresAt: null,
  };

  private AUTH_JSON_PATH = `${process.env.HOME}/.config/claude-code/auth.json`;
  private HEALTH_CHECK_INTERVAL = 60_000;  // 1 minute
  private healthCheckTimer: NodeJS.Timer | null = null;

  constructor() {
    super();
    this.startHealthCheck();
  }

  /**
   * Initiates the OAuth flow.
   * Returns the OAuth URL for the browser to open.
   */
  async initiateAuth(): Promise<{ oauthUrl: string }> {
    if (this.state.status === 'waiting_for_oauth') {
      throw new Error('Auth flow already in progress. Wait or cancel first.');
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.cleanup();
        reject(new Error('OAuth initiation timed out after 30s. Claude Code may not be installed.'));
      }, 30_000);

      // Spawn `claude /login` and capture its output
      const proc = spawn('claude', ['/login'], {
        env: { ...process.env, BROWSER: 'echo' },  // Prevent auto-open, just print URL
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.state.claudeProcess = proc;
      this.state.status = 'waiting_for_oauth';

      let stdoutBuffer = '';
      let stderrBuffer = '';

      proc.stdout.on('data', (data: Buffer) => {
        stdoutBuffer += data.toString();

        // Claude Code prints the OAuth URL and the local port it's listening on
        // Parse both from the output
        const urlMatch = stdoutBuffer.match(/https?:\/\/[^\s]+/);
        const portMatch = stdoutBuffer.match(/localhost:(\d+)/);

        if (urlMatch) {
          clearTimeout(timeout);
          const originalUrl = urlMatch[0];
          const port = portMatch ? parseInt(portMatch[1]) : null;
          
          this.state.localPort = port;
          this.state.status = 'waiting_for_callback';

          // Rewrite the callback URL so it points to Spyre, not localhost
          const rewrittenUrl = this.rewriteOAuthUrl(originalUrl);
          this.state.oauthUrl = rewrittenUrl;

          resolve({ oauthUrl: rewrittenUrl });
        }
      });

      proc.stderr.on('data', (data: Buffer) => {
        stderrBuffer += data.toString();
      });

      proc.on('exit', (code) => {
        if (code === 0 && this.state.status === 'waiting_for_callback') {
          // Successful auth completion
          this.state.status = 'authenticated';
          this.state.lastAuthenticated = new Date();
          this.state.error = null;
          this.emit('authenticated');
        } else if (code !== 0 && this.state.status !== 'authenticated') {
          clearTimeout(timeout);
          this.state.status = 'error';
          this.state.error = `Claude /login exited with code ${code}: ${stderrBuffer}`;
          this.emit('auth_error', this.state.error);
          reject(new Error(this.state.error));
        }
        this.state.claudeProcess = null;
      });

      proc.on('error', (err) => {
        clearTimeout(timeout);
        this.state.status = 'error';
        this.state.error = `Failed to spawn claude: ${err.message}`;
        reject(new Error(this.state.error));
      });
    });
  }

  /**
   * Rewrites the OAuth URL so the callback redirect points to
   * Spyre's /auth/claude/callback route instead of localhost.
   */
  private rewriteOAuthUrl(originalUrl: string): string {
    const url = new URL(originalUrl);

    // The redirect_uri parameter tells Anthropic where to send the user
    // after approval. We replace localhost with our Spyre hostname.
    const redirectUri = url.searchParams.get('redirect_uri');
    if (redirectUri) {
      const spyreCallback = `${process.env.SPYRE_BASE_URL}/auth/claude/callback`;
      url.searchParams.set('redirect_uri', spyreCallback);

      // Store the original redirect so we can relay back to Claude Code
      url.searchParams.set('state', JSON.stringify({
        originalRedirect: redirectUri,
        spyreSession: crypto.randomUUID(),
      }));
    }

    return url.toString();
  }

  /**
   * Handles the OAuth callback from Anthropic.
   * Relays the auth code to the Claude Code process listening on localhost.
   */
  async handleCallback(callbackParams: Record<string, string>): Promise<{ success: boolean }> {
    if (this.state.status !== 'waiting_for_callback' || !this.state.localPort) {
      throw new Error('No active auth flow to complete. Initiate auth first.');
    }

    const stateParam = callbackParams.state;
    let originalRedirect: string;

    try {
      const parsed = JSON.parse(stateParam);
      originalRedirect = parsed.originalRedirect;
    } catch {
      throw new Error('Invalid state parameter in callback.');
    }

    // Reconstruct the callback URL as Claude Code expects it
    const relayUrl = new URL(originalRedirect);
    for (const [key, value] of Object.entries(callbackParams)) {
      if (key !== 'state') {
        relayUrl.searchParams.set(key, value);
      }
    }

    // Relay the callback to Claude Code's local server
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Callback relay to Claude Code timed out.'));
      }, 15_000);

      const req = http.get(relayUrl.toString(), (res) => {
        clearTimeout(timeout);
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 400) {
            this.state.status = 'authenticated';
            this.state.lastAuthenticated = new Date();
            this.state.error = null;
            this.emit('authenticated');
            resolve({ success: true });
          } else {
            this.state.status = 'error';
            this.state.error = `Claude Code rejected callback: ${res.statusCode} ${body}`;
            reject(new Error(this.state.error));
          }
        });
      });

      req.on('error', (err) => {
        clearTimeout(timeout);
        this.state.status = 'error';
        this.state.error = `Failed to relay callback: ${err.message}`;
        reject(new Error(this.state.error));
      });
    });
  }

  /**
   * Checks if Claude Code is currently authenticated by verifying
   * auth.json exists and testing a simple command.
   */
  async checkAuthStatus(): Promise<AuthState['status']> {
    try {
      const fs = await import('fs/promises');
      const authData = await fs.readFile(this.AUTH_JSON_PATH, 'utf-8');
      const auth = JSON.parse(authData);

      // Check token expiry if the field exists
      if (auth.expiresAt) {
        const expiresAt = new Date(auth.expiresAt);
        this.state.tokenExpiresAt = expiresAt;

        if (expiresAt < new Date()) {
          this.state.status = 'error';
          this.state.error = 'OAuth token has expired. Re-authentication required.';
          this.emit('token_expired');
          return 'error';
        }

        // Warn if expiring within 24 hours
        const hoursUntilExpiry = (expiresAt.getTime() - Date.now()) / (1000 * 60 * 60);
        if (hoursUntilExpiry < 24) {
          this.emit('token_expiring_soon', hoursUntilExpiry);
        }
      }

      // Verify auth actually works with a lightweight test
      const result = await this.testClaudeAuth();
      if (result) {
        this.state.status = 'authenticated';
        this.state.error = null;
        return 'authenticated';
      } else {
        this.state.status = 'error';
        this.state.error = 'auth.json exists but Claude Code reports invalid session.';
        return 'error';
      }
    } catch {
      this.state.status = 'idle';
      return 'idle';
    }
  }

  /**
   * Lightweight auth test — spawns claude with a trivial prompt
   * and checks for auth errors.
   */
  private testClaudeAuth(): Promise<boolean> {
    return new Promise((resolve) => {
      const proc = spawn('claude', ['-p', 'echo test', '--output-format', 'json'], {
        timeout: 15_000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stderr = '';
      proc.stderr.on('data', (d) => { stderr += d.toString(); });

      proc.on('exit', (code) => {
        if (code === 0) {
          resolve(true);
        } else if (stderr.includes('Invalid API key') || stderr.includes('/login')) {
          resolve(false);
        } else {
          // Other errors (rate limit, network) don't mean auth is broken
          resolve(true);
        }
      });

      proc.on('error', () => resolve(false));
    });
  }

  /**
   * Periodic health check — monitors auth status and emits events
   * when action is needed.
   */
  private startHealthCheck() {
    this.healthCheckTimer = setInterval(async () => {
      const status = await this.checkAuthStatus();
      this.emit('health_check', { status, state: this.getState() });
    }, this.HEALTH_CHECK_INTERVAL);
  }

  /**
   * Cancel an in-progress auth flow.
   */
  cancelAuth() {
    if (this.state.claudeProcess) {
      this.state.claudeProcess.kill('SIGTERM');
    }
    this.cleanup();
  }

  private cleanup() {
    this.state.status = 'idle';
    this.state.oauthUrl = null;
    this.state.localPort = null;
    this.state.claudeProcess = null;
  }

  getState(): Readonly<AuthState> {
    return { ...this.state };
  }

  destroy() {
    if (this.healthCheckTimer) clearInterval(this.healthCheckTimer);
    this.cancelAuth();
  }
}

export const claudeAuth = new ClaudeAuthRelay();
```

### Web App Routes for OAuth Relay

```typescript
// routes/auth/claude/initiate/+server.ts — Starts the OAuth flow

import { json, error } from '@sveltejs/kit';
import { claudeAuth } from '$lib/server/claude-auth';

export async function POST({ locals }) {
  // Ensure the user is logged into Spyre and has admin role
  if (!locals.user || locals.user.role !== 'admin') {
    throw error(403, 'Only admins can manage Claude authentication.');
  }

  try {
    const { oauthUrl } = await claudeAuth.initiateAuth();
    return json({ oauthUrl });
  } catch (err: any) {
    // Structured error responses for the frontend
    if (err.message.includes('already in progress')) {
      throw error(409, 'Auth flow already in progress.');
    }
    if (err.message.includes('timed out')) {
      throw error(504, 'Claude Code did not respond. Is it installed?');
    }
    throw error(500, `Auth initiation failed: ${err.message}`);
  }
}

// routes/auth/claude/callback/+server.ts — Receives the OAuth callback

import { redirect, error } from '@sveltejs/kit';
import { claudeAuth } from '$lib/server/claude-auth';

export async function GET({ url }) {
  const params: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    params[key] = value;
  });

  // Check for OAuth error responses from Anthropic
  if (params.error) {
    const errorMsg = params.error_description || params.error;
    // Redirect to dashboard with error status
    throw redirect(303, `/settings/claude?error=${encodeURIComponent(errorMsg)}`);
  }

  if (!params.code) {
    throw error(400, 'Missing authorization code in callback.');
  }

  try {
    await claudeAuth.handleCallback(params);
    throw redirect(303, '/settings/claude?status=authenticated');
  } catch (err: any) {
    if (err.status === 303) throw err;  // Re-throw redirects
    throw redirect(303, `/settings/claude?error=${encodeURIComponent(err.message)}`);
  }
}

// routes/auth/claude/status/+server.ts — Check current auth state

import { json } from '@sveltejs/kit';
import { claudeAuth } from '$lib/server/claude-auth';

export async function GET() {
  const status = await claudeAuth.checkAuthStatus();
  const state = claudeAuth.getState();

  return json({
    status: state.status,
    lastAuthenticated: state.lastAuthenticated,
    tokenExpiresAt: state.tokenExpiresAt,
    error: state.error,
  });
}
```

### Frontend: Claude Auth Management UI

```svelte
<!-- routes/settings/claude/+page.svelte -->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  let authState = $state({
    status: 'checking' as string,
    lastAuthenticated: null as string | null,
    tokenExpiresAt: null as string | null,
    error: null as string | null,
  });
  let authInProgress = $state(false);
  let pollTimer: ReturnType<typeof setInterval>;

  onMount(async () => {
    await checkStatus();
    // Poll every 30s while page is open
    pollTimer = setInterval(checkStatus, 30_000);
  });

  onDestroy(() => clearInterval(pollTimer));

  async function checkStatus() {
    const res = await fetch('/auth/claude/status');
    authState = await res.json();
  }

  async function initiateAuth() {
    authInProgress = true;
    try {
      const res = await fetch('/auth/claude/initiate', { method: 'POST' });
      if (!res.ok) {
        const err = await res.json();
        authState.error = err.message;
        return;
      }
      const { oauthUrl } = await res.json();

      // Open the OAuth page in a new window/tab
      // The callback will redirect back to this page with status params
      window.open(oauthUrl, '_blank', 'width=600,height=700');

      // Poll more aggressively while waiting for callback
      const fastPoll = setInterval(async () => {
        await checkStatus();
        if (authState.status === 'authenticated' || authState.status === 'error') {
          clearInterval(fastPoll);
          authInProgress = false;
        }
      }, 2_000);

      // Timeout after 5 minutes
      setTimeout(() => {
        clearInterval(fastPoll);
        if (authInProgress) {
          authInProgress = false;
          authState.error = 'Auth timed out. The OAuth window may have been closed.';
        }
      }, 300_000);

    } catch (err: any) {
      authState.error = err.message;
      authInProgress = false;
    }
  }
</script>

<div class="claude-auth-panel">
  <h2>Claude Code Authentication</h2>

  {#if authState.status === 'checking'}
    <div class="status checking">Checking Claude Code auth status...</div>

  {:else if authState.status === 'authenticated'}
    <div class="status authenticated">
      <span class="indicator green"></span>
      Claude Code is authenticated
    </div>
    {#if authState.lastAuthenticated}
      <p class="meta">Last authenticated: {new Date(authState.lastAuthenticated).toLocaleString()}</p>
    {/if}
    {#if authState.tokenExpiresAt}
      <p class="meta">Token expires: {new Date(authState.tokenExpiresAt).toLocaleString()}</p>
    {/if}
    <button onclick={initiateAuth} class="secondary">Re-authenticate</button>

  {:else if authState.status === 'idle'}
    <div class="status idle">
      <span class="indicator yellow"></span>
      Claude Code is not authenticated
    </div>
    <p>Click below to sign in. A new window will open for Anthropic's OAuth flow.</p>
    <button onclick={initiateAuth} disabled={authInProgress}>
      {authInProgress ? 'Waiting for OAuth...' : 'Authenticate Claude Code'}
    </button>

  {:else if authState.status === 'error'}
    <div class="status error">
      <span class="indicator red"></span>
      Authentication issue
    </div>
    <p class="error-message">{authState.error}</p>
    <button onclick={initiateAuth} disabled={authInProgress}>
      {authInProgress ? 'Waiting for OAuth...' : 'Re-authenticate'}
    </button>

  {:else if authState.status === 'waiting_for_callback'}
    <div class="status pending">
      <span class="indicator yellow pulse"></span>
      Waiting for OAuth completion...
    </div>
    <p>Complete the sign-in in the Anthropic OAuth window.</p>
  {/if}
</div>
```

### Three Layers of Auth

| Layer | What | How | Scope |
|-------|------|-----|-------|
| **User → Web App** | Human authenticates to the Spyre UI | Local accounts (bcrypt-hashed), or plug in OIDC/LDAP. Session managed via HTTP-only cookies + JWT. | Per-user RBAC. Some users can only view; others can provision. |
| **Web App → Claude Code** | Web app dispatches tasks to the local Claude Code instance | OAuth relay (described above). Claude Code's `auth.json` is managed by the Spyre controller. Internal process spawning on the same VM. | Single OAuth session. All Claude usage flows through one authenticated instance. |
| **Claude Code → Workers** | Claude Code (or the Spyre engine directly) SSHs into worker nodes | SSH key pair generated during Spyre setup. Public key is injected into every worker during provisioning. Agent forwarding disabled for security. | Per-node SSH key. Spyre controller's key is the only one trusted. |

### OAuth Session Management — Error Handling Matrix

| Scenario | Detection | Recovery |
|----------|-----------|----------|
| **Token expired** | `checkAuthStatus()` health check detects expired `auth.json` token | Emit `token_expired` event → web UI shows "Re-authenticate" banner → user clicks → OAuth relay flow |
| **Token expiring soon (<24h)** | Health check compares `tokenExpiresAt` to current time | Emit `token_expiring_soon` event → web UI shows non-blocking warning → user can proactively re-auth |
| **OAuth window closed before completion** | `initiateAuth()` 5-minute timeout fires with status still `waiting_for_callback` | Frontend shows timeout error → user can retry. Backend `cancelAuth()` kills the orphaned `claude /login` process. |
| **Anthropic OAuth server error** | Callback receives `?error=` parameter | Redirect to settings page with error message displayed. No retry — user must manually re-initiate. |
| **Claude Code not installed** | `initiateAuth()` spawn fails or times out after 30s | Error surfaced in UI: "Claude Code not found. Run `npm install -g @anthropic-ai/claude-code` on the controller." |
| **Callback relay fails** | `handleCallback()` HTTP request to Claude Code's localhost server fails | Error logged. User sees "Failed to complete auth" with retry option. Stale `claude /login` process is killed. |
| **Multiple admins try to auth simultaneously** | `initiateAuth()` checks `state.status === 'waiting_for_oauth'` | Returns 409 Conflict: "Auth flow already in progress." Second admin waits or first admin cancels. |
| **Controller VM reboots** | `auth.json` persists on disk. Health check on Spyre startup verifies it. | If auth.json is valid, status returns to `authenticated`. If missing/expired, UI shows re-auth prompt on first page load. |
| **Network partition during OAuth** | Browser can't reach callback URL | Anthropic's OAuth will show its own error. User returns to Spyre settings, sees stale `waiting_for_callback` status, clicks "Cancel & Retry". |
| **Claude Code process crashes mid-task** | Task dispatch detects non-zero exit code or timeout | Task marked as `error` in DB. If auth-related (exit code + stderr contains "login"), auto-triggers re-auth banner. Otherwise, task can be retried. |

### OAuth vs. API Key — Decision Documented

| Factor | OAuth (your choice) | API Key |
|--------|-------------------|---------|
| **Setup complexity** | Higher — requires relay service, callback routing, session monitoring | Lower — set env var, done |
| **Token lifespan** | Limited — tokens expire, need periodic re-auth | Unlimited until manually revoked |
| **Billing** | Uses Pro/Max subscription (included usage) | Separate API billing (pay per token) |
| **Headless compatibility** | Requires the relay architecture above | Native — no browser interaction needed |
| **Multi-user metering** | All usage under one subscription | Can create separate keys per user/team |
| **Operational overhead** | Must monitor token health, handle re-auth flows | Essentially zero ongoing maintenance |

Your choice of OAuth makes sense if you're on a Pro/Max plan and want to keep everything on one subscription. The relay architecture above handles the complexity cleanly. If you ever want to switch to API key later, it's a one-line change (`ANTHROPIC_API_KEY` env var) and the entire relay service becomes dormant.

---

## 5. Provisioning Pipeline

### Phase 1: Proxmox API — Create the Container/VM

Spyre talks directly to the Proxmox REST API (port 8006) using API tokens (not password auth — tokens are scoped, revocable, and don't require CSRF handling).

```python
# Simplified — actual implementation in the Spyre engine
import requests

PROXMOX_URL = "https://pve.local:8006/api2/json"
HEADERS = {
    "Authorization": "PVEAPIToken=spyre@pam!automation=<uuid-token>"
}

def create_lxc(node, config):
    return requests.post(
        f"{PROXMOX_URL}/nodes/{node}/lxc",
        headers=HEADERS,
        data={
            "vmid": config["vmid"],
            "hostname": config["hostname"],
            "ostemplate": config["template"],
            "cores": config["cores"],
            "memory": config["memory"],
            "rootfs": f"{config['storage']}:{config['disk_gb']}",
            "net0": f"name=eth0,bridge={config['bridge']},ip=dhcp",
            "start": 1,
            "ssh-public-keys": open("/home/spyre/.ssh/id_ed25519.pub").read()
        },
        verify=False
    )
```

### Phase 2: Proxmox Helper Scripts — Pre-Canned Application Stacks

For supported application stacks (the 400+ scripts from community-scripts/ProxmoxVE), Spyre can invoke them directly on the Proxmox host via SSH:

```bash
# Spyre SSHs to the Proxmox host and runs the helper script
ssh root@pve.local 'bash -c "$(curl -fsSL \
  https://raw.githubusercontent.com/community-scripts/ProxmoxVE/main/ct/docker.sh)"'
```

**Important nuance**: Helper scripts are interactive (whiptail menus). For automation, Spyre needs to either:

- Use the scripts' environment variables to pre-set choices (many support this)
- Wrap them with `expect` for automated input
- Use the Proxmox API directly for the container creation, then run only the *install* portion of the helper scripts inside the container

**Recommended approach**: Use the Proxmox API for container/VM creation (Phase 1), then use the helper scripts' *install scripts* (which run inside the container) for application setup. This gives you programmatic control over the container specs while still benefiting from the community's tested install procedures.

### Phase 3: Spyre Configs — Post-Provision Customization (IaC Layer)

This is where your static configs come in. After the container/VM exists and has its base application installed, Spyre applies your custom configuration layer.

#### Config Format: `spyre.yaml`

```yaml
# ~/.spyre/configs/dev-web.yaml
apiVersion: spyre/v1
kind: Environment
metadata:
  name: dev-web
  labels:
    team: frontend
    env: development

spec:
  # Phase 1: Proxmox provisioning
  platform:
    type: lxc                    # or "vm"
    template: ubuntu-24.04       # resolved to actual vztmpl path
    node: pve                    # Proxmox node name
    resources:
      cores: 4
      memory: 4096               # MB
      disk: 32                   # GB
      storage: local-lvm
    network:
      bridge: vmbr0
      ip: dhcp                   # or static: "10.0.1.50/24"
      gateway: 10.0.1.1          # required for static

  # Phase 2: Base application stack (optional)
  helper_script: docker          # maps to community-scripts/ProxmoxVE ct/docker.sh
                                 # set to null/omit to skip

  # Phase 3: Post-provision customization
  provision:
    # Packages to install via system package manager
    packages:
      - git
      - curl
      - build-essential
      - nginx
      - certbot

    # Custom scripts to run (executed in order)
    scripts:
      - name: "Install Node.js 22"
        run: |
          curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
          apt-get install -y nodejs

      - name: "Clone project repo"
        run: |
          git clone https://github.com/myorg/myapp.git /opt/myapp
          cd /opt/myapp && npm install

      - name: "Configure Nginx"
        copy:
          src: configs/nginx/dev-web.conf
          dest: /etc/nginx/sites-enabled/default
        then: systemctl reload nginx

    # SSH authorized keys (in addition to Spyre controller key)
    authorized_keys:
      - ssh-ed25519 AAAA... developer@workstation

  # Services exposed through Spyre proxy
  services:
    - name: web
      port: 80
      protocol: http
    - name: app
      port: 3000
      protocol: http
    - name: ssh
      port: 22
      protocol: ssh
    - name: vnc
      port: 5900
      protocol: vnc

  # Claude Code workspace settings for this environment
  claude:
    working_directory: /opt/myapp
    claude_md: |
      # Dev Web Environment
      This is the frontend development server.
      - Framework: Next.js
      - Node version: 22
      - Run dev server: npm run dev
```

#### Config Inheritance

Configs can extend base configs to avoid repetition:

```yaml
# ~/.spyre/configs/bases/ubuntu-dev.yaml
apiVersion: spyre/v1
kind: EnvironmentBase
metadata:
  name: ubuntu-dev-base
spec:
  platform:
    type: lxc
    template: ubuntu-24.04
    resources:
      cores: 2
      memory: 2048
      disk: 20
  provision:
    packages: [git, curl, wget, htop, vim, tmux, build-essential]
```

```yaml
# ~/.spyre/configs/dev-api.yaml
apiVersion: spyre/v1
kind: Environment
extends: bases/ubuntu-dev
metadata:
  name: dev-api
spec:
  platform:
    resources:
      cores: 4                  # override base
      memory: 4096              # override base
  provision:
    packages:                   # merged with base packages
      - python3
      - python3-pip
      - postgresql-client
```

---

## 6. Web Application Architecture

### Tech Stack

| Component | Technology | Rationale |
|-----------|-----------|-----------|
| **Frontend** | SvelteKit (or Next.js) | Reactive UI, SSR for initial load, WebSocket support built-in |
| **Backend API** | Node.js (same runtime as SvelteKit) | Shares runtime with Claude Code (Node-based). Direct process spawning. |
| **Terminal** | xterm.js + WebSocket | Industry standard browser terminal. Used by VS Code, Gitpod, etc. |
| **VNC** | noVNC | Browser-native VNC client. No plugins needed. |
| **RDP** | Apache Guacamole (headless) | The gold standard for browser-based RDP. Runs as a daemon. |
| **Database** | SQLite (via better-sqlite3) | Zero-config, single-file. Perfect for single-node management. |
| **Reverse Proxy** | Caddy | Automatic HTTPS, simple config, WebSocket proxying built-in |
| **Process Manager** | systemd | Native Ubuntu. No extra dependencies. |

### Application Layout

```
spyre/
├── web/                        # SvelteKit application
│   ├── src/
│   │   ├── routes/
│   │   │   ├── +page.svelte            # Dashboard landing
│   │   │   ├── environments/
│   │   │   │   ├── +page.svelte        # List all environments
│   │   │   │   ├── [id]/
│   │   │   │   │   ├── +page.svelte    # Single environment detail
│   │   │   │   │   ├── terminal/       # SSH terminal view
│   │   │   │   │   ├── desktop/        # VNC/RDP view
│   │   │   │   │   └── services/       # Proxied web services
│   │   │   ├── configs/
│   │   │   │   ├── +page.svelte        # List/browse configs
│   │   │   │   └── editor/             # YAML editor with validation
│   │   │   ├── claude/
│   │   │   │   ├── +page.svelte        # Claude Code dispatch UI
│   │   │   │   └── sessions/           # View active Claude sessions
│   │   │   ├── auth/
│   │   │   │   └── claude/
│   │   │   │       ├── initiate/       # POST: start OAuth flow
│   │   │   │       ├── callback/       # GET: OAuth callback relay
│   │   │   │       └── status/         # GET: current auth state
│   │   │   └── settings/
│   │   │       └── claude/             # Claude auth management UI
│   │   ├── lib/
│   │   │   ├── server/
│   │   │   │   ├── proxmox.ts          # Proxmox API client
│   │   │   │   ├── ssh-pool.ts         # SSH connection pool manager
│   │   │   │   ├── claude-auth.ts      # OAuth relay service (above)
│   │   │   │   ├── claude-bridge.ts    # Claude Code process manager
│   │   │   │   ├── provisioner.ts      # Orchestrates the 3-phase pipeline
│   │   │   │   ├── config-store.ts     # YAML config loader/validator
│   │   │   │   └── db.ts              # SQLite connection
│   │   │   └── components/
│   │   │       ├── Terminal.svelte      # xterm.js wrapper
│   │   │       ├── DesktopViewer.svelte # noVNC/Guacamole wrapper
│   │   │       ├── ConfigEditor.svelte  # Monaco/CodeMirror YAML editor
│   │   │       ├── EnvCard.svelte       # Environment status card
│   │   │       ├── ClaudeAuthPanel.svelte
│   │   │       └── ServiceProxy.svelte  # Iframe/embedded service viewer
│   │   └── app.html
│   ├── static/
│   └── package.json
├── engine/                     # Spyre core (can also be in web/src/lib/server)
│   ├── provisioner.ts
│   ├── ssh-manager.ts
│   ├── tmux-controller.ts
│   └── claude-dispatcher.ts
├── configs/                    # User environment configs
│   ├── bases/
│   │   └── ubuntu-dev.yaml
│   ├── dev-web.yaml
│   └── dev-api.yaml
├── scripts/                    # Helper scripts, provision scripts
│   └── post-provision/
├── Caddyfile                   # Reverse proxy config
├── spyre.service               # systemd unit file
└── setup.sh                    # One-shot controller setup
```

---

## 7. In-Browser Connection Proxying

### SSH Terminals (xterm.js + WebSocket)

```
Browser (xterm.js)  ──WebSocket──►  Spyre Backend  ──SSH──►  Worker tmux session
```

The backend maintains a pool of SSH connections. When the user opens a terminal tab:

1. Backend checks if a tmux session exists on the target (`ssh worker "tmux has-session -t spyre 2>/dev/null"`)
2. If not, creates one: `ssh worker "tmux new-session -d -s spyre -x 200 -y 50"`
3. Attaches to it: `ssh worker "tmux attach -t spyre"`
4. Pipes the SSH channel's stdin/stdout to the WebSocket bidirectionally

**Multi-tab support**: Each "tab" in the browser maps to a tmux window within the same session:

```bash
# Tab 1 already exists (window 0)
# User opens Tab 2:
ssh worker "tmux new-window -t spyre"
# User opens Tab 3:
ssh worker "tmux new-window -t spyre"
# Switch to specific tab:
ssh worker "tmux select-window -t spyre:2"
```

The browser UI shows tabs that correspond to tmux windows. The user can also split panes within a tab (mapped to tmux panes).

### VNC (noVNC + WebSocket)

```
Browser (noVNC)  ──WebSocket──►  Spyre websockify  ──TCP──►  Worker VNC :5900
```

For graphical desktop environments. Spyre runs `websockify` to bridge WebSocket to VNC's raw TCP. noVNC renders in a `<canvas>` element.

### RDP (Apache Guacamole)

```
Browser (Guacamole.js)  ──WebSocket──►  guacd daemon  ──RDP──►  Worker :3389
```

Guacamole handles RDP, VNC, and SSH natively. For Windows VMs (future expansion) or Linux with xrdp, this is the cleanest path. Guacamole runs headless as `guacd` — no Tomcat/Java web app needed; Spyre's web app serves the Guacamole JavaScript client directly.

### Web Services (Reverse Proxy)

```
Browser  ──HTTPS──►  Caddy  ──HTTP──►  Worker :3000 (or any port)
```

For web applications running on workers, Caddy dynamically proxies based on Spyre's service registry:

```
# Auto-generated Caddyfile entries
dev-web.spyre.local {
    reverse_proxy 10.0.1.50:3000
}

dev-api.spyre.local {
    reverse_proxy 10.0.1.51:8080
}

# Or path-based for simpler DNS setup
spyre.local/proxy/dev-web/* {
    reverse_proxy 10.0.1.50:3000
}
```

Spyre regenerates proxy rules whenever environments are created/destroyed/reconfigured and hot-reloads Caddy (`caddy reload`).

---

## 8. Claude Code Integration

### How Claude Code Interacts with Workers

Claude Code on the Spyre controller connects to workers via its native SSH support or via Spyre's SSH pool:

```bash
# Direct: Claude Code SSH remote connection
claude --ssh worker-hostname "Analyze the nginx logs and suggest optimizations"

# Headless: Dispatched by the web app
claude -p "SSH into dev-web at 10.0.1.50, check the Node.js app logs, \
  and fix any errors you find" \
  --output-format json \
  --allowedTools "Bash,Read,Write,Grep" \
  --dangerously-skip-permissions
```

### Claude Dispatch Architecture

The web app uses a **task dispatch model** with auth-awareness:

```
┌─────────────────────────────────────────────────┐
│                 Web App UI                        │
│                                                   │
│  User: "Set up a PostgreSQL replica on dev-db"   │
│  [Dispatch to Claude] button                      │
└──────────────────────┬────────────────────────────┘
                       │
                       ▼
┌──────────────────────────────────────────────────┐
│            Claude Dispatcher Service              │
│                                                   │
│  0. Checks claudeAuth.getState() — if not        │
│     'authenticated', rejects with re-auth prompt  │
│  1. Validates user has permission for target env  │
│  2. Builds context (env config, CLAUDE.md, etc.)  │
│  3. Spawns: claude -p "<task>" --output-format    │
│     stream-json --allowedTools "Bash,Read,Write"  │
│  4. Monitors for auth errors in stderr — if       │
│     detected, pauses task + emits re-auth event   │
│  5. Streams output back to user via WebSocket     │
│  6. Logs task, cost, result to SQLite             │
└──────────────────────────────────────────────────┘
```

### Auth-Aware Task Execution

```typescript
// engine/claude-dispatcher.ts — Auth-aware task dispatch

import { spawn } from 'child_process';
import { claudeAuth } from '../web/src/lib/server/claude-auth';
import { EventEmitter } from 'events';

interface TaskResult {
  id: string;
  status: 'success' | 'error' | 'auth_required';
  result?: string;
  cost_usd?: number;
  session_id?: string;
  error?: string;
}

export class ClaudeDispatcher extends EventEmitter {

  async dispatch(taskId: string, prompt: string, options: {
    envId?: string;
    allowedTools?: string[];
    workingDir?: string;
  } = {}): Promise<TaskResult> {

    // Pre-flight: check auth status
    const authStatus = await claudeAuth.checkAuthStatus();
    if (authStatus !== 'authenticated') {
      return {
        id: taskId,
        status: 'auth_required',
        error: 'Claude Code is not authenticated. Please re-authenticate in Settings → Claude.',
      };
    }

    const args = [
      '-p', prompt,
      '--output-format', 'json',
    ];

    if (options.allowedTools?.length) {
      args.push('--allowedTools', options.allowedTools.join(','));
    }

    if (options.workingDir) {
      args.push('--cwd', options.workingDir);
    }

    // Skip permission prompts for headless dispatch
    args.push('--dangerously-skip-permissions');

    return new Promise((resolve) => {
      const proc = spawn('claude', args, {
        timeout: 600_000,  // 10 minute max per task
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
        // Stream partial output to listeners
        this.emit(`task:${taskId}:output`, data.toString());
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();

        // Detect auth failures mid-task
        if (stderr.includes('Invalid API key') || 
            stderr.includes('Please run /login') ||
            stderr.includes('authentication') ||
            stderr.includes('401')) {
          proc.kill('SIGTERM');
          resolve({
            id: taskId,
            status: 'auth_required',
            error: 'Claude session expired during task execution. Please re-authenticate.',
          });
        }
      });

      proc.on('exit', (code) => {
        if (code === 0) {
          try {
            const parsed = JSON.parse(stdout);
            resolve({
              id: taskId,
              status: 'success',
              result: parsed.result,
              cost_usd: parsed.total_cost_usd,
              session_id: parsed.session_id,
            });
          } catch {
            resolve({
              id: taskId,
              status: 'success',
              result: stdout,
            });
          }
        } else {
          resolve({
            id: taskId,
            status: 'error',
            error: stderr || `Claude exited with code ${code}`,
          });
        }
      });

      proc.on('error', (err) => {
        resolve({
          id: taskId,
          status: 'error',
          error: `Failed to spawn Claude: ${err.message}`,
        });
      });
    });
  }
}
```

### Interactive Claude Sessions

For complex work where Claude needs back-and-forth interaction, Spyre spawns an interactive Claude Code session inside a tmux window on the controller, and pipes the terminal to the browser via xterm.js — just like it does for worker SSH sessions. The user interacts with Claude Code through the browser terminal as if they were at the controller VM's keyboard.

This is where the **single sign-in** truly shines: Claude Code is already authenticated on the controller. The user authenticated to the web app. The web app gives the user a terminal that connects to the already-authenticated Claude Code. No additional auth needed.

### Session Persistence with tmux

Every Claude Code operation on a remote worker goes through tmux:

```bash
# Spyre creates a named tmux session per environment per operation
ssh dev-web "tmux new-session -d -s claude-task-$(date +%s) \
  'cd /opt/myapp && bash'"

# Claude Code attaches and does its work within that session
# If connection drops, the session persists on the worker
# Claude Code can resume: claude --resume <session-id>
```

For long-running Claude tasks (refactoring a large codebase, running test suites), the tmux session means:

- Network blip? No problem — tmux keeps running.
- Close your browser tab? Reconnect and reattach.
- Want to check progress from your phone? Connect to Spyre web app, navigate to the environment, see the live terminal.

---

## 9. Multi-Terminal Workspace

Each environment in the Spyre UI gets a workspace view with tabbed terminals:

```
┌─────────────────────────────────────────────────────────┐
│  dev-web  │  dev-api  │  staging  │                     │
├─────────────────────────────────────────────────────────┤
│  ┌─────────────┬──────────────┬───────────────┐         │
│  │ Terminal 1  │ Terminal 2   │ Claude Code + │         │
│  ├─────────────┴──────────────┴───────────────┤         │
│  │                                             │         │
│  │  user@dev-web:~$ npm run dev               │         │
│  │  > next dev                                 │         │
│  │  ready - started server on 0.0.0.0:3000    │         │
│  │  ▌                                          │         │
│  │                                             │         │
│  └─────────────────────────────────────────────┘         │
│                                                          │
│  [+ New Tab]  [Split Horizontal]  [Split Vertical]      │
│                                                          │
│  ┌──────────────────────────────┐                        │
│  │ Services: web(:80) app(:3000)│  [Open in Browser]    │
│  └──────────────────────────────┘                        │
└─────────────────────────────────────────────────────────┘
```

Implementation:

- Each browser tab = one tmux window on the worker
- Split panes in the browser = tmux split-pane commands
- Tab names are synced with tmux window names
- All state lives in tmux on the worker — the browser is just a viewport

---

## 10. Database Schema

```sql
-- Spyre Controller SQLite Schema

CREATE TABLE environments (
    id              TEXT PRIMARY KEY,
    name            TEXT UNIQUE NOT NULL,
    config_path     TEXT NOT NULL,
    vmid            INTEGER,
    type            TEXT NOT NULL,            -- 'lxc' or 'vm'
    status          TEXT DEFAULT 'pending',   -- pending/provisioning/running/stopped/error
    ip_address      TEXT,
    node            TEXT,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_accessed   DATETIME,
    metadata        TEXT                      -- JSON blob
);

CREATE TABLE services (
    id              TEXT PRIMARY KEY,
    env_id          TEXT REFERENCES environments(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    port            INTEGER NOT NULL,
    protocol        TEXT NOT NULL,            -- ssh/http/https/vnc/rdp
    proxy_url       TEXT,
    status          TEXT DEFAULT 'unknown'
);

CREATE TABLE claude_tasks (
    id              TEXT PRIMARY KEY,
    env_id          TEXT REFERENCES environments(id),
    user_id         TEXT,
    prompt          TEXT NOT NULL,
    status          TEXT DEFAULT 'pending',   -- pending/running/complete/error/auth_required
    result          TEXT,
    cost_usd        REAL,
    session_id      TEXT,                     -- Claude Code session ID for resume
    started_at      DATETIME,
    completed_at    DATETIME
);

CREATE TABLE claude_auth_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    event           TEXT NOT NULL,            -- initiated/callback_received/authenticated/
                                             -- expired/error/health_check
    details         TEXT,                     -- JSON
    timestamp       DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE users (
    id              TEXT PRIMARY KEY,
    username        TEXT UNIQUE NOT NULL,
    password_hash   TEXT NOT NULL,
    role            TEXT DEFAULT 'operator',  -- admin/operator/viewer
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE audit_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         TEXT,
    action          TEXT NOT NULL,
    target          TEXT,
    details         TEXT,                     -- JSON
    timestamp       DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## 11. Setup Procedure

### Prerequisites

- Proxmox VE 8.x host with API access enabled
- An Ubuntu Server 24.04 VM on the Proxmox host (this becomes the Spyre controller)
- Anthropic Pro/Max subscription (for OAuth)
- Network connectivity between the controller VM and the Proxmox host API (:8006)
- A domain or hostname for the controller (e.g., `spyre.local`) — needed for OAuth callback routing

### One-Shot Setup Script

```bash
#!/bin/bash
# setup.sh — Run on the Spyre controller VM

set -euo pipefail

echo "=== Spyre Controller Setup ==="

# 1. System packages
sudo apt update && sudo apt install -y \
  curl git tmux jq sqlite3 openssh-client \
  caddy expect python3 python3-pip

# 2. Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# 3. Claude Code
sudo npm install -g @anthropic-ai/claude-code

# 4. Guacamole daemon (for RDP support)
sudo apt install -y guacd libguac-client-rdp0 libguac-client-vnc0

# 5. Generate SSH key pair for Spyre → Worker connections
ssh-keygen -t ed25519 -f ~/.ssh/spyre_ed25519 -N "" -C "spyre-controller"
echo "→ Public key (inject into workers):"
cat ~/.ssh/spyre_ed25519.pub

# 6. Configure SSH for Spyre connections
cat >> ~/.ssh/config << 'EOF'
Host spyre-worker-*
    IdentityFile ~/.ssh/spyre_ed25519
    StrictHostKeyChecking accept-new
    ServerAliveInterval 30
    ServerAliveCountMax 5
    ControlMaster auto
    ControlPath ~/.ssh/sockets/%r@%h-%p
    ControlPersist 600
EOF
mkdir -p ~/.ssh/sockets

# 7. Create Spyre directory structure
sudo mkdir -p /opt/spyre/{configs/bases,scripts,data}
sudo mkdir -p /etc/spyre
sudo chown -R $USER:$USER /opt/spyre

# 8. Configure Spyre base URL (needed for OAuth callback)
echo "Enter the URL users will access Spyre at (e.g., https://spyre.local):"
read SPYRE_URL
cat | sudo tee /etc/spyre/env << EOF
SPYRE_BASE_URL=${SPYRE_URL}
NODE_ENV=production
EOF
sudo chmod 600 /etc/spyre/env

# 9. Initialize database
sqlite3 /opt/spyre/data/spyre.db < schema.sql

# 10. Clone and build the web application
cd /opt/spyre
git clone https://github.com/yourorg/spyre-web.git web
cd web && npm install && npm run build

# 11. Configure Caddy
sudo tee /etc/caddy/Caddyfile << 'CADDYEOF'
{$SPYRE_DOMAIN:spyre.local} {
    reverse_proxy localhost:3000

    # WebSocket support for terminals
    @websockets {
        header Connection *Upgrade*
        header Upgrade websocket
    }
    reverse_proxy @websockets localhost:3000
}

# Dynamic proxy entries appended by Spyre
import /opt/spyre/data/Caddyfile.d/*
CADDYEOF
sudo mkdir -p /opt/spyre/data/Caddyfile.d

# 12. Create systemd service
sudo tee /etc/systemd/system/spyre.service << EOF
[Unit]
Description=Spyre - Claude Code Infrastructure Orchestrator
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=/opt/spyre/web
EnvironmentFile=/etc/spyre/env
ExecStart=/usr/bin/node build/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now spyre
sudo systemctl restart caddy

echo ""
echo "=== Spyre is running at ${SPYRE_URL} ==="
echo "=== First visit: create admin account ==="
echo "=== Then: Settings → Claude → Authenticate ==="
echo ""
echo "The OAuth flow will open in your browser."
echo "Sign in with your Anthropic account to connect Claude Code."
```

---

## 12. Operational Workflows

### Create a New Environment

```
User clicks [+ New Environment] in web UI
    │
    ├── Option A: Select from existing config (dev-web.yaml)
    │   └── One click → provisions automatically
    │
    └── Option B: Create new config
        ├── Choose base template (ubuntu-dev, fedora-dev, etc.)
        ├── Customize resources, packages, scripts in editor
        ├── [Validate] → dry-run config parsing
        └── [Save & Provision] → kicks off 3-phase pipeline
```

### Destroy an Environment

```
User clicks [Destroy] on environment card
    │
    ├── Confirmation dialog with environment name
    ├── Spyre sends DELETE to Proxmox API
    │   └── pvesh delete /nodes/{node}/lxc/{vmid} --purge
    ├── Removes Caddy proxy entries, reloads
    ├── Cleans up SSH known_hosts entry
    └── Marks environment as destroyed in DB (soft delete for audit)
```

### Ask Claude to Do Something

```
User navigates to dev-web environment → Claude tab
    │
    ├── Types: "Upgrade Node.js to v22 and fix any breaking changes"
    ├── [Run] dispatches to Claude Code on controller
    │   └── Pre-flight: checks Claude auth status
    │   └── If expired → shows re-auth banner, blocks dispatch
    │   └── If valid → claude -p "SSH into dev-web..." --output-format stream-json
    ├── Real-time output streams to browser via WebSocket
    ├── If auth error mid-task → pauses, prompts re-auth, resumes via session ID
    ├── Task result saved to claude_tasks table
    └── User can [Resume] if Claude needs clarification
```

---

## 13. Security Considerations

| Concern | Mitigation |
|---------|-----------|
| Proxmox API token compromise | Token scoped to VM/LXC creation + management only. No host-level access. Stored encrypted at rest. |
| SSH key compromise | Spyre key only on controller VM. Workers accept only this key. Key rotation via config update + re-provisioning. |
| Claude Code OAuth token exposure | Stored in `~/.config/claude-code/auth.json` with 600 permissions. Never sent to browser. Never logged. Health checks detect expiry and prompt re-auth. |
| OAuth callback interception | Callback URL is HTTPS (Caddy auto-TLS). State parameter contains CSRF-equivalent nonce. Callback relay validates state before forwarding to Claude Code process. |
| Web app auth bypass | bcrypt password hashing, HTTP-only secure cookies, CSRF tokens. Rate limiting on login. |
| Worker-to-controller lateral movement | Workers have no SSH access back to controller. Firewall rules: controller → workers (22, service ports); workers → controller (deny). |
| `--dangerously-skip-permissions` | Only used in headless dispatch mode within the controller's trusted context. The web app's RBAC is the permission layer. |
| Tmux session hijacking | Tmux sockets are per-user (Spyre's SSH user on workers). Other users on the worker can't attach. |

---

## 14. Scaling Considerations

### Near-Term (Phase 1 — what to build first)

- Single Proxmox host, single Spyre controller VM
- LXC containers only (fastest provisioning, lowest overhead)
- SSH terminal only (no VNC/RDP yet)
- 5-10 environments
- Single user (you)

### Medium-Term (Phase 2)

- Add VM support for workloads that need full kernel isolation
- VNC/RDP for graphical environments
- Multi-user with RBAC
- Config version history (git-backed config directory)
- Environment snapshots/cloning via Proxmox API

### Long-Term (Phase 3)

- Multiple Proxmox nodes / Proxmox cluster
- Windows VM support (RDP via Guacamole)
- Spyre controller HA (active-passive with shared SQLite → PostgreSQL)
- Ansible/Terraform export (generate IaC from Spyre configs)
- Claude Code multi-agent: multiple Claude tasks running in parallel across environments
- Cost tracking and budgeting per environment/team
- Integration with external CI/CD (GitHub Actions dispatch via Spyre)

---

## 15. Key Technology Decisions Summary

| Decision | Choice | Why |
|----------|--------|-----|
| Claude auth strategy | OAuth via relay service on controller | Uses Pro/Max subscription. Single auth, browser-relayed, health-monitored with auto re-auth prompts. |
| Worker connectivity | SSH with persistent connections + tmux | Lightweight, universal, resumable, battle-tested |
| Proxmox integration | REST API + API tokens | Programmatic, scoped, no interactive dependencies |
| Helper script usage | API for provisioning, install scripts for app setup | Separates infra from config, allows automation |
| Web terminal | xterm.js over WebSocket | Industry standard, fast, supports mouse/color/resize |
| Remote desktop | noVNC + Guacamole | Browser-native, no client install, supports VNC+RDP |
| Config format | YAML with inheritance | Readable, diffable, git-friendly, familiar to IaC users |
| Database | SQLite | Zero-config, embedded, sufficient for single-controller |
| Web framework | SvelteKit | Fast, reactive, SSR+SPA hybrid, WebSocket-friendly |
| Reverse proxy | Caddy | Auto-HTTPS, simple config, dynamic reloading |
| Process isolation | systemd | Native, reliable, well-understood |

---

## 16. Getting Started — Minimal Viable Spyre

To avoid boiling the ocean, here's the smallest useful version you can build first:

1. **Controller VM**: Ubuntu Server 24.04 on Proxmox, Claude Code installed
2. **OAuth relay**: The `claude-auth.ts` module + three route handlers + settings page
3. **One YAML config**: A simple dev environment definition
4. **One provisioner script**: Talks to Proxmox API to create an LXC, injects SSH key, runs post-provision packages
5. **One Express/SvelteKit server**: REST endpoints for create/list/destroy environments + OAuth routes
6. **One HTML page**: Lists environments, has a [Create] button, embeds xterm.js for SSH, has Claude auth panel
7. **tmux everywhere**: Every SSH connection wraps in tmux automatically

That's your MVP. Everything else (Guacamole, Caddy dynamic proxy, config inheritance, Claude dispatch UI, multi-user auth) layers on top incrementally.

---

*This document is a living architecture guide. As Spyre evolves, update the relevant sections. The core principle — one Claude, many targets, everything in the browser — should remain the north star.*
