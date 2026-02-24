import { json } from '@sveltejs/kit';
import { v4 as uuid } from 'uuid';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import type { ClaudeTaskQueueItem } from '$lib/types/claude';

export const GET: RequestHandler = async ({ params }) => {
  const db = getDb();
  const items = db.prepare(
    "SELECT * FROM claude_task_queue WHERE env_id = ? AND status != 'cancelled' ORDER BY position ASC"
  ).all(params.envId) as ClaudeTaskQueueItem[];

  return json(items);
};

export const POST: RequestHandler = async ({ params, request }) => {
  try {
    const body = await request.json();
    const { prompt } = body;

    if (!prompt) {
      return json({ code: 'INVALID_REQUEST', message: 'prompt is required' }, { status: 400 });
    }

    const db = getDb();
    const id = uuid();

    // Get max position for this env
    const maxPos = db.prepare(
      'SELECT MAX(position) as maxPos FROM claude_task_queue WHERE env_id = ?'
    ).get(params.envId) as { maxPos: number | null };

    const position = (maxPos?.maxPos ?? -1) + 1;

    db.prepare(`
      INSERT INTO claude_task_queue (id, env_id, prompt, position, status)
      VALUES (?, ?, ?, ?, 'queued')
    `).run(id, params.envId, prompt, position);

    const item = db.prepare('SELECT * FROM claude_task_queue WHERE id = ?').get(id);
    return json(item, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to add to queue';
    return json({ code: 'QUEUE_ERROR', message }, { status: 500 });
  }
};
