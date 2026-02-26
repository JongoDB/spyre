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
  persona_id: string | null;
  docker_enabled: boolean;
  repo_url: string | null;
  git_branch: string;
  project_dir: string;
  project_name: string | null;
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
  // Provisioner pipeline fields
  default_user?: string;
  community_script_slug?: string;
  install_method_type?: string;
  software_pool_ids?: string[];
  software_ids?: string[];
  custom_script?: string;
  install_claude?: boolean;
  config_name?: string;
  persona_id?: string;
  docker_enabled?: boolean;
  repo_url?: string;
  git_branch?: string;
  project_dir?: string;
  project_name?: string;
}
