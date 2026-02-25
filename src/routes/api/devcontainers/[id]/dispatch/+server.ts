import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDevcontainer } from '$lib/server/devcontainers';
import { dispatch } from '$lib/server/claude-bridge';

/**
 * POST /api/devcontainers/:id/dispatch — Dispatch a Claude task to a devcontainer.
 * Body: { prompt: string, working_dir?: string }
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const dc = getDevcontainer(params.id);
	if (!dc) throw error(404, 'Devcontainer not found');
	if (dc.status !== 'running') throw error(400, `Devcontainer is ${dc.status}, not running`);

	let body: { prompt: string; working_dir?: string };
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON in request body');
	}

	if (!body.prompt || typeof body.prompt !== 'string') {
		throw error(400, 'prompt is required');
	}

	try {
		const taskId = await dispatch({
			envId: dc.env_id,
			prompt: body.prompt,
			workingDir: body.working_dir ?? dc.working_dir,
			devcontainerId: dc.id
		});
		return json({ taskId }, { status: 201 });
	} catch (err: unknown) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		const e = err as { code?: string; message?: string };
		if (e.code === 'ALREADY_RUNNING') throw error(409, e.message ?? 'Task already running');
		if (e.code === 'RATE_LIMITED') throw error(429, e.message ?? 'Rate limited');
		throw error(500, e.message ?? 'Failed to dispatch task');
	}
};
