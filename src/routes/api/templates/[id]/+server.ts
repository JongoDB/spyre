import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getTemplateWithRelations, updateTemplate, deleteTemplate } from '$lib/server/templates';

export const GET: RequestHandler = async ({ params }) => {
	try {
		const template = getTemplateWithRelations(params.id);
		if (!template) {
			throw error(404, 'Template not found');
		}
		return json(template);
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		const e = err as { code?: string; message?: string };
		if (e.code === 'DUPLICATE_NAME') throw error(409, e.message ?? 'Duplicate template name');
		if (e.code === 'NOT_FOUND') throw error(404, e.message ?? 'Template not found');
		throw error(500, e.message ?? 'Unknown error');
	}
};

export const PUT: RequestHandler = async ({ params, request }) => {
	try {
		const body = await request.json();
		const template = updateTemplate(params.id, body);
		return json(template);
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		const e = err as { code?: string; message?: string };
		if (e.code === 'DUPLICATE_NAME') throw error(409, e.message ?? 'Duplicate template name');
		if (e.code === 'NOT_FOUND') throw error(404, e.message ?? 'Template not found');
		throw error(500, e.message ?? 'Unknown error');
	}
};

export const DELETE: RequestHandler = async ({ params }) => {
	try {
		deleteTemplate(params.id);
		return new Response(null, { status: 204 });
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		const e = err as { code?: string; message?: string };
		if (e.code === 'DUPLICATE_NAME') throw error(409, e.message ?? 'Duplicate template name');
		if (e.code === 'NOT_FOUND') throw error(404, e.message ?? 'Template not found');
		throw error(500, e.message ?? 'Unknown error');
	}
};
