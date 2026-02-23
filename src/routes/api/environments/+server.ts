import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listEnvironments, createEnvironment } from '$lib/server/environments';
import type { CreateEnvironmentRequest } from '$lib/types/environment';

export const GET: RequestHandler = async () => {
  try {
    const environments = listEnvironments();
    return json(environments);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    throw error(500, `Failed to list environments: ${message}`);
  }
};

export const POST: RequestHandler = async ({ request }) => {
  let body: CreateEnvironmentRequest;
  try {
    body = await request.json();
  } catch {
    throw error(400, 'Invalid JSON in request body.');
  }

  if (!body.name || typeof body.name !== 'string') {
    throw error(400, 'A valid environment name is required.');
  }
  if (body.type !== 'lxc' && body.type !== 'vm') {
    throw error(400, "Environment type must be 'lxc' or 'vm'.");
  }
  if (!body.template || typeof body.template !== 'string') {
    throw error(400, 'A valid template identifier is required.');
  }
  if (typeof body.cores !== 'number' || body.cores < 1) {
    throw error(400, 'Cores must be a positive number.');
  }
  if (typeof body.memory !== 'number' || body.memory < 1) {
    throw error(400, 'Memory (MB) must be a positive number.');
  }
  if (typeof body.disk !== 'number' || body.disk < 1) {
    throw error(400, 'Disk (GB) must be a positive number.');
  }

  try {
    const environment = await createEnvironment(body);
    return json(environment, { status: 201 });
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err) {
      throw err; // Re-throw SvelteKit errors
    }
    const message = err instanceof Error ? err.message :
      (err as { message?: string })?.message ?? 'Unknown error';
    throw error(500, `Failed to create environment: ${message}`);
  }
};
