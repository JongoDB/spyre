import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { handleGateDecision } from '$lib/server/pipeline-engine';

export const POST: RequestHandler = async ({ params, request }) => {
  try {
    const body = await request.json();
    const { action, feedback, revise_to_step_id } = body;

    if (!action || !['approve', 'reject', 'revise'].includes(action)) {
      return json({ code: 'INVALID_REQUEST', message: 'action must be approve, reject, or revise' }, { status: 400 });
    }

    await handleGateDecision(params.id, params.stepId, { action, feedback, revise_to_step_id });
    return json({ ok: true });
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e.code === 'NOT_FOUND') return json(e, { status: 404 });
    if (e.code === 'CONFLICT') return json(e, { status: 409 });
    if (e.code === 'INVALID_STATE') return json(e, { status: 409 });
    return json({ code: 'INTERNAL', message: e.message ?? 'Failed to process gate decision' }, { status: 500 });
  }
};
