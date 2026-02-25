import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPersona, updatePersona, deletePersona } from '$lib/server/personas';

export const GET: RequestHandler = async ({ params }) => {
  try {
    const persona = getPersona(params.id);
    if (!persona) {
      throw error(404, 'Persona not found.');
    }
    return json(persona);
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err) {
      throw err;
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    throw error(500, `Failed to get persona: ${message}`);
  }
};

export const PUT: RequestHandler = async ({ params, request }) => {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    throw error(400, 'Invalid JSON in request body.');
  }

  if (body.name !== undefined && (typeof body.name !== 'string' || !body.name.trim())) {
    throw error(400, 'A valid persona name is required.');
  }
  if (body.role !== undefined && (typeof body.role !== 'string' || !body.role.trim())) {
    throw error(400, 'A valid role is required.');
  }

  try {
    const persona = updatePersona(params.id, body as Parameters<typeof updatePersona>[1]);
    return json(persona);
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
    throw error(500, `Failed to update persona: ${message}`);
  }
};

export const DELETE: RequestHandler = async ({ params }) => {
  try {
    deletePersona(params.id);
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
    throw error(500, `Failed to delete persona: ${message}`);
  }
};
