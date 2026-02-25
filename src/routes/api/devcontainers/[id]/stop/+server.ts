import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { stopDevcontainer } from '$lib/server/devcontainers';

/**
 * POST /api/devcontainers/:id/stop — Stop a running devcontainer.
 */
export const POST: RequestHandler = async ({ params }) => {
	try {
		await stopDevcontainer(params.id);
		return json({ ok: true });
	} catch (err: unknown) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		const e = err as { message?: string };
		throw error(500, e.message ?? 'Failed to stop devcontainer');
	}
};
