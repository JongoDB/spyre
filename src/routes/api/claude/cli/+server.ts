import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getClaudeCliStatus } from '$lib/server/claude-auth';

/**
 * GET /api/claude/cli
 *
 * Returns the Claude CLI installation status on the controller.
 */
export const GET: RequestHandler = async () => {
  const status = await getClaudeCliStatus();
  return json(status);
};
