import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { rebuildDevcontainer } from '$lib/server/devcontainers';

/**
 * POST /api/devcontainers/:id/rebuild — Rebuild a devcontainer image and recreate.
 */
export const POST: RequestHandler = async ({ params }) => {
	try {
		await rebuildDevcontainer(params.id);
		return json({ ok: true });
	} catch (err: unknown) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		const e = err as { message?: string };
		throw error(500, e.message ?? 'Failed to rebuild devcontainer');
	}
};
