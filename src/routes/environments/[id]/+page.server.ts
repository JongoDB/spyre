import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getEnvironment } from '$lib/server/environments';
import { discoverLxcIp } from '$lib/server/proxmox';
import { getDb } from '$lib/server/db';
import { getActiveTaskForEnv, listTasks } from '$lib/server/claude-bridge';
import { getProgressForEnv, getGitActivityForEnv } from '$lib/server/claude-poller';
import { getProvisioningProgress } from '$lib/server/provisioning-log';

export const load: PageServerLoad = async ({ params }) => {
  let env = getEnvironment(params.id);
  if (!env) {
    throw error(404, 'Environment not found');
  }

  // Auto-discover IP if environment is running but has no IP
  if (env.status === 'running' && !env.ip_address && env.vmid) {
    try {
      const ip = await discoverLxcIp(env.node, env.vmid, 3, 2000);
      if (ip) {
        getDb().prepare(
          "UPDATE environments SET ip_address = ?, updated_at = datetime('now') WHERE id = ?"
        ).run(ip, env.id);
        env = getEnvironment(params.id)!;
      }
    } catch {
      // Non-critical — page still loads, just without terminal
    }
  }

  let metadata: Record<string, unknown> | null = null;
  if (env.metadata) {
    try {
      metadata = JSON.parse(env.metadata);
    } catch {
      metadata = null;
    }
  }

  // Claude data
  const activeTask = getActiveTaskForEnv(params.id);
  const taskHistory = listTasks({ envId: params.id, limit: 20 });
  const progress = getProgressForEnv(params.id);
  const gitActivity = getGitActivityForEnv(params.id);

  // Queue items
  const db = getDb();
  const queueItems = db.prepare(
    "SELECT * FROM claude_task_queue WHERE env_id = ? AND status = 'queued' ORDER BY position ASC"
  ).all(params.id);

  // Provisioning progress — show for provisioning AND error states
  // (error may occur mid-provisioning, log shows what happened)
  const provisioningProgress = (env.status === 'provisioning' || env.status === 'error')
    ? getProvisioningProgress(params.id)
    : null;

  return {
    environment: env,
    metadata,
    provisioningProgress,
    claude: {
      activeTask,
      taskHistory,
      progress,
      gitActivity,
      queueItems
    }
  };
};
