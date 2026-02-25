<script lang="ts">
	import type { DevcontainerWithPersona } from '$lib/types/devcontainer';
	import type { Persona } from '$lib/types/persona';
	import { addToast } from '$lib/stores/toast.svelte';

	interface StepDraft {
		id: string;
		position: number;
		type: 'agent' | 'gate';
		label: string;
		devcontainer_id: string;
		persona_id: string;
		prompt_template: string;
		gate_instructions: string;
		max_retries: number;
	}

	interface Props {
		envId: string;
		devcontainers: DevcontainerWithPersona[];
		personas: Persona[];
		onCreated: (pipelineId: string) => void;
		onCancel: () => void;
	}

	let { envId, devcontainers, personas, onCreated, onCancel }: Props = $props();

	let name = $state('');
	let description = $state('');
	let steps = $state<StepDraft[]>([makeStep(1)]);
	let creating = $state(false);
	let savingTemplate = $state(false);

	let nextStepId = 1;

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
			max_retries: 0
		};
	}

	function addStep() {
		const maxPos = steps.reduce((m, s) => Math.max(m, s.position), 0);
		steps = [...steps, makeStep(maxPos + 1)];
	}

	function addParallelStep() {
		if (steps.length === 0) { addStep(); return; }
		const lastPos = steps[steps.length - 1].position;
		steps = [...steps, makeStep(lastPos)];
	}

	function removeStep(id: string) {
		steps = steps.filter(s => s.id !== id);
	}

	function moveUp(idx: number) {
		if (idx <= 0) return;
		const arr = [...steps];
		[arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
		steps = arr;
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
					steps: steps.map(s => ({
						position: s.position,
						type: s.type,
						label: s.label || `Step ${s.position}`,
						devcontainer_id: s.devcontainer_id || undefined,
						persona_id: s.persona_id || undefined,
						prompt_template: s.prompt_template || undefined,
						gate_instructions: s.gate_instructions || undefined,
						max_retries: s.max_retries
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
	</div>

	<div class="steps-section">
		<div class="steps-header">
			<span class="steps-title">Steps</span>
			<div class="steps-actions">
				<button class="btn btn-sm btn-secondary" onclick={addParallelStep} title="Add a step that runs in parallel with the last step">+ Parallel</button>
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
								</select>
								<input class="label-input" bind:value={step.label} placeholder="Step label" />
								<button class="remove-btn" onclick={() => removeStep(step.id)} title="Remove step">
									<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
								</button>
							</div>

							{#if step.type === 'agent'}
								<div class="step-fields">
									<div class="form-group">
										<label>Agent</label>
										<select class="form-select" bind:value={step.devcontainer_id} onchange={(e) => {
											const dc = devcontainers.find(d => d.id === (e.target as HTMLSelectElement).value);
											if (dc?.persona_id) step.persona_id = dc.persona_id;
										}}>
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
									<div class="form-group form-inline">
										<label>Max retries</label>
										<input type="number" class="form-input retries-input" bind:value={step.max_retries} min="0" max="5" />
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
			<div class="empty-steps">Add steps to define the pipeline workflow.</div>
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

	.builder-footer {
		display: flex; align-items: center; justify-content: space-between;
		padding-top: 12px; border-top: 1px solid var(--border);
	}
	.footer-right { display: flex; gap: 8px; }
</style>
