import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getEnvironment } from '$lib/server/environments';
import { getConnection } from '$lib/server/ssh-pool';
import { ensureSession, listWindows, createWindow } from '$lib/server/tmux-controller';

export const GET: RequestHandler = async ({ params }) => {
  const env = getEnvironment(params.envId);
  if (!env) {
    return json({ code: 'NOT_FOUND', message: 'Environment not found' }, { status: 404 });
  }

  if (env.status !== 'running') {
    return json({ code: 'INVALID_STATE', message: `Environment is ${env.status}, not running` }, { status: 400 });
  }

  try {
    const client = await getConnection(params.envId);
    await ensureSession(client);
    const windows = await listWindows(client);
    return json(windows);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ code: 'SSH_ERROR', message }, { status: 500 });
  }
};

export const POST: RequestHandler = async ({ params }) => {
  const env = getEnvironment(params.envId);
  if (!env) {
    return json({ code: 'NOT_FOUND', message: 'Environment not found' }, { status: 404 });
  }

  if (env.status !== 'running') {
    return json({ code: 'INVALID_STATE', message: `Environment is ${env.status}, not running` }, { status: 400 });
  }

  try {
    const client = await getConnection(params.envId);
    await ensureSession(client);
    const windowIndex = await createWindow(client);
    return json({ windowIndex, name: `window-${windowIndex}` }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ code: 'SSH_ERROR', message }, { status: 500 });
  }
};
