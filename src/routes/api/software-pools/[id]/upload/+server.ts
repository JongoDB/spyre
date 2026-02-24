import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPool } from '$lib/server/software-pools';

const MAX_FILE_SIZE = 1024 * 1024; // 1MB

export const POST: RequestHandler = async ({ params, request }) => {
  // Validate pool exists
  const pool = getPool(params.id);
  if (!pool) throw error(404, 'Software pool not found.');

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    throw error(400, 'Expected multipart/form-data request.');
  }

  const file = formData.get('file');
  if (!file || !(file instanceof File)) {
    throw error(400, 'No file provided. Expected a "file" field in the form data.');
  }

  if (file.size > MAX_FILE_SIZE) {
    throw error(400, `File too large (${(file.size / 1024).toFixed(1)} KB). Maximum size is 1 MB.`);
  }

  if (file.size === 0) {
    throw error(400, 'File is empty.');
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const content = buffer.toString('utf-8');

    return json({
      content,
      filename: file.name,
      size: file.size
    });
  } catch {
    throw error(500, 'Failed to read uploaded file.');
  }
};
