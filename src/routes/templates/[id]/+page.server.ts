import type { PageServerLoad } from './$types';
import { getTemplateWithRelations } from '$lib/server/templates';
import { listPresets } from '$lib/server/resource-presets';
import { listProfiles } from '$lib/server/network-profiles';
import { listPools } from '$lib/server/software-pools';
import { authenticate, listTemplates as listOsTemplates, listNetworkBridges } from '$lib/server/proxmox';
import { getEnvConfig } from '$lib/server/env-config';
import { error } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ params }) => {
	const template = getTemplateWithRelations(params.id);
	if (!template) throw error(404, 'Template not found');

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
			listOsTemplates(config.proxmox.node_name, config.defaults.storage),
			listNetworkBridges(config.proxmox.node_name)
		]);
		osTemplates = tpls ?? [];
		bridges = br ?? [];
	} catch {
		proxmoxConnected = false;
	}

	return { template, presets, profiles, pools, osTemplates, bridges, proxmoxConnected };
};
