import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { cancelPipeline } from '$lib/server/pipeline-engine';

export const POST: RequestHandler = async ({ params }) => {
  try {
    await cancelPipeline(params.id);
    return json({ ok: true });
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e.code === 'NOT_FOUND') return json(e, { status: 404 });
    if (e.code === 'INVALID_STATE') return json(e, { status: 409 });
    return json({ code: 'INTERNAL', message: e.message ?? 'Failed to cancel' }, { status: 500 });
  }
};
