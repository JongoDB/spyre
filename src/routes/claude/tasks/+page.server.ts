import type { PageServerLoad } from './$types';
import { listTasks } from '$lib/server/claude-bridge';

export const load: PageServerLoad = async () => {
  const tasks = listTasks({ limit: 100 });
  return { tasks };
};
