import { getEnvConfig, getProxmoxTokenSecret } from './env-config';
import type {
  ProxmoxVersion,
  ProxmoxNode,
  ProxmoxLxc,
  ProxmoxLxcStatus,
  ProxmoxLxcConfig,
  ProxmoxStorageContent,
  ProxmoxStorage,
  ProxmoxNetworkInterface,
  ProxmoxTaskStatus,
  ProxmoxApiResponse,
  ProxmoxApiError
} from '$lib/types/proxmox';

// For self-signed Proxmox certs: set at module load when verify_ssl is false.
// This is the standard Node.js approach for self-signed certs with native fetch.
let _tlsConfigured = false;
function ensureTlsConfig(): void {
  if (_tlsConfigured) return;
  _tlsConfigured = true;
  const config = getEnvConfig();
  if (!config.proxmox.verify_ssl) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }
}

function getBaseUrl(): string {
  const config = getEnvConfig();
  return `https://${config.proxmox.host}:${config.proxmox.port}/api2/json`;
}

function getAuthHeader(): string {
  const config = getEnvConfig();
  const secret = getProxmoxTokenSecret();
  return `PVEAPIToken=${config.proxmox.token_id}=${secret}`;
}

async function proxmoxFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  ensureTlsConfig();

  const url = `${getBaseUrl()}${path}`;
  const headers: Record<string, string> = {
    Authorization: getAuthHeader(),
    ...(options.headers as Record<string, string> ?? {})
  };

  let response: Response;
  try {
    response = await fetch(url, { ...options, headers });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const config = getEnvConfig();
    if (message.includes('ECONNREFUSED')) {
      throw createError('CONNECTION_REFUSED',
        `Cannot reach Proxmox at ${config.proxmox.host}:${config.proxmox.port} (connection refused). ` +
        'Verify the Proxmox host IP and port in environment.yaml, and ensure the Proxmox web interface is running.'
      );
    }
    if (message.includes('ETIMEDOUT') || message.includes('timeout')) {
      throw createError('TIMEOUT',
        `Connection to Proxmox at ${config.proxmox.host}:${config.proxmox.port} timed out. ` +
        'Check network connectivity between the controller and the Proxmox host.'
      );
    }
    throw createError('NETWORK_ERROR',
      `Network error connecting to Proxmox at ${config.proxmox.host}:${config.proxmox.port}: ${message}`
    );
  }

  if (response.status === 401) {
    const config = getEnvConfig();
    throw createError('AUTH_FAILED',
      `Proxmox authentication failed for token "${config.proxmox.token_id}" on ${config.proxmox.host}. ` +
      'Verify the token exists in Proxmox (Datacenter → Permissions → API Tokens) and that SPYRE_PVE_TOKEN_SECRET in .env matches the token secret.'
    );
  }
  if (response.status === 403) {
    const body = await response.text().catch(() => '');
    const config = getEnvConfig();
    let detail = '';
    try {
      const parsed = JSON.parse(body);
      // Proxmox returns "permission check failed" or specific privilege info
      if (parsed.errors) {
        detail = ` (${Object.values(parsed.errors).join('; ')})`;
      } else if (typeof parsed.data === 'string') {
        detail = ` (${parsed.data})`;
      }
    } catch {
      if (body && body.length < 300) detail = ` (${body.trim()})`;
    }
    throw createError('FORBIDDEN',
      `Proxmox API token "${config.proxmox.token_id}" lacks privileges for ${path}${detail}. ` +
      'Fix: On the Proxmox host, run: pveum user token remove root@pam <token-name> && ' +
      'pveum user token add root@pam <token-name> --privsep 0 — then update the secret in .env. ' +
      'The --privsep 0 flag lets the token inherit full root privileges.'
    );
  }
  if (response.status === 500) {
    const body = await response.text().catch(() => '');
    // Try to extract a meaningful error message from the Proxmox response
    let detail = 'internal server error';
    try {
      const parsed = JSON.parse(body);
      if (parsed.errors) {
        detail = Object.values(parsed.errors).join('; ');
      } else if (parsed.data) {
        detail = String(parsed.data);
      }
    } catch {
      if (body) detail = body.slice(0, 500);
    }
    throw createError('PROXMOX_ERROR', `Proxmox internal error on ${path}: ${detail}`);
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    let detail = body;
    try {
      const parsed = JSON.parse(body);
      if (parsed.errors) detail = Object.values(parsed.errors).join('; ');
      else if (parsed.message) detail = parsed.message;
    } catch { /* use raw body */ }
    throw createError('API_ERROR', `Proxmox API error (HTTP ${response.status}) on ${path}: ${detail}`);
  }

  const json = await response.json() as ProxmoxApiResponse<T>;
  return json.data;
}

function createError(code: string, message: string, details?: unknown): ProxmoxApiError {
  return { code, message, details };
}

// --- Authentication ---

export async function authenticate(): Promise<ProxmoxVersion> {
  return proxmoxFetch<ProxmoxVersion>('/version');
}

// --- Nodes ---

export async function listNodes(): Promise<ProxmoxNode[]> {
  return proxmoxFetch<ProxmoxNode[]>('/nodes');
}

// --- LXC Containers ---

export async function listLxc(node: string): Promise<ProxmoxLxc[]> {
  return proxmoxFetch<ProxmoxLxc[]>(`/nodes/${encodeURIComponent(node)}/lxc`);
}

export async function getLxcStatus(node: string, vmid: number): Promise<ProxmoxLxcStatus> {
  return proxmoxFetch<ProxmoxLxcStatus>(
    `/nodes/${encodeURIComponent(node)}/lxc/${vmid}/status/current`
  );
}

export async function getLxcConfig(node: string, vmid: number): Promise<ProxmoxLxcConfig> {
  return proxmoxFetch<ProxmoxLxcConfig>(
    `/nodes/${encodeURIComponent(node)}/lxc/${vmid}/config`
  );
}

export interface CreateLxcConfig {
  vmid: number;
  hostname: string;
  ostemplate: string;
  cores: number;
  memory: number;
  rootfs: string;
  net0: string;
  start?: boolean;
  sshPublicKeys?: string;
  password?: string;
  swap?: number;
  nameserver?: string;
  searchdomain?: string;
  unprivileged?: boolean;
  features?: string;
  timezone?: string;
  onboot?: boolean;
  mountpoints?: Array<{ hostPath: string; containerPath: string; readonly?: boolean }>;
}

export async function createLxc(
  node: string,
  config: CreateLxcConfig
): Promise<string> {
  const body = new URLSearchParams();
  body.set('vmid', String(config.vmid));
  body.set('hostname', config.hostname);
  body.set('ostemplate', config.ostemplate);
  body.set('cores', String(config.cores));
  body.set('memory', String(config.memory));
  body.set('rootfs', config.rootfs);
  body.set('net0', config.net0);
  if (config.start !== false) {
    body.set('start', '1');
  }
  if (config.sshPublicKeys) {
    body.set('ssh-public-keys', config.sshPublicKeys);
  }
  if (config.password) {
    body.set('password', config.password);
  }
  if (config.swap != null) {
    body.set('swap', String(config.swap));
  }
  if (config.nameserver) {
    body.set('nameserver', config.nameserver);
  }
  if (config.searchdomain) {
    body.set('searchdomain', config.searchdomain);
  }
  if (config.unprivileged != null) {
    body.set('unprivileged', config.unprivileged ? '1' : '0');
  }
  if (config.features) {
    body.set('features', config.features);
  }
  if (config.timezone) {
    body.set('timezone', config.timezone);
  }
  if (config.onboot != null) {
    body.set('onboot', config.onboot ? '1' : '0');
  }
  if (config.mountpoints) {
    config.mountpoints.forEach((mp, i) => {
      const ro = mp.readonly ? ',ro=1' : '';
      body.set(`mp${i}`, `${mp.hostPath},mp=${mp.containerPath}${ro}`);
    });
  }

  return proxmoxFetch<string>(`/nodes/${encodeURIComponent(node)}/lxc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });
}

export async function destroyLxc(node: string, vmid: number): Promise<string> {
  return proxmoxFetch<string>(
    `/nodes/${encodeURIComponent(node)}/lxc/${vmid}?purge=1`,
    { method: 'DELETE' }
  );
}

export async function startLxc(node: string, vmid: number): Promise<string> {
  return proxmoxFetch<string>(
    `/nodes/${encodeURIComponent(node)}/lxc/${vmid}/status/start`,
    { method: 'POST' }
  );
}

export async function stopLxc(node: string, vmid: number): Promise<string> {
  return proxmoxFetch<string>(
    `/nodes/${encodeURIComponent(node)}/lxc/${vmid}/status/stop`,
    { method: 'POST' }
  );
}

// --- VMs ---

export async function listVm(node: string): Promise<ProxmoxLxc[]> {
  return proxmoxFetch<ProxmoxLxc[]>(`/nodes/${encodeURIComponent(node)}/qemu`);
}

// --- Cluster ---

export async function getNextVmid(): Promise<number> {
  const raw = await proxmoxFetch<string>('/cluster/nextid');
  return parseInt(String(raw), 10);
}

// --- Storage ---

export async function listStorage(node: string): Promise<ProxmoxStorage[]> {
  return proxmoxFetch<ProxmoxStorage[]>(
    `/nodes/${encodeURIComponent(node)}/storage`
  );
}

export async function listTemplates(node: string, storage: string): Promise<ProxmoxStorageContent[]> {
  return proxmoxFetch<ProxmoxStorageContent[]>(
    `/nodes/${encodeURIComponent(node)}/storage/${encodeURIComponent(storage)}/content?content=vztmpl`
  );
}

/**
 * Find all OS templates (vztmpl) across all storages on a node.
 * Queries each storage that supports 'vztmpl' content type.
 */
export async function listAllOsTemplates(node: string): Promise<ProxmoxStorageContent[]> {
  const storages = await listStorage(node);
  // Filter storages that can hold vztmpl content
  const templateStorages = storages.filter(s =>
    s.content?.includes('vztmpl')
  );

  const results: ProxmoxStorageContent[] = [];
  for (const s of templateStorages) {
    try {
      const contents = await proxmoxFetch<ProxmoxStorageContent[]>(
        `/nodes/${encodeURIComponent(node)}/storage/${encodeURIComponent(s.storage)}/content?content=vztmpl`
      );
      results.push(...contents);
    } catch {
      // Storage may be unavailable — skip
    }
  }
  return results;
}

// --- Network (bridges) ---

export interface ProxmoxBridge {
  iface: string;
  type: string;
  active: number;
  method: string;
  address?: string;
  netmask?: string;
  gateway?: string;
  bridge_ports?: string;
  bridge_stp?: string;
  bridge_fd?: string;
  families?: string[];
  autostart?: number;
  comments?: string;
}

export async function listNetworkBridges(node: string): Promise<ProxmoxBridge[]> {
  const all = await proxmoxFetch<ProxmoxBridge[]>(
    `/nodes/${encodeURIComponent(node)}/network`
  );
  // Filter to only bridges (Linux bridges and OVS bridges)
  return all.filter(iface =>
    iface.type === 'bridge' || iface.type === 'OVSBridge'
  );
}

// --- Exec (run commands inside containers via PVE 8+ API) ---

export async function proxmoxExec(
  node: string,
  vmid: number,
  command: string
): Promise<void> {
  const body = new URLSearchParams();
  body.set('command', command);
  await proxmoxFetch<unknown>(
    `/nodes/${encodeURIComponent(node)}/lxc/${vmid}/exec`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    }
  );
}

// --- Tasks ---

export async function getTaskStatus(node: string, upid: string): Promise<ProxmoxTaskStatus> {
  const encodedUpid = encodeURIComponent(upid);
  return proxmoxFetch<ProxmoxTaskStatus>(
    `/nodes/${encodeURIComponent(node)}/tasks/${encodedUpid}/status`
  );
}

export async function waitForTask(
  node: string,
  upid: string,
  timeoutMs: number = 120000,
  pollIntervalMs: number = 2000
): Promise<ProxmoxTaskStatus> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const status = await getTaskStatus(node, upid);
    if (status.status === 'stopped') {
      if (status.exitstatus && status.exitstatus !== 'OK') {
        // Parse common Proxmox task failure reasons
        const exit = status.exitstatus;
        let hint = '';
        if (exit.includes('storage') || exit.includes('disk')) {
          hint = ' Check that the storage pool exists and has enough free space.';
        } else if (exit.includes('lock')) {
          hint = ' The resource may be locked by another operation. Try again in a moment.';
        } else if (exit.includes('template') || exit.includes('no such file')) {
          hint = ' The OS template may not be downloaded. Check Proxmox storage for available templates.';
        }
        throw createError('TASK_FAILED', `Proxmox task failed: ${exit}.${hint}`);
      }
      return status;
    }
    await new Promise(r => setTimeout(r, pollIntervalMs));
  }
  throw createError('TASK_TIMEOUT',
    `Proxmox task did not complete within ${timeoutMs / 1000}s. ` +
    'The operation may still be running on the Proxmox host — check the Proxmox web UI task log.'
  );
}

// --- Network Interfaces (for getting container IP) ---

export async function getLxcInterfaces(
  node: string,
  vmid: number
): Promise<ProxmoxNetworkInterface[]> {
  return proxmoxFetch<ProxmoxNetworkInterface[]>(
    `/nodes/${encodeURIComponent(node)}/lxc/${vmid}/interfaces`
  );
}

export async function discoverLxcIp(
  node: string,
  vmid: number,
  retries: number = 10,
  intervalMs: number = 3000
): Promise<string | null> {
  for (let i = 0; i < retries; i++) {
    try {
      const interfaces = await getLxcInterfaces(node, vmid);
      for (const iface of interfaces) {
        if (iface.name === 'lo') continue;
        const ipv4 = iface['ip-addresses']?.find(
          addr => addr['ip-address-type'] === 'inet'
        );
        if (ipv4) {
          return ipv4['ip-address'];
        }
      }
    } catch {
      // Container may not be fully started yet
    }
    if (i < retries - 1) {
      await new Promise(r => setTimeout(r, intervalMs));
    }
  }
  return null;
}
