<script lang="ts">
	interface ProvisioningLogEntry {
		id: number;
		phase: string;
		step: string;
		status: 'running' | 'success' | 'error' | 'skipped';
		output: string | null;
		started_at: string;
		completed_at: string | null;
	}

	interface ProvisioningPhase {
		phase: string;
		steps: ProvisioningLogEntry[];
		status: 'pending' | 'running' | 'success' | 'error' | 'skipped';
	}

	interface ProvisioningProgress {
		phases: ProvisioningPhase[];
		percentComplete: number;
		currentPhase: string | null;
		isComplete: boolean;
		hasError: boolean;
	}

	let { progress }: { progress: ProvisioningProgress } = $props();

	let expandedPhases = $state<Set<string>>(new Set());

	function togglePhase(phase: string) {
		const next = new Set(expandedPhases);
		if (next.has(phase)) {
			next.delete(phase);
		} else {
			next.add(phase);
		}
		expandedPhases = next;
	}

	function formatPhase(phase: string): string {
		const map: Record<string, string> = {
			proxmox: 'Proxmox Setup',
			helper_script: 'Helper Script',
			post_provision: 'Post-Provision',
			community_script: 'Community Script',
			software_pool: 'Software Installation',
			custom_script: 'Custom Script',
			claude_install: 'Claude Code'
		};
		return map[phase] ?? phase;
	}

	function formatDuration(startedAt: string, completedAt: string | null): string {
		if (!completedAt) return '';
		const start = new Date(startedAt + 'Z').getTime();
		const end = new Date(completedAt + 'Z').getTime();
		const ms = end - start;
		if (ms < 1000) return `${ms}ms`;
		if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
		return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
	}
</script>

<div class="provisioning-progress">
	<!-- Overall progress bar -->
	<div class="progress-header">
		<div class="progress-bar-container">
			<div
				class="progress-bar-fill"
				class:error={progress.hasError}
				style="width: {progress.percentComplete}%"
			></div>
		</div>
		<span class="progress-percent">{progress.percentComplete}%</span>
	</div>

	{#if progress.currentPhase}
		<div class="current-phase">
			<div class="spinner-sm"></div>
			<span>{formatPhase(progress.currentPhase)}</span>
		</div>
	{/if}

	<!-- Phase timeline -->
	<div class="phase-list">
		{#each progress.phases as phase (phase.phase)}
			<div class="phase-item">
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div class="phase-header" onclick={() => togglePhase(phase.phase)}>
					<span class="phase-icon">
						{#if phase.status === 'running'}
							<div class="spinner-sm"></div>
						{:else if phase.status === 'success'}
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2.5" stroke-linecap="round"><path d="M20 6L9 17l-5-5"/></svg>
						{:else if phase.status === 'error'}
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--error)" stroke-width="2.5" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
						{:else if phase.status === 'skipped'}
							<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" stroke-width="2" stroke-linecap="round"><path d="M5 12h14"/></svg>
						{:else}
							<div class="dot-pending"></div>
						{/if}
					</span>
					<span class="phase-name">{formatPhase(phase.phase)}</span>
					<span class="phase-status badge badge-{phase.status === 'running' ? 'provisioning' : phase.status === 'success' ? 'running' : phase.status}">{phase.status}</span>
					<svg
						class="expand-icon"
						class:expanded={expandedPhases.has(phase.phase)}
						width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"
					><path d="M6 9l6 6 6-6"/></svg>
				</div>

				{#if expandedPhases.has(phase.phase)}
					<div class="phase-steps">
						{#each phase.steps as step (step.id)}
							<div class="step-item">
								<span class="step-icon">
									{#if step.status === 'running'}
										<div class="dot-running"></div>
									{:else if step.status === 'success'}
										<div class="dot-success"></div>
									{:else if step.status === 'error'}
										<div class="dot-error"></div>
									{:else}
										<div class="dot-skipped"></div>
									{/if}
								</span>
								<span class="step-text">{step.step}</span>
								{#if step.started_at && step.completed_at}
									<span class="step-duration">{formatDuration(step.started_at, step.completed_at)}</span>
								{/if}
							</div>
							{#if step.output}
								<pre class="step-output">{step.output}</pre>
							{/if}
						{/each}
					</div>
				{/if}
			</div>
		{/each}
	</div>
</div>

<style>
	.provisioning-progress {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.progress-header {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.progress-bar-container {
		flex: 1;
		height: 8px;
		background-color: rgba(255, 255, 255, 0.06);
		border-radius: 4px;
		overflow: hidden;
	}

	.progress-bar-fill {
		height: 100%;
		background-color: var(--accent);
		border-radius: 4px;
		transition: width 0.3s ease;
	}

	.progress-bar-fill.error {
		background-color: var(--error);
	}

	.progress-percent {
		font-size: 0.8125rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		color: var(--text-secondary);
		min-width: 36px;
		text-align: right;
	}

	.current-phase {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 0.8125rem;
		color: var(--accent);
	}

	.phase-list {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.phase-item {
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		overflow: hidden;
	}

	.phase-header {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 12px;
		cursor: pointer;
		transition: background-color var(--transition);
	}

	.phase-header:hover {
		background-color: rgba(255, 255, 255, 0.02);
	}

	.phase-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		flex-shrink: 0;
	}

	.phase-name {
		flex: 1;
		font-size: 0.8125rem;
		font-weight: 500;
	}

	.phase-status {
		font-size: 0.6875rem;
	}

	.expand-icon {
		color: var(--text-secondary);
		transition: transform 0.2s ease;
		flex-shrink: 0;
	}

	.expand-icon.expanded {
		transform: rotate(180deg);
	}

	.phase-steps {
		border-top: 1px solid var(--border);
		padding: 8px 12px 8px 40px;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.step-item {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 0.75rem;
	}

	.step-icon {
		display: flex;
		align-items: center;
		width: 10px;
		flex-shrink: 0;
	}

	.step-text {
		flex: 1;
		color: var(--text-secondary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.step-duration {
		font-size: 0.6875rem;
		color: var(--text-secondary);
		opacity: 0.7;
		font-family: 'SF Mono', 'Fira Code', monospace;
		flex-shrink: 0;
	}

	.step-output {
		font-size: 0.6875rem;
		font-family: 'SF Mono', 'Fira Code', monospace;
		background-color: rgba(0, 0, 0, 0.2);
		color: var(--text-secondary);
		padding: 6px 8px;
		border-radius: var(--radius-sm);
		white-space: pre-wrap;
		word-break: break-word;
		max-height: 120px;
		overflow-y: auto;
		margin: 2px 0;
	}

	.dot-pending {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background-color: var(--text-secondary);
		opacity: 0.3;
	}

	.dot-running {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background-color: var(--accent);
		animation: pulse 1.5s ease infinite;
	}

	.dot-success {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background-color: var(--success);
	}

	.dot-error {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background-color: var(--error);
	}

	.dot-skipped {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background-color: var(--text-secondary);
		opacity: 0.4;
	}

	.spinner-sm {
		width: 16px;
		height: 16px;
		border: 2px solid var(--border);
		border-top-color: var(--accent);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	@keyframes pulse {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.4; }
	}
</style>
