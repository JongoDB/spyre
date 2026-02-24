<script lang="ts">
	interface EnvironmentHealthCard {
		envId: string;
		envName: string;
		envStatus: string;
		lastTaskStatus: string | null;
		lastTaskPrompt: string | null;
		gitBranch: string | null;
		blockers: string[];
		currentTask: string | null;
	}

	let { cards }: { cards: EnvironmentHealthCard[] } = $props();

	function truncate(text: string, max: number): string {
		return text.length > max ? text.slice(0, max) + '...' : text;
	}
</script>

{#if cards.length === 0}
	<p class="empty">No environments</p>
{:else}
	<div class="health-grid">
		{#each cards as card (card.envId)}
			<a href="/environments/{card.envId}?tab=claude" class="health-card card">
				<div class="card-header">
					<span class="env-name">{card.envName}</span>
					<span class="badge badge-{card.envStatus}">{card.envStatus}</span>
				</div>

				{#if card.currentTask}
					<div class="info-row">
						<span class="info-label">Current</span>
						<span class="info-value">{truncate(card.currentTask, 50)}</span>
					</div>
				{/if}

				{#if card.gitBranch}
					<div class="info-row">
						<span class="info-label">Branch</span>
						<code class="branch">{card.gitBranch}</code>
					</div>
				{/if}

				{#if card.lastTaskStatus}
					<div class="info-row">
						<span class="info-label">Last task</span>
						<span class="badge badge-sm" class:badge-running={card.lastTaskStatus === 'complete'} class:badge-error={card.lastTaskStatus === 'error'}>
							{card.lastTaskStatus}
						</span>
					</div>
				{/if}

				{#if card.blockers.length > 0}
					<div class="blockers">
						<span class="blocker-label">Blockers:</span>
						{#each card.blockers as blocker}
							<span class="blocker-tag">{truncate(blocker, 40)}</span>
						{/each}
					</div>
				{/if}
			</a>
		{/each}
	</div>
{/if}

<style>
	.empty {
		font-size: 0.8125rem;
		color: var(--text-secondary);
		padding: 16px 0;
	}

	.health-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
		gap: 12px;
	}

	.health-card {
		display: flex;
		flex-direction: column;
		gap: 8px;
		text-decoration: none;
		color: inherit;
		transition: border-color var(--transition);
	}

	.health-card:hover {
		border-color: var(--accent);
	}

	.card-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}

	.env-name {
		font-size: 0.8125rem;
		font-weight: 600;
	}

	.info-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		font-size: 0.75rem;
	}

	.info-label {
		color: var(--text-secondary);
		font-size: 0.6875rem;
	}

	.info-value {
		font-size: 0.75rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.branch {
		font-size: 0.6875rem;
		background-color: rgba(255, 255, 255, 0.04);
		padding: 1px 6px;
		border-radius: var(--radius-sm);
	}

	.badge-sm {
		font-size: 0.5625rem;
		padding: 1px 5px;
	}

	.blockers {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		align-items: center;
	}

	.blocker-label {
		font-size: 0.6875rem;
		color: var(--error);
		font-weight: 500;
	}

	.blocker-tag {
		font-size: 0.625rem;
		padding: 1px 5px;
		border-radius: 3px;
		background-color: rgba(239, 68, 68, 0.1);
		color: var(--error);
	}
</style>
