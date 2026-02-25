import { v4 as uuid } from 'uuid';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Client as SshClient } from 'ssh2';
import { getDb } from './db';
import { getEnvConfig } from './env-config';
import * as proxmox from './proxmox';
import { getScript } from './community-scripts';
import { runPipeline, injectSpyreTracking, installClaudeInEnvironment } from './provisioner';
import type { ProvisionerContext } from './provisioner';
import { broadcastProvisioningEvent } from './provisioning-events';
import { getPersona } from './personas';
import { propagateGitHubAuth } from './github-auth';
import { ensureDockerInstalled } from './devcontainers';
import type { Environment, CreateEnvironmentRequest } from '$lib/types/environment';
import type { CommunityScript, CommunityScriptInstallMethod } from '$lib/types/community-script';

// =============================================================================
// Provisioning Mutex — Serialize VMID allocation to prevent race conditions
// =============================================================================
// Proxmox's /cluster/nextid is optimistic (no reservation). Two concurrent
// createEnvironment() calls can get the same VMID. This mutex ensures only
// one provisioning operation allocates and claims a VMID at a time.
// The lock is held from getNextVmid() through createLxc() completion.

let _provisioningLock: Promise<void> = Promise.resolve();

function withProvisioningLock<T>(fn: () => Promise<T>): Promise<T> {
  let release: () => void;
  const next = new Promise<void>(resolve => { release = resolve; });
  const prev = _provisioningLock;
  _provisioningLock = next;
  return prev.then(fn).finally(() => release!());
}

function generatePassword(length = 16): string {
  // Only use shell-safe characters — no quotes, backslashes, or special shell metacharacters
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const bytes = randomBytes(length);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

// =============================================================================
// Command Execution — SSH to Proxmox host + pct exec, or direct SSH to container
// =============================================================================

/**
 * SSH into the Proxmox host and run a command.
 * Uses the SSH key configured in environment.yaml.
 */
function sshToProxmox(
  command: string,
  timeoutMs = 30000,
  options?: { pty?: boolean }
): Promise<{ code: number; stdout: string; stderr: string }> {
  const config = getEnvConfig();
  const keyPath = config.controller.ssh_key_path.replace('~', process.env.HOME ?? '');

  let privateKey: Buffer;
  try {
    privateKey = readFileSync(keyPath);
  } catch {
    throw new Error(`SSH key not found at ${keyPath}. Run setup.sh to generate it.`);
  }

  return new Promise((resolve, reject) => {
    const conn = new SshClient();
    const timer = setTimeout(() => {
      conn.end();
      reject(new Error(`SSH to Proxmox timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    conn.on('ready', () => {
      const execCallback = (err: Error | undefined, stream: import('ssh2').ClientChannel) => {
        if (err) {
          clearTimeout(timer);
          conn.end();
          reject(err);
          return;
        }
        let stdout = '';
        let stderr = '';
        stream.on('data', (data: Buffer) => { stdout += data.toString(); });
        stream.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
        stream.on('close', (code: number) => {
          clearTimeout(timer);
          conn.end();
          resolve({ code, stdout, stderr });
        });
      };

      if (options?.pty) {
        conn.exec(command, { pty: { rows: 50, cols: 200, term: 'xterm' } }, execCallback);
      } else {
        conn.exec(command, execCallback);
      }
    });

    conn.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    conn.connect({
      host: config.proxmox.host,
      port: 22,
      username: 'root',
      privateKey,
      readyTimeout: 10000,
      hostVerifier: () => true,
    } as Parameters<typeof conn.connect>[0]);
  });
}

/**
 * Execute a command inside a container via `pct exec` on the Proxmox host.
 * This works regardless of whether SSH is running inside the container.
 */
async function pctExec(vmid: number, command: string, timeoutMs = 30000): Promise<{ code: number; stdout: string; stderr: string }> {
  // Escape single quotes in the command for safe embedding
  const escaped = command.replace(/'/g, "'\\''");
  const pctCommand = `pct exec ${vmid} -- bash -c '${escaped}'`;
  return sshToProxmox(pctCommand, timeoutMs);
}

/**
 * Execute a command inside a container via direct SSH.
 * Only works after SSH has been configured in the container.
 */
function sshExec(host: string, password: string, command: string, timeoutMs = 15000): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const conn = new SshClient();
    const timer = setTimeout(() => {
      conn.end();
      reject(new Error(`SSH command timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    conn.on('ready', () => {
      conn.exec(command, (err, stream) => {
        if (err) {
          clearTimeout(timer);
          conn.end();
          reject(err);
          return;
        }
        let stdout = '';
        let stderr = '';
        stream.on('data', (data: Buffer) => { stdout += data.toString(); });
        stream.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
        stream.on('close', (code: number) => {
          clearTimeout(timer);
          conn.end();
          resolve({ code, stdout, stderr });
        });
      });
    });

    conn.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    conn.connect({
      host,
      port: 22,
      username: 'root',
      password,
      readyTimeout: 10000,
      hostVerifier: () => true,
    } as Parameters<typeof conn.connect>[0]);
  });
}

/**
 * Execute a command in a container. Tries direct SSH first (faster for long-running
 * commands with streaming output), falls back to pct exec via Proxmox host.
 */
async function containerExec(
  vmid: number,
  ip: string | null,
  password: string,
  command: string,
  timeoutMs = 60000
): Promise<{ code: number; stdout: string; stderr: string }> {
  // Try direct SSH first if we have an IP
  if (ip) {
    try {
      return await sshExec(ip, password, command, timeoutMs);
    } catch {
      // SSH not available — fall through to pct exec
    }
  }

  // Fall back to pct exec via Proxmox host
  return pctExec(vmid, command, timeoutMs);
}

/**
 * Configure sshd inside a container to allow root login with password.
 * Uses pct exec via the Proxmox host — does NOT require SSH in the container.
 */
async function configureContainerSsh(vmid: number): Promise<void> {
  // Small delay for container init to complete
  await new Promise(r => setTimeout(r, 3000));

  const commands = [
    // Enable root login (handle both commented and uncommented lines)
    "sed -i -e 's/^#*PermitRootLogin.*/PermitRootLogin yes/' /etc/ssh/sshd_config",
    // Enable password auth
    "sed -i -e 's/^#*PasswordAuthentication.*/PasswordAuthentication yes/' /etc/ssh/sshd_config",
    // Remove cloud-init SSH overrides if present
    "rm -f /etc/ssh/sshd_config.d/60-cloudimg-settings.conf",
    // Restart SSH (try all common service names)
    "systemctl restart sshd 2>/dev/null || systemctl restart ssh 2>/dev/null || service ssh restart 2>/dev/null || true"
  ];

  for (const cmd of commands) {
    try {
      const result = await pctExec(vmid, cmd);
      if (result.code !== 0 && result.stderr) {
        console.warn(`[spyre] pct exec non-zero (${result.code}): ${cmd} — ${result.stderr.trim()}`);
      }
    } catch (err) {
      console.warn(`[spyre] pct exec failed: ${cmd}`, err);
      // Continue to next command
    }
  }

  console.log(`[spyre] SSH configured for root access in container ${vmid}`);
}

// =============================================================================
// Provisioner Pipeline — delegates to provisioner.ts
// =============================================================================

function logProvisioningStep(
  envId: string,
  phase: string,
  status: 'running' | 'success' | 'error',
  message: string
): void {
  const db = getDb();
  const dbStatus = status === 'running' ? 'running' : status === 'error' ? 'error' : 'success';
  db.prepare(`
    INSERT INTO provisioning_log (env_id, phase, step, status, output, started_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `).run(envId, phase, message, dbStatus, null);
}

/**
 * Build a ProvisionerContext that wraps containerExec for the given environment.
 */
function buildProvisionerContext(
  envId: string,
  vmid: number,
  ip: string | null,
  rootPassword: string
): ProvisionerContext {
  return {
    envId,
    vmid,
    ip,
    rootPassword,
    exec: (command: string, timeoutMs?: number) =>
      containerExec(vmid, ip, rootPassword, command, timeoutMs ?? 60000),
  };
}

/**
 * Run the full provisioner pipeline after container creation.
 * Delegates to the extracted provisioner module.
 */
async function runProvisionerPipeline(
  envId: string,
  vmid: number,
  ip: string | null,
  rootPassword: string,
  req: CreateEnvironmentRequest
): Promise<void> {
  const ctx = buildProvisionerContext(envId, vmid, ip, rootPassword);
  await runPipeline(ctx, {
    software_pool_ids: req.software_pool_ids,
    software_ids: req.software_ids,
    community_script_slug: req.community_script_slug,
    install_method_type: req.install_method_type,
    custom_script: req.custom_script,
    default_user: req.default_user,
  }, (event) => {
    broadcastProvisioningEvent(envId, event);
  });
}

export function listEnvironments(): Environment[] {
  const db = getDb();
  return db.prepare('SELECT * FROM environments ORDER BY created_at DESC').all() as Environment[];
}

export function getEnvironment(id: string): Environment | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM environments WHERE id = ?').get(id) as Environment | undefined;
}

export function getEnvironmentByName(name: string): Environment | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM environments WHERE name = ?').get(name) as Environment | undefined;
}

// =============================================================================
// Community Script — Host-Side Execution
// =============================================================================

/**
 * Discover the Proxmox storage that holds vztmpl content (for template downloads).
 * Falls back to 'local' if none found.
 */
async function discoverTemplateStorage(): Promise<string> {
  try {
    const config = getEnvConfig();
    const storages = await proxmox.listStorage(config.proxmox.node_name);
    const tplStorage = storages.find(s => s.content?.includes('vztmpl'));
    return tplStorage?.storage ?? 'local';
  } catch {
    return 'local';
  }
}

/**
 * Sanitize a name into a valid DNS hostname.
 * Lowercase, strip invalid chars, truncate to 63 chars.
 */
function sanitizeHostname(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')   // Replace invalid chars with hyphens
    .replace(/^-+|-+$/g, '')        // Trim leading/trailing hyphens
    .replace(/-{2,}/g, '-')         // Collapse multiple hyphens
    .slice(0, 63) || 'spyre-env';   // Truncate and provide fallback
}

/**
 * Build the full bash command to run a community script on the Proxmox host.
 * Sets mode=default + all var_* env vars to bypass the interactive TUI.
 *
 * The command includes:
 * - A whiptail wrapper to auto-respond to any interactive dialogs
 * - TERM/DEBIAN_FRONTEND for non-interactive operation
 * - All var_* exports for build.func's base_settings()
 * - DIAGNOSTICS=no to skip telemetry prompts
 */
function buildCommunityScriptCommand(
  script: CommunityScript,
  method: CommunityScriptInstallMethod,
  req: CreateEnvironmentRequest,
  config: ReturnType<typeof getEnvConfig>,
  templateStorage: string,
  sshPubKey: string | undefined,
  rootPassword: string
): string {
  const containerStorage = req.storage ?? config.defaults.storage;
  const bridge = req.bridge ?? config.defaults.bridge;
  const password = rootPassword;
  const hostname = sanitizeHostname(req.name);

  // Build var_* exports — these map to internal variables in build.func's base_settings()
  //
  // IMPORTANT: Do NOT set var_ns (DNS) or var_gateway here.
  // In build.func, advanced_settings() reformats these into pct-create options
  // (e.g., NS → "-nameserver=8.8.8.8"), but in mode=default that reformatting
  // is skipped. Setting them as raw values causes "too many arguments" errors
  // in pct create. Containers inherit DNS from the Proxmox host by default.
  const vars: Record<string, string> = {
    var_cpu: String(req.cores),
    var_ram: String(req.memory),
    var_disk: String(req.disk),
    var_os: method.resources.os ?? 'debian',
    var_version: method.resources.version ?? '12',
    var_unprivileged: (req.unprivileged !== false) ? '1' : '0',
    var_nesting: (req.nesting !== false) ? '1' : '0',
    var_brg: bridge,
    var_net: req.ip ?? 'dhcp',
    var_pw: password,
    var_ssh: req.ssh_enabled !== false ? 'yes' : 'no',
    var_container_storage: containerStorage,
    var_template_storage: templateStorage,
    var_hostname: hostname,
    var_verbose: 'yes',
    var_tags: 'spyre',
    var_timezone: 'host',
  };

  if (sshPubKey) {
    vars.var_ssh_authorized_key = sshPubKey;
  }

  // Build the script URL
  const scriptPath = method.script;
  const scriptUrl = `https://raw.githubusercontent.com/community-scripts/ProxmoxVE/main/${scriptPath}`;

  // Assemble var_* exports
  const exportLines = Object.entries(vars)
    .map(([k, v]) => `export ${k}='${v.replace(/'/g, "'\\''")}'`)
    .join('; ');

  // Whiptail wrapper: intercepts all whiptail/dialog calls to auto-respond.
  // Uses printf instead of heredoc since heredoc delimiters need their own line
  // but we're building a semicolon-joined command string.
  // --yesno returns 1 (No) to skip debug prompts on failure.
  // --msgbox/--infobox returns 0.
  // --menu/--radiolist/--inputbox: echo empty to stderr, return 0.
  const whiptailScript = `#!/bin/bash
MODE=""
for arg in "$@"; do
  case "$arg" in
    --yesno) MODE=yesno ;;
    --msgbox|--infobox|--gauge) MODE=msg ;;
    --menu|--radiolist|--checklist) MODE=menu ;;
    --inputbox|--passwordbox) MODE=input ;;
  esac
done
case "$MODE" in
  yesno) exit 1 ;;
  msg) exit 0 ;;
  menu|input) echo "" >&2; exit 0 ;;
  *) exit 0 ;;
esac`;

  // Base64-encode the script to avoid quoting issues in the command
  const whiptailB64 = Buffer.from(whiptailScript).toString('base64');

  const whiptailWrapper = [
    'mkdir -p /tmp/spyre-bin',
    `echo '${whiptailB64}' | base64 -d > /tmp/spyre-bin/whiptail`,
    'chmod +x /tmp/spyre-bin/whiptail',
    'export PATH="/tmp/spyre-bin:$PATH"',
  ].join('; ');

  return [
    // Terminal and non-interactive settings
    'export TERM=xterm',
    'export DEBIAN_FRONTEND=noninteractive',
    // Whiptail auto-responder wrapper
    whiptailWrapper,
    // Diagnostics opt-out
    'mkdir -p /usr/local/community-scripts',
    "echo 'DIAGNOSTICS=no' > /usr/local/community-scripts/diagnostics",
    // Mode and variable exports
    'export mode=default',
    exportLines,
    // Execute the community script — yes '' handles any stray read prompts
    `yes '' | bash -c "$(curl -fsSL '${scriptUrl}')" 2>&1`
  ].join('; ');
}

/**
 * Parse the CTID from community script output.
 * The scripts log recognizable patterns when creating containers.
 * build.func outputs "pct create <ID> ..." during container creation.
 */
function parseCTIDFromOutput(output: string): number | null {
  // Strip ANSI escape codes for clean matching
  const clean = output.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');

  // Try various patterns that build.func outputs
  const patterns = [
    /pct create (\d+)/,           // The actual pct create command
    /CTID[=:\s]+(\d+)/i,         // build.func exports CTID
    /Container ID[:\s]+(\d+)/i,
    /Using ID[:\s]+(\d+)/i,
    /LXC_ID[=:\s]+(\d+)/i,
    /Successfully created Container (\d+)/i,
    /PCT_DISK_SIZE.*pct create (\d+)/i,
  ];

  for (const pattern of patterns) {
    const match = clean.match(pattern);
    if (match) {
      const id = parseInt(match[1], 10);
      if (id > 0 && id < 999999) return id;
    }
  }

  return null;
}

/**
 * Run a community script on the Proxmox host via SSH.
 * Uses a PTY for proper terminal handling (tput, clear, etc. work correctly).
 */
async function runCommunityScriptOnHost(
  command: string,
  timeoutMs = 900000
): Promise<{ code: number; stdout: string; stderr: string }> {
  return sshToProxmox(command, timeoutMs, { pty: true });
}

/**
 * Create an environment by running a community script on the Proxmox host.
 * The script handles template download, container creation, and app installation.
 */
async function createViaCommunityScript(
  id: string,
  req: CreateEnvironmentRequest,
  rootPassword: string,
  metadata: Record<string, unknown>
): Promise<Environment> {
  const db = getDb();
  const config = getEnvConfig();
  const node = config.proxmox.node_name;

  // Look up the community script
  const script = getScript(req.community_script_slug!);
  if (!script) {
    throw { code: 'NOT_FOUND', message: `Community script '${req.community_script_slug}' not found in cache.` };
  }

  // Select the install method
  const methodType = req.install_method_type ?? 'default';
  const method = script.install_methods.find(m => m.type === methodType)
    ?? script.install_methods[0];

  if (!method) {
    throw { code: 'INVALID_CONFIG', message: `No install methods available for script '${script.name}'.` };
  }

  // Store community script metadata
  metadata.community_script = {
    slug: script.slug,
    name: script.name,
    install_method_type: method.type,
    interface_port: script.interface_port,
    default_credentials: {
      username: script.default_username,
      password: script.default_password
    }
  };
  db.prepare("UPDATE environments SET metadata = ?, updated_at = datetime('now') WHERE id = ?")
    .run(JSON.stringify(metadata), id);

  // Read SSH public key
  let sshPubKey: string | undefined;
  if (req.ssh_enabled !== false) {
    try {
      const keyPath = config.controller.ssh_key_path.replace('~', process.env.HOME ?? '');
      sshPubKey = readFileSync(`${keyPath}.pub`, 'utf-8').trim();
    } catch {
      console.warn('[spyre] SSH public key not found — container will rely on password auth');
    }
  }

  // Discover template storage
  const templateStorage = await discoverTemplateStorage();

  // Build the command
  const command = buildCommunityScriptCommand(script, method, req, config, templateStorage, sshPubKey, rootPassword);

  // Snapshot existing containers BEFORE running the script (for CTID detection fallback)
  let existingVmids: Set<number>;
  try {
    const existing = await proxmox.listLxc(node);
    existingVmids = new Set(existing.map(c => c.vmid));
  } catch {
    existingVmids = new Set();
  }

  // Log and execute
  logProvisioningStep(id, 'community_script', 'running', `Running ${script.name} on Proxmox host...`);
  const maskedCommand = command.replace(/var_pw='[^']*'/, "var_pw='***'");
  console.log(`[spyre] Running community script '${script.name}' (method: ${method.type}) on Proxmox host`);
  console.log(`[spyre] Command (password masked):\n${maskedCommand}`);

  const result = await runCommunityScriptOnHost(command);
  const fullOutput = result.stdout + result.stderr;

  console.log(`[spyre] Script exit code: ${result.code}, output: ${result.stdout.length + result.stderr.length} chars`);

  if (result.code !== 0) {
    logProvisioningStep(id, 'community_script', 'error', `Script exited with code ${result.code}`);

    // Extract meaningful error lines from output (skip ANSI escape codes and whiptail box art)
    const cleanOutput = fullOutput.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, ''); // Strip ANSI codes
    const errorLines = cleanOutput.split('\n')
      .filter(line => {
        const trimmed = line.trim();
        if (!trimmed) return false;
        // Skip whiptail box-drawing chars and empty UI lines
        if (/^[│┌┐└┘├┤┬┴┼─╔╗╚╝║═\s<>]+$/.test(trimmed)) return false;
        // Keep lines with error indicators
        return /error|fail|warn|unable|cannot|denied|refused|timeout|pct create/i.test(trimmed);
      })
      .slice(-20); // Last 20 error-relevant lines

    const errorSummary = errorLines.length > 0
      ? errorLines.join('\n')
      : cleanOutput.slice(-1000);

    console.warn(`[spyre] Community script failed (exit ${result.code}).`);
    console.warn(`[spyre] Full output length: ${fullOutput.length} chars`);
    console.warn(`[spyre] Error-relevant lines:\n${errorSummary}`);
    console.warn(`[spyre] Last 3000 chars of output:\n${cleanOutput.slice(-3000)}`);

    throw {
      code: 'SCRIPT_FAILED',
      message: `Community script '${script.name}' failed (exit ${result.code}). Errors:\n${errorSummary.slice(-800)}`
    };
  }

  logProvisioningStep(id, 'community_script', 'success', `${script.name} installed successfully.`);

  // Parse CTID from output
  let vmid = parseCTIDFromOutput(fullOutput);
  console.log(`[spyre] CTID from output parsing: ${vmid ?? 'not found'}`);

  // Fallback: find new containers that didn't exist before the script ran
  if (!vmid) {
    console.log('[spyre] CTID not found in output, diffing container list...');
    const hostname = sanitizeHostname(req.name);
    try {
      const currentContainers = await proxmox.listLxc(node);
      // Find containers that are NEW (not in the pre-run snapshot)
      const newContainers = currentContainers.filter(c => !existingVmids.has(c.vmid));
      console.log(`[spyre] Found ${newContainers.length} new container(s) since script started`);

      if (newContainers.length === 1) {
        // Only one new container — it must be ours
        vmid = newContainers[0].vmid;
        console.log(`[spyre] Single new container found: VMID ${vmid} (name: ${newContainers[0].name})`);
      } else if (newContainers.length > 1) {
        // Multiple new containers — match by hostname or tags
        const match = newContainers.find(c =>
          c.name === hostname ||
          (c.tags && c.tags.includes('spyre'))
        );
        if (match) {
          vmid = match.vmid;
          console.log(`[spyre] Matched new container by hostname/tags: VMID ${vmid}`);
        }
      }

      // Last resort: search ALL containers for matching hostname
      if (!vmid) {
        const match = currentContainers.find(c => c.name === hostname);
        if (match) {
          vmid = match.vmid;
          console.log(`[spyre] Found container by hostname match: VMID ${vmid}`);
        }
      }
    } catch (err) {
      console.warn('[spyre] Failed to query Proxmox for container:', err);
    }
  }

  if (!vmid) {
    throw { code: 'CTID_NOT_FOUND', message: 'Could not determine the container ID created by the community script.' };
  }

  // Update DB with VMID
  db.prepare("UPDATE environments SET vmid = ?, updated_at = datetime('now') WHERE id = ?")
    .run(vmid, id);

  // Discover IP address
  const ipAddress = await proxmox.discoverLxcIp(node, vmid);

  // Run remaining provisioner pipeline (software pools, custom script, default user)
  // but NOT the community_script step (already done on host)
  try {
    const pipelineReq = { ...req, community_script_slug: undefined };
    await runProvisionerPipeline(id, vmid, ipAddress, rootPassword, pipelineReq);
  } catch (provErr) {
    console.warn('[spyre] Post-community-script pipeline error:', provErr);
    // Non-fatal — container is created and the app is installed
  }

  const ctx = buildProvisionerContext(id, vmid, ipAddress, rootPassword);

  // Docker provisioning for community-script environments
  if (req.docker_enabled) {
    try {
      await ensureDockerInstalled(id);
    } catch (dockerErr) {
      console.warn('[spyre] Docker installation failed (non-fatal):', dockerErr);
    }
  }

  // Project directory setup
  const projectDir = req.project_dir ?? '/project';
  if (req.repo_url || req.docker_enabled) {
    try {
      await ctx.exec(`mkdir -p '${projectDir}'`, 10000);
      if (req.repo_url) {
        const gitBranch = req.git_branch ?? 'main';
        await ctx.exec(
          `git clone --branch '${gitBranch}' '${req.repo_url}' '${projectDir}' 2>&1 || ` +
          `(cd '${projectDir}' && git init && git remote add origin '${req.repo_url}' && git fetch origin '${gitBranch}' && git checkout -b '${gitBranch}' 'origin/${gitBranch}' 2>&1)`,
          120000
        );
      } else {
        await ctx.exec(`cd '${projectDir}' && git init 2>&1`, 10000);
      }
      await ctx.exec(`mkdir -p '${projectDir}/.spyre'`, 10000);
    } catch (projErr) {
      console.warn('[spyre] Project directory setup failed (non-fatal):', projErr);
    }
  }

  // Look up persona for this environment
  const persona = req.persona_id ? getPersona(req.persona_id) ?? null : null;
  const projectContext = req.repo_url
    ? { repoUrl: req.repo_url, gitBranch: req.git_branch, projectDir: req.project_dir }
    : null;

  // Inject .spyre tracking (always)
  try {
    await injectSpyreTracking(ctx.exec, undefined, persona, projectContext);
  } catch (trackErr) {
    console.warn('[spyre] Spyre tracking injection failed (non-fatal):', trackErr);
  }

  // Write project-level CLAUDE.md for docker-enabled environments
  if (req.docker_enabled) {
    try {
      await injectSpyreTracking(ctx.exec, projectDir, persona, projectContext);
    } catch (trackErr) {
      console.warn('[spyre] Project-level CLAUDE.md injection failed (non-fatal):', trackErr);
    }
  }

  // Install Claude CLI if requested (opt-in)
  if (req.install_claude) {
    logProvisioningStep(id, 'claude_install', 'running', 'Installing Claude Code...');
    broadcastProvisioningEvent(id, { phase: 'claude_install', step: 'Installing Claude Code...', status: 'running' });
    try {
      await installClaudeInEnvironment(ctx.exec);
      logProvisioningStep(id, 'claude_install', 'success', 'Claude Code installed.');
      broadcastProvisioningEvent(id, { phase: 'claude_install', step: 'Claude Code installed.', status: 'success' });
    } catch (claudeErr) {
      const msg = claudeErr instanceof Error ? claudeErr.message : String(claudeErr);
      logProvisioningStep(id, 'claude_install', 'error', msg);
      broadcastProvisioningEvent(id, { phase: 'claude_install', step: msg, status: 'error' });
      // Still non-fatal — don't fail the entire provisioning
    }
  }

  // Propagate GitHub auth if repo URL is configured
  if (req.repo_url) {
    try {
      await propagateGitHubAuth(id, persona?.name);
    } catch (ghErr) {
      console.warn('[spyre] GitHub auth propagation failed (non-fatal):', ghErr);
    }
  }

  // Update environment status
  db.prepare(`
    UPDATE environments
    SET status = 'running', ip_address = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(ipAddress, id);

  return getEnvironment(id) as Environment;
}

export async function createEnvironment(req: CreateEnvironmentRequest): Promise<Environment> {
  const db = getDb();
  const config = getEnvConfig();

  // Check name uniqueness
  const existing = getEnvironmentByName(req.name);
  if (existing) {
    throw { code: 'DUPLICATE_NAME', message: `Environment '${req.name}' already exists.` };
  }

  const id = uuid();
  const node = config.proxmox.node_name;
  const sshUser = req.ssh_user ?? config.defaults.ssh_user;

  // Generate root password if not provided
  const rootPassword = req.password || generatePassword();

  // Build metadata with password for UI display
  const metadata: Record<string, unknown> = {
    root_password: rootPassword,
    ssh_enabled: req.ssh_enabled !== false,
    unprivileged: req.unprivileged !== false,
    nesting: req.nesting !== false
  };

  // Insert pending environment into DB first
  db.prepare(`
    INSERT INTO environments (id, name, type, status, node, ssh_user, metadata, persona_id, docker_enabled, repo_url, git_branch, project_dir)
    VALUES (?, ?, ?, 'provisioning', ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, req.name, req.type, node, sshUser, JSON.stringify(metadata),
    req.persona_id ?? null,
    req.docker_enabled ? 1 : 0,
    req.repo_url ?? null,
    req.git_branch ?? 'main',
    req.project_dir ?? '/project'
  );

  // Log initial provisioning step
  logProvisioningStep(id, 'proxmox', 'running', 'Starting environment provisioning...');
  broadcastProvisioningEvent(id, {
    phase: 'proxmox',
    step: 'Starting environment provisioning...',
    status: 'running'
  });

  // Run provisioning in the background — do NOT await.
  // The frontend will watch progress via the SSE stream.
  const provisioningPromise = (async () => {
    try {
      if (req.community_script_slug) {
        await createViaCommunityScript(id, req, rootPassword, metadata);
      } else {
        await createViaProxmoxApi(id, req, rootPassword, node);
      }
      // Broadcast completion
      broadcastProvisioningEvent(id, {
        phase: 'complete',
        step: 'Environment provisioning complete.',
        status: 'success'
      });
    } catch (err) {
      const message = err instanceof Error ? err.message :
        (err as { message?: string })?.message ?? String(err);
      // Check if a VMID was set during provisioning (i.e., CT was created in Proxmox).
      // If VMID is null, the CT was never created and we can safely leave it null.
      // If VMID is set but the error happened after creation (e.g., SSH config),
      // keep the VMID so the user can still manage/delete the CT.
      const currentEnv = getEnvironment(id);
      if (currentEnv?.vmid) {
        // CT exists in Proxmox — keep VMID, just mark as error
        db.prepare(`
          UPDATE environments
          SET status = 'error', error_message = ?, updated_at = datetime('now')
          WHERE id = ?
        `).run(message, id);
      } else {
        // CT was never created — clear any stale data
        db.prepare(`
          UPDATE environments
          SET status = 'error', error_message = ?, vmid = NULL, ip_address = NULL, updated_at = datetime('now')
          WHERE id = ?
        `).run(message, id);
      }
      logProvisioningStep(id, 'error', 'error', message);
      broadcastProvisioningEvent(id, {
        phase: 'error',
        step: message,
        status: 'error'
      });
      console.error(`[spyre] Environment ${id} provisioning failed:`, message);
    }
  })();

  // Prevent unhandled promise rejection
  provisioningPromise.catch(() => {});

  // Return the environment immediately with "provisioning" status
  return getEnvironment(id) as Environment;
}

/**
 * Standard LXC creation via the Proxmox API.
 * This is the original createEnvironment logic, extracted into its own function.
 */
async function createViaProxmoxApi(
  id: string,
  req: CreateEnvironmentRequest,
  rootPassword: string,
  node: string
): Promise<Environment> {
  const db = getDb();
  const config = getEnvConfig();
  const bridge = req.bridge ?? config.defaults.bridge;
  const storage = req.storage ?? config.defaults.storage;

  // Build network config
  const ip = req.ip ?? 'dhcp';
  let net0: string;
  if (ip === 'dhcp') {
    net0 = `name=eth0,bridge=${bridge},ip=dhcp,ip6=auto`;
  } else {
    const gateway = config.defaults.gateway;
    if (!gateway) {
      console.warn('[spyre] Static IP requested but defaults.gateway is empty in environment.yaml');
    }
    net0 = `name=eth0,bridge=${bridge},ip=${ip}`;
    if (gateway) {
      net0 += `,gw=${gateway}`;
    }
  }

  // DNS config
  const nameserver = req.nameserver ?? config.defaults.dns ?? '8.8.8.8';

  // Unprivileged and nesting defaults
  // Docker-in-LXC requires nesting=1 and keyctl=1
  const unprivileged = req.unprivileged !== false;
  const nesting = req.docker_enabled ? true : (req.nesting !== false);
  let features: string | undefined;
  if (nesting && req.docker_enabled) {
    features = 'nesting=1,keyctl=1';
  } else if (nesting) {
    features = 'nesting=1';
  }

  // Swap defaults to 0
  const swap = req.swap ?? 0;

  // Read SSH public key for injection
  let sshPubKey: string | undefined;
  if (req.ssh_enabled !== false) {
    try {
      const keyPath = config.controller.ssh_key_path.replace('~', process.env.HOME ?? '');
      sshPubKey = readFileSync(`${keyPath}.pub`, 'utf-8').trim();
    } catch {
      console.warn('[spyre] SSH public key not found at configured path — container will rely on password auth');
    }
  }

  // Critical section: VMID allocation + container creation must be serialized
  // to prevent two concurrent creates from getting the same VMID.
  const vmid = await withProvisioningLock(async () => {
    const allocatedVmid = await proxmox.getNextVmid();

    // Log progress
    logProvisioningStep(id, 'proxmox', 'running', `Creating ${req.type.toUpperCase()} on Proxmox (VMID ${allocatedVmid})...`);
    broadcastProvisioningEvent(id, {
      phase: 'proxmox',
      step: `Creating ${req.type.toUpperCase()} on Proxmox (VMID ${allocatedVmid})...`,
      status: 'running'
    });

    // Create LXC via Proxmox API
    const upid = await proxmox.createLxc(node, {
      vmid: allocatedVmid,
      hostname: req.name,
      ostemplate: req.template,
      cores: req.cores,
      memory: req.memory,
      rootfs: `${storage}:${req.disk}`,
      net0,
      start: true,
      sshPublicKeys: sshPubKey,
      password: rootPassword,
      swap,
      nameserver,
      unprivileged,
      features,
      timezone: 'host',
      onboot: false,
    });

    // Update DB with VMID immediately (inside lock, so it's claimed)
    db.prepare("UPDATE environments SET vmid = ?, updated_at = datetime('now') WHERE id = ?")
      .run(allocatedVmid, id);

    // Wait for Proxmox task to complete (still inside lock — VMID is now committed)
    await proxmox.waitForTask(node, upid);

    return allocatedVmid;
  });

  logProvisioningStep(id, 'proxmox', 'success', 'Container created successfully.');
  broadcastProvisioningEvent(id, {
    phase: 'proxmox',
    step: 'Container created successfully.',
    status: 'success'
  });

  // Discover IP address
  logProvisioningStep(id, 'post_provision', 'running', 'Discovering IP address...');
  broadcastProvisioningEvent(id, {
    phase: 'post_provision',
    step: 'Discovering IP address...',
    status: 'running'
  });

  const ipAddress = await proxmox.discoverLxcIp(node, vmid);

  logProvisioningStep(id, 'post_provision', 'success', ipAddress ? `IP: ${ipAddress}` : 'No IP discovered (DHCP pending).');
  broadcastProvisioningEvent(id, {
    phase: 'post_provision',
    step: ipAddress ? `IP: ${ipAddress}` : 'No IP discovered (DHCP pending).',
    status: 'success'
  });

  // Post-provision: configure SSH root login via pct exec on Proxmox host
  if (req.ssh_enabled !== false) {
    logProvisioningStep(id, 'post_provision', 'running', 'Configuring SSH access...');
    broadcastProvisioningEvent(id, {
      phase: 'post_provision',
      step: 'Configuring SSH access...',
      status: 'running'
    });
    try {
      await configureContainerSsh(vmid);
      logProvisioningStep(id, 'post_provision', 'success', 'SSH configured.');
      broadcastProvisioningEvent(id, {
        phase: 'post_provision',
        step: 'SSH configured.',
        status: 'success'
      });
    } catch (sshErr) {
      console.warn('[spyre] Failed to configure SSH in container:', sshErr);
      // Non-fatal — container is still usable via console
    }
  }

  // Run provisioner pipeline (software pools, community scripts, custom script)
  try {
    await runProvisionerPipeline(id, vmid, ipAddress, rootPassword, req);
  } catch (provErr) {
    console.warn('[spyre] Provisioner pipeline error:', provErr);
    // Non-fatal — container is created and accessible
  }

  const ctx = buildProvisionerContext(id, vmid, ipAddress, rootPassword);

  // Docker provisioning — install Docker and set up project directory
  if (req.docker_enabled) {
    logProvisioningStep(id, 'docker_install', 'running', 'Installing Docker...');
    broadcastProvisioningEvent(id, { phase: 'docker_install', step: 'Installing Docker...', status: 'running' });
    try {
      await ensureDockerInstalled(id);
      logProvisioningStep(id, 'docker_install', 'success', 'Docker installed.');
      broadcastProvisioningEvent(id, { phase: 'docker_install', step: 'Docker installed.', status: 'success' });
    } catch (dockerErr) {
      const msg = dockerErr instanceof Error ? dockerErr.message : String(dockerErr);
      logProvisioningStep(id, 'docker_install', 'error', msg);
      broadcastProvisioningEvent(id, { phase: 'docker_install', step: msg, status: 'error' });
      // Non-fatal — can be retried later
    }
  }

  // Project directory setup — clone repo or init git
  const projectDir = req.project_dir ?? '/project';
  if (req.repo_url || req.docker_enabled) {
    logProvisioningStep(id, 'project_setup', 'running', 'Setting up project directory...');
    broadcastProvisioningEvent(id, { phase: 'project_setup', step: 'Setting up project directory...', status: 'running' });
    try {
      await ctx.exec(`mkdir -p '${projectDir}'`, 10000);
      if (req.repo_url) {
        // Clone repo (with GitHub PAT if configured)
        const gitBranch = req.git_branch ?? 'main';
        const cloneResult = await ctx.exec(
          `git clone --branch '${gitBranch}' '${req.repo_url}' '${projectDir}' 2>&1 || ` +
          `(cd '${projectDir}' && git init && git remote add origin '${req.repo_url}' && git fetch origin '${gitBranch}' && git checkout -b '${gitBranch}' 'origin/${gitBranch}' 2>&1)`,
          120000
        );
        console.log(`[spyre] Repo clone result: exit=${cloneResult.code}`);
      } else {
        // Init empty git repo for docker-enabled environments
        await ctx.exec(`cd '${projectDir}' && git init 2>&1`, 10000);
      }
      // Create .spyre directory in project
      await ctx.exec(`mkdir -p '${projectDir}/.spyre'`, 10000);
      logProvisioningStep(id, 'project_setup', 'success', `Project directory ready at ${projectDir}.`);
      broadcastProvisioningEvent(id, { phase: 'project_setup', step: `Project directory ready at ${projectDir}.`, status: 'success' });
    } catch (projErr) {
      const msg = projErr instanceof Error ? projErr.message : String(projErr);
      logProvisioningStep(id, 'project_setup', 'error', msg);
      broadcastProvisioningEvent(id, { phase: 'project_setup', step: msg, status: 'error' });
    }
  }

  // Look up persona for this environment
  const persona = req.persona_id ? getPersona(req.persona_id) ?? null : null;
  const projectContext = req.repo_url
    ? { repoUrl: req.repo_url, gitBranch: req.git_branch, projectDir: req.project_dir }
    : null;

  // Inject .spyre tracking (always)
  try {
    await injectSpyreTracking(ctx.exec, undefined, persona, projectContext);
  } catch (trackErr) {
    console.warn('[spyre] Spyre tracking injection failed (non-fatal):', trackErr);
  }

  // Write project-level CLAUDE.md into the project directory for docker-enabled environments
  if (req.docker_enabled) {
    try {
      await injectSpyreTracking(ctx.exec, projectDir, persona, projectContext);
    } catch (trackErr) {
      console.warn('[spyre] Project-level CLAUDE.md injection failed (non-fatal):', trackErr);
    }
  }

  // Install Claude CLI if requested (opt-in)
  if (req.install_claude) {
    logProvisioningStep(id, 'claude_install', 'running', 'Installing Claude Code...');
    broadcastProvisioningEvent(id, { phase: 'claude_install', step: 'Installing Claude Code...', status: 'running' });
    try {
      await installClaudeInEnvironment(ctx.exec);
      logProvisioningStep(id, 'claude_install', 'success', 'Claude Code installed.');
      broadcastProvisioningEvent(id, { phase: 'claude_install', step: 'Claude Code installed.', status: 'success' });
    } catch (claudeErr) {
      const msg = claudeErr instanceof Error ? claudeErr.message : String(claudeErr);
      logProvisioningStep(id, 'claude_install', 'error', msg);
      broadcastProvisioningEvent(id, { phase: 'claude_install', step: msg, status: 'error' });
      // Still non-fatal — don't fail the entire provisioning
    }
  }

  // Propagate GitHub auth if repo URL is configured
  if (req.repo_url) {
    try {
      await propagateGitHubAuth(id, persona?.name);
    } catch (ghErr) {
      console.warn('[spyre] GitHub auth propagation failed (non-fatal):', ghErr);
    }
  }

  // Update environment status
  db.prepare(`
    UPDATE environments
    SET status = 'running', ip_address = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(ipAddress, id);

  logProvisioningStep(id, 'complete', 'success', 'Environment ready.');
  broadcastProvisioningEvent(id, {
    phase: 'complete',
    step: 'Environment ready.',
    status: 'success'
  });

  return getEnvironment(id) as Environment;
}

export async function destroyEnvironment(id: string): Promise<void> {
  const db = getDb();
  const env = getEnvironment(id);
  if (!env) {
    throw { code: 'NOT_FOUND', message: 'Environment not found.' };
  }

  if (env.status === 'running') {
    throw { code: 'INVALID_STATE', message: 'Cannot delete a running environment. Stop it first.' };
  }

  if (env.status === 'provisioning') {
    throw { code: 'INVALID_STATE', message: 'Cannot delete an environment while it is provisioning.' };
  }

  db.prepare("UPDATE environments SET status = 'destroying', updated_at = datetime('now') WHERE id = ?")
    .run(id);

  try {
    if (env.vmid && env.node) {
      // Stop first if still running (edge case)
      if (env.status !== 'stopped' && env.status !== 'error') {
        try {
          const stopUpid = await proxmox.stopLxc(env.node, env.vmid);
          await proxmox.waitForTask(env.node, stopUpid, 30000);
        } catch {
          // May already be stopped
        }
      }
      // Try to destroy via Proxmox API — if the CT was never actually created
      // (e.g., template not found, creation failed), this will fail.
      // Treat that as success and proceed with DB cleanup.
      try {
        const upid = await proxmox.destroyLxc(env.node, env.vmid);
        await proxmox.waitForTask(env.node, upid);
      } catch (destroyErr) {
        // If the CT doesn't exist in Proxmox, that's fine — just clean up DB
        const msg = (destroyErr as { message?: string })?.message ?? '';
        console.warn(`[spyre] Proxmox destroy failed for VMID ${env.vmid}: ${msg}`);
        console.warn('[spyre] Proceeding with DB cleanup (CT may not exist in Proxmox).');
      }
    }

    // Remove from DB (and associated provisioning_log entries)
    db.prepare('DELETE FROM provisioning_log WHERE env_id = ?').run(id);
    db.prepare('DELETE FROM environments WHERE id = ?').run(id);
  } catch (err) {
    const message = err instanceof Error ? err.message :
      (err as { message?: string })?.message ?? String(err);
    db.prepare(`
      UPDATE environments
      SET status = 'error', error_message = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(message, id);
    throw err;
  }
}

export async function startEnvironment(id: string): Promise<void> {
  const db = getDb();
  const env = getEnvironment(id);
  if (!env) throw { code: 'NOT_FOUND', message: 'Environment not found.' };
  if (!env.vmid || !env.node) throw { code: 'INVALID_STATE', message: 'Environment has no VMID. It may not have been created in Proxmox.' };
  if (env.status === 'provisioning') throw { code: 'INVALID_STATE', message: 'Cannot start while provisioning.' };

  try {
    const upid = await proxmox.startLxc(env.node, env.vmid);
    await proxmox.waitForTask(env.node, upid);
  } catch (err) {
    const msg = (err as { message?: string })?.message ?? String(err);
    // If the error says it's already running, that's fine
    if (msg.includes('already running')) {
      // Just update status
    } else {
      throw err;
    }
  }

  // Re-discover IP if missing
  let ipAddress = env.ip_address;
  if (!ipAddress) {
    ipAddress = await proxmox.discoverLxcIp(env.node, env.vmid);
  }

  db.prepare(`
    UPDATE environments SET status = 'running', ip_address = ?, updated_at = datetime('now') WHERE id = ?
  `).run(ipAddress, id);
}

export async function stopEnvironment(id: string): Promise<void> {
  const db = getDb();
  const env = getEnvironment(id);
  if (!env) throw { code: 'NOT_FOUND', message: 'Environment not found.' };
  if (!env.vmid || !env.node) throw { code: 'INVALID_STATE', message: 'Environment has no VMID. It may not have been created in Proxmox.' };
  if (env.status === 'provisioning') throw { code: 'INVALID_STATE', message: 'Cannot stop while provisioning.' };

  try {
    const upid = await proxmox.stopLxc(env.node, env.vmid);
    await proxmox.waitForTask(env.node, upid);
  } catch (err) {
    const msg = (err as { message?: string })?.message ?? String(err);
    // If already stopped, that's fine
    if (msg.includes('already stopped') || msg.includes('not running')) {
      // Just update status
    } else {
      throw err;
    }
  }

  db.prepare("UPDATE environments SET status = 'stopped', updated_at = datetime('now') WHERE id = ?")
    .run(id);
}

export async function syncEnvironmentStatuses(): Promise<void> {
  const db = getDb();
  const config = getEnvConfig();
  const environments = listEnvironments();

  for (const env of environments) {
    // Skip environments that:
    // - have no VMID (not yet created in Proxmox)
    // - are in transitional states (pending, provisioning, destroying)
    // - are in error state (VMID may be stale from a failed provisioning)
    if (!env.vmid || env.status === 'pending' || env.status === 'provisioning' || env.status === 'destroying' || env.status === 'error') {
      continue;
    }
    try {
      const lxcStatus = await proxmox.getLxcStatus(config.proxmox.node_name, env.vmid);
      const newStatus = lxcStatus.status === 'running' ? 'running' : 'stopped';
      if (env.status !== newStatus) {
        db.prepare("UPDATE environments SET status = ?, updated_at = datetime('now') WHERE id = ?")
          .run(newStatus, env.id);
      }
    } catch {
      // Container may have been removed externally
    }
  }
}
