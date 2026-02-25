import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { startDevcontainer } from '$lib/server/devcontainers';

/**
 * POST /api/devcontainers/:id/start — Start a stopped devcontainer.
 */
export const POST: RequestHandler = async ({ params }) => {
	try {
		await startDevcontainer(params.id);
		return json({ ok: true });
	} catch (err: unknown) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		const e = err as { message?: string };
		throw error(500, e.message ?? 'Failed to start devcontainer');
	}
};
