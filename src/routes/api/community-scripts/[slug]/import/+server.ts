import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { importAsTemplate } from '$lib/server/community-scripts';

export const POST: RequestHandler = async ({ params, request }) => {
	try {
		const body = await request.json().catch(() => ({}));
		const result = await importAsTemplate(params.slug, body?.name);
		return json(result, { status: 201 });
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		const e = err as { code?: string; message?: string };
		if (e.code === 'NOT_FOUND') throw error(404, e.message ?? 'Script not found');
		if (e.code === 'SYNC_FAILED') throw error(502, e.message ?? 'Sync failed');
		if (e.code === 'DUPLICATE_NAME') throw error(409, e.message ?? 'Template name already exists');
		throw error(500, e.message ?? 'Unknown error');
	}
};
