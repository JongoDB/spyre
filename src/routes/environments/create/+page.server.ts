import type { PageServerLoad } from './$types';
import { authenticate, listTemplates, listStorage } from '$lib/server/proxmox';
import { getEnvConfig } from '$lib/server/env-config';
import type { ProxmoxStorageContent, ProxmoxStorage } from '$lib/types/proxmox';

export const load: PageServerLoad = async () => {
	let templates: ProxmoxStorageContent[] = [];
	let storageList: ProxmoxStorage[] = [];
	let proxmoxConnected = false;

	try {
		const config = getEnvConfig();
		const node = config.proxmox.node_name;
		const defaultStorage = config.defaults.storage;

		await authenticate();
		proxmoxConnected = true;

		const [tpls, stores] = await Promise.all([
			listTemplates(node, defaultStorage),
			listStorage(node)
		]);

		templates = tpls ?? [];
		storageList = stores ?? [];
	} catch {
		proxmoxConnected = false;
	}

	return {
		templates,
		storageList,
		proxmoxConnected
	};
};
