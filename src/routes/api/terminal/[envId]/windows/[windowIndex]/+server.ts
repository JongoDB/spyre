import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getEnvironment } from '$lib/server/environments';
import { getConnection } from '$lib/server/ssh-pool';
import { ensureSession, killWindow, renameWindow } from '$lib/server/tmux-controller';

export const DELETE: RequestHandler = async ({ params }) => {
  const env = getEnvironment(params.envId);
  if (!env) {
    return json({ code: 'NOT_FOUND', message: 'Environment not found' }, { status: 404 });
  }

  if (env.status !== 'running') {
    return json({ code: 'INVALID_STATE', message: `Environment is ${env.status}, not running` }, { status: 400 });
  }

  const windowIndex = parseInt(params.windowIndex, 10);
  if (isNaN(windowIndex)) {
    return json({ code: 'BAD_REQUEST', message: 'Invalid window index' }, { status: 400 });
  }

  try {
    const client = await getConnection(params.envId);
    await ensureSession(client);
    await killWindow(client, 'spyre', windowIndex);
    return json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ code: 'SSH_ERROR', message }, { status: 500 });
  }
};

export const PATCH: RequestHandler = async ({ params, request }) => {
  const env = getEnvironment(params.envId);
  if (!env) {
    return json({ code: 'NOT_FOUND', message: 'Environment not found' }, { status: 404 });
  }

  if (env.status !== 'running') {
    return json({ code: 'INVALID_STATE', message: `Environment is ${env.status}, not running` }, { status: 400 });
  }

  const windowIndex = parseInt(params.windowIndex, 10);
  if (isNaN(windowIndex)) {
    return json({ code: 'BAD_REQUEST', message: 'Invalid window index' }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const newName = typeof body.name === 'string' ? body.name.trim() : '';
  if (!newName) {
    return json({ code: 'BAD_REQUEST', message: 'Name is required' }, { status: 400 });
  }

  try {
    const client = await getConnection(params.envId);
    await ensureSession(client);
    await renameWindow(client, 'spyre', windowIndex, newName);
    return json({ ok: true, name: newName });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ code: 'SSH_ERROR', message }, { status: 500 });
  }
};
