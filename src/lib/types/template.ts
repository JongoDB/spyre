// =============================================================================
// Categories
// =============================================================================

export interface Category {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface CategoryInput {
  name: string;
  description?: string;
  icon?: string;
  sort_order?: number;
}

// =============================================================================
// Resource Presets
// =============================================================================

export interface ResourcePreset {
  id: string;
  name: string;
  description: string | null;
  cores: number;
  memory: number;
  swap: number;
  disk: number;
  created_at: string;
  updated_at: string;
}

export interface ResourcePresetInput {
  name: string;
  description?: string;
  cores: number;
  memory: number;
  swap?: number;
  disk: number;
}

// =============================================================================
// Network Profiles
// =============================================================================

export interface NetworkProfile {
  id: string;
  name: string;
  description: string | null;
  bridge: string;
  ip_mode: 'dhcp' | 'static';
  ip_address: string | null;
  gateway: string | null;
  ip6_mode: 'auto' | 'static' | 'disabled' | null;
  ip6_address: string | null;
  ip6_gateway: string | null;
  dns: string | null;
  dns_search: string | null;
  vlan: number | null;
  mtu: number | null;
  firewall: number;
  rate_limit: number | null;
  created_at: string;
  updated_at: string;
}

export interface NetworkProfileInput {
  name: string;
  description?: string;
  bridge?: string;
  ip_mode?: 'dhcp' | 'static';
  ip_address?: string;
  gateway?: string;
  ip6_mode?: 'auto' | 'static' | 'disabled';
  ip6_address?: string;
  ip6_gateway?: string;
  dns?: string;
  dns_search?: string;
  vlan?: number;
  mtu?: number;
  firewall?: boolean;
  rate_limit?: number;
}

// =============================================================================
// Software Pools
// =============================================================================

export interface SoftwarePoolItem {
  id: string;
  pool_id: string;
  sort_order: number;
  item_type: 'package' | 'script' | 'file';
  content: string;
  destination: string | null;
  label: string | null;
  post_command: string | null;
  created_at: string;
}

export interface SoftwarePoolItemInput {
  item_type: 'package' | 'script' | 'file';
  content: string;
  destination?: string;
  label?: string;
  post_command?: string;
  sort_order?: number;
}

export interface SoftwarePool {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface SoftwarePoolWithItems extends SoftwarePool {
  items: SoftwarePoolItem[];
}

export interface SoftwarePoolInput {
  name: string;
  description?: string;
  items?: SoftwarePoolItemInput[];
}

// =============================================================================
// Templates
// =============================================================================

export interface Template {
  id: string;
  name: string;
  description: string | null;
  type: 'lxc' | 'vm';

  // References
  resource_preset_id: string | null;
  network_profile_id: string | null;
  category_id: string | null;

  // OS
  os_template: string | null;
  os_type: string | null;
  os_version: string | null;

  // Inline resource overrides
  cores: number | null;
  memory: number | null;
  swap: number | null;
  disk: number | null;
  storage: string | null;

  // Inline network overrides
  bridge: string | null;
  ip_mode: 'dhcp' | 'static' | null;
  ip_address: string | null;
  gateway: string | null;
  dns: string | null;
  vlan: number | null;

  // LXC settings
  unprivileged: number;
  nesting: number;
  features: string | null;
  startup_order: number | null;
  protection: number;

  // Access
  ssh_enabled: number;
  ssh_keys: string | null;
  root_password: string | null;
  default_user: string | null;
  timezone: string | null;

  // Community
  community_script_slug: string | null;
  install_method_type: string | null;
  interface_port: number | null;
  default_credentials: string | null;
  post_install_notes: string | null;
  privileged: number;

  // Display
  installed_software: string | null;
  custom_script: string | null;
  tags: string | null;

  created_at: string;
  updated_at: string;
}

export interface TemplateWithRelations extends Template {
  resource_preset: ResourcePreset | null;
  network_profile: NetworkProfile | null;
  category: Category | null;
  software_pools: SoftwarePoolWithItems[];
}

export interface TemplateInput {
  name: string;
  description?: string;
  type?: 'lxc' | 'vm';

  resource_preset_id?: string;
  network_profile_id?: string;
  category_id?: string;

  os_template?: string;
  os_type?: string;
  os_version?: string;

  cores?: number;
  memory?: number;
  swap?: number;
  disk?: number;
  storage?: string;

  bridge?: string;
  ip_mode?: 'dhcp' | 'static';
  ip_address?: string;
  gateway?: string;
  dns?: string;
  vlan?: number;

  unprivileged?: boolean;
  nesting?: boolean;
  features?: string;
  startup_order?: number;
  protection?: boolean;

  ssh_enabled?: boolean;
  ssh_keys?: string;
  root_password?: string;
  default_user?: string;
  timezone?: string;

  community_script_slug?: string;
  install_method_type?: string;
  interface_port?: number;
  default_credentials?: { username: string | null; password: string | null };
  post_install_notes?: Array<{ text: string; type?: string }>;
  privileged?: boolean;

  installed_software?: string[];
  custom_script?: string;
  tags?: string;

  software_pool_ids?: string[];
}

// =============================================================================
// Resolved Template — Fully merged, ready for provisioning
// =============================================================================

export interface ResolvedTemplate {
  id: string;
  name: string;
  description: string | null;
  type: 'lxc' | 'vm';

  // OS
  os_template: string;
  os_type: string | null;
  os_version: string | null;

  // Resources (fully resolved, always present)
  cores: number;
  memory: number;
  swap: number;
  disk: number;
  storage: string;

  // Network (fully resolved)
  bridge: string;
  ip_mode: 'dhcp' | 'static';
  ip_address: string | null;
  gateway: string | null;
  dns: string;
  vlan: number | null;

  // LXC settings
  unprivileged: boolean;
  nesting: boolean;
  features: string | null;
  startup_order: number | null;
  protection: boolean;

  // Access
  ssh_enabled: boolean;
  ssh_keys: string | null;
  root_password: string | null;
  default_user: string | null;
  timezone: string;

  // Community
  community_script_slug: string | null;
  install_method_type: string | null;
  interface_port: number | null;
  default_credentials: { username: string | null; password: string | null } | null;
  post_install_notes: Array<{ text: string; type?: string }>;
  privileged: boolean;

  // Software
  software_pools: SoftwarePoolWithItems[];
  custom_script: string | null;

  // Display
  installed_software: string[];
  tags: string[];
}
