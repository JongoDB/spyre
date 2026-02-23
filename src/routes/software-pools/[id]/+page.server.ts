import type { PageServerLoad } from './$types';
import { getPool } from '$lib/server/software-pools';
import { error } from '@sveltejs/kit';

export const load: PageServerLoad = async ({ params }) => {
	const pool = getPool(params.id);
	if (!pool) throw error(404, 'Software pool not found');
	return { pool };
};
