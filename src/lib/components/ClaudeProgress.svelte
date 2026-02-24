<script lang="ts">
	import type { ClaudeProgress } from '$lib/types/claude';

	interface Props {
		progress: ClaudeProgress | null;
	}

	let { progress }: Props = $props();

	const phaseStatusIcon = (status: string) => {
		switch (status) {
			case 'completed': return 'completed';
			case 'in_progress': return 'active';
			case 'error': return 'error';
			default: return 'pending';
		}
	};
</script>

{#if progress}
	<div class="progress-panel">
		{#if progress.plan}
			<div class="progress-plan">
				<span class="label">Plan</span>
				<p>{progress.plan}</p>
			</div>
		{/if}

		{#if progress.current_task}
			<div class="current-task">
				<span class="label">Current Task</span>
				<p>{progress.current_task}</p>
			</div>
		{/if}

		{#if progress.phases.length > 0}
			<div class="phases">
				<span class="label">Phases</span>
				<div class="phase-list">
					{#each progress.phases as phase}
						<div class="phase-item phase-{phaseStatusIcon(phase.status)}">
							<div class="phase-dot"></div>
							<div class="phase-info">
								<span class="phase-name">{phase.name}</span>
								{#if phase.detail}
									<span class="phase-detail">{phase.detail}</span>
								{/if}
							</div>
							<span class="phase-status">{phase.status}</span>
						</div>
					{/each}
				</div>
			</div>
		{/if}

		{#if progress.blockers.length > 0}
			<div class="blockers">
				<span class="label">Blockers</span>
				<ul>
					{#each progress.blockers as blocker}
						<li>{blocker}</li>
					{/each}
				</ul>
			</div>
		{/if}

		{#if Object.keys(progress.metrics).length > 0}
			<div class="metrics">
				{#each Object.entries(progress.metrics) as [key, value]}
					<div class="metric">
						<span class="metric-value">{value}</span>
						<span class="metric-label">{key.replace(/_/g, ' ')}</span>
					</div>
				{/each}
			</div>
		{/if}

		{#if progress.updated_at}
			<div class="updated-at">
				Updated: {new Date(progress.updated_at).toLocaleString()}
			</div>
		{/if}
	</div>
{:else}
	<div class="progress-empty">
		<p>No progress data available.</p>
		<p class="hint">Progress will appear when Claude runs a task in this environment.</p>
	</div>
{/if}

<style>
	.progress-panel {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	.label {
		font-size: 0.6875rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-secondary);
		display: block;
		margin-bottom: 4px;
	}

	.progress-plan p,
	.current-task p {
		font-size: 0.875rem;
		margin: 0;
		line-height: 1.5;
	}

	.current-task {
		padding: 10px 14px;
		background-color: rgba(99, 102, 241, 0.06);
		border: 1px solid rgba(99, 102, 241, 0.15);
		border-radius: var(--radius-sm);
	}

	.phase-list {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.phase-item {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 6px 0;
	}

	.phase-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.phase-completed .phase-dot { background-color: var(--success); }
	.phase-active .phase-dot {
		background-color: var(--accent);
		box-shadow: 0 0 6px rgba(99, 102, 241, 0.5);
		animation: pulse 2s infinite;
	}
	.phase-error .phase-dot { background-color: var(--error); }
	.phase-pending .phase-dot { background-color: var(--border); }

	.phase-info {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.phase-name {
		font-size: 0.8125rem;
		font-weight: 500;
	}

	.phase-detail {
		font-size: 0.75rem;
		color: var(--text-secondary);
	}

	.phase-status {
		font-size: 0.6875rem;
		color: var(--text-secondary);
		text-transform: lowercase;
	}

	.blockers ul {
		margin: 0;
		padding-left: 18px;
	}

	.blockers li {
		font-size: 0.8125rem;
		color: var(--error);
		line-height: 1.5;
	}

	.metrics {
		display: flex;
		flex-wrap: wrap;
		gap: 16px;
	}

	.metric {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
	}

	.metric-value {
		font-size: 1.25rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}

	.metric-label {
		font-size: 0.6875rem;
		color: var(--text-secondary);
		text-transform: capitalize;
	}

	.updated-at {
		font-size: 0.6875rem;
		color: var(--text-secondary);
		opacity: 0.6;
	}

	.progress-empty {
		text-align: center;
		padding: 24px;
		color: var(--text-secondary);
	}

	.progress-empty p { margin: 0; }
	.progress-empty .hint {
		font-size: 0.8125rem;
		opacity: 0.7;
		margin-top: 4px;
	}

	@keyframes pulse {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.5; }
	}
</style>
