import type { PageServerLoad } from './$types';
import { listScripts, getLastSyncTime, getAllCategories } from '$lib/server/community-scripts';
import { authenticate, listAllOsTemplates } from '$lib/server/proxmox';
import { getEnvConfig } from '$lib/server/env-config';
import type { ProxmoxStorageContent } from '$lib/types/proxmox';

export const load: PageServerLoad = async ({ url }) => {
	const query = url.searchParams.get('query') ?? undefined;
	const type = url.searchParams.get('type') as 'ct' | 'vm' | undefined;
	const category = url.searchParams.get('category') ?? undefined;
	const source = url.searchParams.get('source') ?? '';
	const page = parseInt(url.searchParams.get('page') ?? '1', 10);

	// Fetch community scripts
	const result = listScripts({ query, type, category, page, limit: 24 });
	const lastSync = getLastSyncTime();
	const categories = getAllCategories();

	// Fetch Proxmox OS templates
	let osTemplates: ProxmoxStorageContent[] = [];
	let proxmoxConnected = false;
	try {
		const config = getEnvConfig();
		await authenticate();
		proxmoxConnected = true;
		osTemplates = await listAllOsTemplates(config.proxmox.node_name) ?? [];
	} catch {
		proxmoxConnected = false;
	}

	return {
		...result,
		lastSync,
		categories,
		osTemplates,
		proxmoxConnected,
		query: query ?? '',
		selectedType: type ?? '',
		selectedCategory: category ?? '',
		selectedSource: source
	};
};
