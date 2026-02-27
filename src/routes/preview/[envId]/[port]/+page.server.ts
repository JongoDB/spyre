import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getEnvironment } from '$lib/server/environments';
import { getServicesForEnv } from '$lib/server/service-detector';

export const load: PageServerLoad = async ({ params }) => {
  const env = getEnvironment(params.envId);
  if (!env) throw error(404, 'Environment not found');
  if (!env.ip_address) throw error(400, 'Environment has no IP address');

  const port = parseInt(params.port, 10);
  if (isNaN(port) || port < 1 || port > 65535) throw error(400, 'Invalid port');

  const services = getServicesForEnv(params.envId);

  return {
    envId: params.envId,
    envName: env.name,
    port,
    services,
  };
};
