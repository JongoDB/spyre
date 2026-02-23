export interface ControllerConfig {
  hostname: string;
  ip: string;
  url: string;
  ssh_key_path: string;
  ssh_public_key: string;
  data_dir: string;
  config_dir: string;
  db_path: string;
}

export interface ProxmoxConfig {
  host: string;
  port: number;
  node_name: string;
  token_id: string;
  verify_ssl: boolean;
}

export interface DefaultsConfig {
  bridge: string;
  storage: string;
  dns: string;
  gateway: string;
  subnet: string;
  ssh_user: string;
}

export interface NetworkConfig {
  subnet: string;
  gateway: string;
  dns: string;
}

export interface ClaudeConfig {
  auth_method: 'oauth' | 'api_key';
  health_check_interval: number;
  task_timeout: number;
  auth_json_path: string;
}

export interface EnvironmentConfig {
  controller: ControllerConfig;
  proxmox: ProxmoxConfig;
  defaults: DefaultsConfig;
  network: NetworkConfig;
  claude: ClaudeConfig;
}
