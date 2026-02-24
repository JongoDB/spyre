import type { PageServerLoad } from './$types';
import { getState, getAuthLog } from '$lib/server/claude-auth';
import { getEnvConfig } from '$lib/server/env-config';

export const load: PageServerLoad = async () => {
  const authState = getState();
  const authLog = getAuthLog(25);
  const config = getEnvConfig();

  return {
    authState,
    authLog,
    claudeConfig: config.claude ?? {}
  };
};
