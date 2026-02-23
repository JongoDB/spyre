import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listCategories, createCategory } from '$lib/server/categories';

export const GET: RequestHandler = async () => {
  try {
    const categories = listCategories();
    return json(categories);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    throw error(500, `Failed to list categories: ${message}`);
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
    throw error(400, 'A valid category name is required.');
  }

  try {
    const category = createCategory(body as unknown as Parameters<typeof createCategory>[0]);
    return json(category, { status: 201 });
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
    throw error(500, `Failed to create category: ${message}`);
  }
};
