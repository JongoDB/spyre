import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveConfig } from '$lib/server/config-store';
import { configToCreateRequest } from '$lib/server/config-converter';
import { createEnvironment } from '$lib/server/environments';

/**
 * POST /api/configs/[...name]/create-env — Create an environment directly from a config.
 * Body: { name: string, install_claude?: boolean }
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const configName = params.name;
	if (!configName) {
		throw error(400, 'Config name is required.');
	}

	let body: { name: string; install_claude?: boolean; persona_id?: string };
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON in request body.');
	}

	if (!body.name || typeof body.name !== 'string') {
		throw error(400, 'Environment name is required.');
	}

	try {
		// Resolve the config (follows extends chains)
		const resolvedConfig = resolveConfig(configName);

		// Convert to CreateEnvironmentRequest
		const req = configToCreateRequest(resolvedConfig, body.name.trim());
		if (body.install_claude !== undefined) {
			req.install_claude = body.install_claude;
		}
		if (body.persona_id) {
			req.persona_id = body.persona_id;
		}

		// Create the environment
		const environment = await createEnvironment(req);
		return json(environment, { status: 201 });
	} catch (err: unknown) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		const e = err as { code?: string; message?: string };
		if (e.code === 'NOT_FOUND') throw error(404, e.message ?? 'Config not found.');
		if (e.code === 'INVALID_CONFIG') throw error(422, e.message ?? 'Config is invalid.');
		throw error(500, e.message ?? 'Failed to create environment from config.');
	}
};
