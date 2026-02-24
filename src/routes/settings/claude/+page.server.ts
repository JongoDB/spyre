import type { PageServerLoad } from './$types';
import { getState, getAuthLog, getClaudeCliStatus, getDetailedAuthStatus } from '$lib/server/claude-auth';
import { getEnvConfig } from '$lib/server/env-config';

export const load: PageServerLoad = async () => {
  const authState = getState();
  const authLog = getAuthLog(25);
  const config = getEnvConfig();
  const cliStatus = await getClaudeCliStatus();
  const detailedStatus = await getDetailedAuthStatus();

  return {
    authState: {
      ...authState,
      cliInstalled: cliStatus.installed,
      email: detailedStatus.email,
      subscriptionType: detailedStatus.subscriptionType
    },
    authLog,
    claudeConfig: config.claude ?? {},
    cliStatus
  };
};
