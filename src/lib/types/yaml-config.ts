// =============================================================================
// YAML Config Schema — spyre/v1
// =============================================================================

export interface SpyreConfig {
  apiVersion: 'spyre/v1';
  kind: 'Environment' | 'EnvironmentBase';
  extends?: string;
  metadata: SpyreConfigMetadata;
  spec: SpyreConfigSpec;
}

export interface SpyreConfigMetadata {
  name: string;
  description?: string;
  labels?: Record<string, string>;
}

export interface SpyreConfigSpec {
  platform: SpyreConfigPlatform;
  helper_script?: string;
  software?: string[];
  provision?: SpyreConfigProvision;
  services?: SpyreConfigService[];
  claude?: SpyreConfigClaude;
  lxc?: SpyreConfigLxc;
  access?: SpyreConfigAccess;
  community_script?: { slug: string; install_method?: string };
}

export interface SpyreConfigPlatform {
  type: 'lxc' | 'vm';
  template?: string;
  resources?: SpyreConfigResources;
  network?: SpyreConfigNetwork;
}

export interface SpyreConfigResources {
  cores?: number;
  memory?: number;
  swap?: number;
  disk?: number;
  storage?: string;
}

export interface SpyreConfigNetwork {
  bridge?: string;
  ip?: string;
  gateway?: string;
  dns?: string;
  vlan?: number;
}

export interface SpyreConfigProvision {
  packages?: Array<string | SpyreConfigPackage>;
  scripts?: SpyreConfigScript[];
  authorized_keys?: string[];
}

export interface SpyreConfigPackage {
  name: string;
  manager?: 'auto' | 'apt' | 'apk' | 'dnf' | 'yum';
  condition?: string;
}

export interface SpyreConfigScript {
  name?: string;
  run?: string;
  copy?: SpyreConfigScriptCopy;
  post_command?: string;
  interpreter?: 'bash' | 'sh' | 'python3' | 'node' | 'ruby' | 'perl';
  url?: string;
  mode?: string;
  owner?: string;
  condition?: string;
}

export interface SpyreConfigScriptCopy {
  content: string;
  destination: string;
}

export interface SpyreConfigService {
  name: string;
  port: number;
  protocol?: 'http' | 'https' | 'tcp';
}

export interface SpyreConfigClaude {
  working_directory?: string;
  claude_md?: string;
}

export interface SpyreConfigLxc {
  unprivileged?: boolean;
  nesting?: boolean;
  features?: string;
  startup_order?: number;
  protection?: boolean;
}

export interface SpyreConfigAccess {
  ssh_enabled?: boolean;
  root_password?: string;
  default_user?: string;
  timezone?: string;
}

// =============================================================================
// Validation
// =============================================================================

export interface ConfigValidationError {
  path: string;
  message: string;
  line?: number;
  column?: number;
}

export interface ConfigValidationResult {
  valid: boolean;
  errors: ConfigValidationError[];
  warnings: ConfigValidationError[];
  config?: SpyreConfig;
}

// =============================================================================
// Config listing
// =============================================================================

export interface ConfigListEntry {
  name: string;
  kind: 'Environment' | 'EnvironmentBase';
  description?: string;
  extends?: string;
  labels?: Record<string, string>;
  modifiedAt: string;
}
