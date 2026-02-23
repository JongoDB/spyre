import type { PageServerLoad } from './$types';
import { listScripts, getLastSyncTime, getAllCategories } from '$lib/server/community-scripts';

export const load: PageServerLoad = async ({ url }) => {
	const query = url.searchParams.get('query') ?? undefined;
	const type = url.searchParams.get('type') as 'ct' | 'vm' | undefined;
	const category = url.searchParams.get('category') ?? undefined;
	const page = parseInt(url.searchParams.get('page') ?? '1', 10);

	const result = listScripts({ query, type, category, page, limit: 24 });
	const lastSync = getLastSyncTime();
	const categories = getAllCategories();

	return {
		...result,
		lastSync,
		categories,
		query: query ?? '',
		selectedType: type ?? '',
		selectedCategory: category ?? ''
	};
};
