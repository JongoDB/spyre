import type { PageServerLoad } from './$types';
import { listPresets } from '$lib/server/resource-presets';
import { listProfiles } from '$lib/server/network-profiles';
import { listPools } from '$lib/server/software-pools';
import { authenticate, listTemplates as listOsTemplates } from '$lib/server/proxmox';
import { getEnvConfig } from '$lib/server/env-config';

export const load: PageServerLoad = async () => {
	const presets = listPresets();
	const profiles = listProfiles();
	const pools = listPools();

	let osTemplates: Array<{ volid: string }> = [];
	let proxmoxConnected = false;

	try {
		const config = getEnvConfig();
		await authenticate();
		proxmoxConnected = true;
		const tpls = await listOsTemplates(config.proxmox.node_name, config.defaults.storage);
		osTemplates = tpls ?? [];
	} catch {
		proxmoxConnected = false;
	}

	return { presets, profiles, pools, osTemplates, proxmoxConnected };
};
