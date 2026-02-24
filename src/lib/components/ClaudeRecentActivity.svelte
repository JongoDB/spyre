<script lang="ts">
	interface RecentActivityItem {
		task: {
			id: string;
			prompt: string;
			status: string;
			completed_at: string | null;
		};
		envName: string | null;
		duration: number | null;
	}

	let { items }: { items: RecentActivityItem[] } = $props();

	function formatDuration(seconds: number | null): string {
		if (seconds === null) return '';
		if (seconds < 60) return `${seconds}s`;
		if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
		return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
	}

	function formatTime(dateStr: string | null): string {
		if (!dateStr) return '';
		const d = new Date(dateStr + 'Z');
		return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
	}

	function truncate(text: string, max: number): string {
		return text.length > max ? text.slice(0, max) + '...' : text;
	}
</script>

{#if items.length === 0}
	<p class="empty">No recent activity</p>
{:else}
	<div class="activity-list">
		{#each items as item (item.task.id)}
			<div class="activity-row">
				<span class="status-dot" class:success={item.task.status === 'complete'} class:error={item.task.status === 'error'}></span>
				<div class="activity-info">
					<span class="activity-prompt">{truncate(item.task.prompt, 80)}</span>
					{#if item.envName}
						<span class="activity-env">{item.envName}</span>
					{/if}
				</div>
				<div class="activity-meta">
					{#if item.duration !== null}
						<span class="activity-duration">{formatDuration(item.duration)}</span>
					{/if}
					<span class="activity-time">{formatTime(item.task.completed_at)}</span>
				</div>
			</div>
		{/each}
	</div>
{/if}

<style>
	.empty {
		font-size: 0.8125rem;
		color: var(--text-secondary);
		padding: 16px 0;
	}

	.activity-list {
		display: flex;
		flex-direction: column;
	}

	.activity-row {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 0;
		border-bottom: 1px solid var(--border);
	}

	.activity-row:last-child {
		border-bottom: none;
	}

	.status-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
		background-color: var(--text-secondary);
	}

	.status-dot.success {
		background-color: var(--success);
	}

	.status-dot.error {
		background-color: var(--error);
	}

	.activity-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.activity-prompt {
		font-size: 0.8125rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.activity-env {
		font-size: 0.6875rem;
		color: var(--text-secondary);
	}

	.activity-meta {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 2px;
		flex-shrink: 0;
	}

	.activity-duration {
		font-size: 0.6875rem;
		font-family: 'SF Mono', 'Fira Code', monospace;
		color: var(--text-secondary);
	}

	.activity-time {
		font-size: 0.625rem;
		color: var(--text-secondary);
		opacity: 0.7;
	}
</style>
