import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getSoftware } from '$lib/server/software-repo';

export const load: PageServerLoad = ({ params }) => {
	const entry = getSoftware(params.id);
	if (!entry) {
		throw error(404, 'Software entry not found');
	}
	return { entry };
};
