import type { PageServerLoad } from './$types';
import { authenticate, listAllOsTemplates, listStorage } from '$lib/server/proxmox';
import { getEnvConfig } from '$lib/server/env-config';
import { listTemplates } from '$lib/server/templates';
import { listScripts } from '$lib/server/community-scripts';
import { listConfigs } from '$lib/server/config-store';
import { listPersonas } from '$lib/server/personas';
import type { ProxmoxStorageContent, ProxmoxStorage } from '$lib/types/proxmox';

export const load: PageServerLoad = async ({ url }) => {
	let osTemplates: ProxmoxStorageContent[] = [];
	let storageList: ProxmoxStorage[] = [];
	let proxmoxConnected = false;
	let defaultDns = '8.8.8.8';

	try {
		const config = getEnvConfig();
		const node = config.proxmox.node_name;
		defaultDns = config.defaults.dns || '8.8.8.8';

		await authenticate();
		proxmoxConnected = true;

		const [tpls, stores] = await Promise.all([
			listAllOsTemplates(node),
			listStorage(node)
		]);

		osTemplates = tpls ?? [];
		storageList = stores ?? [];
	} catch (err) {
		console.warn('[spyre] Failed to fetch Proxmox data for create page:', err);
		proxmoxConnected = false;
	}

	// Spyre templates for "From Template" tab
	const spyreTemplates = listTemplates();

	// Community scripts for "Community" tab
	const communityQuery = url.searchParams.get('cq') ?? undefined;
	const communityResult = listScripts({ query: communityQuery, limit: 12 });

	// YAML configs for "From Config" tab
	const yamlConfigs = listConfigs().filter(c => c.kind === 'Environment');

	// Support preselecting a config from URL params
	const preselectedConfig = url.searchParams.get('config') ?? '';
	const preselectedTab = url.searchParams.get('tab') ?? '';

	// Personas for persona selector
	const personas = listPersonas();

	return {
		templates: osTemplates,
		storageList,
		proxmoxConnected,
		defaultDns,
		spyreTemplates,
		communityScripts: communityResult.scripts,
		communityQuery: communityQuery ?? '',
		yamlConfigs,
		preselectedConfig,
		preselectedTab,
		personas
	};
};
