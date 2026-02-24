import type { PageServerLoad } from './$types';
import { loadRawConfig, configExists } from '$lib/server/config-store';
import { error } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ params }) => {
	const name = params.name;
	if (!name) {
		throw error(400, 'Config name is required.');
	}

	if (!configExists(name)) {
		throw error(404, `Config '${name}' not found.`);
	}

	const rawYaml = loadRawConfig(name);

	return {
		configName: name,
		rawYaml
	};
};
