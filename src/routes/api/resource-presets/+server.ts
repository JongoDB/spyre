import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listPresets, createPreset } from '$lib/server/resource-presets';

export const GET: RequestHandler = async () => {
  try {
    const presets = listPresets();
    return json(presets);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    throw error(500, `Failed to list resource presets: ${message}`);
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
    throw error(400, 'A valid preset name is required.');
  }
  if (typeof body.cores !== 'number' || body.cores < 1) {
    throw error(400, 'Cores must be a number >= 1.');
  }
  if (typeof body.memory !== 'number' || body.memory < 1) {
    throw error(400, 'Memory (MB) must be a number >= 1.');
  }
  if (typeof body.disk !== 'number' || body.disk < 1) {
    throw error(400, 'Disk (GB) must be a number >= 1.');
  }

  try {
    const preset = createPreset(body as unknown as Parameters<typeof createPreset>[0]);
    return json(preset, { status: 201 });
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err) {
      throw err;
    }
    const code = (err as { code?: string })?.code;
    const message = err instanceof Error ? err.message :
      (err as { message?: string })?.message ?? 'Unknown error';
    if (code === 'DUPLICATE_NAME') {
      throw error(409, message);
    }
    throw error(500, `Failed to create resource preset: ${message}`);
  }
};
