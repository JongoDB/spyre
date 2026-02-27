<script lang="ts">
	import AgentDesk from './AgentDesk.svelte';

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

	let { agents, selectedAgentId = null, onSelectAgent }: {
		agents: AgentData[];
		selectedAgentId?: string | null;
		onSelectAgent?: (id: string) => void;
	} = $props();

	// Group agents by wave
	interface WaveGroup {
		waveId: string;
		agents: AgentData[];
		allComplete: boolean;
		totalCost: number;
	}

	let waveGroups = $derived.by(() => {
		const groups = new Map<string, AgentData[]>();
		const noWave: AgentData[] = [];

		for (const agent of agents) {
			if (agent.wave_id) {
				if (!groups.has(agent.wave_id)) groups.set(agent.wave_id, []);
				groups.get(agent.wave_id)!.push(agent);
			} else {
				noWave.push(agent);
			}
		}

		const result: WaveGroup[] = [];

		// Non-wave agents first
		if (noWave.length > 0) {
			result.push({
				waveId: 'standalone',
				agents: noWave,
				allComplete: noWave.every(a => a.status === 'completed' || a.status === 'error' || a.status === 'cancelled'),
				totalCost: noWave.reduce((sum, a) => sum + (a.cost_usd ?? 0), 0),
			});
		}

		// Wave groups in order
		let waveNum = 1;
		for (const [waveId, waveAgents] of groups) {
			const sorted = waveAgents.sort((a, b) => (a.wave_position ?? 0) - (b.wave_position ?? 0));
			result.push({
				waveId,
				agents: sorted,
				allComplete: sorted.every(a => a.status === 'completed' || a.status === 'error' || a.status === 'cancelled'),
				totalCost: sorted.reduce((sum, a) => sum + (a.cost_usd ?? 0), 0),
			});
			waveNum++;
		}

		return result;
	});
</script>

<div class="agent-office">
	{#if agents.length === 0}
		<div class="empty">No agents spawned yet</div>
	{:else}
		{#each waveGroups as wave, waveIdx}
			<div class="wave-band" class:complete={wave.allComplete}>
				<div class="wave-header">
					<span class="wave-label">
						{wave.waveId === 'standalone' ? 'Standalone' : `Wave ${waveIdx + 1}`}
					</span>
					<span class="wave-meta">
						{wave.agents.length} agent{wave.agents.length !== 1 ? 's' : ''}
						{#if wave.totalCost > 0}
							&middot; ${wave.totalCost.toFixed(4)}
						{/if}
					</span>
				</div>
				<div class="wave-agents">
					{#each wave.agents as agent (agent.id)}
						<AgentDesk
							{agent}
							expanded={selectedAgentId === agent.id}
							onSelect={onSelectAgent}
						/>
					{/each}
				</div>
			</div>
		{/each}
	{/if}
</div>

<style>
	.agent-office {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.empty {
		text-align: center;
		padding: 2rem;
		color: var(--text-secondary, #a1a1aa);
		font-size: 0.85rem;
	}

	.wave-band {
		border: 1px solid var(--border-color, #333);
		border-radius: 8px;
		padding: 0.625rem;
		background: var(--bg-primary, #18181b);
	}

	.wave-band.complete {
		border-color: rgba(34, 197, 94, 0.3);
	}

	.wave-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 0.5rem;
		padding-bottom: 0.375rem;
		border-bottom: 1px solid var(--border-color, #333);
	}

	.wave-label {
		font-weight: 600;
		font-size: 0.75rem;
		color: var(--text-primary, #e4e4e7);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.wave-meta {
		font-size: 0.7rem;
		color: var(--text-secondary, #a1a1aa);
	}

	.wave-agents {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}
</style>
