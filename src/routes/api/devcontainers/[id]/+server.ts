import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDevcontainerWithPersona, deleteDevcontainer } from '$lib/server/devcontainers';

/**
 * GET /api/devcontainers/:id — Get devcontainer detail.
 */
export const GET: RequestHandler = async ({ params }) => {
	const dc = getDevcontainerWithPersona(params.id);
	if (!dc) throw error(404, 'Devcontainer not found');
	return json(dc);
};

/**
 * DELETE /api/devcontainers/:id — Delete a devcontainer.
 */
export const DELETE: RequestHandler = async ({ params }) => {
	try {
		await deleteDevcontainer(params.id);
		return json({ ok: true });
	} catch (err: unknown) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		const e = err as { message?: string };
		throw error(500, e.message ?? 'Failed to delete devcontainer');
	}
};
