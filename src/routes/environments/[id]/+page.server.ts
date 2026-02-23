import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getEnvironment } from '$lib/server/environments';
import { discoverLxcIp } from '$lib/server/proxmox';
import { getDb } from '$lib/server/db';

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

  return {
    environment: env,
    metadata
  };
};
