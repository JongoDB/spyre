import { v4 as uuid } from 'uuid';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { getDb } from './db';
import { getEnvConfig, getProxmoxTokenSecret } from './env-config';
import * as proxmox from './proxmox';
import type { Environment, CreateEnvironmentRequest } from '$lib/types/environment';

function generatePassword(length = 16): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%&*';
  const bytes = randomBytes(length);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

async function configureContainerSsh(node: string, vmid: number): Promise<void> {
  // Use Proxmox API to write a file and exec commands inside the container.
  // We configure sshd to allow root login with password.
  const commands = [
    // Enable root login
    "sed -i -e 's/^#\\?PermitRootLogin.*/PermitRootLogin yes/' /etc/ssh/sshd_config",
    // Enable password auth
    "sed -i -e 's/^#\\?PasswordAuthentication.*/PasswordAuthentication yes/' /etc/ssh/sshd_config",
    // Remove cloud-init SSH overrides if present
    "rm -f /etc/ssh/sshd_config.d/60-cloudimg-settings.conf",
    // Restart SSH (try both service names)
    "systemctl restart sshd 2>/dev/null || systemctl restart ssh 2>/dev/null || service ssh restart 2>/dev/null || true"
  ];

  const config = getEnvConfig();
  const pveHost = config.proxmox.host;
  const pvePort = config.proxmox.port;
  const tokenId = config.proxmox.token_id;
  const tokenSecret = getProxmoxTokenSecret();

  // Use Proxmox API's POST /nodes/{node}/lxc/{vmid}/exec (PVE 8+)
  // If that fails, fall back to SSH via the Proxmox host
  for (const cmd of commands) {
    try {
      // Try the Proxmox exec API endpoint (available in PVE 8+)
      await proxmox.proxmoxExec(node, vmid, cmd);
    } catch {
      // If exec API isn't available, try alternative: use curl to the API from controller
      // This is a best-effort approach
      console.warn(`[spyre] Could not exec command in container ${vmid}, trying alternative...`);
      try {
        // Shell out to curl for the Proxmox API exec endpoint
        const curlUrl = `https://${pveHost}:${pvePort}/api2/json/nodes/${node}/lxc/${vmid}/exec`;
        execFileSync('curl', [
          '-sk', '-X', 'POST',
          '-H', `Authorization: PVEAPIToken=${tokenId}=${tokenSecret}`,
          '-d', `command=${encodeURIComponent(cmd)}`,
          curlUrl
        ], { timeout: 10000 });
      } catch {
        // Last resort: just log and continue — SSH may still work for many templates
        console.warn(`[spyre] All exec methods failed for container ${vmid}, SSH config may need manual setup`);
        break;
      }
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
  const bridge = req.bridge ?? config.defaults.bridge;
  const storage = req.storage ?? config.defaults.storage;
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
        const { readFileSync } = await import('node:fs');
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
    db.prepare('UPDATE environments SET vmid = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(vmid, id);

    // Wait for Proxmox task to complete
    await proxmox.waitForTask(node, upid);

    // Discover IP address
    const ipAddress = await proxmox.discoverLxcIp(node, vmid);

    // Post-provision: configure SSH root login via pct exec on the Proxmox host
    if (req.ssh_enabled !== false) {
      try {
        await configureContainerSsh(node, vmid);
      } catch (sshErr) {
        console.warn('[spyre] Failed to configure SSH in container:', sshErr);
        // Non-fatal — container is still usable via password on console
      }
    }

    // Update environment status
    db.prepare(`
      UPDATE environments
      SET status = 'running', ip_address = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(ipAddress, id);

    return getEnvironment(id) as Environment;
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

export async function destroyEnvironment(id: string): Promise<void> {
  const db = getDb();
  const env = getEnvironment(id);
  if (!env) {
    throw { code: 'NOT_FOUND', message: 'Environment not found.' };
  }

  db.prepare("UPDATE environments SET status = 'destroying', updated_at = datetime('now') WHERE id = ?")
    .run(id);

  try {
    if (env.vmid && env.node) {
      // Stop first if running
      if (env.status === 'running') {
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
