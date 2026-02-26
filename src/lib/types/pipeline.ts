export interface PipelineOutputArtifacts {
  services: Array<{ port: number; name: string }>;
  files: Array<{ path: string; filename: string; size: number }>;
  projectDir: string;
  projectName: string;
  scannedAt: string;
}

export interface Pipeline {
  id: string;
  env_id: string;
  template_id: string | null;
  name: string;
  description: string | null;
  auto_approve: boolean;
  status: 'draft' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  current_position: number | null;
  total_cost_usd: number;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
  output_artifacts: string | null;
  created_at: string;
  updated_at: string;
}

export interface PipelineStep {
  id: string;
  pipeline_id: string;
  position: number;
  type: 'agent' | 'gate';
  label: string;
  devcontainer_id: string | null;
  persona_id: string | null;
  prompt_template: string | null;
  gate_instructions: string | null;
  status: 'pending' | 'running' | 'completed' | 'skipped' | 'error' | 'waiting' | 'cancelled';
  task_id: string | null;
  result_summary: string | null;
  gate_result: 'approved' | 'rejected' | 'revised' | null;
  gate_feedback: string | null;
  gate_decided_at: string | null;
  iteration: number;
  max_retries: number;
  retry_count: number;
  timeout_ms: number | null;
  cost_usd: number | null;
  started_at: string | null;
  completed_at: string | null;
}

export interface PipelineStepWithContext extends PipelineStep {
  persona_name: string | null;
  persona_role: string | null;
  persona_avatar: string | null;
  devcontainer_service: string | null;
  task_status: string | null;
}

export interface PipelineWithSteps extends Pipeline {
  steps: PipelineStepWithContext[];
}

export interface PipelineTemplate {
  id: string;
  name: string;
  description: string | null;
  env_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface PipelineTemplateStep {
  id: string;
  template_id: string;
  position: number;
  type: 'agent' | 'gate';
  label: string;
  devcontainer_id: string | null;
  persona_id: string | null;
  prompt_template: string | null;
  gate_instructions: string | null;
  max_retries: number;
  timeout_ms: number | null;
}

export interface CreatePipelineRequest {
  env_id: string;
  name: string;
  description?: string;
  auto_approve?: boolean;
  template_id?: string;
  steps: Array<{
    position: number;
    type: 'agent' | 'gate';
    label: string;
    devcontainer_id?: string;
    persona_id?: string;
    prompt_template?: string;
    gate_instructions?: string;
    max_retries?: number;
    timeout_ms?: number;
  }>;
}

export interface GateDecisionRequest {
  action: 'approve' | 'reject' | 'revise';
  feedback?: string;
  revise_to_step_id?: string;
}
