import type { PageServerLoad } from './$types';
import { listProfiles } from '$lib/server/network-profiles';
import { authenticate, listNetworkBridges } from '$lib/server/proxmox';
import { getEnvConfig } from '$lib/server/env-config';

export const load: PageServerLoad = async () => {
  const profiles = listProfiles();

  let bridges: Array<{ iface: string; type: string }> = [];
  try {
    const config = getEnvConfig();
    await authenticate();
    bridges = await listNetworkBridges(config.proxmox.node_name) ?? [];
  } catch {
    // Proxmox unreachable — bridge dropdown won't be populated
  }

  return { profiles, bridges };
};
