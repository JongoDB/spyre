import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { duplicateTemplate } from '$lib/server/templates';

export const POST: RequestHandler = async ({ params, request }) => {
	try {
		const body = await request.json().catch(() => ({}));
		const template = duplicateTemplate(params.id, body?.name);
		return json(template, { status: 201 });
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		const e = err as { code?: string; message?: string };
		if (e.code === 'DUPLICATE_NAME') throw error(409, e.message ?? 'Duplicate template name');
		if (e.code === 'NOT_FOUND') throw error(404, e.message ?? 'Template not found');
		throw error(500, e.message ?? 'Unknown error');
	}
};
