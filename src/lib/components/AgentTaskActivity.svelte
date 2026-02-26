<script lang="ts">
	import { onDestroy } from 'svelte';
	import type { ClaudeTaskEvent } from '$lib/types/claude';

	interface Props {
		taskId: string;
		onComplete?: () => void;
	}

	let { taskId, onComplete }: Props = $props();

	let events = $state<ClaudeTaskEvent[]>([]);
	let status = $state<string | null>(null);
	let cost = $state<number | null>(null);
	let elapsed = $state(0);
	let ws: WebSocket | null = null;
	let timer: ReturnType<typeof setInterval> | null = null;
	let eventsEl: HTMLDivElement | undefined = $state();

	function eventIcon(type: string): string {
		switch (type) {
			case 'tool_use': return '🔧';
			case 'text': return '💬';
			case 'error': return '⚠';
			case 'result': return '🏁';
			default: return '•';
		}
	}

	function extractToolInfo(event: ClaudeTaskEvent): { name: string; detail: string } {
		const idx = event.summary.indexOf(':');
		if (idx > 0) return { name: event.summary.slice(0, idx), detail: event.summary.slice(idx + 2) };
		return { name: 'Tool', detail: event.summary };
	}

	function extractText(event: ClaudeTaskEvent): string {
		const data = event.data;
		// Claude stream-json wraps content in message envelope
		const msg = data.message as Record<string, unknown> | undefined;
		const content = (data.content ?? msg?.content) as Array<Record<string, unknown>> | undefined;
		if (data.type === 'assistant' && Array.isArray(content)) {
			const text = content
				.filter(b => b.type === 'text')
				.map(b => String(b.text ?? ''))
				.join('');
			if (text) return text;
		}
		return event.summary;
	}

	function formatElapsed(s: number): string {
		if (s < 60) return `${s}s`;
		return `${Math.floor(s / 60)}m ${s % 60}s`;
	}

	function connect() {
		const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
		ws = new WebSocket(`${protocol}//${window.location.host}/api/claude/tasks/${taskId}/stream`);

		timer = setInterval(() => { elapsed += 1; }, 1000);

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
						// Only auto-scroll if user is near the bottom
						const nearBottom = eventsEl
							? (eventsEl.scrollHeight - eventsEl.scrollTop - eventsEl.clientHeight) < 60
							: true;
						events = [...events, evt];
						if (nearBottom) {
							requestAnimationFrame(() => {
								if (eventsEl) eventsEl.scrollTop = eventsEl.scrollHeight;
							});
						}
					}
					if (evt.type === 'result') {
						if (evt.data.cost_usd != null) cost = Number(evt.data.cost_usd);
						else if (evt.data.costUsd != null) cost = Number(evt.data.costUsd);
					}
				} else if (msg.type === 'complete') {
					status = msg.status ?? 'complete';
					if (msg.cost_usd != null) cost = Number(msg.cost_usd);
					cleanup();
					onComplete?.();
				} else if (msg.type === 'error') {
					status = 'error';
					cleanup();
					onComplete?.();
				}
			} catch { /* ignore parse errors */ }
		};

		ws.onclose = () => {
			if (!status) {
				status = 'complete';
				cleanup();
				onComplete?.();
			}
		};

		ws.onerror = () => {
			status = 'error';
			cleanup();
			onComplete?.();
		};
	}

	function cleanup() {
		if (timer) { clearInterval(timer); timer = null; }
	}

	// Connect on mount
	connect();

	onDestroy(() => {
		cleanup();
		if (ws) { ws.close(); ws = null; }
	});

	const displayEvents = $derived(
		events.filter(e => e.type === 'text' || e.type === 'tool_use' || e.type === 'error')
	);
</script>

<div class="activity">
	<div class="activity-header">
		{#if !status}
			<span class="status-running">
				<span class="pulse"></span>
				Running
			</span>
		{:else if status === 'complete'}
			<span class="status-complete">Complete</span>
		{:else}
			<span class="status-error">{status}</span>
		{/if}
		<span class="elapsed">{formatElapsed(elapsed)}</span>
		{#if cost != null}
			<span class="cost">${cost.toFixed(4)}</span>
		{/if}
		<span class="event-count">{displayEvents.length} events</span>
	</div>
	<div class="events-list" bind:this={eventsEl}>
		{#if displayEvents.length === 0 && !status}
			<div class="waiting">Waiting for activity...</div>
		{/if}
		{#each displayEvents as event (event.seq)}
			{#if event.type === 'tool_use'}
				{@const tool = extractToolInfo(event)}
				<div class="event-row tool">
					<span class="icon">{eventIcon(event.type)}</span>
					<span class="tool-name">{tool.name}</span>
					<span class="tool-detail">{tool.detail}</span>
				</div>
			{:else if event.type === 'text'}
				<div class="event-row text">
					<span class="icon">{eventIcon(event.type)}</span>
					<span class="text-content">{extractText(event).slice(0, 300)}</span>
				</div>
			{:else}
				<div class="event-row error">
					<span class="icon">{eventIcon(event.type)}</span>
					<span class="text-content">{event.summary}</span>
				</div>
			{/if}
		{/each}
	</div>
</div>

<style>
	.activity {
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		margin-top: 8px;
	}

	.activity-header {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 8px 12px;
		background: var(--bg-secondary);
		border-bottom: 1px solid var(--border);
		font-size: 0.75rem;
	}

	.status-running {
		display: flex;
		align-items: center;
		gap: 6px;
		color: var(--accent, #6366f1);
		font-weight: 600;
	}

	.pulse {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--accent, #6366f1);
		animation: pulse 1.5s ease-in-out infinite;
	}

	@keyframes pulse {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.4; }
	}

	.status-complete {
		color: var(--success, #22c55e);
		font-weight: 600;
	}

	.status-error {
		color: var(--error, #ef4444);
		font-weight: 600;
	}

	.elapsed, .cost, .event-count {
		font-family: 'SF Mono', 'Fira Code', monospace;
		color: var(--text-secondary);
	}

	.events-list {
		max-height: 400px;
		min-height: 60px;
		overflow-y: scroll;
		background: var(--bg-primary);
	}

	.waiting {
		padding: 12px;
		text-align: center;
		color: var(--text-secondary);
		font-size: 0.75rem;
	}

	.event-row {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		padding: 4px 12px;
		font-size: 0.75rem;
		border-bottom: 1px solid rgba(255, 255, 255, 0.03);
	}

	.event-row:last-child {
		border-bottom: none;
	}

	.event-row.tool {
		background: rgba(59, 130, 246, 0.04);
	}

	.event-row.error {
		background: rgba(239, 68, 68, 0.04);
	}

	.icon {
		flex-shrink: 0;
		width: 18px;
		text-align: center;
		font-size: 0.6875rem;
	}

	.tool-name {
		flex-shrink: 0;
		font-weight: 600;
		font-family: 'SF Mono', 'Fira Code', monospace;
		font-size: 0.6875rem;
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

	.text-content {
		flex: 1;
		min-width: 0;
		font-family: 'SF Mono', 'Fira Code', monospace;
		font-size: 0.6875rem;
		color: var(--text-primary);
		white-space: pre-wrap;
		word-break: break-word;
	}
</style>
