import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listTemplates, createTemplate } from '$lib/server/pipeline-engine';

export const GET: RequestHandler = async () => {
  return json(listTemplates());
};

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json();
    const { name, description, env_id, steps } = body;

    if (!name || !Array.isArray(steps) || steps.length === 0) {
      return json({ code: 'INVALID_REQUEST', message: 'name and steps[] are required' }, { status: 400 });
    }

    const template = createTemplate(name, description ?? null, env_id ?? null, steps);
    return json(template, { status: 201 });
  } catch (err) {
    const e = err as { code?: string; message?: string };
    return json({ code: e.code ?? 'INTERNAL', message: e.message ?? 'Failed to create template' }, { status: 500 });
  }
};
