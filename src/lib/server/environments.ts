import { v4 as uuid } from 'uuid';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Client as SshClient } from 'ssh2';
import { getDb } from './db';
import { getEnvConfig } from './env-config';
import * as proxmox from './proxmox';
import { getPool } from './software-pools';
import { getScript } from './community-scripts';
import type { Environment, CreateEnvironmentRequest } from '$lib/types/environment';
import type { SoftwarePoolItem } from '$lib/types/template';
import type { CommunityScript, CommunityScriptInstallMethod } from '$lib/types/community-script';

function generatePassword(length = 16): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%&*';
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
function sshToProxmox(command: string, timeoutMs = 30000): Promise<{ code: number; stdout: string; stderr: string }> {
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
// Provisioner Pipeline
// =============================================================================

function logProvisioningStep(
  envId: string,
  phase: string,
  status: 'running' | 'success' | 'error',
  message: string
) {
  const db = getDb();
  // Map friendly names to schema-valid status values
  const dbStatus = status === 'running' ? 'running' : status === 'error' ? 'error' : 'success';
  db.prepare(`
    INSERT INTO provisioning_log (env_id, phase, step, status, output, started_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `).run(envId, phase, message, dbStatus, null);
}

/**
 * Detect the package manager available inside the container.
 */
async function detectPackageManager(vmid: number, ip: string | null, password: string): Promise<'apt' | 'apk' | 'yum' | 'dnf' | null> {
  for (const pm of ['apt', 'apk', 'dnf', 'yum'] as const) {
    try {
      const result = await containerExec(vmid, ip, password, `which ${pm} 2>/dev/null`);
      if (result.code === 0 && result.stdout.trim()) return pm;
    } catch {
      // continue
    }
  }
  return null;
}

/**
 * Install packages inside the container using the detected package manager.
 */
async function installPackages(vmid: number, ip: string | null, password: string, packages: string): Promise<{ code: number; stdout: string; stderr: string }> {
  const pm = await detectPackageManager(vmid, ip, password);
  if (!pm) {
    return { code: 1, stdout: '', stderr: 'No package manager found (apt/apk/dnf/yum)' };
  }

  let cmd: string;
  switch (pm) {
    case 'apt':
      cmd = `DEBIAN_FRONTEND=noninteractive apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ${packages}`;
      break;
    case 'apk':
      cmd = `apk add --no-cache ${packages}`;
      break;
    case 'dnf':
      cmd = `dnf install -y ${packages}`;
      break;
    case 'yum':
      cmd = `yum install -y ${packages}`;
      break;
  }

  return containerExec(vmid, ip, password, cmd, 120000);
}

/**
 * Execute a single software pool item inside the container.
 */
async function executeSoftwarePoolItem(
  vmid: number,
  ip: string | null,
  password: string,
  item: SoftwarePoolItem
): Promise<void> {
  const label = item.label || item.content.slice(0, 50);

  switch (item.item_type) {
    case 'package': {
      console.log(`[spyre] Installing packages: ${item.content}`);
      const result = await installPackages(vmid, ip, password, item.content);
      if (result.code !== 0) {
        console.warn(`[spyre] Package install warning: ${result.stderr.slice(0, 200)}`);
      }
      break;
    }
    case 'script': {
      console.log(`[spyre] Running script: ${label}`);
      const result = await containerExec(vmid, ip, password, item.content, 120000);
      if (result.code !== 0) {
        console.warn(`[spyre] Script exited with code ${result.code}: ${result.stderr.slice(0, 200)}`);
      }
      break;
    }
    case 'file': {
      const dest = item.destination || '/tmp/spyre-file';
      console.log(`[spyre] Writing file to ${dest}`);
      const writeCmd = `mkdir -p "$(dirname '${dest}')" && cat > '${dest}' << 'SPYRE_EOF'\n${item.content}\nSPYRE_EOF`;
      const result = await containerExec(vmid, ip, password, writeCmd, 30000);
      if (result.code !== 0) {
        console.warn(`[spyre] File write failed: ${result.stderr.slice(0, 200)}`);
      }
      break;
    }
  }

  // Run post_command if specified
  if (item.post_command) {
    console.log(`[spyre] Running post-command: ${item.post_command.slice(0, 50)}`);
    const result = await containerExec(vmid, ip, password, item.post_command, 60000);
    if (result.code !== 0) {
      console.warn(`[spyre] Post-command exited with code ${result.code}: ${result.stderr.slice(0, 200)}`);
    }
  }
}

/**
 * Create a non-root user inside the container with sudo access.
 */
async function createDefaultUser(
  vmid: number,
  ip: string | null,
  rootPassword: string,
  username: string
): Promise<void> {
  console.log(`[spyre] Creating default user: ${username}`);

  const commands = [
    `id ${username} 2>/dev/null || useradd -m -s /bin/bash ${username}`,
    `echo '${username}:${rootPassword}' | chpasswd`,
    `which sudo >/dev/null 2>&1 || (apt-get update -qq && apt-get install -y -qq sudo 2>/dev/null) || apk add sudo 2>/dev/null || yum install -y sudo 2>/dev/null || true`,
    `usermod -aG sudo ${username} 2>/dev/null || usermod -aG wheel ${username} 2>/dev/null || true`,
    `echo '${username} ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/${username} && chmod 440 /etc/sudoers.d/${username}`,
    `if [ -f /root/.ssh/authorized_keys ]; then mkdir -p /home/${username}/.ssh && cp /root/.ssh/authorized_keys /home/${username}/.ssh/ && chown -R ${username}:${username} /home/${username}/.ssh && chmod 700 /home/${username}/.ssh && chmod 600 /home/${username}/.ssh/authorized_keys; fi`
  ];

  for (const cmd of commands) {
    try {
      const result = await containerExec(vmid, ip, rootPassword, cmd, 30000);
      if (result.code !== 0 && result.stderr) {
        console.warn(`[spyre] User creation step warning: ${result.stderr.slice(0, 200)}`);
      }
    } catch (err) {
      console.warn(`[spyre] User creation step failed:`, err);
    }
  }

  console.log(`[spyre] Default user '${username}' created with sudo access`);
}

/**
 * Run the full provisioner pipeline after container creation.
 * Pipeline order: software pools -> community script -> custom script -> default user
 */
async function runProvisionerPipeline(
  envId: string,
  vmid: number,
  ip: string | null,
  rootPassword: string,
  req: CreateEnvironmentRequest
): Promise<void> {
  const db = getDb();

  // 1. Software Pools
  if (req.software_pool_ids && req.software_pool_ids.length > 0) {
    logProvisioningStep(envId, 'software_pool', 'running', 'Installing software pools...');
    try {
      for (const poolId of req.software_pool_ids) {
        const pool = getPool(poolId);
        if (!pool) {
          console.warn(`[spyre] Software pool ${poolId} not found — skipping`);
          continue;
        }

        console.log(`[spyre] Executing software pool: ${pool.name} (${pool.items.length} items)`);
        for (const item of pool.items) {
          await executeSoftwarePoolItem(vmid, ip, rootPassword, item);
        }
      }
      logProvisioningStep(envId, 'software_pool', 'success', 'Software pools installed.');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logProvisioningStep(envId, 'software_pool', 'error', msg);
      console.warn('[spyre] Software pool execution error:', msg);
    }
  }

  // 2. Community Script
  if (req.community_script_slug) {
    logProvisioningStep(envId, 'community_script', 'running', `Installing community script: ${req.community_script_slug}`);
    try {
      const script = getScript(req.community_script_slug);
      if (script && script.install_methods.length > 0) {
        const method = script.install_methods[0];
        if (method.script) {
          const scriptUrl = `https://raw.githubusercontent.com/community-scripts/ProxmoxVE/main/${method.script}`;
          console.log(`[spyre] Downloading and executing community script: ${scriptUrl}`);

          const result = await containerExec(
            vmid, ip, rootPassword,
            `bash -c "$(curl -fsSL '${scriptUrl}')"`,
            300000
          );

          if (result.code !== 0) {
            console.warn(`[spyre] Community script exited with code ${result.code}: ${result.stderr.slice(0, 500)}`);
            logProvisioningStep(envId, 'community_script', 'error', `Script exited with code ${result.code}`);
          } else {
            logProvisioningStep(envId, 'community_script', 'success', `Community script installed.`);
          }
        } else {
          logProvisioningStep(envId, 'community_script', 'error', 'No install script URL found in script metadata.');
        }
      } else {
        logProvisioningStep(envId, 'community_script', 'error', `Community script '${req.community_script_slug}' not found in cache.`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logProvisioningStep(envId, 'community_script', 'error', msg);
      console.warn('[spyre] Community script execution error:', msg);
    }
  }

  // 3. Custom Script
  if (req.custom_script) {
    logProvisioningStep(envId, 'custom_script', 'running', 'Running custom provisioning script...');
    try {
      console.log(`[spyre] Running custom script (${req.custom_script.length} chars)`);
      const result = await containerExec(vmid, ip, rootPassword, req.custom_script, 300000);
      if (result.code !== 0) {
        console.warn(`[spyre] Custom script exited with code ${result.code}: ${result.stderr.slice(0, 500)}`);
        logProvisioningStep(envId, 'custom_script', 'error', `Script exited with code ${result.code}`);
      } else {
        logProvisioningStep(envId, 'custom_script', 'success', 'Custom script completed.');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logProvisioningStep(envId, 'custom_script', 'error', msg);
      console.warn('[spyre] Custom script execution error:', msg);
    }
  }

  // 4. Default User
  if (req.default_user) {
    logProvisioningStep(envId, 'post_provision', 'running', `Creating default user: ${req.default_user}`);
    try {
      await createDefaultUser(vmid, ip, rootPassword, req.default_user);
      logProvisioningStep(envId, 'post_provision', 'success', `Default user '${req.default_user}' created.`);

      const env = getEnvironment(envId);
      if (env?.metadata) {
        const meta = JSON.parse(env.metadata);
        meta.default_user = req.default_user;
        db.prepare("UPDATE environments SET metadata = ?, updated_at = datetime('now') WHERE id = ?")
          .run(JSON.stringify(meta), envId);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logProvisioningStep(envId, 'post_provision', 'error', msg);
      console.warn('[spyre] Default user creation error:', msg);
    }
  }
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
 * Build the full bash command to run a community script on the Proxmox host.
 * Sets mode=default + all var_* env vars to bypass the interactive TUI.
 */
function buildCommunityScriptCommand(
  script: CommunityScript,
  method: CommunityScriptInstallMethod,
  req: CreateEnvironmentRequest,
  config: ReturnType<typeof getEnvConfig>,
  templateStorage: string,
  sshPubKey: string | undefined
): string {
  const containerStorage = req.storage ?? config.defaults.storage;
  const bridge = req.bridge ?? config.defaults.bridge;
  const dns = req.nameserver ?? config.defaults.dns ?? '8.8.8.8';
  const gateway = config.defaults.gateway ?? '';
  const password = req.password || generatePassword();

  // Build var_* exports
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
    var_gateway: gateway,
    var_ns: dns,
    var_pw: password,
    var_ssh: req.ssh_enabled !== false ? 'yes' : 'no',
    var_container_storage: containerStorage,
    var_template_storage: templateStorage,
    var_hostname: req.name,
    var_verbose: 'no',
    var_tags: `spyre`,
    var_timezone: 'host',
  };

  if (sshPubKey) {
    vars.var_ssh_authorized_key = sshPubKey;
  }

  // Build the script URL
  const scriptPath = method.script;
  const scriptUrl = `https://raw.githubusercontent.com/community-scripts/ProxmoxVE/main/${scriptPath}`;

  // Assemble command
  const exportLines = Object.entries(vars)
    .map(([k, v]) => `export ${k}='${v.replace(/'/g, "'\\''")}'`)
    .join('; ');

  return [
    "mkdir -p /usr/local/community-scripts",
    "echo 'DIAGNOSTICS=no' > /usr/local/community-scripts/diagnostics",
    "export mode=default",
    exportLines,
    `yes '' | bash -c "$(curl -fsSL '${scriptUrl}')" 2>&1`
  ].join('; ');
}

/**
 * Parse the CTID from community script output.
 * The scripts log recognizable patterns when creating containers.
 */
function parseCTIDFromOutput(output: string): number | null {
  // Try various patterns that build.func outputs
  const patterns = [
    /pct create (\d+)/,
    /Container ID[:\s]+(\d+)/i,
    /Using ID[:\s]+(\d+)/i,
    /LXC_ID[=:\s]+(\d+)/i,
    /CTID[=:\s]+(\d+)/i,
  ];

  for (const pattern of patterns) {
    const match = output.match(pattern);
    if (match) {
      return parseInt(match[1], 10);
    }
  }

  return null;
}

/**
 * Run a community script on the Proxmox host via SSH.
 */
async function runCommunityScriptOnHost(
  command: string,
  timeoutMs = 900000
): Promise<{ code: number; stdout: string; stderr: string }> {
  return sshToProxmox(command, timeoutMs);
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
  const command = buildCommunityScriptCommand(script, method, req, config, templateStorage, sshPubKey);

  // Log and execute
  logProvisioningStep(id, 'community_script', 'running', `Running ${script.name} on Proxmox host...`);
  console.log(`[spyre] Running community script '${script.name}' (method: ${method.type}) on Proxmox host`);

  const result = await runCommunityScriptOnHost(command);
  const fullOutput = result.stdout + result.stderr;

  if (result.code !== 0) {
    logProvisioningStep(id, 'community_script', 'error', `Script exited with code ${result.code}`);
    console.warn(`[spyre] Community script failed (exit ${result.code}):`, result.stderr.slice(0, 500));
    throw { code: 'SCRIPT_FAILED', message: `Community script '${script.name}' failed with exit code ${result.code}.` };
  }

  logProvisioningStep(id, 'community_script', 'success', `${script.name} installed successfully.`);

  // Parse CTID from output
  let vmid = parseCTIDFromOutput(fullOutput);

  // Fallback: query Proxmox API for containers matching hostname
  if (!vmid) {
    console.log('[spyre] CTID not found in output, querying Proxmox API...');
    try {
      const containers = await proxmox.listLxc(node);
      const match = containers.find(c =>
        c.name === req.name || (c.tags && c.tags.includes('spyre'))
      );
      if (match) {
        vmid = match.vmid;
        console.log(`[spyre] Found matching container via API: VMID ${vmid}`);
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
    INSERT INTO environments (id, name, type, status, node, ssh_user, metadata)
    VALUES (?, ?, ?, 'provisioning', ?, ?, ?)
  `).run(id, req.name, req.type, node, sshUser, JSON.stringify(metadata));

  try {
    // Route to community script path or standard Proxmox API path
    if (req.community_script_slug) {
      return await createViaCommunityScript(id, req, rootPassword, metadata);
    }
    return await createViaProxmoxApi(id, req, rootPassword, node);
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

  // Get next available VMID
  const vmid = await proxmox.getNextVmid();

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
  const unprivileged = req.unprivileged !== false;
  const nesting = req.nesting !== false;
  const features = nesting ? 'nesting=1' : undefined;

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

  // Create LXC via Proxmox API
  const upid = await proxmox.createLxc(node, {
    vmid,
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
    onboot: false
  });

  // Update DB with VMID
  db.prepare("UPDATE environments SET vmid = ?, updated_at = datetime('now') WHERE id = ?")
    .run(vmid, id);

  // Wait for Proxmox task to complete
  await proxmox.waitForTask(node, upid);

  // Discover IP address
  const ipAddress = await proxmox.discoverLxcIp(node, vmid);

  // Post-provision: configure SSH root login via pct exec on Proxmox host
  if (req.ssh_enabled !== false) {
    try {
      await configureContainerSsh(vmid);
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

  // Update environment status
  db.prepare(`
    UPDATE environments
    SET status = 'running', ip_address = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(ipAddress, id);

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
      const upid = await proxmox.destroyLxc(env.node, env.vmid);
      await proxmox.waitForTask(env.node, upid);
    }

    // Remove from DB
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
  if (!env.vmid || !env.node) throw { code: 'INVALID_STATE', message: 'Environment has no VMID.' };

  const upid = await proxmox.startLxc(env.node, env.vmid);
  await proxmox.waitForTask(env.node, upid);

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
  if (!env.vmid || !env.node) throw { code: 'INVALID_STATE', message: 'Environment has no VMID.' };

  const upid = await proxmox.stopLxc(env.node, env.vmid);
  await proxmox.waitForTask(env.node, upid);

  db.prepare("UPDATE environments SET status = 'stopped', updated_at = datetime('now') WHERE id = ?")
    .run(id);
}

export async function syncEnvironmentStatuses(): Promise<void> {
  const db = getDb();
  const config = getEnvConfig();
  const environments = listEnvironments();

  for (const env of environments) {
    if (!env.vmid || env.status === 'pending' || env.status === 'provisioning' || env.status === 'destroying') {
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
