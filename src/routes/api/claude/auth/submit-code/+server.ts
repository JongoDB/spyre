import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { submitOauthCode } from '$lib/server/claude-auth';

/**
 * POST /api/claude/auth/submit-code
 *
 * Submit the OAuth auth code to complete the OAuth flow.
 * Body: { code: string }
 */
export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => ({}));
  const code = body.code as string | undefined;

  if (!code || typeof code !== 'string' || code.trim().length === 0) {
    return json({ error: 'Auth code is required' }, { status: 400 });
  }

  const result = await submitOauthCode(code.trim());

  if (!result.success) {
    return json({ error: result.error ?? 'OAuth code submission failed' }, { status: 400 });
  }

  return json({ message: 'Authentication completed successfully' });
};
