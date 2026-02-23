import type { PageServerLoad } from './$types';
import { listPresets } from '$lib/server/resource-presets';

export const load: PageServerLoad = async () => {
  const presets = listPresets();
  return { presets };
};
