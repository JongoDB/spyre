import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getEnvironment } from '$lib/server/environments';
import { getServicesForEnv, scanAndStoreServices } from '$lib/server/service-detector';

export const GET: RequestHandler = async ({ params }) => {
  const env = getEnvironment(params.id);
  if (!env) throw error(404, 'Environment not found');

  const services = getServicesForEnv(params.id);
  return json(services);
};

export const POST: RequestHandler = async ({ params }) => {
  const env = getEnvironment(params.id);
  if (!env) throw error(404, 'Environment not found');
  if (env.status !== 'running') throw error(400, 'Environment is not running');
  if (!env.ip_address) throw error(400, 'Environment has no IP address');

  try {
    const services = await scanAndStoreServices(params.id);
    return json(services);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw error(502, `Service scan failed: ${msg}`);
  }
};
