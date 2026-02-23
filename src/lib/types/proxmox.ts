export interface ProxmoxVersion {
  version: string;
  release: string;
  repoid: string;
}

export interface ProxmoxNode {
  node: string;
  status: string;
  cpu: number;
  maxcpu: number;
  mem: number;
  maxmem: number;
  disk: number;
  maxdisk: number;
  uptime: number;
}

export interface ProxmoxLxc {
  vmid: number;
  name: string;
  status: 'running' | 'stopped';
  cpus: number;
  maxmem: number;
  maxdisk: number;
  uptime: number;
  mem: number;
  disk: number;
  netin: number;
  netout: number;
  type: string;
  tags?: string;
}

export interface ProxmoxLxcStatus {
  vmid: number;
  name: string;
  status: 'running' | 'stopped';
  cpus: number;
  maxmem: number;
  mem: number;
  uptime: number;
  ha: { managed: number };
}

export interface ProxmoxLxcConfig {
  hostname: string;
  cores: number;
  memory: number;
  rootfs: string;
  net0: string;
  ostype: string;
  arch: string;
}

export interface ProxmoxStorageContent {
  volid: string;
  content: string;
  format: string;
  size: number;
}

export interface ProxmoxStorage {
  storage: string;
  type: string;
  content: string;
  active: number;
  total: number;
  used: number;
  avail: number;
}

export interface ProxmoxNetworkInterface {
  name: string;
  'hardware-address': string;
  'ip-addresses'?: Array<{
    'ip-address': string;
    'ip-address-type': string;
    prefix: number;
  }>;
}

export interface ProxmoxTaskStatus {
  status: string;
  exitstatus?: string;
  type: string;
  id: string;
  node: string;
  pid: number;
  starttime: number;
  upid: string;
}

export interface ProxmoxApiResponse<T> {
  data: T;
}

export interface ProxmoxApiError {
  code: string;
  message: string;
  details?: unknown;
}
