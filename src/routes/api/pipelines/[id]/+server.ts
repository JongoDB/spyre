import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPipelineWithSteps, deletePipeline } from '$lib/server/pipeline-engine';

export const GET: RequestHandler = async ({ params }) => {
  const pipeline = getPipelineWithSteps(params.id);
  if (!pipeline) {
    return json({ code: 'NOT_FOUND', message: 'Pipeline not found' }, { status: 404 });
  }
  return json(pipeline);
};

export const DELETE: RequestHandler = async ({ params }) => {
  try {
    deletePipeline(params.id);
    return json({ ok: true });
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e.code === 'NOT_FOUND') return json(e, { status: 404 });
    if (e.code === 'INVALID_STATE') return json(e, { status: 409 });
    return json({ code: 'INTERNAL', message: e.message ?? 'Failed to delete' }, { status: 500 });
  }
};
