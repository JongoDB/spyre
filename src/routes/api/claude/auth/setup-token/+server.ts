import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { setupToken } from '$lib/server/claude-auth';

/**
 * POST /api/claude/auth/setup-token
 *
 * Set up Claude auth using a token/API key.
 * Body: { token: string }
 */
export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => ({}));
  const token = body.token as string | undefined;

  if (!token || typeof token !== 'string' || token.trim().length === 0) {
    return json({ error: 'Token is required' }, { status: 400 });
  }

  const result = await setupToken(token.trim());

  if (!result.success) {
    return json({ error: result.error ?? 'Token setup failed' }, { status: 400 });
  }

  return json({ message: 'Token configured successfully' });
};
