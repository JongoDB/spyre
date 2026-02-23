import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getEnvironment,
	startEnvironment,
	stopEnvironment,
	destroyEnvironment
} from '$lib/server/environments';

interface BulkRequest {
	action: 'start' | 'stop' | 'destroy';
	ids: string[];
}

interface BulkResult {
	id: string;
	success: boolean;
	error?: string;
}

export const POST: RequestHandler = async ({ request }) => {
	let body: BulkRequest;
	try {
		body = await request.json();
	} catch {
		return json({ code: 'INVALID_REQUEST', message: 'Invalid JSON body.' }, { status: 400 });
	}

	const { action, ids } = body;

	if (!action || !['start', 'stop', 'destroy'].includes(action)) {
		return json({ code: 'INVALID_ACTION', message: 'Action must be start, stop, or destroy.' }, { status: 400 });
	}

	if (!Array.isArray(ids) || ids.length === 0) {
		return json({ code: 'INVALID_IDS', message: 'Must provide at least one environment ID.' }, { status: 400 });
	}

	if (ids.length > 50) {
		return json({ code: 'TOO_MANY', message: 'Maximum 50 environments per bulk action.' }, { status: 400 });
	}

	const results: BulkResult[] = [];

	// Execute sequentially to avoid overwhelming Proxmox
	for (const id of ids) {
		try {
			const env = getEnvironment(id);
			if (!env) {
				results.push({ id, success: false, error: 'Environment not found.' });
				continue;
			}

			switch (action) {
				case 'start':
					await startEnvironment(id);
					break;
				case 'stop':
					await stopEnvironment(id);
					break;
				case 'destroy':
					await destroyEnvironment(id);
					break;
			}

			results.push({ id, success: true });
		} catch (err) {
			const message = err instanceof Error
				? err.message
				: (err as { message?: string })?.message ?? String(err);
			results.push({ id, success: false, error: message });
		}
	}

	return json({ results });
};
