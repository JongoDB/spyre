import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { getSession } from '$lib/server/orchestrator';
import type { AskUserRequest } from '$lib/types/orchestrator';

/**
 * GET /api/orchestrator/:id/ask-user — List pending ask-user requests.
 */
export const GET: RequestHandler = async ({ params }) => {
	const session = getSession(params.id);
	if (!session) throw error(404, 'Orchestrator session not found');

	const db = getDb();
	const requests = db.prepare(
		"SELECT * FROM ask_user_requests WHERE orchestrator_id = ? AND status = 'pending' ORDER BY created_at ASC"
	).all(params.id) as AskUserRequest[];

	return json(requests);
};

/**
 * POST /api/orchestrator/:id/ask-user — Submit an answer to an ask-user request.
 * Body: { request_id, response }
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const session = getSession(params.id);
	if (!session) throw error(404, 'Orchestrator session not found');

	let body: Record<string, unknown>;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON in request body');
	}

	const requestId = body.request_id as string;
	const response = body.response as string;

	if (!requestId) throw error(400, 'request_id is required');
	if (!response) throw error(400, 'response is required');

	const db = getDb();
	const existing = db.prepare(
		'SELECT * FROM ask_user_requests WHERE id = ? AND orchestrator_id = ?'
	).get(requestId, params.id) as AskUserRequest | undefined;

	if (!existing) throw error(404, 'Ask-user request not found');
	if (existing.status !== 'pending') throw error(400, `Request is already ${existing.status}`);

	db.prepare(
		"UPDATE ask_user_requests SET status = 'answered', response = ?, answered_at = datetime('now') WHERE id = ?"
	).run(response, requestId);

	return json({ success: true, request_id: requestId });
};
