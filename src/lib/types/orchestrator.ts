// =============================================================================
// Orchestrator Session Types — Dynamic LLM-driven orchestration
// =============================================================================

export interface OrchestratorSession {
  id: string;
  env_id: string;
  pipeline_id: string | null;
  task_id: string | null;
  goal: string;
  system_prompt: string | null;
  model: string;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'error' | 'cancelled';
  wave_count: number;
  agent_count: number;
  total_cost_usd: number;
  result_summary: string | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface AskUserRequest {
  id: string;
  env_id: string;
  orchestrator_id: string | null;
  agent_id: string | null;
  question: string;
  options: string | null;
  response: string | null;
  status: 'pending' | 'answered' | 'cancelled' | 'expired';
  created_at: string;
  answered_at: string | null;
}
