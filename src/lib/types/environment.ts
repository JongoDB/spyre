export interface Environment {
  id: string;
  name: string;
  config_path: string | null;
  vmid: number | null;
  type: 'lxc' | 'vm';
  status: 'pending' | 'provisioning' | 'running' | 'stopped' | 'error' | 'destroying';
  ip_address: string | null;
  node: string;
  ssh_user: string;
  ssh_port: number;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  last_accessed: string | null;
  metadata: string | null;
}

export interface Service {
  id: string;
  env_id: string;
  name: string;
  port: number;
  protocol: 'ssh' | 'http' | 'https' | 'vnc' | 'rdp' | 'tcp';
  proxy_url: string | null;
  status: 'up' | 'down' | 'unknown';
}

export interface CreateEnvironmentRequest {
  name: string;
  type: 'lxc' | 'vm';
  template: string;
  cores: number;
  memory: number;
  disk: number;
  bridge?: string;
  storage?: string;
  ip?: string;
  ssh_user?: string;
  password?: string;
  swap?: number;
  nameserver?: string;
  unprivileged?: boolean;
  nesting?: boolean;
  ssh_enabled?: boolean;
  template_id?: string;
}
