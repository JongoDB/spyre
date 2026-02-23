export interface CommunityScriptInstallMethod {
  type: string;
  script: string;
  resources: {
    cpu: number;
    ram: number;
    hdd: number;
    os: string;
    version: string;
  };
}

export interface CommunityScript {
  slug: string;
  name: string;
  description: string | null;
  type: 'ct' | 'vm' | null;
  categories: string[];
  website: string | null;
  logo_url: string | null;
  documentation: string | null;
  interface_port: number | null;
  default_cpu: number | null;
  default_ram: number | null;
  default_disk: number | null;
  default_os: string | null;
  default_os_version: string | null;
  script_path: string | null;
  install_methods: CommunityScriptInstallMethod[];
  default_username: string | null;
  default_password: string | null;
  notes: string[];
  fetched_at: string;
  source_hash: string | null;
}

export interface CommunityScriptSearchParams {
  query?: string;
  type?: 'ct' | 'vm';
  category?: string;
  page?: number;
  limit?: number;
}

export interface CommunityScriptListResult {
  scripts: CommunityScript[];
  total: number;
  page: number;
  limit: number;
}
