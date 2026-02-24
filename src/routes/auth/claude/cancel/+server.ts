import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { cancelAuth } from '$lib/server/claude-auth';

export const POST: RequestHandler = async () => {
  cancelAuth();
  return json({ success: true });
};
