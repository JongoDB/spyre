import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listPipelines, createPipeline } from '$lib/server/pipeline-engine';

export const GET: RequestHandler = async ({ url }) => {
  const envId = url.searchParams.get('envId');
  if (!envId) {
    return json({ code: 'INVALID_REQUEST', message: 'envId is required' }, { status: 400 });
  }
  return json(listPipelines(envId));
};

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json();
    const { env_id, name, description, template_id, steps } = body;

    if (!env_id || !name || !Array.isArray(steps) || steps.length === 0) {
      return json({ code: 'INVALID_REQUEST', message: 'env_id, name, and steps[] are required' }, { status: 400 });
    }

    const pipeline = createPipeline({ env_id, name, description, template_id, steps });
    return json(pipeline, { status: 201 });
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e.code === 'NOT_FOUND') return json(e, { status: 404 });
    return json({ code: e.code ?? 'INTERNAL', message: e.message ?? 'Failed to create pipeline' }, { status: 500 });
  }
};
