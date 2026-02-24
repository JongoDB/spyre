import type { PageServerLoad } from './$types';
import { listConfigs } from '$lib/server/config-store';
import { listIndexedConfigs, rebuildIndex } from '$lib/server/config-index';

export const load: PageServerLoad = async () => {
	// Rebuild the index to ensure it's fresh
	try {
		rebuildIndex();
	} catch {
		// Non-fatal — fall back to filesystem listing
	}

	// Try indexed configs first (fast DB query), fall back to filesystem
	let indexed: Array<{ name: string; kind: string | null; description: string | null; extends_name: string | null; os_type: string | null; os_template: string | null; labels: string | null; software_ids: string | null; has_services: number; has_claude: number; modified_at: string | null }> = [];
	try {
		indexed = listIndexedConfigs();
	} catch {
		// Fall back to filesystem
	}

	if (indexed.length > 0) {
		const configs = indexed.map(c => ({
			name: c.name,
			kind: (c.kind ?? 'Environment') as 'Environment' | 'EnvironmentBase',
			description: c.description ?? undefined,
			extends: c.extends_name ?? undefined,
			labels: c.labels ? JSON.parse(c.labels) : undefined,
			osType: c.os_type ?? undefined,
			osTemplate: c.os_template ?? undefined,
			hasServices: c.has_services === 1,
			hasClaude: c.has_claude === 1,
			modifiedAt: c.modified_at ?? new Date().toISOString(),
		}));

		const bases = configs.filter(c => c.kind === 'EnvironmentBase');
		const environments = configs.filter(c => c.kind === 'Environment');

		return { bases, environments };
	}

	// Fallback: filesystem listing
	const configs = listConfigs();
	const bases = configs.filter(c => c.kind === 'EnvironmentBase').map(c => ({
		...c,
		osType: undefined as string | undefined,
		osTemplate: undefined as string | undefined,
		hasServices: false,
		hasClaude: false,
	}));
	const environments = configs.filter(c => c.kind === 'Environment').map(c => ({
		...c,
		osType: undefined as string | undefined,
		osTemplate: undefined as string | undefined,
		hasServices: false,
		hasClaude: false,
	}));

	return { bases, environments };
};
