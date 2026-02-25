import { getDb } from './db';
import { listEnvironments } from './environments';
import { getConnection } from './ssh-pool';
import { getActiveTaskForEnv } from './claude-bridge';
import { getPersona } from './personas';
import { listDevcontainers, devcontainerExec } from './devcontainers';
import type { ClaudeProgress, ClaudeGitActivity, ClaudeEnvironmentLiveData } from '$lib/types/claude';

// =============================================================================
// Claude Poller — Progress & Git Activity from Environments
// =============================================================================

type Subscriber = (data: ClaudeEnvironmentLiveData[]) => void;

const subscribers = new Set<Subscriber>();
let pollTimer: ReturnType<typeof setInterval> | null = null;
let lastData: ClaudeEnvironmentLiveData[] = [];

const ACTIVE_POLL_INTERVAL = 30_000;   // 30s when tasks are running
const IDLE_POLL_INTERVAL = 120_000;    // 120s otherwise
const MAX_CONCURRENT_CHECKS = 3;

// =============================================================================
// SSH Helpers
// =============================================================================

function sshExecOnEnv(
  envId: string,
  command: string,
  timeoutMs = 10000
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    getConnection(envId).then((client) => {
      const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
      client.exec(command, (err, stream) => {
        if (err) { clearTimeout(timer); reject(err); return; }
        let stdout = '';
        let stderr = '';
        stream.on('data', (d: Buffer) => { stdout += d.toString(); });
        stream.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
        stream.on('close', (code: number) => {
          clearTimeout(timer);
          resolve({ code: code ?? 0, stdout, stderr });
        });
      });
    }).catch(reject);
  });
}

// =============================================================================
// Data Fetchers
// =============================================================================

async function fetchProgress(envId: string): Promise<ClaudeProgress | null> {
  try {
    const result = await sshExecOnEnv(envId, 'cat /root/.spyre/progress.json 2>/dev/null');
    if (result.code !== 0 || !result.stdout.trim()) return null;

    const raw = JSON.parse(result.stdout);
    const progress: ClaudeProgress = {
      env_id: envId,
      plan: raw.plan ?? null,
      phases: Array.isArray(raw.phases) ? raw.phases : [],
      current_task: raw.current_task ?? null,
      blockers: Array.isArray(raw.blockers) ? raw.blockers : [],
      metrics: raw.metrics ?? {},
      updated_at: raw.updated_at ?? null,
      fetched_at: new Date().toISOString()
    };

    // Cache in DB
    const db = getDb();
    db.prepare(`
      INSERT OR REPLACE INTO claude_progress (env_id, progress, fetched_at)
      VALUES (?, ?, datetime('now'))
    `).run(envId, JSON.stringify(progress));

    return progress;
  } catch {
    return null;
  }
}

async function fetchGitActivity(envId: string): Promise<ClaudeGitActivity | null> {
  try {
    // Check if git is available and in a repo
    const gitCheck = await sshExecOnEnv(envId, 'git rev-parse --git-dir 2>/dev/null');
    if (gitCheck.code !== 0) return null;

    // Fetch all git info in one call for efficiency
    const gitCmd = [
      "git log --oneline -10 --format='%H|%s|%an|%aI' 2>/dev/null",
      "echo '---SEPARATOR---'",
      'git diff --stat 2>/dev/null',
      "echo '---SEPARATOR---'",
      'git status --short 2>/dev/null',
      "echo '---SEPARATOR---'",
      'git branch --show-current 2>/dev/null'
    ].join('; ');

    const result = await sshExecOnEnv(envId, gitCmd, 15000);
    if (result.code !== 0) return null;

    const parts = result.stdout.split('---SEPARATOR---');

    // Parse commits
    const commitLines = (parts[0] ?? '').trim().split('\n').filter(Boolean);
    const recent_commits = commitLines.map(line => {
      const [hash, message, author, date] = line.split('|');
      return { hash: hash ?? '', message: message ?? '', author: author ?? '', date: date ?? '' };
    }).filter(c => c.hash);

    const diff_stat = (parts[1] ?? '').trim() || null;
    const git_status = (parts[2] ?? '').trim() || null;
    const branch = (parts[3] ?? '').trim() || null;

    const activity: ClaudeGitActivity = {
      env_id: envId,
      recent_commits,
      diff_stat,
      git_status,
      branch,
      fetched_at: new Date().toISOString()
    };

    // Cache in DB
    const db = getDb();
    db.prepare(`
      INSERT OR REPLACE INTO claude_git_activity (env_id, recent_commits, diff_stat, git_status, branch, fetched_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).run(envId, JSON.stringify(recent_commits), diff_stat, git_status, branch);

    return activity;
  } catch {
    return null;
  }
}

// =============================================================================
// Polling
// =============================================================================

async function poll(): Promise<void> {
  try {
    const environments = listEnvironments();
    const runningEnvs = environments.filter(e => e.status === 'running' && e.ip_address);

    const results: ClaudeEnvironmentLiveData[] = [];

    // Process in batches to avoid SSH overload
    for (let i = 0; i < runningEnvs.length; i += MAX_CONCURRENT_CHECKS) {
      const batch = runningEnvs.slice(i, i + MAX_CONCURRENT_CHECKS);
      const batchResults = await Promise.allSettled(
        batch.map(async (env) => {
          const [progress, gitActivity] = await Promise.all([
            fetchProgress(env.id),
            fetchGitActivity(env.id)
          ]);

          const activeTask = getActiveTaskForEnv(env.id);

          // Look up persona from the environment's persona_id
          let personaName: string | null = null;
          let personaRole: string | null = null;
          let personaAvatar: string | null = null;
          if ((env as { persona_id?: string | null }).persona_id) {
            const persona = getPersona((env as { persona_id: string }).persona_id);
            if (persona) {
              personaName = persona.name;
              personaRole = persona.role;
              personaAvatar = persona.avatar;
            }
          }

          return {
            envId: env.id,
            progress,
            gitActivity,
            activeTask,
            personaName,
            personaRole,
            personaAvatar
          } as ClaudeEnvironmentLiveData;
        })
      );

      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        }
      }
    }

    // For docker-enabled environments, also poll devcontainer progress
    for (const env of runningEnvs) {
      if (!(env as { docker_enabled?: boolean }).docker_enabled) continue;
      try {
        const dcs = listDevcontainers(env.id).filter(dc => dc.status === 'running');
        for (const dc of dcs) {
          try {
            const result = await devcontainerExec(dc.id, 'cat /workspace/.spyre/progress.json 2>/dev/null', 10000);
            if (result.code === 0 && result.stdout.trim()) {
              const db = getDb();
              db.prepare(`
                INSERT OR REPLACE INTO devcontainer_progress (devcontainer_id, progress, fetched_at)
                VALUES (?, ?, datetime('now'))
              `).run(dc.id, result.stdout.trim());
            }
          } catch { /* non-fatal per devcontainer */ }
        }
      } catch { /* non-fatal */ }
    }

    lastData = results;

    // Notify subscribers
    for (const sub of subscribers) {
      try {
        sub(lastData);
      } catch {
        subscribers.delete(sub);
      }
    }
  } catch (err) {
    console.error('[spyre] Claude poller error:', err);
  }
}

function getInterval(): number {
  // Use faster interval if any environments have active tasks
  const db = getDb();
  const activeCount = (db.prepare(
    "SELECT COUNT(*) as count FROM claude_tasks WHERE status IN ('pending', 'running')"
  ).get() as { count: number }).count;

  return activeCount > 0 ? ACTIVE_POLL_INTERVAL : IDLE_POLL_INTERVAL;
}

function startPolling(): void {
  if (pollTimer) return;
  poll();
  pollTimer = setInterval(() => {
    // Adjust interval dynamically
    const needed = getInterval();
    poll();
    // If interval needs to change, restart timer
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = setInterval(() => poll(), needed);
    }
  }, getInterval());
}

function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

// =============================================================================
// Public API
// =============================================================================

export function subscribe(callback: Subscriber): () => void {
  subscribers.add(callback);

  if (subscribers.size === 1) {
    startPolling();
  }

  // Send last known data immediately
  if (lastData.length > 0) {
    try {
      callback(lastData);
    } catch {
      // ignore
    }
  }

  return () => {
    subscribers.delete(callback);
    if (subscribers.size === 0) {
      stopPolling();
    }
  };
}

export function getLastData(): ClaudeEnvironmentLiveData[] {
  return lastData;
}

export function getProgressForEnv(envId: string): ClaudeProgress | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM claude_progress WHERE env_id = ?').get(envId) as {
    env_id: string; progress: string | null; fetched_at: string;
  } | undefined;

  if (!row?.progress) return null;
  try {
    return JSON.parse(row.progress) as ClaudeProgress;
  } catch {
    return null;
  }
}

export function getGitActivityForEnv(envId: string): ClaudeGitActivity | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM claude_git_activity WHERE env_id = ?').get(envId) as {
    env_id: string; recent_commits: string | null; diff_stat: string | null;
    git_status: string | null; branch: string | null; fetched_at: string;
  } | undefined;

  if (!row) return null;

  let recent_commits: ClaudeGitActivity['recent_commits'] = [];
  if (row.recent_commits) {
    try { recent_commits = JSON.parse(row.recent_commits); } catch { /* ignore */ }
  }

  return {
    env_id: envId,
    recent_commits,
    diff_stat: row.diff_stat,
    git_status: row.git_status,
    branch: row.branch,
    fetched_at: row.fetched_at
  };
}
