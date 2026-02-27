<script lang="ts">
	import type { DevcontainerWithPersona } from '$lib/types/devcontainer';
	import type { Persona } from '$lib/types/persona';
	import { addToast } from '$lib/stores/toast.svelte';

	interface StepDraft {
		id: string;
		position: number;
		type: 'agent' | 'gate' | 'orchestrator';
		label: string;
		devcontainer_id: string;
		persona_id: string;
		prompt_template: string;
		gate_instructions: string;
		max_retries: number;
		timeout_min: number | null;
	}

	interface Props {
		envId: string;
		devcontainers: DevcontainerWithPersona[];
		personas: Persona[];
		onCreated: (pipelineId: string) => void;
		onCancel: () => void;
	}

	let { envId, devcontainers, personas, onCreated, onCancel }: Props = $props();

	let nextStepId = 1;

	let name = $state('');
	let description = $state('');
	let autoApprove = $state(false);
	let steps = $state<StepDraft[]>([makeStep(1)]);
	let creating = $state(false);
	let savingTemplate = $state(false);
	let showPresets = $state(true);

	// --- Presets ---
	interface Preset {
		name: string;
		description: string;
		icon: string;
		steps: Array<{ type: 'agent' | 'gate' | 'orchestrator'; label: string; pickAgent?: number; prompt?: string; gate_instructions?: string }>;
	}

	const presets: Preset[] = [
		{
			name: 'Design → Review → Implement',
			description: 'Architect designs the approach, human reviews, then implementation begins',
			icon: '1',
			steps: [
				{ type: 'agent', label: 'Design approach', pickAgent: 0, prompt: 'Analyze the requirements and design the implementation approach. Write a detailed plan covering architecture decisions, file changes, and potential risks.' },
				{ type: 'gate', label: 'Review design', gate_instructions: 'Review the proposed design. Is the approach sound? Are there any concerns with the architecture?' },
				{ type: 'agent', label: 'Implement', pickAgent: 0, prompt: 'Implement the solution following the approved design from the previous step.' },
				{ type: 'gate', label: 'Final review', gate_instructions: 'Review the implementation. Does it match the design? Are there any issues?' }
			]
		},
		{
			name: 'Implement → Test → Review',
			description: 'Build the feature, run tests, then human reviews the result',
			icon: '2',
			steps: [
				{ type: 'agent', label: 'Implement', pickAgent: 0, prompt: 'Implement the requested feature or changes.' },
				{ type: 'agent', label: 'Test', pickAgent: 1, prompt: 'Write and run tests for the changes made in the previous step. Verify correctness and edge cases.' },
				{ type: 'gate', label: 'Review', gate_instructions: 'Review the implementation and test results. Are the changes correct and well-tested?' }
			]
		},
		{
			name: 'Parallel Build → Review',
			description: 'Multiple agents build in parallel, then human reviews all work',
			icon: '3',
			steps: [
				{ type: 'agent', label: 'Build (Agent 1)', pickAgent: 0, prompt: 'Implement your part of the feature.' },
				{ type: 'agent', label: 'Build (Agent 2)', pickAgent: 1, prompt: 'Implement your part of the feature.' },
				{ type: 'gate', label: 'Review all', gate_instructions: 'Review the combined work from both agents. Are the changes compatible and correct?' }
			]
		},
		{
			name: 'Single Agent → Review',
			description: 'Simple: one agent works, then human reviews',
			icon: '4',
			steps: [
				{ type: 'agent', label: 'Execute task', pickAgent: 0, prompt: '' },
				{ type: 'gate', label: 'Review', gate_instructions: 'Review the agent\'s work.' }
			]
		}
	];

	function applyPreset(preset: Preset) {
		name = name || preset.name;
		description = description || preset.description;
		nextStepId = 1;

		// For parallel preset, steps at same index get same position
		let position = 1;
		const newSteps: StepDraft[] = [];

		if (preset.name.includes('Parallel')) {
			// First two agent steps are parallel (position 1), then gate at position 2
			for (let i = 0; i < preset.steps.length; i++) {
				const ps = preset.steps[i];
				if (i < 2) position = 1;
				else position = 2;
				const dc = ps.pickAgent != null && devcontainers[ps.pickAgent] ? devcontainers[ps.pickAgent] : null;
				newSteps.push({
					id: `draft-${++nextStepId}`,
					position,
					type: ps.type,
					label: dc ? `${dc.persona_name ?? dc.service_name}` : ps.label,
					devcontainer_id: dc?.id ?? '',
					persona_id: dc?.persona_id ?? '',
					prompt_template: ps.prompt ?? '',
					gate_instructions: ps.gate_instructions ?? '',
					max_retries: 0,
					timeout_min: null
				});
			}
		} else {
			for (const ps of preset.steps) {
				const dc = ps.pickAgent != null && devcontainers[ps.pickAgent] ? devcontainers[ps.pickAgent] : null;
				newSteps.push({
					id: `draft-${++nextStepId}`,
					position: position++,
					type: ps.type,
					label: dc ? `${dc.persona_name ?? dc.service_name}: ${ps.label}` : ps.label,
					devcontainer_id: dc?.id ?? '',
					persona_id: dc?.persona_id ?? '',
					prompt_template: ps.prompt ?? '',
					gate_instructions: ps.gate_instructions ?? '',
					max_retries: 0,
					timeout_min: null
				});
			}
		}

		steps = newSteps;
		showPresets = false;
	}

	function makeStep(position: number): StepDraft {
		nextStepId++;
		return {
			id: `draft-${nextStepId}`,
			position,
			type: 'agent',
			label: '',
			devcontainer_id: '',
			persona_id: '',
			prompt_template: '',
			gate_instructions: '',
			max_retries: 0,
			timeout_min: null
		};
	}

	function addStep() {
		const maxPos = steps.reduce((m, s) => Math.max(m, s.position), 0);
		steps = [...steps, makeStep(maxPos + 1)];
	}

	function addGateStep() {
		const maxPos = steps.reduce((m, s) => Math.max(m, s.position), 0);
		const gate = makeStep(maxPos + 1);
		gate.type = 'gate';
		gate.label = 'Review';
		gate.gate_instructions = 'Review the work from the previous step.';
		steps = [...steps, gate];
	}

	function addParallelStep() {
		if (steps.length === 0) { addStep(); return; }
		const lastPos = steps[steps.length - 1].position;
		steps = [...steps, makeStep(lastPos)];
	}

	function removeStep(id: string) {
		steps = steps.filter(s => s.id !== id);
	}

	function onAgentSelect(step: StepDraft, dcId: string) {
		step.devcontainer_id = dcId;
		const dc = devcontainers.find(d => d.id === dcId);
		if (dc?.persona_id) step.persona_id = dc.persona_id;
		// Auto-fill label from persona name if label is empty or was auto-generated
		if (dc && (!step.label || step.label === 'Step' || devcontainers.some(d => step.label === d.persona_name || step.label === d.service_name))) {
			step.label = dc.persona_name ?? dc.service_name;
		}
	}

	// Group steps by position for visual grouping
	const groupedSteps = $derived(() => {
		const groups: Array<{ position: number; steps: StepDraft[] }> = [];
		for (const s of steps) {
			const existing = groups.find(g => g.position === s.position);
			if (existing) { existing.steps.push(s); }
			else { groups.push({ position: s.position, steps: [s] }); }
		}
		groups.sort((a, b) => a.position - b.position);
		return groups;
	});

	async function createPipeline(autoStart = false) {
		if (!name.trim() || steps.length === 0) {
			addToast('Name and at least one step required', 'error');
			return;
		}
		creating = true;
		try {
			const res = await fetch('/api/pipelines', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					env_id: envId,
					name: name.trim(),
					description: description.trim() || undefined,
					auto_approve: autoApprove || undefined,
					steps: steps.map(s => ({
						position: s.position,
						type: s.type,
						label: s.label || `Step ${s.position}`,
						devcontainer_id: s.devcontainer_id || undefined,
						persona_id: s.persona_id || undefined,
						prompt_template: s.prompt_template || undefined,
						gate_instructions: s.gate_instructions || undefined,
						max_retries: s.max_retries,
						timeout_ms: s.timeout_min ? s.timeout_min * 60 * 1000 : undefined
					}))
				})
			});

			if (res.ok) {
				const pipeline = await res.json();
				if (autoStart) {
					await fetch(`/api/pipelines/${pipeline.id}/start`, { method: 'POST' });
				}
				addToast('Pipeline created', 'success');
				onCreated(pipeline.id);
			} else {
				const body = await res.json().catch(() => ({}));
				addToast(body.message ?? 'Failed to create pipeline', 'error');
			}
		} catch {
			addToast('Network error', 'error');
		} finally {
			creating = false;
		}
	}

	async function saveAsTemplate() {
		if (!name.trim() || steps.length === 0) {
			addToast('Name and at least one step required', 'error');
			return;
		}
		savingTemplate = true;
		try {
			const res = await fetch('/api/pipeline-templates', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: name.trim(),
					description: description.trim() || null,
					env_id: envId,
					steps: steps.map(s => ({
						position: s.position,
						type: s.type,
						label: s.label || `Step ${s.position}`,
						devcontainer_id: s.devcontainer_id || null,
						persona_id: s.persona_id || null,
						prompt_template: s.prompt_template || null,
						gate_instructions: s.gate_instructions || null,
						max_retries: s.max_retries
					}))
				})
			});
			if (res.ok) {
				addToast('Template saved', 'success');
			} else {
				const body = await res.json().catch(() => ({}));
				addToast(body.message ?? 'Failed to save template', 'error');
			}
		} catch {
			addToast('Network error', 'error');
		} finally {
			savingTemplate = false;
		}
	}
</script>

<div class="builder">
	<div class="builder-header">
		<h3>New Pipeline</h3>
		<button class="btn btn-sm btn-secondary" onclick={onCancel}>Cancel</button>
	</div>

	<!-- Quick-start presets -->
	<div class="presets-section">
		<button class="presets-toggle" onclick={() => showPresets = !showPresets}>
			<span class="presets-label">Quick Start</span>
			<span class="presets-hint">{showPresets ? 'Hide' : 'Choose a workflow pattern'}</span>
			<svg class="presets-chevron" class:open={showPresets} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
		</button>
		{#if showPresets}
			<div class="preset-grid">
				{#each presets as preset}
					<button class="preset-card" onclick={() => applyPreset(preset)}>
						<span class="preset-icon">{preset.icon}</span>
						<div class="preset-info">
							<span class="preset-name">{preset.name}</span>
							<span class="preset-desc">{preset.description}</span>
						</div>
					</button>
				{/each}
			</div>
		{/if}
	</div>

	<div class="builder-form">
		<div class="form-row">
			<div class="form-group flex-1">
				<label for="pipe-name">Name</label>
				<input id="pipe-name" class="form-input" bind:value={name} placeholder="e.g. Feature Implementation" />
			</div>
		</div>
		<div class="form-row">
			<div class="form-group flex-1">
				<label for="pipe-desc">Description</label>
				<input id="pipe-desc" class="form-input" bind:value={description} placeholder="Brief description of the pipeline goal" />
			</div>
		</div>
		<label class="auto-approve-toggle">
			<input type="checkbox" bind:checked={autoApprove} />
			<span class="toggle-label">Hands-off mode</span>
			<span class="toggle-hint">Auto-approve intermediate gates; pause only at final review</span>
		</label>
	</div>

	<div class="steps-section">
		<div class="steps-header">
			<span class="steps-title">Steps</span>
			<div class="steps-actions">
				<button class="btn btn-sm btn-secondary" onclick={addParallelStep} title="Add a step that runs in parallel with the last step">+ Parallel</button>
				<button class="btn btn-sm btn-secondary" onclick={addGateStep} title="Add a human review gate">+ Gate</button>
				<button class="btn btn-sm btn-secondary" onclick={addStep}>+ Step</button>
			</div>
		</div>

		{#each groupedSteps() as group (group.position)}
			<div class="position-group" class:parallel={group.steps.length > 1}>
				<div class="position-badge">{group.position}</div>
				<div class="position-steps">
					{#each group.steps as step (step.id)}
						<div class="step-card">
							<div class="step-card-header">
								<select class="type-select" bind:value={step.type}>
									<option value="agent">Agent</option>
									<option value="gate">Gate</option>
									<option value="orchestrator">Orchestrator</option>
								</select>
								<input class="label-input" bind:value={step.label} placeholder={step.type === 'gate' ? 'Review checkpoint' : 'Step label (auto-fills from agent)'} />
								<button class="remove-btn" onclick={() => removeStep(step.id)} title="Remove step">
									<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
								</button>
							</div>

							{#if step.type === 'agent'}
								<div class="step-fields">
									<div class="form-group">
										<label>Agent</label>
										<select class="form-select" value={step.devcontainer_id} onchange={(e) => onAgentSelect(step, (e.target as HTMLSelectElement).value)}>
											<option value="">Select agent...</option>
											{#each devcontainers as dc}
												<option value={dc.id}>{dc.persona_avatar ?? ''} {dc.persona_name ?? dc.service_name} — {dc.persona_role ?? 'agent'}</option>
											{/each}
										</select>
									</div>
									<div class="form-group">
										<label>Prompt</label>
										<textarea class="form-input prompt-input" bind:value={step.prompt_template} placeholder="Task instructions for this agent..." rows="3"></textarea>
									</div>
									<div class="step-inline-fields">
									<div class="form-group form-inline">
										<label>Max retries</label>
										<input type="number" class="form-input retries-input" bind:value={step.max_retries} min="0" max="5" />
									</div>
									<div class="form-group form-inline">
										<label>Timeout (min)</label>
										<input type="number" class="form-input retries-input" bind:value={step.timeout_min} placeholder="--" min="1" max="120" />
									</div>
								</div>
								</div>
							{:else if step.type === 'orchestrator'}
								<div class="step-fields">
									<div class="form-group">
										<label>Orchestrator Goal</label>
										<textarea class="form-input prompt-input" bind:value={step.prompt_template} placeholder="The goal for the dynamic orchestrator to accomplish..." rows="3"></textarea>
									</div>
								</div>
							{:else}
								<div class="step-fields">
									<div class="form-group">
										<label>Gate Instructions</label>
										<textarea class="form-input prompt-input" bind:value={step.gate_instructions} placeholder="What should the reviewer check?" rows="2"></textarea>
									</div>
								</div>
							{/if}
						</div>
					{/each}
				</div>
			</div>
		{/each}

		{#if steps.length === 0}
			<div class="empty-steps">Add steps to define the pipeline workflow, or choose a quick-start preset above.</div>
		{/if}
	</div>

	<div class="builder-footer">
		<button class="btn btn-sm btn-secondary" onclick={saveAsTemplate} disabled={savingTemplate}>
			{savingTemplate ? 'Saving...' : 'Save as Template'}
		</button>
		<div class="footer-right">
			<button class="btn btn-sm btn-secondary" onclick={() => createPipeline(false)} disabled={creating}>
				Save Draft
			</button>
			<button class="btn btn-sm btn-primary" onclick={() => createPipeline(true)} disabled={creating}>
				{creating ? 'Creating...' : 'Create & Start'}
			</button>
		</div>
	</div>
</div>

<style>
	.builder { display: flex; flex-direction: column; gap: 16px; }
	.builder-header { display: flex; align-items: center; justify-content: space-between; }
	.builder-header h3 { font-size: 0.9375rem; font-weight: 600; margin: 0; }

	/* Presets */
	.presets-section {
		border: 1px solid var(--border); border-radius: var(--radius-sm); overflow: hidden;
	}
	.presets-toggle {
		display: flex; align-items: center; gap: 8px; width: 100%;
		padding: 10px 14px; background: var(--bg-secondary);
		border: none; cursor: pointer; color: var(--text-primary);
		transition: background-color var(--transition);
	}
	.presets-toggle:hover { background: rgba(255,255,255,0.03); }
	.presets-label { font-size: 0.8125rem; font-weight: 600; }
	.presets-hint { font-size: 0.75rem; color: var(--text-secondary); }
	.presets-chevron { margin-left: auto; color: var(--text-secondary); transition: transform var(--transition); }
	.presets-chevron.open { transform: rotate(180deg); }

	.preset-grid {
		display: grid; grid-template-columns: 1fr 1fr; gap: 8px;
		padding: 12px; border-top: 1px solid var(--border);
	}
	.preset-card {
		display: flex; align-items: flex-start; gap: 10px;
		padding: 10px 12px; background: var(--bg-primary); border: 1px solid var(--border);
		border-radius: var(--radius-sm); cursor: pointer; text-align: left;
		transition: all var(--transition); color: var(--text-primary);
	}
	.preset-card:hover { border-color: var(--accent); background: rgba(99,102,241,0.03); }
	.preset-icon {
		width: 28px; height: 28px; border-radius: 6px;
		background: rgba(99,102,241,0.1); color: var(--accent);
		display: flex; align-items: center; justify-content: center;
		font-size: 0.75rem; font-weight: 700; flex-shrink: 0;
	}
	.preset-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
	.preset-name { font-size: 0.8125rem; font-weight: 500; }
	.preset-desc { font-size: 0.6875rem; color: var(--text-secondary); line-height: 1.4; }

	.builder-form { display: flex; flex-direction: column; gap: 10px; }
	.form-row { display: flex; gap: 12px; }
	.flex-1 { flex: 1; }
	.form-group { display: flex; flex-direction: column; gap: 4px; }
	.form-group label { font-size: 0.75rem; font-weight: 500; color: var(--text-secondary); }
	.form-inline { flex-direction: row; align-items: center; gap: 8px; }
	.retries-input { width: 60px; }

	.steps-section { display: flex; flex-direction: column; gap: 8px; }
	.steps-header { display: flex; align-items: center; justify-content: space-between; }
	.steps-title { font-size: 0.8125rem; font-weight: 600; }
	.steps-actions { display: flex; gap: 6px; }

	.position-group {
		display: flex; gap: 10px; padding: 10px; background: var(--bg-secondary);
		border: 1px solid var(--border); border-radius: var(--radius-sm);
	}
	.position-group.parallel { border-left: 3px solid var(--accent); }
	.position-badge {
		width: 28px; height: 28px; border-radius: 50%; background: var(--bg-tertiary);
		display: flex; align-items: center; justify-content: center;
		font-size: 0.75rem; font-weight: 700; flex-shrink: 0; color: var(--text-secondary);
	}
	.position-steps { flex: 1; display: flex; flex-direction: column; gap: 8px; }

	.step-card {
		background: var(--bg-primary); border: 1px solid var(--border);
		border-radius: var(--radius-sm); padding: 10px 12px;
	}
	.step-card-header { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
	.type-select {
		width: 90px; font-size: 0.75rem; padding: 4px 8px;
		background: var(--bg-tertiary); border: 1px solid var(--border);
		border-radius: var(--radius-sm); color: var(--text-primary);
	}
	.label-input {
		flex: 1; font-size: 0.8125rem; padding: 4px 8px;
		background: var(--bg-tertiary); border: 1px solid var(--border);
		border-radius: var(--radius-sm); color: var(--text-primary);
	}
	.remove-btn {
		background: none; border: none; color: var(--text-secondary);
		cursor: pointer; padding: 4px; border-radius: var(--radius-sm);
		transition: color var(--transition);
	}
	.remove-btn:hover { color: var(--error); }

	.step-fields { display: flex; flex-direction: column; gap: 8px; }
	.prompt-input { resize: vertical; min-height: 48px; font-size: 0.8125rem; }

	.empty-steps {
		text-align: center; padding: 24px; color: var(--text-secondary);
		font-size: 0.8125rem; background: var(--bg-secondary);
		border: 1px dashed var(--border); border-radius: var(--radius-sm);
	}

	.auto-approve-toggle {
		display: flex; align-items: center; gap: 8px; cursor: pointer;
		padding: 8px 12px; background: var(--bg-secondary);
		border: 1px solid var(--border); border-radius: var(--radius-sm);
		transition: border-color var(--transition);
	}
	.auto-approve-toggle:hover { border-color: var(--accent); }
	.auto-approve-toggle input[type="checkbox"] { accent-color: var(--accent); }
	.toggle-label { font-size: 0.8125rem; font-weight: 500; color: var(--text-primary); }
	.toggle-hint { font-size: 0.6875rem; color: var(--text-secondary); }

	.step-inline-fields { display: flex; gap: 16px; align-items: center; }

	.builder-footer {
		display: flex; align-items: center; justify-content: space-between;
		padding-top: 12px; border-top: 1px solid var(--border);
	}
	.footer-right { display: flex; gap: 8px; }
</style>
