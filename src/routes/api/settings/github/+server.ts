import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSetting, setSetting, deleteSetting } from '$lib/server/settings';

export const GET: RequestHandler = async () => {
  try {
    const token = getSetting('github_pat');
    return json({
      configured: !!token,
      // Return masked token preview if set
      preview: token ? `${token.slice(0, 8)}...${token.slice(-4)}` : null
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    throw error(500, `Failed to get GitHub settings: ${message}`);
  }
};

export const PUT: RequestHandler = async ({ request }) => {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    throw error(400, 'Invalid JSON in request body.');
  }

  const token = body.token;
  if (!token || typeof token !== 'string') {
    throw error(400, 'A valid token is required.');
  }

  try {
    setSetting('github_pat', token);
    return json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    throw error(500, `Failed to save GitHub token: ${message}`);
  }
};

export const DELETE: RequestHandler = async () => {
  try {
    deleteSetting('github_pat');
    return json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    throw error(500, `Failed to delete GitHub token: ${message}`);
  }
};
