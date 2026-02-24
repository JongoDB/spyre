import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSoftware, updateSoftware, deleteSoftware } from '$lib/server/software-repo';

export const GET: RequestHandler = ({ params }) => {
	const entry = getSoftware(params.id);
	if (!entry) {
		throw error(404, 'Software entry not found');
	}
	return json(entry);
};

export const PUT: RequestHandler = async ({ params, request }) => {
	const body = await request.json();

	try {
		const entry = updateSoftware(params.id, {
			name: body.name,
			description: body.description,
			logo_url: body.logo_url,
			os_families: body.os_families,
			tags: body.tags
		}, body.instructions);
		return json(entry);
	} catch (err) {
		const e = err as { code?: string; message?: string };
		if (e.code === 'NOT_FOUND') {
			throw error(404, e.message ?? 'Not found');
		}
		if (e.code === 'DUPLICATE_NAME') {
			return json({ code: e.code, message: e.message }, { status: 409 });
		}
		return json({ code: 'INTERNAL', message: e.message ?? 'Failed to update.' }, { status: 500 });
	}
};

export const DELETE: RequestHandler = ({ params }) => {
	try {
		deleteSoftware(params.id);
		return json({ success: true });
	} catch (err) {
		const e = err as { code?: string; message?: string };
		if (e.code === 'NOT_FOUND') {
			throw error(404, e.message ?? 'Not found');
		}
		if (e.code === 'BUILTIN' || e.code === 'IN_USE') {
			return json({ code: e.code, message: e.message }, { status: 409 });
		}
		return json({ code: 'INTERNAL', message: e.message ?? 'Failed to delete.' }, { status: 500 });
	}
};
