import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getEnvironment } from '$lib/server/environments';

export const load: PageServerLoad = async ({ params }) => {
  const env = getEnvironment(params.id);
  if (!env) {
    throw error(404, 'Environment not found');
  }

  let metadata: Record<string, unknown> | null = null;
  if (env.metadata) {
    try {
      metadata = JSON.parse(env.metadata);
    } catch {
      metadata = null;
    }
  }

  return {
    environment: env,
    metadata
  };
};
