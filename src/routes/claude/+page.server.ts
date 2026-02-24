import type { PageServerLoad } from './$types';
import {
	getDashboardSummary,
	getActiveWork,
	getRecentActivity,
	getEnvironmentHealth
} from '$lib/server/claude-dashboard';

export const load: PageServerLoad = () => {
	return {
		summary: getDashboardSummary(),
		activeWork: getActiveWork(),
		recentActivity: getRecentActivity(20),
		environmentHealth: getEnvironmentHealth()
	};
};
