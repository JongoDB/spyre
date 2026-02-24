import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { validateYamlString } from '$lib/server/config-validator';

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json();

		if (!body.content || typeof body.content !== 'string') {
			throw error(400, 'Missing required field: content (string)');
		}

		const result = validateYamlString(body.content);
		return json(result);
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		const e = err as { code?: string; message?: string };
		throw error(500, e.message ?? 'Validation failed');
	}
};
