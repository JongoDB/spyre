<script lang="ts">
	import type { ClaudeTask, ClaudeTaskEvent } from '$lib/types/claude';
	import { addToast } from '$lib/stores/toast.svelte';

	interface Props {
		envId: string;
		activeTask?: ClaudeTask | null;
		onTaskStarted?: (taskId: string) => void;
	}

	let { envId, activeTask = null, onTaskStarted }: Props = $props();

	let prompt = $state('');
	let workingDir = $state('');
	let dispatching = $state(false);
	let streamOutput = $state('');
	let streamWs: WebSocket | null = $state(null);
	let taskStatus = $state<string | null>(null);
	let events = $state<ClaudeTaskEvent[]>([]);
	let showRaw = $state(false);
	let runningCost = $state<number | null>(null);

	const isRunning = $derived(
		activeTask?.status === 'running' || activeTask?.status === 'pending' || !!streamWs
	);

	async function dispatchTask() {
		if (!prompt.trim()) return;
		dispatching = true;
		streamOutput = '';
		taskStatus = null;
		events = [];
		runningCost = null;

		try {
			const res = await fetch('/api/claude/tasks', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					envId,
					prompt: prompt.trim(),
					workingDir: workingDir.trim() || undefined
				})
			});

			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				addToast(body.message ?? 'Failed to dispatch task', 'error');
				dispatching = false;
				return;
			}

			const { taskId } = await res.json();
			onTaskStarted?.(taskId);
			connectStream(taskId);
			prompt = '';
		} catch {
			addToast('Network error dispatching task', 'error');
		} finally {
			dispatching = false;
		}
	}

	function connectStream(taskId: string) {
		const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
		const ws = new WebSocket(`${protocol}//${window.location.host}/api/claude/tasks/${taskId}/stream`);

		ws.onmessage = (msgEvent) => {
			try {
				const msg = JSON.parse(msgEvent.data);
				if (msg.type === 'event') {
					// Structured event from the bridge
					const evt: ClaudeTaskEvent = {
						seq: msg.seq,
						type: msg.eventType,
						timestamp: msg.timestamp,
						summary: msg.summary,
						data: msg.data ?? {}
					};
					// Deduplicate by seq
					if (!events.some(e => e.seq === evt.seq)) {
						events = [...events, evt];
					}
					// Track cost from result events
					if (evt.type === 'result' && evt.data.cost_usd != null) {
						runningCost = Number(evt.data.cost_usd);
					} else if (evt.type === 'result' && evt.data.costUsd != null) {
						runningCost = Number(evt.data.costUsd);
					}
				} else if (msg.type === 'output') {
					streamOutput += msg.data;
				} else if (msg.type === 'complete') {
					taskStatus = msg.status ?? 'complete';
				} else if (msg.type === 'error') {
					streamOutput += `\nError: ${msg.message}\n`;
					taskStatus = 'error';
				} else if (msg.type === 'auth_required') {
					streamOutput += '\nAuthentication required. Please configure Claude auth in Settings.\n';
					taskStatus = 'auth_required';
				}
			} catch {
				// Raw data
				streamOutput += msgEvent.data;
			}
		};

		ws.onclose = () => {
			streamWs = null;
			if (!taskStatus) taskStatus = 'complete';
		};

		ws.onerror = () => {
			streamWs = null;
			taskStatus = 'error';
		};

		streamWs = ws;
	}

	function cancelTask() {
		if (activeTask) {
			fetch(`/api/claude/tasks/${activeTask.id}`, { method: 'DELETE' });
		}
		if (streamWs) {
			streamWs.close();
			streamWs = null;
		}
		taskStatus = 'cancelled';
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

	let feedEl: HTMLDivElement | undefined;
	let outputEl: HTMLPreElement | undefined;

	$effect(() => {
		if (events.length && feedEl) {
			feedEl.scrollTop = feedEl.scrollHeight;
		}
	});

	$effect(() => {
		if (streamOutput && outputEl) {
			outputEl.scrollTop = outputEl.scrollHeight;
		}
	});
</script>

<div class="dispatch-panel">
	<div class="dispatch-form">
		<textarea
			class="prompt-input"
			placeholder="Enter a prompt for Claude Code..."
			bind:value={prompt}
			rows="3"
			disabled={isRunning}
			onkeydown={(e) => {
				if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
					e.preventDefault();
					dispatchTask();
				}
			}}
		></textarea>
		<div class="form-row">
			<input
				class="working-dir-input"
				type="text"
				placeholder="Working directory (optional)"
				bind:value={workingDir}
				disabled={isRunning}
			/>
			<div class="form-actions">
				{#if isRunning}
					<button class="btn btn-danger btn-sm" onclick={cancelTask}>Cancel</button>
				{:else}
					<button
						class="btn btn-primary btn-sm"
						onclick={dispatchTask}
						disabled={dispatching || !prompt.trim()}
					>
						{dispatching ? 'Dispatching...' : 'Run'}
					</button>
				{/if}
			</div>
		</div>
		<span class="hint">Ctrl+Enter to run</span>
	</div>

	{#if events.length > 0 || streamOutput || taskStatus}
		<div class="output-section">
			<div class="output-header">
				<div class="output-header-left">
					<span class="output-label">Output</span>
					{#if taskStatus}
						<span class="badge badge-{taskStatus}">{taskStatus}</span>
					{:else}
						<span class="badge badge-running">running</span>
					{/if}
					{#if runningCost != null}
						<span class="cost-tag">${runningCost.toFixed(4)}</span>
					{/if}
				</div>
				<button
					class="toggle-btn"
					onclick={() => showRaw = !showRaw}
					title={showRaw ? 'Show activity feed' : 'Show raw output'}
				>
					{showRaw ? 'Activity' : 'Raw'}
				</button>
			</div>

			{#if showRaw}
				<pre class="output-content" bind:this={outputEl}>{streamOutput || 'Waiting for output...'}</pre>
			{:else if events.length > 0}
				<div class="activity-feed" bind:this={feedEl}>
					{#each events as event (event.seq)}
						<div class="event-row event-type-{event.type}">
							<span class="event-icon">{eventIcon(event.type)}</span>
							<span class="event-summary">{event.summary}</span>
							<span class="event-time">{new Date(event.timestamp).toLocaleTimeString()}</span>
						</div>
					{/each}
				</div>
			{:else}
				<pre class="output-content" bind:this={outputEl}>{streamOutput || 'Waiting for output...'}</pre>
			{/if}
		</div>
	{/if}
</div>

<style>
	.dispatch-panel {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.dispatch-form {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.prompt-input {
		width: 100%;
		padding: 10px 14px;
		background-color: var(--bg-secondary);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		color: var(--text-primary);
		font-size: 0.875rem;
		font-family: 'SF Mono', 'Fira Code', monospace;
		resize: vertical;
		min-height: 60px;
	}

	.prompt-input:focus {
		outline: none;
		border-color: var(--accent);
	}

	.prompt-input:disabled {
		opacity: 0.5;
	}

	.form-row {
		display: flex;
		gap: 8px;
		align-items: center;
	}

	.working-dir-input {
		flex: 1;
		padding: 6px 12px;
		background-color: var(--bg-secondary);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		color: var(--text-primary);
		font-size: 0.8125rem;
		font-family: 'SF Mono', 'Fira Code', monospace;
	}

	.working-dir-input:focus {
		outline: none;
		border-color: var(--accent);
	}

	.working-dir-input:disabled {
		opacity: 0.5;
	}

	.form-actions {
		display: flex;
		gap: 6px;
	}

	.hint {
		font-size: 0.6875rem;
		color: var(--text-secondary);
		opacity: 0.6;
	}

	.output-section {
		display: flex;
		flex-direction: column;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		overflow: hidden;
	}

	.output-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px 14px;
		background-color: var(--bg-secondary);
		border-bottom: 1px solid var(--border);
	}

	.output-header-left {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.output-label {
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-secondary);
	}

	.cost-tag {
		font-size: 0.6875rem;
		font-family: 'SF Mono', 'Fira Code', monospace;
		color: var(--text-secondary);
		background-color: rgba(255, 255, 255, 0.04);
		padding: 1px 6px;
		border-radius: 3px;
	}

	.toggle-btn {
		font-size: 0.6875rem;
		padding: 2px 8px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--border);
		background-color: transparent;
		color: var(--text-secondary);
		cursor: pointer;
		transition: all var(--transition);
	}

	.toggle-btn:hover {
		background-color: rgba(255, 255, 255, 0.04);
		color: var(--text-primary);
	}

	.output-content {
		padding: 12px 14px;
		font-size: 0.8125rem;
		font-family: 'SF Mono', 'Fira Code', monospace;
		color: var(--text-primary);
		background-color: var(--bg-primary);
		max-height: 400px;
		overflow-y: auto;
		white-space: pre-wrap;
		word-break: break-word;
		margin: 0;
		line-height: 1.5;
	}

	.activity-feed {
		max-height: 400px;
		overflow-y: auto;
		background-color: var(--bg-primary);
	}

	.event-row {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		padding: 6px 14px;
		border-bottom: 1px solid rgba(255, 255, 255, 0.03);
		font-size: 0.8125rem;
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
		width: 20px;
		text-align: center;
		font-size: 0.75rem;
		line-height: 1.5;
	}

	.event-summary {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: 'SF Mono', 'Fira Code', monospace;
		font-size: 0.8125rem;
		color: var(--text-primary);
	}

	.event-time {
		flex-shrink: 0;
		font-size: 0.6875rem;
		color: var(--text-secondary);
		font-family: 'SF Mono', 'Fira Code', monospace;
	}
</style>
