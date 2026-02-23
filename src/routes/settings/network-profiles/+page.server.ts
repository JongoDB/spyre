import type { PageServerLoad } from './$types';
import { listProfiles } from '$lib/server/network-profiles';

export const load: PageServerLoad = async () => {
  const profiles = listProfiles();
  return { profiles };
};
