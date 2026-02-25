import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listPersonas, createPersona } from '$lib/server/personas';

export const GET: RequestHandler = async () => {
  try {
    const personas = listPersonas();
    return json(personas);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    throw error(500, `Failed to list personas: ${message}`);
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
    throw error(400, 'A valid persona name is required.');
  }
  if (!body.role || typeof body.role !== 'string') {
    throw error(400, 'A valid role is required.');
  }

  try {
    const persona = createPersona(body as unknown as Parameters<typeof createPersona>[0]);
    return json(persona, { status: 201 });
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
    if (code === 'VALIDATION_ERROR') {
      throw error(400, message);
    }
    throw error(500, `Failed to create persona: ${message}`);
  }
};
