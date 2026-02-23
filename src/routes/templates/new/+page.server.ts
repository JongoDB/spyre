import type { PageServerLoad } from './$types';
import { listPresets } from '$lib/server/resource-presets';
import { listProfiles } from '$lib/server/network-profiles';
import { listPools } from '$lib/server/software-pools';
import { authenticate, listAllOsTemplates, listNetworkBridges } from '$lib/server/proxmox';
import { getEnvConfig } from '$lib/server/env-config';

export const load: PageServerLoad = async () => {
	const presets = listPresets();
	const profiles = listProfiles();
	const pools = listPools();

	let osTemplates: Array<{ volid: string }> = [];
	let bridges: Array<{ iface: string; type: string }> = [];
	let proxmoxConnected = false;

	try {
		const config = getEnvConfig();
		await authenticate();
		proxmoxConnected = true;
		const [tpls, br] = await Promise.all([
			listAllOsTemplates(config.proxmox.node_name),
			listNetworkBridges(config.proxmox.node_name)
		]);
		osTemplates = tpls ?? [];
		bridges = br ?? [];
	} catch (err) {
		console.warn('[spyre] Failed to fetch Proxmox data for template page:', err);
		proxmoxConnected = false;
	}

	return { presets, profiles, pools, osTemplates, bridges, proxmoxConnected };
};
