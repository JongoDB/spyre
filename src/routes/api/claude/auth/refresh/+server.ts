import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ensureFreshToken, readOAuthTokens, isTokenExpired } from '$lib/server/claude-auth';

/**
 * POST /api/claude/auth/refresh
 *
 * Force-refresh the OAuth access token using the stored refresh token.
 * Returns the new expiry time on success.
 */
export const POST: RequestHandler = async () => {
  const tokens = readOAuthTokens();
  if (!tokens) {
    return json(
      { error: 'No OAuth credentials found. Authenticate first.' },
      { status: 400 }
    );
  }

  const result = await ensureFreshToken();

  if (!result.success) {
    return json(
      { error: result.error ?? 'Token refresh failed' },
      { status: 502 }
    );
  }

  return json({
    message: 'Token refreshed successfully',
    expiresAt: result.expiresAt,
    expiresIn: result.expiresAt ? result.expiresAt - Date.now() : null,
  });
};

/**
 * GET /api/claude/auth/refresh
 *
 * Check current token status without refreshing.
 */
export const GET: RequestHandler = async () => {
  const tokens = readOAuthTokens();
  if (!tokens) {
    return json({
      authenticated: false,
      expired: true,
      expiresAt: null,
      expiresIn: null,
    });
  }

  const expired = isTokenExpired(tokens);
  return json({
    authenticated: true,
    expired,
    expiresAt: tokens.expiresAt,
    expiresIn: Math.max(0, tokens.expiresAt - Date.now()),
    subscriptionType: tokens.subscriptionType ?? null,
  });
};
