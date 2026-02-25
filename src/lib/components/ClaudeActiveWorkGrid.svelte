<script lang="ts">
	interface ActiveWorkItem {
		envId: string;
		envName: string;
		task: {
			id: string;
			prompt: string;
			status: string;
			started_at: string | null;
			created_at: string;
		};
		currentTask: string | null;
		plan: string | null;
		personaAvatar: string | null;
		personaRole: string | null;
	}

	let { items }: { items: ActiveWorkItem[] } = $props();

	function formatElapsed(startedAt: string | null): string {
		if (!startedAt) return '';
		const start = new Date(startedAt + 'Z').getTime();
		const now = Date.now();
		const seconds = Math.floor((now - start) / 1000);
		if (seconds < 60) return `${seconds}s`;
		if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
		return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
	}

	function truncate(text: string, max: number): string {
		return text.length > max ? text.slice(0, max) + '...' : text;
	}
</script>

{#if items.length === 0}
	<p class="empty">No active tasks</p>
{:else}
	<div class="work-grid">
		{#each items as item (item.task.id)}
			<a href="/environments/{item.envId}?tab=claude" class="work-card card">
				<div class="work-header">
					<span class="env-name">
						{#if item.personaAvatar}
							<span class="persona-avatar">{item.personaAvatar}</span>
						{/if}
						{item.envName}
					</span>
					{#if item.personaRole}
						<span class="persona-role-tag">{item.personaRole}</span>
					{:else}
						<span class="badge badge-provisioning">{item.task.status}</span>
					{/if}
				</div>
				<p class="prompt">{truncate(item.task.prompt, 100)}</p>
				{#if item.currentTask}
					<p class="current-task">
						<span class="task-label">Doing:</span> {truncate(item.currentTask, 80)}
					</p>
				{/if}
				<div class="work-footer">
					{#if item.task.started_at}
						<span class="elapsed">{formatElapsed(item.task.started_at)} elapsed</span>
					{/if}
				</div>
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

	.work-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: 12px;
	}

	.work-card {
		display: flex;
		flex-direction: column;
		gap: 8px;
		text-decoration: none;
		color: inherit;
		transition: border-color var(--transition);
	}

	.work-card:hover {
		border-color: var(--accent);
	}

	.work-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}

	.env-name {
		font-size: 0.8125rem;
		font-weight: 600;
	}

	.prompt {
		font-size: 0.75rem;
		color: var(--text-secondary);
		line-height: 1.4;
	}

	.current-task {
		font-size: 0.6875rem;
		color: var(--accent);
		background-color: rgba(99, 102, 241, 0.06);
		padding: 4px 8px;
		border-radius: var(--radius-sm);
	}

	.task-label {
		font-weight: 600;
	}

	.work-footer {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: auto;
	}

	.elapsed {
		font-size: 0.6875rem;
		color: var(--text-secondary);
		font-family: 'SF Mono', 'Fira Code', monospace;
	}

	.persona-avatar {
		margin-right: 4px;
	}

	.persona-role-tag {
		font-size: 0.6875rem;
		padding: 2px 8px;
		background: var(--bg-tertiary);
		border-radius: 10px;
		color: var(--text-secondary);
		white-space: nowrap;
	}
</style>
