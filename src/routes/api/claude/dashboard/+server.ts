import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getDashboardSummary,
	getActiveWork,
	getRecentActivity,
	getEnvironmentHealth
} from '$lib/server/claude-dashboard';

export const GET: RequestHandler = () => {
	const summary = getDashboardSummary();
	const activeWork = getActiveWork();
	const recentActivity = getRecentActivity(20);
	const environmentHealth = getEnvironmentHealth();

	return json({ summary, activeWork, recentActivity, environmentHealth });
};
