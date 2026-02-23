import type { PageServerLoad } from './$types';
import { listTemplates } from '$lib/server/templates';

export const load: PageServerLoad = async () => {
	const templates = listTemplates();
	return { templates };
};
