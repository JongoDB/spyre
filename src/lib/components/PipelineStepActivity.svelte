<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import type { ClaudeTaskEvent } from '$lib/types/claude';

	interface Props {
		taskId: string;
		compact?: boolean;
	}

	let { taskId, compact = false }: Props = $props();

	let events = $state<ClaudeTaskEvent[]>([]);
	let streamWs: WebSocket | null = $state(null);
	let taskStatus = $state<string | null>(null);
	let runningCost = $state<number | null>(null);
	let elapsed = $state(0);
	let startedAt = $state<number>(Date.now());
	let completionResult = $state<string | null>(null);
	let timerInterval: ReturnType<typeof setInterval> | null = null;

	const displayEvents = $derived(
		events.filter(e => e.type === 'text' || e.type === 'tool_use' || e.type === 'error')
	);

	function extractTextContent(event: ClaudeTaskEvent): string {
		const data = event.data;
		const msg = data.message as Record<string, unknown> | undefined;
		const content = (data.content ?? msg?.content) as Array<Record<string, unknown>> | undefined;
		if (data.type === 'assistant' && Array.isArray(content)) {
			const textBlocks = content.filter(b => b.type === 'text');
			const text = textBlocks.map(b => String(b.text ?? '')).join('');
			if (text) return text;
		}
		return event.summary;
	}

	function extractToolInfo(event: ClaudeTaskEvent): { name: string; detail: string } {
		const data = event.data;
		const msg = data.message as Record<string, unknown> | undefined;
		const content = (data.content ?? msg?.content) as Array<Record<string, unknown>> | undefined;
		if (data.type === 'assistant' && Array.isArray(content)) {
			const toolBlock = content.find(b => b.type === 'tool_use');
			if (toolBlock) {
				return {
					name: String(toolBlock.name ?? 'Tool'),
					detail: event.summary.includes(':') ? event.summary.slice(event.summary.indexOf(':') + 2) : event.summary
				};
			}
		}
		const colonIdx = event.summary.indexOf(':');
		if (colonIdx > 0) return { name: event.summary.slice(0, colonIdx), detail: event.summary.slice(colonIdx + 2) };
		return { name: 'Tool', detail: event.summary };
	}

	const finalAnswer = $derived.by(() => {
		if (completionResult) return completionResult;
		const textEvents = events.filter(e => e.type === 'text');
		if (textEvents.length > 0) return extractTextContent(textEvents[textEvents.length - 1]);
		return null;
	});

	function formatElapsed(secs: number): string {
		if (secs < 60) return `${secs}s`;
		const mins = Math.floor(secs / 60);
		return `${mins}m ${secs % 60}s`;
	}

	function connectStream() {
		const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
		const ws = new WebSocket(`${protocol}//${window.location.host}/api/claude/tasks/${taskId}/stream`);

		ws.onmessage = (msgEvent) => {
			try {
				const msg = JSON.parse(msgEvent.data);
				if (msg.type === 'event') {
					const evt: ClaudeTaskEvent = {
						seq: msg.seq,
						type: msg.eventType,
						timestamp: msg.timestamp,
						summary: msg.summary,
						data: msg.data ?? {}
					};
					if (!events.some(e => e.seq === evt.seq)) {
						events = [...events, evt];
					}
					if (evt.type === 'result') {
						if (evt.data.cost_usd != null) runningCost = Number(evt.data.cost_usd);
						else if (evt.data.costUsd != null) runningCost = Number(evt.data.costUsd);
					}
				} else if (msg.type === 'complete') {
					taskStatus = msg.status ?? 'complete';
					if (msg.result) completionResult = msg.result;
					if (msg.cost_usd != null) runningCost = Number(msg.cost_usd);
					stopTimer();
				} else if (msg.type === 'error') {
					taskStatus = 'error';
					stopTimer();
				}
			} catch { /* ignore parse errors */ }
		};

		ws.onclose = () => {
			streamWs = null;
			if (!taskStatus) {
				taskStatus = 'complete';
				stopTimer();
			}
		};

		ws.onerror = () => {
			streamWs = null;
		};

		streamWs = ws;
	}

	function startTimer() {
		startedAt = Date.now();
		elapsed = 0;
		timerInterval = setInterval(() => {
			elapsed = Math.floor((Date.now() - startedAt) / 1000);
		}, 1000);
	}

	function stopTimer() {
		if (timerInterval) {
			clearInterval(timerInterval);
			timerInterval = null;
		}
	}

	let feedEl: HTMLDivElement | undefined;

	$effect(() => {
		if (events.length && feedEl) {
			feedEl.scrollTop = feedEl.scrollHeight;
		}
	});

	onMount(() => {
		startTimer();
		connectStream();
	});

	onDestroy(() => {
		stopTimer();
		if (streamWs) {
			streamWs.close();
			streamWs = null;
		}
	});
</script>

<div class="step-activity" class:compact>
	<div class="activity-header">
		<div class="activity-stats">
			{#if taskStatus}
				<span class="activity-badge done">{taskStatus}</span>
			{:else}
				<span class="activity-badge running">live</span>
			{/if}
			{#if elapsed > 0 || !taskStatus}
				<span class="activity-stat">{formatElapsed(elapsed)}</span>
			{/if}
			{#if runningCost != null}
				<span class="activity-stat">${runningCost.toFixed(4)}</span>
			{/if}
			<span class="activity-stat">{displayEvents.length} events</span>
		</div>
	</div>

	<div class="activity-feed" bind:this={feedEl}>
		{#if taskStatus && finalAnswer}
			<div class="result-block">
				<pre class="result-text">{finalAnswer.length > 500 ? finalAnswer.slice(0, 500) + '...' : finalAnswer}</pre>
			</div>
		{/if}

		{#if displayEvents.length > 0}
			{#if taskStatus && finalAnswer}
				<div class="activity-divider"><span>Activity</span></div>
			{/if}
			{#each displayEvents as event (event.seq)}
				{#if event.type === 'tool_use'}
					{@const tool = extractToolInfo(event)}
					<div class="event-row event-tool">
						<span class="tool-icon">T</span>
						<span class="tool-name">{tool.name}</span>
						<span class="tool-detail">{tool.detail}</span>
					</div>
				{:else if event.type === 'text'}
					<div class="event-row event-text">
						<span class="text-preview">{extractTextContent(event).slice(0, 120)}{extractTextContent(event).length > 120 ? '...' : ''}</span>
					</div>
				{:else if event.type === 'error'}
					<div class="event-row event-error">
						<span class="error-icon">!</span>
						<span class="error-text">{event.summary}</span>
					</div>
				{/if}
			{/each}
		{:else if !taskStatus}
			<div class="waiting">Waiting for activity...</div>
		{/if}
	</div>
</div>

<style>
	.step-activity {
		border-top: 1px solid var(--border);
		background: rgba(99,102,241,0.02);
	}

	.activity-header {
		display: flex; align-items: center; justify-content: space-between;
		padding: 6px 14px; background: rgba(99,102,241,0.04);
		border-bottom: 1px solid rgba(99,102,241,0.08);
	}

	.activity-stats { display: flex; align-items: center; gap: 8px; }

	.activity-badge {
		font-size: 0.625rem; font-weight: 700; text-transform: uppercase;
		letter-spacing: 0.04em; padding: 1px 6px; border-radius: 3px;
	}
	.activity-badge.running {
		background: rgba(99,102,241,0.15); color: var(--accent);
		animation: badge-pulse 2s ease-in-out infinite;
	}
	.activity-badge.done { background: rgba(34,197,94,0.1); color: var(--success); }
	@keyframes badge-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }

	.activity-stat {
		font-size: 0.6875rem; font-family: 'SF Mono', monospace;
		color: var(--text-secondary); padding: 0 4px;
	}

	.activity-feed {
		max-height: 200px; overflow-y: auto;
	}
	.compact .activity-feed { max-height: 140px; }

	.result-block { padding: 8px 14px; border-bottom: 1px solid rgba(255,255,255,0.03); }
	.result-text {
		font-size: 0.75rem; font-family: 'SF Mono', monospace;
		color: var(--text-primary); white-space: pre-wrap;
		word-break: break-word; margin: 0; line-height: 1.5;
	}

	.activity-divider {
		display: flex; align-items: center; padding: 4px 14px;
		background: rgba(255,255,255,0.02);
	}
	.activity-divider span {
		font-size: 0.625rem; font-weight: 600; text-transform: uppercase;
		letter-spacing: 0.05em; color: var(--text-secondary);
	}

	.event-row {
		display: flex; align-items: center; gap: 6px;
		padding: 3px 14px; font-size: 0.75rem;
		border-bottom: 1px solid rgba(255,255,255,0.02);
	}
	.event-row:last-child { border-bottom: none; }

	.event-tool { background: rgba(59,130,246,0.03); }
	.tool-icon {
		width: 16px; height: 16px; border-radius: 3px;
		background: rgba(99,102,241,0.15); color: var(--accent);
		display: flex; align-items: center; justify-content: center;
		font-size: 0.5625rem; font-weight: 700; flex-shrink: 0;
	}
	.tool-name {
		font-weight: 600; font-family: 'SF Mono', monospace;
		font-size: 0.6875rem; color: var(--accent); flex-shrink: 0;
	}
	.tool-detail {
		flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis;
		white-space: nowrap; font-family: 'SF Mono', monospace;
		font-size: 0.6875rem; color: var(--text-secondary);
	}

	.event-text { padding: 4px 14px; }
	.text-preview {
		font-size: 0.6875rem; color: var(--text-secondary);
		white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
		font-family: 'SF Mono', monospace;
	}

	.event-error { background: rgba(239,68,68,0.04); }
	.error-icon {
		width: 16px; height: 16px; border-radius: 3px;
		background: rgba(239,68,68,0.15); color: var(--error);
		display: flex; align-items: center; justify-content: center;
		font-size: 0.625rem; font-weight: 700; flex-shrink: 0;
	}
	.error-text { color: var(--error); font-size: 0.6875rem; }

	.waiting {
		padding: 12px 14px; text-align: center;
		font-size: 0.75rem; color: var(--text-secondary);
	}
</style>
