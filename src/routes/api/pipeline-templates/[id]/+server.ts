import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getTemplateWithSteps, deleteTemplate } from '$lib/server/pipeline-engine';

export const GET: RequestHandler = async ({ params }) => {
  const template = getTemplateWithSteps(params.id);
  if (!template) {
    return json({ code: 'NOT_FOUND', message: 'Template not found' }, { status: 404 });
  }
  return json(template);
};

export const DELETE: RequestHandler = async ({ params }) => {
  try {
    deleteTemplate(params.id);
    return json({ ok: true });
  } catch (err) {
    const e = err as { code?: string; message?: string };
    return json({ code: 'INTERNAL', message: e.message ?? 'Failed to delete template' }, { status: 500 });
  }
};
