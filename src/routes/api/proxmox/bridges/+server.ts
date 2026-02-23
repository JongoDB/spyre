import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listNetworkBridges } from '$lib/server/proxmox';
import { getEnvConfig } from '$lib/server/env-config';

export const GET: RequestHandler = async () => {
  try {
    const config = getEnvConfig();
    const bridges = await listNetworkBridges(config.proxmox.node_name);
    return json(bridges);
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err) throw err;
    const e = err as { code?: string; message?: string };
    throw error(500, e.message ?? 'Failed to fetch bridges');
  }
};
