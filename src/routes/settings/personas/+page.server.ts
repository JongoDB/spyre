import type { PageServerLoad } from './$types';
import { listPersonas, getPersonaUsageCounts } from '$lib/server/personas';

export const load: PageServerLoad = async () => {
  const personas = listPersonas();
  const usageCounts = getPersonaUsageCounts();
  return { personas, usageCounts };
};
