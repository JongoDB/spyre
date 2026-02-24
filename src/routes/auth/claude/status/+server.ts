import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { checkAuthStatus } from '$lib/server/claude-auth';

export const GET: RequestHandler = async () => {
  const state = await checkAuthStatus();
  return json(state);
};
