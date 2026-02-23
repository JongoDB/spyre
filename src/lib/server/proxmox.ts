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
    if (message.includes('ECONNREFUSED')) {
      throw createError('CONNECTION_REFUSED', `Cannot reach Proxmox at ${getEnvConfig().proxmox.host}:${getEnvConfig().proxmox.port}. Is the host accessible?`);
    }
    if (message.includes('ETIMEDOUT') || message.includes('timeout')) {
      throw createError('TIMEOUT', 'Connection to Proxmox timed out.');
    }
    throw createError('NETWORK_ERROR', `Network error connecting to Proxmox: ${message}`);
  }

  if (response.status === 401) {
    throw createError('AUTH_FAILED', 'Proxmox API token is invalid or expired. Check environment.yaml and SPYRE_PVE_TOKEN_SECRET.');
  }
  if (response.status === 403) {
    throw createError('FORBIDDEN', 'Proxmox API token lacks required privileges.');
  }
  if (response.status === 500) {
    throw createError('PROXMOX_ERROR', 'Proxmox internal server error.');
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw createError('API_ERROR', `Proxmox API error (${response.status}): ${body}`);
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
        throw createError('TASK_FAILED', `Proxmox task failed: ${status.exitstatus}`);
      }
      return status;
    }
    await new Promise(r => setTimeout(r, pollIntervalMs));
  }
  throw createError('TASK_TIMEOUT', `Proxmox task did not complete within ${timeoutMs / 1000}s.`);
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
