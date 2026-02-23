import { v4 as uuid } from 'uuid';
import { getDb } from './db';
import { getEnvConfig } from './env-config';
import * as proxmox from './proxmox';
import type { Environment, CreateEnvironmentRequest } from '$lib/types/environment';

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

  // Insert pending environment into DB first
  db.prepare(`
    INSERT INTO environments (id, name, type, status, node, ssh_user)
    VALUES (?, ?, ?, 'provisioning', ?, ?)
  `).run(id, req.name, req.type, node, sshUser);

  try {
    // Get next available VMID
    const vmid = await proxmox.getNextVmid();

    // Build network config
    const ip = req.ip ?? 'dhcp';
    const net0 = ip === 'dhcp'
      ? `name=eth0,bridge=${bridge},ip=dhcp`
      : `name=eth0,bridge=${bridge},ip=${ip},gw=${config.defaults.gateway}`;

    // Read SSH public key for injection
    let sshPubKey: string | undefined;
    try {
      const { readFileSync } = await import('node:fs');
      const keyPath = config.controller.ssh_key_path.replace('~', process.env.HOME ?? '');
      sshPubKey = readFileSync(`${keyPath}.pub`, 'utf-8').trim();
    } catch {
      // No SSH key available — proceed without
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
      sshPublicKeys: sshPubKey
    });

    // Update DB with VMID
    db.prepare('UPDATE environments SET vmid = ?, updated_at = datetime(\'now\') WHERE id = ?')
      .run(vmid, id);

    // Wait for Proxmox task to complete
    await proxmox.waitForTask(node, upid);

    // Discover IP address
    const ipAddress = await proxmox.discoverLxcIp(node, vmid);

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
