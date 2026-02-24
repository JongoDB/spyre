<script lang="ts">
	import type { ClaudeTask } from '$lib/types/claude';
	import { addToast } from '$lib/stores/toast.svelte';

	interface Props {
		tasks: ClaudeTask[];
		showEnvId?: boolean;
	}

	let { tasks, showEnvId = false }: Props = $props();

	let expandedTask = $state<string | null>(null);
	let resuming = $state<string | null>(null);

	function toggleExpand(taskId: string) {
		expandedTask = expandedTask === taskId ? null : taskId;
	}

	function formatDuration(start: string | null, end: string | null): string {
		if (!start) return '-';
		const startDate = new Date(start);
		const endDate = end ? new Date(end) : new Date();
		const ms = endDate.getTime() - startDate.getTime();
		const seconds = Math.floor(ms / 1000);
		if (seconds < 60) return `${seconds}s`;
		const mins = Math.floor(seconds / 60);
		const secs = seconds % 60;
		return `${mins}m ${secs}s`;
	}

	function formatCost(cost: number | null): string {
		if (cost === null || cost === undefined) return '-';
		return `$${cost.toFixed(4)}`;
	}

	async function resumeTask(taskId: string) {
		resuming = taskId;
		try {
			const res = await fetch(`/api/claude/tasks/${taskId}/resume`, { method: 'POST' });
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				addToast(body.message ?? 'Failed to resume task', 'error');
			} else {
				addToast('Task resumed', 'success');
			}
		} catch {
			addToast('Network error resuming task', 'error');
		} finally {
			resuming = null;
		}
	}
</script>

{#if tasks.length === 0}
	<div class="empty-state">
		<p>No tasks yet.</p>
	</div>
{:else}
	<div class="task-list">
		{#each tasks as task (task.id)}
			<div class="task-item card" class:expanded={expandedTask === task.id}>
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div class="task-header" onclick={() => toggleExpand(task.id)}>
					<div class="task-info">
						<span class="badge badge-{task.status}">{task.status}</span>
						<span class="task-prompt">{task.prompt.slice(0, 100)}{task.prompt.length > 100 ? '...' : ''}</span>
					</div>
					<div class="task-meta">
						{#if showEnvId && task.env_id}
							<code class="env-id">{task.env_id.slice(0, 8)}</code>
						{/if}
						<span class="task-duration">{formatDuration(task.started_at, task.completed_at)}</span>
						<span class="task-cost">{formatCost(task.cost_usd)}</span>
						<svg class="expand-icon" class:rotated={expandedTask === task.id} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
							<polyline points="6 9 12 15 18 9" />
						</svg>
					</div>
				</div>

				{#if expandedTask === task.id}
					<div class="task-detail">
						<div class="detail-section">
							<span class="detail-label">Prompt</span>
							<pre class="detail-content">{task.prompt}</pre>
						</div>
						{#if task.result}
							<div class="detail-section">
								<span class="detail-label">Result</span>
								<pre class="detail-content">{task.result.slice(0, 2000)}</pre>
							</div>
						{/if}
						{#if task.error_message}
							<div class="detail-section">
								<span class="detail-label">Error</span>
								<pre class="detail-content error">{task.error_message}</pre>
							</div>
						{/if}
						<div class="detail-row">
							{#if task.session_id}
								<div class="detail-item">
									<span class="detail-label">Session</span>
									<code>{task.session_id.slice(0, 12)}</code>
								</div>
							{/if}
							<div class="detail-item">
								<span class="detail-label">Created</span>
								<span>{new Date(task.created_at).toLocaleString()}</span>
							</div>
						</div>
						{#if task.session_id && (task.status === 'complete' || task.status === 'error')}
							<div class="detail-actions">
								<button
									class="btn btn-secondary btn-sm"
									onclick={() => resumeTask(task.id)}
									disabled={resuming === task.id}
								>
									{resuming === task.id ? 'Resuming...' : 'Resume Session'}
								</button>
							</div>
						{/if}
					</div>
				{/if}
			</div>
		{/each}
	</div>
{/if}

<style>
	.task-list {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.task-item {
		padding: 0;
		overflow: hidden;
	}

	.task-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 16px;
		cursor: pointer;
		gap: 12px;
		transition: background-color var(--transition);
	}

	.task-header:hover {
		background-color: rgba(255, 255, 255, 0.02);
	}

	.task-info {
		display: flex;
		align-items: center;
		gap: 10px;
		flex: 1;
		min-width: 0;
	}

	.task-prompt {
		font-size: 0.8125rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.task-meta {
		display: flex;
		align-items: center;
		gap: 12px;
		flex-shrink: 0;
		font-size: 0.75rem;
		color: var(--text-secondary);
	}

	.env-id {
		font-size: 0.6875rem;
		background-color: rgba(255, 255, 255, 0.04);
		padding: 1px 6px;
		border-radius: 3px;
	}

	.task-duration {
		font-family: 'SF Mono', 'Fira Code', monospace;
		font-size: 0.6875rem;
	}

	.task-cost {
		font-family: 'SF Mono', 'Fira Code', monospace;
		font-size: 0.6875rem;
	}

	.expand-icon {
		transition: transform 0.15s;
	}

	.expand-icon.rotated {
		transform: rotate(180deg);
	}

	.task-detail {
		padding: 0 16px 16px;
		border-top: 1px solid var(--border);
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding-top: 12px;
	}

	.detail-section {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.detail-label {
		font-size: 0.6875rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-secondary);
	}

	.detail-content {
		font-size: 0.8125rem;
		font-family: 'SF Mono', 'Fira Code', monospace;
		background-color: var(--bg-secondary);
		padding: 10px 14px;
		border-radius: var(--radius-sm);
		white-space: pre-wrap;
		word-break: break-word;
		max-height: 300px;
		overflow-y: auto;
		margin: 0;
	}

	.detail-content.error {
		color: var(--error);
		background-color: rgba(239, 68, 68, 0.06);
	}

	.detail-row {
		display: flex;
		flex-wrap: wrap;
		gap: 8px 24px;
	}

	.detail-item {
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-size: 0.8125rem;
	}

	.detail-actions {
		display: flex;
		gap: 8px;
	}

	.empty-state {
		text-align: center;
		padding: 24px;
		color: var(--text-secondary);
		font-size: 0.875rem;
	}

	.empty-state p {
		margin: 0;
	}
</style>
