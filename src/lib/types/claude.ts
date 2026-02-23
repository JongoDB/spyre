export interface ClaudeAuthState {
  status: 'idle' | 'waiting_for_oauth' | 'waiting_for_callback' | 'authenticated' | 'error';
  oauthUrl: string | null;
  localPort: number | null;
  error: string | null;
  lastAuthenticated: string | null;
  tokenExpiresAt: string | null;
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
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface ClaudeTaskResult {
  id: string;
  status: 'success' | 'error' | 'auth_required';
  result?: string;
  cost_usd?: number;
  session_id?: string;
  error?: string;
}
