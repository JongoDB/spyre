import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { generateOAuthFlow, exchangeAuthCode } from '$lib/server/claude-auth';

// Store active PKCE flows (code_verifier) keyed by state.
// In-memory is fine — these are short-lived and server-local.
const activeFlows = new Map<string, { codeVerifier: string; createdAt: number }>();

// Clean up flows older than 10 minutes
function cleanupStaleFlows(): void {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [state, flow] of activeFlows) {
    if (flow.createdAt < cutoff) activeFlows.delete(state);
  }
}

/**
 * POST /api/claude/auth/oauth-flow
 *
 * Two actions:
 *
 * 1. { action: "initiate" }
 *    Generate PKCE parameters and return the authorization URL.
 *    The client opens this URL in a new window/tab.
 *
 * 2. { action: "exchange", code: "...", state: "..." }
 *    Exchange the authorization code for tokens (completes the PKCE flow).
 */
export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => ({}));
  const action = body.action as string | undefined;

  if (action === 'initiate') {
    cleanupStaleFlows();

    const flow = generateOAuthFlow();

    // Store the verifier so we can use it during exchange
    activeFlows.set(flow.state, {
      codeVerifier: flow.codeVerifier,
      createdAt: Date.now(),
    });

    return json({
      authorizeUrl: flow.authorizeUrl,
      state: flow.state,
    });
  }

  if (action === 'exchange') {
    const code = body.code as string | undefined;
    const state = body.state as string | undefined;

    if (!code || !state) {
      return json(
        { error: 'Missing code or state parameter' },
        { status: 400 }
      );
    }

    // Look up the PKCE verifier for this flow
    const flow = activeFlows.get(state);
    if (!flow) {
      return json(
        { error: 'Unknown or expired OAuth flow. Please start a new flow.' },
        { status: 400 }
      );
    }

    // Clean up the flow
    activeFlows.delete(state);

    const result = await exchangeAuthCode(code, flow.codeVerifier);

    if (!result.success) {
      return json(
        { error: result.error ?? 'Code exchange failed' },
        { status: 502 }
      );
    }

    return json({
      message: 'Authentication successful',
      expiresAt: result.expiresAt,
    });
  }

  return json({ error: 'Invalid action. Use "initiate" or "exchange".' }, { status: 400 });
};
