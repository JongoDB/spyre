import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getCategory, updateCategory, deleteCategory } from '$lib/server/categories';

export const GET: RequestHandler = async ({ params }) => {
  try {
    const category = getCategory(params.id);
    if (!category) {
      throw error(404, 'Category not found.');
    }
    return json(category);
  } catch (err) {
    if (err && typeof err === 'object' && 'status' in err) {
      throw err;
    }
    const message = err instanceof Error ? err.message : 'Unknown error';
    throw error(500, `Failed to get category: ${message}`);
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
    throw error(400, 'A valid category name is required.');
  }

  try {
    const category = updateCategory(params.id, body as Parameters<typeof updateCategory>[1]);
    return json(category);
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
    throw error(500, `Failed to update category: ${message}`);
  }
};

export const DELETE: RequestHandler = async ({ params }) => {
  try {
    deleteCategory(params.id);
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
    throw error(500, `Failed to delete category: ${message}`);
  }
};
