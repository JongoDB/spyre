import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resumeTask } from '$lib/server/claude-bridge';

export const POST: RequestHandler = async ({ params }) => {
  try {
    const newTaskId = await resumeTask(params.taskId);
    return json({ taskId: newTaskId }, { status: 201 });
  } catch (err) {
    const code = (err as { code?: string })?.code ?? 'RESUME_ERROR';
    const message = (err as { message?: string })?.message ?? 'Failed to resume task';
    const status = code === 'NOT_FOUND' ? 404 : code === 'NO_SESSION' ? 400 : 500;
    return json({ code, message }, { status });
  }
};
