// =============================================================================
// Lightweight Agent Types — Dynamic orchestration mode
// =============================================================================

export interface LightweightAgent {
  id: string;
  env_id: string;
  orchestrator_id: string | null;
  name: string;
  role: string | null;
  persona_id: string | null;
  task_prompt: string;
  task_id: string | null;
  model: string;
  status: 'pending' | 'spawning' | 'running' | 'completed' | 'error' | 'cancelled';
  result_summary: string | null;
  result_full: string | null;
  cost_usd: number | null;
  wave_id: string | null;
  wave_position: number | null;
  context: string | null;
  error_message: string | null;
  spawned_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface LightweightAgentWithPersona extends LightweightAgent {
  persona_name: string | null;
  persona_role: string | null;
  persona_avatar: string | null;
}

export interface SpawnAgentRequest {
  name: string;
  role?: string;
  persona_id?: string;
  task: string;
  model?: 'haiku' | 'sonnet' | 'opus';
  wait?: boolean;
  context?: Record<string, unknown>;
}

export interface SpawnAgentsBatchRequest {
  wave_name?: string;
  agents: SpawnAgentRequest[];
}
