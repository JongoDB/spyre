import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getTask, cancelTask } from '$lib/server/claude-bridge';

export const GET: RequestHandler = async ({ params }) => {
  const task = getTask(params.taskId);
  if (!task) {
    return json({ code: 'NOT_FOUND', message: 'Task not found' }, { status: 404 });
  }
  return json(task);
};

export const DELETE: RequestHandler = async ({ params }) => {
  const cancelled = cancelTask(params.taskId);
  if (!cancelled) {
    return json({ code: 'NOT_FOUND', message: 'Task not found or already completed' }, { status: 404 });
  }
  return json({ success: true });
};
