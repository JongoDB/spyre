import type { PageServerLoad } from './$types';
import { authenticate, listTemplates as listOsTemplates, listStorage } from '$lib/server/proxmox';
import { getEnvConfig } from '$lib/server/env-config';
import { listTemplates } from '$lib/server/templates';
import { listScripts } from '$lib/server/community-scripts';
import type { ProxmoxStorageContent, ProxmoxStorage } from '$lib/types/proxmox';

export const load: PageServerLoad = async ({ url }) => {
	let osTemplates: ProxmoxStorageContent[] = [];
	let storageList: ProxmoxStorage[] = [];
	let proxmoxConnected = false;
	let defaultDns = '8.8.8.8';

	try {
		const config = getEnvConfig();
		const node = config.proxmox.node_name;
		const defaultStorage = config.defaults.storage;
		defaultDns = config.defaults.dns || '8.8.8.8';

		await authenticate();
		proxmoxConnected = true;

		const [tpls, stores] = await Promise.all([
			listOsTemplates(node, defaultStorage),
			listStorage(node)
		]);

		osTemplates = tpls ?? [];
		storageList = stores ?? [];
	} catch {
		proxmoxConnected = false;
	}

	// Spyre templates for "From Template" tab
	const spyreTemplates = listTemplates();

	// Community scripts for "Community" tab
	const communityQuery = url.searchParams.get('cq') ?? undefined;
	const communityResult = listScripts({ query: communityQuery, limit: 12 });

	return {
		templates: osTemplates,
		storageList,
		proxmoxConnected,
		defaultDns,
		spyreTemplates,
		communityScripts: communityResult.scripts,
		communityQuery: communityQuery ?? ''
	};
};
