import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listConfigs, saveConfig } from '$lib/server/config-store';

export const GET: RequestHandler = async () => {
	try {
		const configs = listConfigs();
		return json(configs);
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		const e = err as { code?: string; message?: string };
		throw error(500, e.message ?? 'Failed to list configs');
	}
};

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();

		if (!body.name || typeof body.name !== 'string') {
			throw error(400, 'Missing required field: name (string)');
		}
		if (!body.content || typeof body.content !== 'string') {
			throw error(400, 'Missing required field: content (string)');
		}

		const result = saveConfig(body.name, body.content);
		if (!result.valid) {
			return json({ valid: false, errors: result.errors, warnings: result.warnings }, { status: 422 });
		}

		return json({ valid: true, warnings: result.warnings }, { status: 201 });
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		const e = err as { code?: string; message?: string };
		throw error(500, e.message ?? 'Failed to create config');
	}
};
