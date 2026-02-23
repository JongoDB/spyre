import { readFileSync } from 'node:fs';
import { Client as SshClient } from 'ssh2';
import { getEnvConfig } from './env-config';
import { getEnvironment } from './environments';

interface PoolEntry {
  client: SshClient;
  host: string;
  ready: boolean;
}

const pool = new Map<string, PoolEntry>();

function readPrivateKey(): Buffer {
  const config = getEnvConfig();
  const keyPath = config.controller.ssh_key_path.replace('~', process.env.HOME ?? '');
  try {
    return readFileSync(keyPath);
  } catch {
    throw new Error(`SSH key not found at ${keyPath}. Run setup.sh to generate it.`);
  }
}

export function getConnection(envId: string): Promise<SshClient> {
  const env = getEnvironment(envId);
  if (!env) {
    return Promise.reject(new Error(`Environment ${envId} not found`));
  }
  if (!env.ip_address) {
    return Promise.reject(new Error(`Environment ${envId} has no IP address`));
  }

  const host = env.ip_address;
  const port = env.ssh_port || 22;
  const user = env.ssh_user || 'root';

  // Parse password from metadata
  let password: string | undefined;
  if (env.metadata) {
    try {
      const meta = JSON.parse(env.metadata);
      password = meta.root_password;
    } catch {
      // ignore parse errors
    }
  }

  // If cached entry exists and host matches, return it
  const existing = pool.get(envId);
  if (existing && existing.ready && existing.host === host) {
    return Promise.resolve(existing.client);
  }

  // If cached entry host differs, close old connection
  if (existing) {
    try { existing.client.end(); } catch { /* ignore */ }
    pool.delete(envId);
  }

  return new Promise((resolve, reject) => {
    const client = new SshClient();
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        client.end();
        pool.delete(envId);
        reject(new Error(`SSH connection to ${host}:${port} timed out`));
      }
    }, 10_000);

    client.on('ready', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const entry: PoolEntry = { client, host, ready: true };
      pool.set(envId, entry);
      resolve(client);
    });

    client.on('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        pool.delete(envId);
        reject(err);
      }
    });

    client.on('close', () => {
      const entry = pool.get(envId);
      if (entry?.client === client) {
        pool.delete(envId);
      }
    });

    client.on('end', () => {
      const entry = pool.get(envId);
      if (entry?.client === client) {
        pool.delete(envId);
      }
    });

    // Build auth methods: try key first, then password
    let privateKey: Buffer | undefined;
    try {
      privateKey = readPrivateKey();
    } catch {
      // Key not available — rely on password
    }

    client.connect({
      host,
      port,
      username: user,
      privateKey,
      password,
      keepaliveInterval: 30_000,
      keepaliveCountMax: 5,
      readyTimeout: 10_000,
      hostVerifier: () => true,
    } as Parameters<typeof client.connect>[0]);
  });
}

export function closeConnection(envId: string): void {
  const entry = pool.get(envId);
  if (entry) {
    try { entry.client.end(); } catch { /* ignore */ }
    pool.delete(envId);
  }
}

export function closeAll(): void {
  for (const [envId, entry] of pool) {
    try { entry.client.end(); } catch { /* ignore */ }
    pool.delete(envId);
  }
}
