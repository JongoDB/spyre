import type { PageServerLoad } from './$types';
import { listPoolsWithItemCounts } from '$lib/server/software-pools';

export const load: PageServerLoad = async () => {
	const pools = listPoolsWithItemCounts();
	return { pools };
};
