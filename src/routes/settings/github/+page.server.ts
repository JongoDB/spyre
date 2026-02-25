import type { PageServerLoad } from './$types';
import { getSetting } from '$lib/server/settings';

export const load: PageServerLoad = async () => {
  const token = getSetting('github_pat');
  return {
    configured: !!token,
    preview: token ? `${token.slice(0, 8)}...${token.slice(-4)}` : null
  };
};
