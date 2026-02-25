<script lang="ts">
	import type { ClaudeTask, ClaudeTaskEvent } from '$lib/types/claude';
	import { addToast } from '$lib/stores/toast.svelte';

	interface Props {
		tasks: ClaudeTask[];
		showEnvId?: boolean;
	}

	let { tasks, showEnvId = false }: Props = $props();

	let expandedTask = $state<string | null>(null);
	let resuming = $state<string | null>(null);
	let retrying = $state<string | null>(null);
	let taskEvents = $state<Map<string, ClaudeTaskEvent[]>>(new Map());
	let loadingEvents = $state<string | null>(null);

	function toggleExpand(taskId: string) {
		if (expandedTask === taskId) {
			expandedTask = null;
		} else {
			expandedTask = taskId;
			fetchEvents(taskId);
		}
	}

	async function fetchEvents(taskId: string) {
		if (taskEvents.has(taskId)) return;
		loadingEvents = taskId;
		try {
			const res = await fetch(`/api/claude/tasks/${taskId}/events`);
			if (res.ok) {
				const body = await res.json();
				const newMap = new Map(taskEvents);
				newMap.set(taskId, body.events ?? []);
				taskEvents = newMap;
			}
		} catch {
			// Non-critical — events just won't show
		} finally {
			loadingEvents = null;
		}
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

	function eventIcon(type: string): string {
		switch (type) {
			case 'init': return '▶';
			case 'tool_use': return '🔧';
			case 'tool_result': return '📋';
			case 'text': return '💬';
			case 'result': return '🏁';
			case 'error': return '⚠';
			default: return '•';
		}
	}

	/** Extract full text from a text event's data */
	function extractTextContent(event: ClaudeTaskEvent): string {
		const data = event.data;
		if (data.type === 'assistant' && Array.isArray(data.content)) {
			const textBlocks = (data.content as Array<Record<string, unknown>>).filter(
				(b) => b.type === 'text'
			);
			const text = textBlocks.map((b) => String(b.text ?? '')).join('');
			if (text) return text;
		}
		return event.summary;
	}

	/** Extract tool info from a tool_use event */
	function extractToolInfo(event: ClaudeTaskEvent): { name: string; detail: string } {
		const colonIdx = event.summary.indexOf(':');
		if (colonIdx > 0) {
			return {
				name: event.summary.slice(0, colonIdx),
				detail: event.summary.slice(colonIdx + 2)
			};
		}
		return { name: 'Tool', detail: event.summary };
	}

	/** Filter events for display — skip init, tool_result, result */
	function filterEvents(events: ClaudeTaskEvent[]): ClaudeTaskEvent[] {
		return events.filter((e) => e.type === 'text' || e.type === 'tool_use' || e.type === 'error');
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

	async function retryTask(task: ClaudeTask) {
		if (!task.env_id) {
			addToast('Cannot retry: no environment associated', 'error');
			return;
		}
		retrying = task.id;
		try {
			const res = await fetch('/api/claude/tasks', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ envId: task.env_id, prompt: task.prompt })
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				addToast(body.message ?? 'Failed to retry task', 'error');
			} else {
				addToast('Task dispatched (retry)', 'success');
			}
		} catch {
			addToast('Network error retrying task', 'error');
		} finally {
			retrying = null;
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
						{#if task.error_code}
							<span class="error-code">{task.error_code}</span>
						{/if}
						<span class="task-prompt">{task.prompt.slice(0, 100)}{task.prompt.length > 100 ? '...' : ''}</span>
					</div>
					<div class="task-meta">
						{#if task.retry_count > 0}
							<span class="retry-badge">retry {task.retry_count}/{task.max_retries}</span>
						{/if}
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
						{#if task.error_message}
							<div class="detail-section">
								<span class="detail-label">Error</span>
								<pre class="detail-content error">{task.error_message}</pre>
							</div>
						{/if}
						{#if task.result && !task.error_message}
							<div class="detail-section">
								<span class="detail-label">Result</span>
								<pre class="detail-content">{task.result.slice(0, 2000)}</pre>
							</div>
						{/if}

						<!-- Structured events -->
						{#if loadingEvents === task.id}
							<div class="detail-section">
								<span class="detail-label">Activity</span>
								<div class="events-loading">Loading events...</div>
							</div>
						{:else if taskEvents.get(task.id)?.length}
							{@const filtered = filterEvents(taskEvents.get(task.id) ?? [])}
							<div class="detail-section">
								<span class="detail-label">Activity ({filtered.length} events)</span>
								<div class="events-list">
									{#each filtered as event (event.seq)}
										{#if event.type === 'text'}
											<div class="event-text-block">
												<pre class="event-text-content">{extractTextContent(event)}</pre>
											</div>
										{:else if event.type === 'tool_use'}
											{@const tool = extractToolInfo(event)}
											<div class="event-row event-type-tool_use">
												<span class="event-icon">{eventIcon(event.type)}</span>
												<span class="tool-name">{tool.name}</span>
												<span class="tool-detail">{tool.detail}</span>
												<span class="event-time">{new Date(event.timestamp).toLocaleTimeString()}</span>
											</div>
										{:else}
											<div class="event-row event-type-{event.type}">
												<span class="event-icon">{eventIcon(event.type)}</span>
												<span class="event-summary">{event.summary}</span>
												<span class="event-time">{new Date(event.timestamp).toLocaleTimeString()}</span>
											</div>
										{/if}
									{/each}
								</div>
							</div>
						{/if}

						<div class="detail-section">
							<span class="detail-label">Prompt</span>
							<pre class="detail-content">{task.prompt}</pre>
						</div>
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
						{#if task.status === 'error' || (task.session_id && (task.status === 'complete' || task.status === 'error'))}
							<div class="detail-actions">
								{#if task.status === 'error'}
									<button
										class="btn btn-primary btn-sm"
										onclick={() => retryTask(task)}
										disabled={retrying === task.id}
									>
										{retrying === task.id ? 'Retrying...' : 'Retry'}
									</button>
								{/if}
								{#if task.session_id && (task.status === 'complete' || task.status === 'error')}
									<button
										class="btn btn-secondary btn-sm"
										onclick={() => resumeTask(task.id)}
										disabled={resuming === task.id}
									>
										{resuming === task.id ? 'Resuming...' : 'Resume Session'}
									</button>
								{/if}
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

	.error-code {
		font-size: 0.625rem;
		font-family: 'SF Mono', 'Fira Code', monospace;
		color: var(--error);
		background-color: rgba(239, 68, 68, 0.08);
		padding: 1px 5px;
		border-radius: 3px;
		flex-shrink: 0;
	}

	.retry-badge {
		font-size: 0.625rem;
		font-family: 'SF Mono', 'Fira Code', monospace;
		color: var(--warning, #f59e0b);
		background-color: rgba(245, 158, 11, 0.08);
		padding: 1px 5px;
		border-radius: 3px;
		flex-shrink: 0;
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

	.events-loading {
		font-size: 0.8125rem;
		color: var(--text-secondary);
		padding: 8px 0;
	}

	.events-list {
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		max-height: 300px;
		overflow-y: auto;
		background-color: var(--bg-primary);
	}

	.event-row {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		padding: 5px 12px;
		border-bottom: 1px solid rgba(255, 255, 255, 0.03);
		font-size: 0.75rem;
	}

	.event-row:last-child {
		border-bottom: none;
	}

	.event-row.event-type-tool_use {
		background-color: rgba(59, 130, 246, 0.04);
	}

	.event-row.event-type-error {
		background-color: rgba(239, 68, 68, 0.04);
	}

	.event-row.event-type-result {
		background-color: rgba(34, 197, 94, 0.04);
	}

	.event-icon {
		flex-shrink: 0;
		width: 18px;
		text-align: center;
		font-size: 0.6875rem;
		line-height: 1.5;
	}

	.event-summary {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: 'SF Mono', 'Fira Code', monospace;
		color: var(--text-primary);
	}

	.event-time {
		flex-shrink: 0;
		font-size: 0.625rem;
		color: var(--text-secondary);
		font-family: 'SF Mono', 'Fira Code', monospace;
	}

	.event-text-block {
		padding: 8px 12px;
		border-bottom: 1px solid rgba(255, 255, 255, 0.03);
	}

	.event-text-block:last-child {
		border-bottom: none;
	}

	.event-text-content {
		font-size: 0.75rem;
		font-family: 'SF Mono', 'Fira Code', monospace;
		color: var(--text-primary);
		white-space: pre-wrap;
		word-break: break-word;
		margin: 0;
		line-height: 1.5;
	}

	.tool-name {
		flex-shrink: 0;
		font-weight: 600;
		font-size: 0.6875rem;
		font-family: 'SF Mono', 'Fira Code', monospace;
		color: var(--accent, #6366f1);
	}

	.tool-detail {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: 'SF Mono', 'Fira Code', monospace;
		font-size: 0.6875rem;
		color: var(--text-secondary);
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
