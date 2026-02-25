import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listDevcontainers, createDevcontainer } from '$lib/server/devcontainers';
import type { DevcontainerCreateInput } from '$lib/types/devcontainer';

/**
 * GET /api/devcontainers?envId=xxx — List devcontainers for an environment.
 */
export const GET: RequestHandler = async ({ url }) => {
	const envId = url.searchParams.get('envId');
	if (!envId) throw error(400, 'envId query parameter is required');

	return json(listDevcontainers(envId));
};

/**
 * POST /api/devcontainers — Create a new devcontainer.
 * Body: { env_id: string, persona_id: string, service_name?: string }
 */
export const POST: RequestHandler = async ({ request }) => {
	let body: DevcontainerCreateInput;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON in request body');
	}

	if (!body.env_id) throw error(400, 'env_id is required');
	if (!body.persona_id) throw error(400, 'persona_id is required');

	try {
		const dc = await createDevcontainer(body);
		return json(dc, { status: 201 });
	} catch (err: unknown) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		const e = err as { message?: string };
		throw error(500, e.message ?? 'Failed to create devcontainer');
	}
};
