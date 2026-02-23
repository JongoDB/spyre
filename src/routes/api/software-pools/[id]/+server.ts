import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPool, updatePool, deletePool } from '$lib/server/software-pools';

export const GET: RequestHandler = async ({ params }) => {
  try {
    const pool = getPool(params.id);
    if (!pool) throw error(404, 'Software pool not found.');
    return json(pool);
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err) throw err;
    const e = err as { code?: string; message?: string };
    if (e.code === 'NOT_FOUND') throw error(404, e.message ?? 'Software pool not found.');
    throw error(500, e.message ?? 'Unknown error');
  }
};

export const PUT: RequestHandler = async ({ params, request }) => {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    throw error(400, 'Invalid JSON in request body.');
  }

  try {
    const pool = updatePool(params.id, body as Parameters<typeof updatePool>[1]);
    return json(pool);
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err) throw err;
    const e = err as { code?: string; message?: string };
    if (e.code === 'DUPLICATE_NAME') throw error(409, e.message ?? 'A pool with that name already exists.');
    if (e.code === 'NOT_FOUND') throw error(404, e.message ?? 'Software pool not found.');
    if (e.code === 'IN_USE') throw error(409, e.message ?? 'Software pool is in use.');
    throw error(500, e.message ?? 'Unknown error');
  }
};

export const DELETE: RequestHandler = async ({ params }) => {
  try {
    deletePool(params.id);
    return new Response(null, { status: 204 });
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err) throw err;
    const e = err as { code?: string; message?: string };
    if (e.code === 'DUPLICATE_NAME') throw error(409, e.message ?? 'A pool with that name already exists.');
    if (e.code === 'NOT_FOUND') throw error(404, e.message ?? 'Software pool not found.');
    if (e.code === 'IN_USE') throw error(409, e.message ?? 'Software pool is in use.');
    throw error(500, e.message ?? 'Unknown error');
  }
};
