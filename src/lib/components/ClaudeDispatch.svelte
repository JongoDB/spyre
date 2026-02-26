<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import type { ClaudeTask, ClaudeTaskEvent } from '$lib/types/claude';
	import { addToast } from '$lib/stores/toast.svelte';

	interface Props {
		envId: string;
		activeTask?: ClaudeTask | null;
		onTaskStarted?: (taskId: string) => void;
		onTaskCompleted?: () => void;
	}

	let { envId, activeTask = null, onTaskStarted, onTaskCompleted }: Props = $props();

	let prompt = $state('');
	let workingDir = $state('');
	let dispatching = $state(false);
	let streamOutput = $state('');
	let streamWs: WebSocket | null = $state(null);
	let taskStatus = $state<string | null>(null);
	let events = $state<ClaudeTaskEvent[]>([]);
	let showRaw = $state(false);
	let runningCost = $state<number | null>(null);
	let resultDuration = $state<number | null>(null);
	let completionResult = $state<string | null>(null);

	// Elapsed timer
	let startedAt = $state<number | null>(null);
	let elapsed = $state<number>(0);
	let timerInterval: ReturnType<typeof setInterval> | null = null;

	// Local taskStatus takes priority — once we know the task finished, it's not running
	// regardless of what the SSE-provided activeTask prop says (it can be stale)
	const isRunning = $derived(
		taskStatus == null &&
		(activeTask?.status === 'running' || activeTask?.status === 'pending' || !!streamWs)
	);

	function startTimer() {
		startedAt = Date.now();
		elapsed = 0;
		if (timerInterval) clearInterval(timerInterval);
		timerInterval = setInterval(() => {
			if (startedAt) {
				elapsed = Math.floor((Date.now() - startedAt) / 1000);
			}
		}, 1000);
	}

	function stopTimer() {
		if (timerInterval) {
			clearInterval(timerInterval);
			timerInterval = null;
		}
	}

	/** Extract full text from a text event's data */
	function extractTextContent(event: ClaudeTaskEvent): string {
		const data = event.data;
		// Claude stream-json wraps content in message envelope
		const msg = data.message as Record<string, unknown> | undefined;
		const content = (data.content ?? msg?.content) as Array<Record<string, unknown>> | undefined;
		if (data.type === 'assistant' && Array.isArray(content)) {
			const textBlocks = content.filter((b) => b.type === 'text');
			const text = textBlocks.map((b) => String(b.text ?? '')).join('');
			if (text) return text;
		}
		// Fallback to summary
		return event.summary;
	}

	/** Extract tool name and detail from a tool_use event */
	function extractToolInfo(event: ClaudeTaskEvent): { name: string; detail: string } {
		const data = event.data;
		if (data.type === 'assistant' && Array.isArray(data.content)) {
			const toolBlock = (data.content as Array<Record<string, unknown>>).find(
				(b) => b.type === 'tool_use'
			);
			if (toolBlock) {
				return {
					name: String(toolBlock.name ?? 'Tool'),
					detail: event.summary.includes(':')
						? event.summary.slice(event.summary.indexOf(':') + 2)
						: event.summary
				};
			}
		}
		// Fallback: parse from summary "ToolName: detail"
		const colonIdx = event.summary.indexOf(':');
		if (colonIdx > 0) {
			return {
				name: event.summary.slice(0, colonIdx),
				detail: event.summary.slice(colonIdx + 2)
			};
		}
		return { name: 'Tool', detail: event.summary };
	}

	/** Events filtered for display — skip init, tool_result, result */
	const displayEvents = $derived(
		events.filter((e) => e.type === 'text' || e.type === 'tool_use' || e.type === 'error')
	);

	async function dispatchTask() {
		if (!prompt.trim()) return;
		dispatching = true;
		streamOutput = '';
		taskStatus = null;
		events = [];
		runningCost = null;
		resultDuration = null;
		completionResult = null;

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
			startTimer();
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
					if (evt.type === 'result') {
						if (evt.data.cost_usd != null) {
							runningCost = Number(evt.data.cost_usd);
						} else if (evt.data.costUsd != null) {
							runningCost = Number(evt.data.costUsd);
						}
						if (evt.data.duration_ms != null) {
							resultDuration = Math.round(Number(evt.data.duration_ms) / 1000);
						} else if (evt.data.durationMs != null) {
							resultDuration = Math.round(Number(evt.data.durationMs) / 1000);
						}
					}
				} else if (msg.type === 'output') {
					streamOutput += msg.data;
				} else if (msg.type === 'complete') {
					taskStatus = msg.status ?? 'complete';
					if (msg.result) completionResult = msg.result;
					if (msg.cost_usd != null) runningCost = Number(msg.cost_usd);
					stopTimer();
					onTaskCompleted?.();
				} else if (msg.type === 'error') {
					streamOutput += `\nError: ${msg.message}\n`;
					taskStatus = 'error';
					stopTimer();
					onTaskCompleted?.();
				} else if (msg.type === 'auth_required') {
					streamOutput += '\nAuthentication required. Please configure Claude auth in Settings.\n';
					taskStatus = 'auth_required';
					stopTimer();
					onTaskCompleted?.();
				}
			} catch {
				// Raw data
				streamOutput += msgEvent.data;
			}
		};

		ws.onclose = () => {
			streamWs = null;
			if (!taskStatus) {
				taskStatus = 'complete';
				stopTimer();
				onTaskCompleted?.();
			}
		};

		ws.onerror = () => {
			streamWs = null;
			taskStatus = 'error';
			stopTimer();
			onTaskCompleted?.();
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
		stopTimer();
		onTaskCompleted?.();
	}

	/** Get the final answer text — last text event's full content or completion result */
	const finalAnswer = $derived.by(() => {
		if (completionResult) return completionResult;
		// Find the last text event
		const textEvents = events.filter((e) => e.type === 'text');
		if (textEvents.length > 0) {
			return extractTextContent(textEvents[textEvents.length - 1]);
		}
		return null;
	});

	function formatElapsed(secs: number): string {
		if (secs < 60) return `${secs}s`;
		const mins = Math.floor(secs / 60);
		const s = secs % 60;
		return `${mins}m ${s}s`;
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

	// Auto-reconnect to running task on mount
	onMount(() => {
		if (activeTask && (activeTask.status === 'running' || activeTask.status === 'pending')) {
			startTimer();
			// If we have a started_at from the task, use that for more accurate timing
			if (activeTask.started_at) {
				startedAt = new Date(activeTask.started_at).getTime();
			}
			connectStream(activeTask.id);
		}
	});

	onDestroy(() => {
		stopTimer();
		if (streamWs) {
			streamWs.close();
			streamWs = null;
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

	{#if streamWs || events.length > 0 || streamOutput || taskStatus}
		<div class="output-section">
			<div class="output-header">
				<div class="output-header-left">
					<span class="output-label">Output</span>
					{#if taskStatus}
						<span class="badge badge-{taskStatus}">{taskStatus}</span>
					{:else}
						<span class="badge badge-running">running</span>
					{/if}
					{#if elapsed > 0 || isRunning}
						<span class="elapsed-tag">{formatElapsed(resultDuration ?? elapsed)}</span>
					{/if}
					{#if runningCost != null}
						<span class="cost-tag">${runningCost.toFixed(4)}</span>
					{/if}
				</div>
				{#if streamOutput}
					<button
						class="toggle-btn"
						onclick={() => showRaw = !showRaw}
						title={showRaw ? 'Show activity feed' : 'Show stream JSON'}
					>
						{showRaw ? 'Activity' : 'Stream JSON'}
					</button>
				{/if}
			</div>

			{#if showRaw}
				<pre class="output-content" bind:this={outputEl}>{streamOutput || 'Waiting for output...'}</pre>
			{:else}
				<div class="activity-feed" bind:this={feedEl}>
					{#if taskStatus && finalAnswer}
						<div class="result-block">
							<pre class="result-text">{finalAnswer}</pre>
						</div>
					{/if}

					{#if displayEvents.length > 0}
						{#if taskStatus && finalAnswer}
							<div class="activity-divider">
								<span>Activity Log</span>
							</div>
						{/if}
						{#each displayEvents as event (event.seq)}
							{#if event.type === 'text'}
								<div class="event-text-block">
									<pre class="event-text-content">{extractTextContent(event)}</pre>
								</div>
							{:else if event.type === 'tool_use'}
								{@const tool = extractToolInfo(event)}
								<div class="event-row event-type-tool_use">
									<span class="event-icon">🔧</span>
									<span class="tool-name">{tool.name}</span>
									<span class="tool-detail">{tool.detail}</span>
									<span class="event-time">{new Date(event.timestamp).toLocaleTimeString()}</span>
								</div>
							{:else if event.type === 'error'}
								<div class="event-row event-type-error">
									<span class="event-icon">!</span>
									<span class="event-summary">{event.summary}</span>
									<span class="event-time">{new Date(event.timestamp).toLocaleTimeString()}</span>
								</div>
							{/if}
						{/each}
					{:else if !taskStatus}
						<div class="waiting-message">Waiting for response...</div>
					{/if}
				</div>
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

	.elapsed-tag {
		font-size: 0.6875rem;
		font-family: 'SF Mono', 'Fira Code', monospace;
		color: var(--text-secondary);
		background-color: rgba(255, 255, 255, 0.04);
		padding: 1px 6px;
		border-radius: 3px;
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
		max-height: 500px;
		overflow-y: auto;
		white-space: pre-wrap;
		word-break: break-word;
		margin: 0;
		line-height: 1.5;
	}

	.activity-feed {
		max-height: 500px;
		overflow-y: auto;
		background-color: var(--bg-primary);
	}

	/* Result block — prominent final answer */
	.result-block {
		padding: 14px 16px;
		border-bottom: 1px solid var(--border);
	}

	.result-text {
		font-size: 0.875rem;
		font-family: 'SF Mono', 'Fira Code', monospace;
		color: var(--text-primary);
		white-space: pre-wrap;
		word-break: break-word;
		margin: 0;
		line-height: 1.6;
	}

	.activity-divider {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 16px;
		background-color: var(--bg-secondary);
		border-bottom: 1px solid rgba(255, 255, 255, 0.03);
	}

	.activity-divider span {
		font-size: 0.6875rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-secondary);
	}

	/* Text event — full readable block */
	.event-text-block {
		padding: 10px 16px;
		border-bottom: 1px solid rgba(255, 255, 255, 0.03);
	}

	.event-text-block:last-child {
		border-bottom: none;
	}

	.event-text-content {
		font-size: 0.8125rem;
		font-family: 'SF Mono', 'Fira Code', monospace;
		color: var(--text-primary);
		white-space: pre-wrap;
		word-break: break-word;
		margin: 0;
		line-height: 1.5;
	}

	/* Tool use event — compact row */
	.event-row {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 5px 16px;
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

	.event-icon {
		flex-shrink: 0;
		width: 20px;
		text-align: center;
		font-size: 0.75rem;
		line-height: 1.5;
	}

	.tool-name {
		flex-shrink: 0;
		font-weight: 600;
		font-size: 0.75rem;
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
		font-size: 0.75rem;
		color: var(--text-secondary);
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

	.waiting-message {
		padding: 20px 16px;
		text-align: center;
		font-size: 0.8125rem;
		color: var(--text-secondary);
	}
</style>
