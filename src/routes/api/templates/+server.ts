import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listTemplates, createTemplate } from '$lib/server/templates';

export const GET: RequestHandler = async () => {
	try {
		const templates = listTemplates();
		return json(templates);
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		const e = err as { code?: string; message?: string };
		if (e.code === 'DUPLICATE_NAME') throw error(409, e.message ?? 'Duplicate template name');
		if (e.code === 'NOT_FOUND') throw error(404, e.message ?? 'Template not found');
		throw error(500, e.message ?? 'Unknown error');
	}
};

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();

		if (!body.name || typeof body.name !== 'string') {
			throw error(400, 'Missing required field: name (string)');
		}

		const template = createTemplate(body);
		return json(template, { status: 201 });
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		const e = err as { code?: string; message?: string };
		if (e.code === 'DUPLICATE_NAME') throw error(409, e.message ?? 'Duplicate template name');
		if (e.code === 'NOT_FOUND') throw error(404, e.message ?? 'Template not found');
		throw error(500, e.message ?? 'Unknown error');
	}
};
