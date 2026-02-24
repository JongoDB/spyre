import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { handleCallback } from '$lib/server/claude-auth';

export const GET: RequestHandler = async ({ url }) => {
  await handleCallback(url.searchParams);
  throw redirect(302, '/settings/claude');
};
