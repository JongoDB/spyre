import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { installClaudeCli } from '$lib/server/claude-auth';

/**
 * POST /api/claude/cli/install
 *
 * Install the Claude CLI on the controller.
 */
export const POST: RequestHandler = async () => {
  const result = await installClaudeCli();

  if (!result.success) {
    return json(
      { error: result.error ?? 'Installation failed', output: result.output },
      { status: 500 }
    );
  }

  return json({ message: 'Claude CLI installed successfully', output: result.output });
};
