import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getTask, getTaskEvents } from '$lib/server/claude-bridge';

export const GET: RequestHandler = async ({ params, url }) => {
  const task = getTask(params.taskId);
  if (!task) {
    return json({ code: 'NOT_FOUND', message: 'Task not found' }, { status: 404 });
  }

  const afterParam = url.searchParams.get('after');
  const afterSeq = afterParam != null ? parseInt(afterParam, 10) : undefined;

  const events = getTaskEvents(params.taskId, afterSeq);
  return json({ events });
};
