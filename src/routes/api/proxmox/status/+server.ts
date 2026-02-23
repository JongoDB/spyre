import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { authenticate, listNodes } from '$lib/server/proxmox';
import { getEnvConfig } from '$lib/server/env-config';

export const GET: RequestHandler = async () => {
  try {
    const config = getEnvConfig();
    const version = await authenticate();
    const nodes = await listNodes();
    const currentNode = nodes.find(n => n.node === config.proxmox.node_name);

    return json({
      connected: true,
      version: version.version,
      node: config.proxmox.node_name,
      nodeStatus: currentNode ? {
        status: currentNode.status,
        cpu: currentNode.cpu,
        maxcpu: currentNode.maxcpu,
        mem: currentNode.mem,
        maxmem: currentNode.maxmem
      } : null
    });
  } catch (err) {
    const message = err instanceof Error ? err.message :
      (err as { message?: string })?.message ?? 'Unknown error';
    throw error(502, `Failed to connect to Proxmox: ${message}`);
  }
};
