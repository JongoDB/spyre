import type { PageServerLoad } from './$types';
import { listCategories } from '$lib/server/categories';

export const load: PageServerLoad = async () => {
  const categories = listCategories();
  return { categories };
};
