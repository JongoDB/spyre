import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveTemplate } from '$lib/server/templates';

export const GET: RequestHandler = async ({ params }) => {
	try {
		const resolved = resolveTemplate(params.id);
		return json(resolved);
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		const e = err as { code?: string; message?: string };
		if (e.code === 'DUPLICATE_NAME') throw error(409, e.message ?? 'Duplicate template name');
		if (e.code === 'NOT_FOUND') throw error(404, e.message ?? 'Template not found');
		throw error(500, e.message ?? 'Unknown error');
	}
};
