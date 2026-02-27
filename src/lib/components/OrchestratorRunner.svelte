<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import AgentOffice from './AgentOffice.svelte';
	import AskUserDialog from './AskUserDialog.svelte';
	import type { OrchestratorSession } from '$lib/types/orchestrator';

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
		wave_id: string | null;
		wave_position: number | null;
		spawned_at: string | null;
		completed_at: string | null;
	}

	interface AskUserReq {
		id: string;
		question: string;
		options?: string[] | null;
	}

	let { session: initialSession, onBack }: {
		session: OrchestratorSession;
		onBack?: () => void;
	} = $props();

	let session = $state<OrchestratorSession>(initialSession);
	let agents = $state<AgentData[]>([]);
	let selectedAgentId = $state<string | null>(null);
	let pendingAskUser = $state<AskUserReq | null>(null);
	let ws = $state<WebSocket | null>(null);
	let cancelling = $state(false);

	const statusLabels: Record<string, string> = {
		pending: 'Starting...',
		running: 'Running',
		paused: 'Paused',
		completed: 'Completed',
		error: 'Failed',
		cancelled: 'Cancelled',
	};

	const statusColors: Record<string, string> = {
		pending: '#f59e0b',
		running: '#3b82f6',
		paused: '#f59e0b',
		completed: '#22c55e',
		error: '#ef4444',
		cancelled: '#9ca3af',
	};

	onMount(() => {
		connectWs();
		loadPendingQuestions();
	});

	onDestroy(() => {
		ws?.close();
	});

	function connectWs() {
		const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
		const socket = new WebSocket(`${proto}//${location.host}/api/orchestrator/${session.id}/ws`);

		socket.onmessage = (event) => {
			try {
				const msg = JSON.parse(event.data);
				handleWsMessage(msg);
			} catch { /* invalid JSON */ }
		};

		socket.onclose = () => {
			ws = null;
		};

		ws = socket;
	}

	function handleWsMessage(msg: Record<string, unknown>) {
		switch (msg.type) {
			case 'snapshot': {
				if (msg.session) session = msg.session as OrchestratorSession;
				if (msg.agents) agents = msg.agents as AgentData[];
				break;
			}
			case 'agent-spawn': {
				const agent = msg.agent as AgentData;
				agents = [...agents.filter(a => a.id !== agent.id), agent];
				break;
			}
			case 'agent-complete': {
				const agent = msg.agent as AgentData;
				agents = agents.map(a => a.id === agent.id ? agent : a);
				break;
			}
			case 'orchestrator-complete': {
				session = { ...session, status: msg.status as OrchestratorSession['status'] };
				refreshSession();
				break;
			}
			case 'ask-user': {
				const req = (msg as Record<string, unknown>).request as AskUserReq;
				pendingAskUser = req;
				break;
			}
		}
	}

	async function refreshSession() {
		try {
			const res = await fetch(`/api/orchestrator/${session.id}`);
			if (res.ok) {
				const data = await res.json();
				session = data;
				if (data.agents) agents = data.agents;
			}
		} catch { /* non-critical */ }
	}

	async function loadPendingQuestions() {
		try {
			const res = await fetch(`/api/orchestrator/${session.id}/ask-user`);
			if (res.ok) {
				const requests = await res.json();
				if (requests.length > 0) {
					pendingAskUser = requests[0];
				}
			}
		} catch { /* non-critical */ }
	}

	async function handleCancel() {
		cancelling = true;
		try {
			const res = await fetch(`/api/orchestrator/${session.id}`, { method: 'DELETE' });
			if (res.ok) {
				session = { ...session, status: 'cancelled' };
			}
		} catch { /* ignore */ }
		cancelling = false;
	}

	function isTerminal(status: string): boolean {
		return status === 'completed' || status === 'error' || status === 'cancelled';
	}
</script>

<div class="orchestrator-runner">
	<div class="runner-header">
		{#if onBack}
			<button class="back-btn" onclick={onBack}>
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>
				Back
			</button>
		{/if}

		<div class="session-info">
			<h3 class="goal">{session.goal}</h3>
			<div class="session-meta">
				<span class="status-badge" style="color: {statusColors[session.status] ?? '#6b7280'}">
					{statusLabels[session.status] ?? session.status}
				</span>
				<span class="meta-item">{session.agent_count} agent{session.agent_count !== 1 ? 's' : ''}</span>
				<span class="meta-item">{session.wave_count} wave{session.wave_count !== 1 ? 's' : ''}</span>
				{#if session.total_cost_usd > 0}
					<span class="meta-item">${session.total_cost_usd.toFixed(4)}</span>
				{/if}
				<span class="meta-item model">Model: {session.model}</span>
			</div>
		</div>

		{#if !isTerminal(session.status)}
			<button class="cancel-btn" onclick={handleCancel} disabled={cancelling}>
				{cancelling ? 'Cancelling...' : 'Cancel'}
			</button>
		{/if}
	</div>

	<div class="runner-body">
		<AgentOffice
			{agents}
			{selectedAgentId}
			onSelectAgent={(id) => { selectedAgentId = selectedAgentId === id ? null : id; }}
		/>
	</div>

	{#if session.result_summary && isTerminal(session.status)}
		<div class="result-section">
			<h4>Result</h4>
			<p>{session.result_summary}</p>
		</div>
	{/if}

	{#if session.error_message && session.status === 'error'}
		<div class="error-section">
			<h4>Error</h4>
			<p>{session.error_message}</p>
		</div>
	{/if}
</div>

{#if pendingAskUser}
	<AskUserDialog
		request={pendingAskUser}
		orchestratorId={session.id}
		onClose={() => { pendingAskUser = null; }}
	/>
{/if}

<style>
	.orchestrator-runner {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.runner-header {
		display: flex;
		align-items: flex-start;
		gap: 0.75rem;
		padding-bottom: 0.625rem;
		border-bottom: 1px solid var(--border-color, #333);
	}

	.back-btn {
		all: unset;
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: 0.25rem;
		font-size: 0.8rem;
		color: var(--text-secondary, #a1a1aa);
		padding: 0.25rem 0.5rem;
		border-radius: 4px;
		flex-shrink: 0;
	}

	.back-btn:hover {
		color: var(--text-primary, #e4e4e7);
		background: var(--bg-tertiary, #27272a);
	}

	.session-info {
		flex: 1;
		min-width: 0;
	}

	.goal {
		margin: 0;
		font-size: 0.95rem;
		font-weight: 600;
		color: var(--text-primary, #e4e4e7);
		line-height: 1.3;
	}

	.session-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
		margin-top: 0.25rem;
		font-size: 0.7rem;
	}

	.status-badge {
		font-weight: 600;
	}

	.meta-item {
		color: var(--text-secondary, #a1a1aa);
	}

	.meta-item.model {
		text-transform: capitalize;
	}

	.cancel-btn {
		all: unset;
		cursor: pointer;
		padding: 0.375rem 0.75rem;
		border-radius: 6px;
		font-size: 0.8rem;
		font-weight: 500;
		color: #ef4444;
		background: rgba(239, 68, 68, 0.1);
		flex-shrink: 0;
	}

	.cancel-btn:hover:not(:disabled) {
		background: rgba(239, 68, 68, 0.2);
	}

	.cancel-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.runner-body {
		min-height: 100px;
	}

	.result-section, .error-section {
		padding: 0.75rem;
		border-radius: 8px;
		font-size: 0.85rem;
	}

	.result-section {
		background: rgba(34, 197, 94, 0.05);
		border: 1px solid rgba(34, 197, 94, 0.2);
	}

	.error-section {
		background: rgba(239, 68, 68, 0.05);
		border: 1px solid rgba(239, 68, 68, 0.2);
		color: #f87171;
	}

	.result-section h4, .error-section h4 {
		margin: 0 0 0.375rem;
		font-size: 0.8rem;
		font-weight: 600;
	}

	.result-section p, .error-section p {
		margin: 0;
		line-height: 1.5;
		white-space: pre-wrap;
		word-break: break-word;
	}

	.result-section h4 {
		color: #22c55e;
	}
</style>
