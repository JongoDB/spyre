export interface Devcontainer {
  id: string;
  env_id: string;
  persona_id: string | null;
  container_name: string;
  service_name: string;
  status: 'pending' | 'creating' | 'running' | 'stopped' | 'error' | 'removing';
  image: string | null;
  working_dir: string;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface DevcontainerCreateInput {
  env_id: string;
  persona_id: string;
  service_name?: string;
}

export interface DevcontainerWithPersona extends Devcontainer {
  persona_name: string | null;
  persona_role: string | null;
  persona_avatar: string | null;
}
