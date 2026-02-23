import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listPoolsWithItemCounts, createPool } from '$lib/server/software-pools';

export const GET: RequestHandler = async () => {
  try {
    const pools = listPoolsWithItemCounts();
    return json(pools);
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err) throw err;
    const e = err as { code?: string; message?: string };
    throw error(500, e.message ?? 'Failed to list software pools');
  }
};

export const POST: RequestHandler = async ({ request }) => {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    throw error(400, 'Invalid JSON in request body.');
  }

  if (!body.name || typeof body.name !== 'string') {
    throw error(400, 'A valid pool name is required.');
  }

  try {
    const pool = createPool(body as unknown as Parameters<typeof createPool>[0]);
    return json(pool, { status: 201 });
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err) throw err;
    const e = err as { code?: string; message?: string };
    if (e.code === 'DUPLICATE_NAME') throw error(409, e.message ?? 'A pool with that name already exists.');
    if (e.code === 'NOT_FOUND') throw error(404, e.message ?? 'Software pool not found.');
    if (e.code === 'IN_USE') throw error(409, e.message ?? 'Software pool is in use.');
    throw error(500, e.message ?? 'Unknown error');
  }
};
