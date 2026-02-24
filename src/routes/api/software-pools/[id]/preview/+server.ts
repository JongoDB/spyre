import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getPool } from '$lib/server/software-pools';
import { generatePreview } from '$lib/server/provisioner';

export const POST: RequestHandler = async ({ params, request }) => {
  const pool = getPool(params.id);
  if (!pool) throw error(404, 'Software pool not found.');

  let body: { target_pm?: 'apt' | 'apk' | 'dnf' | 'yum' };
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const validPms = ['apt', 'apk', 'dnf', 'yum'];
  const targetPm = body.target_pm && validPms.includes(body.target_pm) ? body.target_pm : undefined;

  const commands = generatePreview(pool.items, targetPm);
  return json({ commands });
};
