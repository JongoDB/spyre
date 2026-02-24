import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadRawConfig, saveConfig, deleteConfig } from '$lib/server/config-store';

export const GET: RequestHandler = async ({ params }) => {
	try {
		const content = loadRawConfig(params.name);
		return json({ name: params.name, content });
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		const e = err as { code?: string; message?: string };
		if (e.code === 'NOT_FOUND') throw error(404, e.message ?? 'Config not found');
		throw error(500, e.message ?? 'Failed to load config');
	}
};

export const PUT: RequestHandler = async ({ params, request }) => {
	try {
		const body = await request.json();

		if (!body.content || typeof body.content !== 'string') {
			throw error(400, 'Missing required field: content (string)');
		}

		const result = saveConfig(params.name, body.content);
		if (!result.valid) {
			return json({ valid: false, errors: result.errors, warnings: result.warnings }, { status: 422 });
		}

		return json({ valid: true, warnings: result.warnings });
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		const e = err as { code?: string; message?: string };
		throw error(500, e.message ?? 'Failed to save config');
	}
};

export const DELETE: RequestHandler = async ({ params }) => {
	try {
		deleteConfig(params.name);
		return new Response(null, { status: 204 });
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		const e = err as { code?: string; message?: string };
		if (e.code === 'NOT_FOUND') throw error(404, e.message ?? 'Config not found');
		if (e.code === 'HAS_DEPENDENTS') throw error(409, e.message ?? 'Config has dependents');
		throw error(500, e.message ?? 'Failed to delete config');
	}
};
