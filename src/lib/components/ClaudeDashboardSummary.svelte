<script lang="ts">
	let { summary }: {
		summary: {
			activeTaskCount: number;
			completedToday: number;
			erroredToday: number;
			successRate: number;
			totalEnvironments: number;
		};
	} = $props();
</script>

<div class="summary-bar">
	<div class="stat-card">
		<span class="stat-value accent">{summary.activeTaskCount}</span>
		<span class="stat-label">Active Tasks</span>
	</div>
	<div class="stat-card">
		<span class="stat-value success">{summary.completedToday}</span>
		<span class="stat-label">Completed Today</span>
	</div>
	<div class="stat-card">
		<span class="stat-value" class:error={summary.erroredToday > 0}>{summary.erroredToday}</span>
		<span class="stat-label">Errors Today</span>
	</div>
	<div class="stat-card">
		<span class="stat-value">{summary.successRate}%</span>
		<span class="stat-label">Success Rate</span>
	</div>
	<div class="stat-card">
		<span class="stat-value">{summary.totalEnvironments}</span>
		<span class="stat-label">Environments</span>
	</div>
</div>

<style>
	.summary-bar {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
		gap: 12px;
	}

	.stat-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 4px;
		padding: 16px 12px;
		background-color: var(--bg-card);
		border: 1px solid var(--border);
		border-radius: var(--radius);
	}

	.stat-value {
		font-size: 1.5rem;
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}

	.stat-value.accent {
		color: var(--accent);
	}

	.stat-value.success {
		color: var(--success);
	}

	.stat-value.error {
		color: var(--error);
	}

	.stat-label {
		font-size: 0.6875rem;
		color: var(--text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		font-weight: 500;
	}
</style>
