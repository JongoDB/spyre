export interface ClaudeAuthState {
  status: 'idle' | 'waiting_for_oauth' | 'waiting_for_callback' | 'authenticated' | 'error';
  oauthUrl: string | null;
  localPort: number | null;
  error: string | null;
  lastAuthenticated: string | null;
  tokenExpiresAt: string | null;
  authMethod: 'oauth' | 'token' | null;
  email: string | null;
  subscriptionType: string | null;
  cliInstalled: boolean;
}

export interface ClaudeCliStatus {
  installed: boolean;
  version: string | null;
  path: string | null;
}

export interface ClaudeTask {
  id: string;
  env_id: string | null;
  user_id: string | null;
  prompt: string;
  status: 'pending' | 'running' | 'complete' | 'error' | 'auth_required' | 'cancelled';
  result: string | null;
  error_message: string | null;
  cost_usd: number | null;
  session_id: string | null;
  output: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  retry_count: number;
  max_retries: number;
  error_code: string | null;
  parent_task_id: string | null;
}

/** Structured event stored in DB and sent to WebSocket clients */
export interface ClaudeTaskEvent {
  seq: number;
  type: 'init' | 'text' | 'tool_use' | 'tool_result' | 'result' | 'error';
  timestamp: string;
  summary: string;
  data: Record<string, unknown>;
}

/** Content block within a stream-json assistant message */
export interface ClaudeContentBlock {
  type: 'text' | 'tool_use';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

export interface ClaudeTaskResult {
  id: string;
  status: 'success' | 'error' | 'auth_required';
  result?: string;
  cost_usd?: number;
  session_id?: string;
  error?: string;
}

export interface ClaudeProgress {
  env_id: string;
  plan: string | null;
  phases: ClaudeProgressPhase[];
  current_task: string | null;
  blockers: string[];
  metrics: Record<string, number>;
  updated_at: string | null;
  fetched_at: string;
}

export interface ClaudeProgressPhase {
  name: string;
  status: 'pending' | 'in_progress' | 'completed' | 'error';
  detail?: string;
}

export interface ClaudeGitActivity {
  env_id: string;
  recent_commits: { hash: string; message: string; author: string; date: string }[];
  diff_stat: string | null;
  git_status: string | null;
  branch: string | null;
  fetched_at: string;
}

export interface ClaudeTaskQueueItem {
  id: string;
  env_id: string;
  prompt: string;
  position: number;
  status: 'queued' | 'dispatched' | 'cancelled' | 'error';
  created_at: string;
}

export interface ClaudeDispatchOptions {
  envId: string;
  prompt: string;
  workingDir?: string;
}

export interface ClaudeStreamEvent {
  type: 'output' | 'error' | 'complete' | 'auth_required';
  data: string;
  taskId: string;
}

export interface ClaudeEnvironmentLiveData {
  envId: string;
  progress: ClaudeProgress | null;
  gitActivity: ClaudeGitActivity | null;
  activeTask: ClaudeTask | null;
}
