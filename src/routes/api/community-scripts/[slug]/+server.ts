import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getScript } from '$lib/server/community-scripts';

export const GET: RequestHandler = async ({ params }) => {
	try {
		const script = await getScript(params.slug);
		return json(script);
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		const e = err as { code?: string; message?: string };
		if (e.code === 'NOT_FOUND') throw error(404, e.message ?? 'Script not found');
		if (e.code === 'SYNC_FAILED') throw error(502, e.message ?? 'Sync failed');
		if (e.code === 'DUPLICATE_NAME') throw error(409, e.message ?? 'Duplicate name');
		throw error(500, e.message ?? 'Unknown error');
	}
};
