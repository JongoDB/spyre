<script lang="ts">
	import { addToast } from '$lib/stores/toast.svelte';
	import type { OrchestratorSession } from '$lib/types/orchestrator';
	import { classifyWorkflow } from '$lib/shared/workflow-classifier';

	interface PersonaOption {
		id: string;
		name: string;
		role: string;
		avatar: string;
	}

	let { envId, personas, onSessionStarted }: {
		envId: string;
		personas: PersonaOption[];
		onSessionStarted: (session: OrchestratorSession) => void;
	} = $props();

	let goal = $state('');
	let model = $state<'haiku' | 'sonnet' | 'opus'>('sonnet');
	let selectedPersonaIds = $state<Set<string>>(new Set());
	let submitting = $state(false);

	// Auto-classify goal to suggest model and personas
	$effect(() => {
		if (goal.trim().length > 5) {
			const suggestion = classifyWorkflow(goal);
			if (suggestion) {
				model = suggestion.model as 'haiku' | 'sonnet' | 'opus';
				const matching = personas.filter(p =>
					suggestion.personaRoles.some(r => p.role.toLowerCase().includes(r.toLowerCase()) || p.name.toLowerCase().includes(r.toLowerCase()))
				);
				if (matching.length > 0) {
					selectedPersonaIds = new Set(matching.map(p => p.id));
				}
			}
		}
	});

	function togglePersona(id: string) {
		const next = new Set(selectedPersonaIds);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		selectedPersonaIds = next;
	}

	async function start() {
		if (!goal.trim()) return;
		submitting = true;

		try {
			const res = await fetch('/api/orchestrator', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					env_id: envId,
					goal: goal.trim(),
					model,
					persona_ids: selectedPersonaIds.size > 0 ? [...selectedPersonaIds] : undefined,
				}),
			});

			if (!res.ok) {
				const data = await res.json().catch(() => ({ message: 'Failed to start' }));
				addToast(data.message ?? 'Failed to start orchestrator', 'error');
				return;
			}

			const session = await res.json();
			addToast('Orchestrator started', 'success');
			onSessionStarted(session);
		} catch (err) {
			addToast('Failed to start orchestrator', 'error');
		} finally {
			submitting = false;
		}
	}
</script>

<div class="launcher">
	<h3>Start Orchestrator</h3>
	<p class="description">Define a goal and the orchestrator will dynamically spawn and coordinate lightweight agents to accomplish it.</p>

	<div class="form-group">
		<label for="orch-goal">Goal</label>
		<textarea
			id="orch-goal"
			bind:value={goal}
			placeholder="Describe what you want to accomplish..."
			rows="4"
		></textarea>
	</div>

	<div class="form-group">
		<label>Model</label>
		<div class="model-selector">
			{#each ['haiku', 'sonnet', 'opus'] as m}
				<button
					class="model-btn"
					class:active={model === m}
					onclick={() => { model = m as 'haiku' | 'sonnet' | 'opus'; }}
				>
					{m}
				</button>
			{/each}
		</div>
	</div>

	{#if personas.length > 0}
		<div class="form-group">
			<label>Agent Personas <span class="optional">(optional)</span></label>
			<div class="persona-chips">
				{#each personas as p}
					<button
						class="persona-chip"
						class:selected={selectedPersonaIds.has(p.id)}
						onclick={() => togglePersona(p.id)}
					>
						<span class="chip-avatar">{p.avatar}</span>
						<span class="chip-name">{p.name}</span>
					</button>
				{/each}
			</div>
		</div>
	{/if}

	<button
		class="start-btn"
		onclick={start}
		disabled={submitting || !goal.trim()}
	>
		{submitting ? 'Starting...' : 'Start Orchestrator'}
	</button>
</div>

<style>
	.launcher {
		max-width: 600px;
	}

	h3 {
		margin: 0 0 0.25rem;
		font-size: 1rem;
		color: var(--text-primary, #e4e4e7);
	}

	.description {
		margin: 0 0 1rem;
		font-size: 0.8rem;
		color: var(--text-secondary, #a1a1aa);
		line-height: 1.4;
	}

	.form-group {
		margin-bottom: 0.875rem;
	}

	.form-group label {
		display: block;
		margin-bottom: 0.375rem;
		font-size: 0.8rem;
		font-weight: 500;
		color: var(--text-primary, #e4e4e7);
	}

	.optional {
		font-weight: 400;
		color: var(--text-secondary, #a1a1aa);
	}

	textarea {
		width: 100%;
		background: var(--bg-secondary, #1e1e2e);
		border: 1px solid var(--border-color, #333);
		border-radius: 6px;
		padding: 0.5rem;
		color: var(--text-primary, #e4e4e7);
		font-family: inherit;
		font-size: 0.85rem;
		resize: vertical;
	}

	textarea:focus {
		outline: none;
		border-color: var(--accent, #6d5dfc);
	}

	.model-selector {
		display: flex;
		gap: 0.375rem;
	}

	.model-btn {
		all: unset;
		cursor: pointer;
		padding: 0.375rem 0.75rem;
		border-radius: 6px;
		font-size: 0.8rem;
		font-weight: 500;
		text-transform: capitalize;
		color: var(--text-secondary, #a1a1aa);
		background: var(--bg-secondary, #1e1e2e);
		border: 1px solid var(--border-color, #333);
		transition: all 0.15s;
	}

	.model-btn.active {
		color: white;
		background: var(--accent, #6d5dfc);
		border-color: var(--accent, #6d5dfc);
	}

	.model-btn:hover:not(.active) {
		border-color: var(--text-secondary, #a1a1aa);
	}

	.persona-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.375rem;
	}

	.persona-chip {
		all: unset;
		cursor: pointer;
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.3rem 0.625rem;
		border-radius: 16px;
		font-size: 0.75rem;
		color: var(--text-secondary, #a1a1aa);
		background: var(--bg-secondary, #1e1e2e);
		border: 1px solid var(--border-color, #333);
		transition: all 0.15s;
	}

	.persona-chip.selected {
		color: white;
		background: var(--accent, #6d5dfc);
		border-color: var(--accent, #6d5dfc);
	}

	.persona-chip:hover:not(.selected) {
		border-color: var(--text-secondary, #a1a1aa);
	}

	.chip-avatar {
		font-size: 0.9rem;
	}

	.start-btn {
		all: unset;
		cursor: pointer;
		display: block;
		width: 100%;
		text-align: center;
		padding: 0.625rem;
		border-radius: 8px;
		font-size: 0.9rem;
		font-weight: 600;
		color: white;
		background: var(--accent, #6d5dfc);
		transition: filter 0.15s;
	}

	.start-btn:hover:not(:disabled) {
		filter: brightness(1.1);
	}

	.start-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
