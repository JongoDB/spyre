import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveConfig } from '$lib/server/config-store';

export const GET: RequestHandler = async ({ params }) => {
	try {
		const resolved = resolveConfig(params.name);
		return json(resolved);
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		const e = err as { code?: string; message?: string };
		if (e.code === 'NOT_FOUND') throw error(404, e.message ?? 'Config not found');
		if (e.code === 'INVALID_CONFIG') throw error(422, e.message ?? 'Invalid config');
		if (e.code === 'CIRCULAR_REF') throw error(422, e.message ?? 'Circular reference in extends chain');
		if (e.code === 'MAX_DEPTH') throw error(422, e.message ?? 'Extends chain too deep');
		throw error(500, e.message ?? 'Failed to resolve config');
	}
};
