import type { PageServerLoad } from './$types';
import { listSoftware } from '$lib/server/software-repo';
import { seedSoftwareRepo } from '$lib/server/software-repo-seed';

export const load: PageServerLoad = () => {
	// Ensure seed data exists
	seedSoftwareRepo();

	const entries = listSoftware();
	return { entries };
};
