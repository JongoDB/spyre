import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listTasks, dispatch } from '$lib/server/claude-bridge';

export const GET: RequestHandler = async ({ url }) => {
  const envId = url.searchParams.get('envId') ?? undefined;
  const status = url.searchParams.get('status') ?? undefined;
  const limit = url.searchParams.get('limit') ? parseInt(url.searchParams.get('limit')!, 10) : undefined;

  const tasks = listTasks({ envId, status, limit });
  return json(tasks);
};

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json();
    const { envId, prompt, workingDir, personaId } = body;

    if (!envId || !prompt) {
      return json({ code: 'INVALID_REQUEST', message: 'envId and prompt are required' }, { status: 400 });
    }

    const taskId = await dispatch({ envId, prompt, workingDir, personaId });
    return json({ taskId }, { status: 201 });
  } catch (err) {
    const code = (err as { code?: string })?.code ?? 'DISPATCH_ERROR';
    const message = (err as { message?: string })?.message ?? 'Failed to dispatch task';
    const status = code === 'NOT_FOUND' ? 404 :
                   code === 'NOT_INSTALLED' ? 422 :
                   code === 'RATE_LIMITED' ? 429 :
                   code === 'ALREADY_RUNNING' ? 409 : 500;
    return json({ code, message }, { status });
  }
};
