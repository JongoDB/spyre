import type { PageServerLoad } from './$types';
import { getScript } from '$lib/server/community-scripts';
import { error } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ params }) => {
	const script = getScript(params.slug);
	if (!script) throw error(404, 'Community script not found');
	return { script };
};
