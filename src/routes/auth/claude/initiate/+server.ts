import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { initiateAuth } from '$lib/server/claude-auth';

export const POST: RequestHandler = async () => {
  try {
    const result = await initiateAuth();
    return json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to initiate authentication';
    return json({ code: 'AUTH_ERROR', message }, { status: 500 });
  }
};
