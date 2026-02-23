import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listScripts } from '$lib/server/community-scripts';

export const GET: RequestHandler = async ({ url }) => {
	try {
		const query = url.searchParams.get('query') ?? undefined;
		const typeParam = url.searchParams.get('type');
		const type = (typeParam === 'ct' || typeParam === 'vm') ? typeParam : undefined;
		const category = url.searchParams.get('category') ?? undefined;
		const page = url.searchParams.get('page') ? Number(url.searchParams.get('page')) : undefined;
		const limit = url.searchParams.get('limit')
			? Number(url.searchParams.get('limit'))
			: undefined;

		const result = listScripts({ query, type, category, page, limit });
		return json(result);
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		const e = err as { code?: string; message?: string };
		if (e.code === 'NOT_FOUND') throw error(404, e.message ?? 'Scripts not found');
		if (e.code === 'SYNC_FAILED') throw error(502, e.message ?? 'Sync failed');
		if (e.code === 'DUPLICATE_NAME') throw error(409, e.message ?? 'Duplicate name');
		throw error(500, e.message ?? 'Unknown error');
	}
};
