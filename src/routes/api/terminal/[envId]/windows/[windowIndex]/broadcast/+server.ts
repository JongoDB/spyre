import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getEnvironment } from '$lib/server/environments';
import { getConnection } from '$lib/server/ssh-pool';
import { ensureSession, setBroadcast } from '$lib/server/tmux-controller';

export const POST: RequestHandler = async ({ params, request }) => {
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
  const enabled = body.enabled === true;

  try {
    const client = await getConnection(params.envId);
    await ensureSession(client);
    await setBroadcast(client, 'spyre', windowIndex, enabled);
    return json({ ok: true, enabled });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ code: 'SSH_ERROR', message }, { status: 500 });
  }
};
