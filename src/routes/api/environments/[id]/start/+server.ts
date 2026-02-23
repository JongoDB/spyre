import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { startEnvironment } from '$lib/server/environments';

export const POST: RequestHandler = async ({ params }) => {
  const { id } = params;

  if (!id) {
    throw error(400, 'Environment ID is required.');
  }

  try {
    await startEnvironment(id);
    return json({ success: true, id });
  } catch (err) {
    const message = err instanceof Error ? err.message :
      (err as { message?: string })?.message ?? 'Unknown error';
    throw error(500, `Failed to start environment: ${message}`);
  }
};
