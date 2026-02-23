import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPreset, updatePreset, deletePreset } from '$lib/server/resource-presets';

export const GET: RequestHandler = async ({ params }) => {
  try {
    const preset = getPreset(params.id);
    if (!preset) {
      throw error(404, 'Resource preset not found.');
    }
    return json(preset);
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err) {
      throw err;
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    throw error(500, `Failed to get resource preset: ${message}`);
  }
};

export const PUT: RequestHandler = async ({ params, request }) => {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    throw error(400, 'Invalid JSON in request body.');
  }

  if (body.name !== undefined && (typeof body.name !== 'string' || !body.name)) {
    throw error(400, 'A valid preset name is required.');
  }
  if (body.cores !== undefined && (typeof body.cores !== 'number' || body.cores < 1)) {
    throw error(400, 'Cores must be a number >= 1.');
  }
  if (body.memory !== undefined && (typeof body.memory !== 'number' || body.memory < 1)) {
    throw error(400, 'Memory (MB) must be a number >= 1.');
  }
  if (body.disk !== undefined && (typeof body.disk !== 'number' || body.disk < 1)) {
    throw error(400, 'Disk (GB) must be a number >= 1.');
  }

  try {
    const preset = updatePreset(params.id, body as Parameters<typeof updatePreset>[1]);
    return json(preset);
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err) {
      throw err;
    }
    const code = (err as { code?: string })?.code;
    const message = err instanceof Error ? err.message :
      (err as { message?: string })?.message ?? 'Unknown error';
    if (code === 'NOT_FOUND') {
      throw error(404, message);
    }
    if (code === 'DUPLICATE_NAME') {
      throw error(409, message);
    }
    throw error(500, `Failed to update resource preset: ${message}`);
  }
};

export const DELETE: RequestHandler = async ({ params }) => {
  try {
    deletePreset(params.id);
    return new Response(null, { status: 204 });
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err) {
      throw err;
    }
    const code = (err as { code?: string })?.code;
    const message = err instanceof Error ? err.message :
      (err as { message?: string })?.message ?? 'Unknown error';
    if (code === 'NOT_FOUND') {
      throw error(404, message);
    }
    if (code === 'IN_USE') {
      throw error(409, message);
    }
    throw error(500, `Failed to delete resource preset: ${message}`);
  }
};
