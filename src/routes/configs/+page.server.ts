import type { PageServerLoad } from './$types';
import { listConfigs } from '$lib/server/config-store';

export const load: PageServerLoad = async () => {
	const configs = listConfigs();

	const bases = configs.filter(c => c.kind === 'EnvironmentBase');
	const environments = configs.filter(c => c.kind === 'Environment');

	return { bases, environments };
};
