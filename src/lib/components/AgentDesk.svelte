<script lang="ts">
	interface AgentData {
		id: string;
		name: string;
		role: string | null;
		persona_name: string | null;
		persona_role: string | null;
		persona_avatar: string | null;
		model: string;
		status: string;
		cost_usd: number | null;
		result_summary: string | null;
		error_message: string | null;
		spawned_at: string | null;
		completed_at: string | null;
	}

	let { agent, expanded = false, onSelect }: {
		agent: AgentData;
		expanded?: boolean;
		onSelect?: (id: string) => void;
	} = $props();

	const statusColors: Record<string, string> = {
		pending: '#6b7280',
		spawning: '#f59e0b',
		running: '#3b82f6',
		completed: '#22c55e',
		error: '#ef4444',
		cancelled: '#9ca3af',
	};

	const modelBadge: Record<string, string> = {
		haiku: 'H',
		sonnet: 'S',
		opus: 'O',
	};

	function formatCost(cost: number | null): string {
		if (cost === null || cost === undefined) return '';
		return `$${cost.toFixed(4)}`;
	}
</script>

<button class="agent-desk" class:expanded onclick={() => onSelect?.(agent.id)}>
	<div class="agent-header">
		<span class="avatar">{agent.persona_avatar ?? '🤖'}</span>
		<div class="agent-info">
			<span class="agent-name">{agent.name}</span>
			<span class="agent-role">{agent.persona_role ?? agent.role ?? 'agent'}</span>
		</div>
		<div class="badges">
			<span class="model-badge" title="Model: {agent.model}">{modelBadge[agent.model] ?? agent.model}</span>
			<span class="status-dot" style="background: {statusColors[agent.status] ?? '#6b7280'}"
				class:pulse={agent.status === 'running'}
				title={agent.status}></span>
		</div>
	</div>

	{#if agent.cost_usd}
		<span class="cost">{formatCost(agent.cost_usd)}</span>
	{/if}

	{#if expanded && agent.result_summary}
		<div class="result-preview">
			<p>{agent.result_summary.slice(0, 300)}{agent.result_summary.length > 300 ? '...' : ''}</p>
		</div>
	{/if}

	{#if expanded && agent.error_message}
		<div class="error-preview">
			<p>{agent.error_message}</p>
		</div>
	{/if}
</button>

<style>
	.agent-desk {
		all: unset;
		cursor: pointer;
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		padding: 0.625rem;
		border-radius: 8px;
		background: var(--bg-secondary, #1e1e2e);
		border: 1px solid var(--border-color, #333);
		min-width: 180px;
		max-width: 260px;
		transition: border-color 0.2s, box-shadow 0.2s;
	}

	.agent-desk:hover {
		border-color: var(--accent, #6d5dfc);
		box-shadow: 0 0 0 1px var(--accent, #6d5dfc);
	}

	.agent-desk.expanded {
		max-width: 100%;
	}

	.agent-header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.avatar {
		font-size: 1.25rem;
		flex-shrink: 0;
	}

	.agent-info {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}

	.agent-name {
		font-weight: 600;
		font-size: 0.8rem;
		color: var(--text-primary, #e4e4e7);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.agent-role {
		font-size: 0.7rem;
		color: var(--text-secondary, #a1a1aa);
	}

	.badges {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		flex-shrink: 0;
	}

	.model-badge {
		font-size: 0.6rem;
		font-weight: 700;
		padding: 0.125rem 0.375rem;
		border-radius: 4px;
		background: var(--bg-tertiary, #27272a);
		color: var(--text-secondary, #a1a1aa);
	}

	.status-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.status-dot.pulse {
		animation: pulse-anim 1.5s ease-in-out infinite;
	}

	@keyframes pulse-anim {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.4; }
	}

	.cost {
		font-size: 0.65rem;
		color: var(--text-secondary, #a1a1aa);
		text-align: right;
	}

	.result-preview, .error-preview {
		font-size: 0.7rem;
		line-height: 1.3;
		padding: 0.375rem;
		border-radius: 4px;
		max-height: 120px;
		overflow-y: auto;
	}

	.result-preview {
		background: var(--bg-tertiary, #27272a);
		color: var(--text-secondary, #a1a1aa);
	}

	.result-preview p, .error-preview p {
		margin: 0;
		white-space: pre-wrap;
		word-break: break-word;
	}

	.error-preview {
		background: rgba(239, 68, 68, 0.1);
		color: #f87171;
	}
</style>
