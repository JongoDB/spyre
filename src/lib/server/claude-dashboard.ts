import { getDb } from './db';
import { getPersona } from './personas';
import type { ClaudeTask } from '$lib/types/claude';

export interface ActiveWorkItem {
	envId: string;
	envName: string;
	task: ClaudeTask;
	currentTask: string | null;
	plan: string | null;
	personaAvatar: string | null;
	personaRole: string | null;
}

export interface RecentActivityItem {
	task: ClaudeTask;
	envName: string | null;
	duration: number | null;
}

export interface EnvironmentHealthCard {
	envId: string;
	envName: string;
	envStatus: string;
	lastTaskStatus: string | null;
	lastTaskPrompt: string | null;
	gitBranch: string | null;
	blockers: string[];
	currentTask: string | null;
}

export interface DashboardSummary {
	activeTaskCount: number;
	completedToday: number;
	erroredToday: number;
	successRate: number;
	totalEnvironments: number;
}

export function getDashboardSummary(): DashboardSummary {
	const db = getDb();

	const activeTaskCount = (db.prepare(
		"SELECT COUNT(*) as count FROM claude_tasks WHERE status IN ('pending', 'running')"
	).get() as { count: number }).count;

	const todayStart = new Date();
	todayStart.setHours(0, 0, 0, 0);
	const todayStr = todayStart.toISOString().replace('T', ' ').slice(0, 19);

	const completedToday = (db.prepare(
		"SELECT COUNT(*) as count FROM claude_tasks WHERE status = 'complete' AND completed_at >= ?"
	).get(todayStr) as { count: number }).count;

	const erroredToday = (db.prepare(
		"SELECT COUNT(*) as count FROM claude_tasks WHERE status = 'error' AND completed_at >= ?"
	).get(todayStr) as { count: number }).count;

	const totalToday = completedToday + erroredToday;
	const successRate = totalToday > 0 ? Math.round((completedToday / totalToday) * 100) : 100;

	const totalEnvironments = (db.prepare(
		"SELECT COUNT(*) as count FROM environments WHERE status IN ('running', 'stopped', 'provisioning')"
	).get() as { count: number }).count;

	return {
		activeTaskCount,
		completedToday,
		erroredToday,
		successRate,
		totalEnvironments
	};
}

export function getActiveWork(): ActiveWorkItem[] {
	const db = getDb();

	const tasks = db.prepare(`
		SELECT ct.*, e.name as env_name, e.persona_id,
			dc.persona_id as dc_persona_id, dc.service_name as dc_service_name
		FROM claude_tasks ct
		JOIN environments e ON ct.env_id = e.id
		LEFT JOIN devcontainers dc ON ct.devcontainer_id = dc.id
		WHERE ct.status IN ('pending', 'running')
		ORDER BY ct.created_at DESC
	`).all() as Array<ClaudeTask & { env_name: string; persona_id: string | null; dc_persona_id: string | null; dc_service_name: string | null }>;

	return tasks.map(t => {
		// Get progress data for this environment
		const progress = db.prepare(
			'SELECT progress FROM claude_progress WHERE env_id = ?'
		).get(t.env_id) as { progress: string } | undefined;

		let currentTask: string | null = null;
		let plan: string | null = null;
		if (progress?.progress) {
			try {
				const parsed = JSON.parse(progress.progress);
				currentTask = parsed.current_task ?? null;
				plan = parsed.plan ?? null;
			} catch {
				// ignore
			}
		}

		// Look up persona — prefer devcontainer persona over environment persona
		const personaId = t.dc_persona_id ?? t.persona_id;
		let personaAvatar: string | null = null;
		let personaRole: string | null = null;
		if (personaId) {
			const persona = getPersona(personaId);
			if (persona) {
				personaAvatar = persona.avatar;
				personaRole = persona.role;
			}
		}

		return {
			envId: t.env_id!,
			envName: t.dc_service_name ? `${t.env_name} / ${t.dc_service_name}` : t.env_name,
			task: t,
			currentTask,
			plan,
			personaAvatar,
			personaRole
		};
	});
}

export function getRecentActivity(limit = 20): RecentActivityItem[] {
	const db = getDb();

	const tasks = db.prepare(`
		SELECT ct.*, e.name as env_name
		FROM claude_tasks ct
		LEFT JOIN environments e ON ct.env_id = e.id
		WHERE ct.status IN ('complete', 'error')
		ORDER BY ct.completed_at DESC
		LIMIT ?
	`).all(limit) as Array<ClaudeTask & { env_name: string | null }>;

	return tasks.map(t => {
		let duration: number | null = null;
		if (t.started_at && t.completed_at) {
			const start = new Date(t.started_at + 'Z').getTime();
			const end = new Date(t.completed_at + 'Z').getTime();
			duration = Math.round((end - start) / 1000);
		}

		return {
			task: t,
			envName: t.env_name,
			duration
		};
	});
}

export function getEnvironmentHealth(): EnvironmentHealthCard[] {
	const db = getDb();

	const environments = db.prepare(`
		SELECT id, name, status FROM environments
		WHERE status IN ('running', 'stopped', 'provisioning')
		ORDER BY name ASC
	`).all() as Array<{ id: string; name: string; status: string }>;

	return environments.map(env => {
		// Last completed task
		const lastTask = db.prepare(`
			SELECT status, prompt FROM claude_tasks
			WHERE env_id = ? AND status IN ('complete', 'error')
			ORDER BY completed_at DESC LIMIT 1
		`).get(env.id) as { status: string; prompt: string } | undefined;

		// Git activity
		const gitActivity = db.prepare(
			'SELECT branch FROM claude_git_activity WHERE env_id = ?'
		).get(env.id) as { branch: string | null } | undefined;

		// Progress
		const progress = db.prepare(
			'SELECT progress FROM claude_progress WHERE env_id = ?'
		).get(env.id) as { progress: string } | undefined;

		let blockers: string[] = [];
		let currentTask: string | null = null;
		if (progress?.progress) {
			try {
				const parsed = JSON.parse(progress.progress);
				blockers = parsed.blockers ?? [];
				currentTask = parsed.current_task ?? null;
			} catch {
				// ignore
			}
		}

		return {
			envId: env.id,
			envName: env.name,
			envStatus: env.status,
			lastTaskStatus: lastTask?.status ?? null,
			lastTaskPrompt: lastTask?.prompt ?? null,
			gitBranch: gitActivity?.branch ?? null,
			blockers,
			currentTask
		};
	});
}
