import { getDb } from './db';

export interface ProvisioningLogEntry {
	id: number;
	env_id: string;
	phase: string;
	step: string;
	status: 'running' | 'success' | 'error' | 'skipped';
	output: string | null;
	started_at: string;
	completed_at: string | null;
}

export interface ProvisioningProgress {
	phases: ProvisioningPhase[];
	percentComplete: number;
	currentPhase: string | null;
	isComplete: boolean;
	hasError: boolean;
}

export interface ProvisioningPhase {
	phase: string;
	steps: ProvisioningLogEntry[];
	status: 'pending' | 'running' | 'success' | 'error' | 'skipped';
}

export function getProvisioningLog(envId: string): ProvisioningLogEntry[] {
	const db = getDb();
	return db.prepare(
		'SELECT * FROM provisioning_log WHERE env_id = ? ORDER BY id ASC'
	).all(envId) as ProvisioningLogEntry[];
}

export function getProvisioningProgress(envId: string): ProvisioningProgress {
	const entries = getProvisioningLog(envId);

	if (entries.length === 0) {
		return {
			phases: [],
			percentComplete: 0,
			currentPhase: null,
			isComplete: false,
			hasError: false
		};
	}

	// Group by phase
	const phaseMap = new Map<string, ProvisioningLogEntry[]>();
	for (const entry of entries) {
		const existing = phaseMap.get(entry.phase) ?? [];
		existing.push(entry);
		phaseMap.set(entry.phase, existing);
	}

	const phases: ProvisioningPhase[] = [];
	let hasError = false;
	let currentPhase: string | null = null;

	for (const [phase, steps] of phaseMap) {
		// Determine phase status from the LAST entry (most recent).
		// logProvisioningStep() inserts new rows without updating old ones,
		// so a phase will have running entries followed by a success/error entry.
		// Using 'any has running' would incorrectly keep the phase in 'running'
		// even after a success entry is logged.
		const lastEntry = steps[steps.length - 1];
		const lastStatus = lastEntry.status;

		let status: ProvisioningPhase['status'];
		if (lastStatus === 'running') {
			status = 'running';
			currentPhase = phase;
		} else if (lastStatus === 'error') {
			status = 'error';
			hasError = true;
		} else if (lastStatus === 'skipped') {
			status = 'skipped';
		} else {
			status = 'success';
		}

		phases.push({ phase, steps, status });
	}

	// Calculate percent
	const totalPhases = phases.length;
	const completedPhases = phases.filter(p =>
		p.status === 'success' || p.status === 'skipped' || p.status === 'error'
	).length;
	const percentComplete = totalPhases > 0
		? Math.round((completedPhases / totalPhases) * 100)
		: 0;

	const isComplete = totalPhases > 0 && completedPhases === totalPhases;

	return {
		phases,
		percentComplete,
		currentPhase,
		isComplete,
		hasError
	};
}
