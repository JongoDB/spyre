import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';

export const DELETE: RequestHandler = async ({ params }) => {
  const db = getDb();
  const result = db.prepare(
    "UPDATE claude_task_queue SET status = 'cancelled' WHERE id = ? AND env_id = ? AND status = 'queued'"
  ).run(params.itemId, params.envId);

  if (result.changes === 0) {
    return json({ code: 'NOT_FOUND', message: 'Queue item not found or already processed' }, { status: 404 });
  }

  return json({ success: true });
};

export const PATCH: RequestHandler = async ({ params, request }) => {
  try {
    const body = await request.json();
    const { position } = body;

    if (typeof position !== 'number') {
      return json({ code: 'INVALID_REQUEST', message: 'position must be a number' }, { status: 400 });
    }

    const db = getDb();
    const result = db.prepare(
      'UPDATE claude_task_queue SET position = ? WHERE id = ? AND env_id = ?'
    ).run(position, params.itemId, params.envId);

    if (result.changes === 0) {
      return json({ code: 'NOT_FOUND', message: 'Queue item not found' }, { status: 404 });
    }

    return json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update queue item';
    return json({ code: 'QUEUE_ERROR', message }, { status: 500 });
  }
};
