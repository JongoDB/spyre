import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listStorage, listTemplates } from '$lib/server/proxmox';
import { getEnvConfig } from '$lib/server/env-config';

export const GET: RequestHandler = async () => {
  try {
    const config = getEnvConfig();
    const node = config.proxmox.node_name;
    const storages = await listStorage(node);

    const templateStorages = storages.filter(
      s => s.content && s.content.includes('vztmpl')
    );

    const templateResults = await Promise.all(
      templateStorages.map(s => listTemplates(node, s.storage))
    );

    const templates = templateResults.flat().map(t => t.volid);
    return json(templates);
  } catch (err) {
    const message = err instanceof Error ? err.message :
      (err as { message?: string })?.message ?? 'Unknown error';
    throw error(500, `Failed to list templates: ${message}`);
  }
};
