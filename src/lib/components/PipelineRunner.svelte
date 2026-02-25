<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import type { PipelineWithSteps, PipelineStepWithContext } from '$lib/types/pipeline';
	import PipelineGateReview from './PipelineGateReview.svelte';
	import { addToast } from '$lib/stores/toast.svelte';

	interface Props {
		pipelineId: string;
		onBack: () => void;
		onRefresh: () => void;
	}

	let { pipelineId, onBack, onRefresh }: Props = $props();

	let pipeline = $state<PipelineWithSteps | null>(null);
	let loading = $state(true);
	let cancelling = $state(false);
	let expandedStep = $state<string | null>(null);
	let savingTemplate = $state(false);
	let templateName = $state('');
	let showSaveTemplate = $state(false);

	let eventSource: EventSource | null = null;

	const groupedSteps = $derived(() => {
		if (!pipeline?.steps) return [];
		const groups: Array<{ position: number; steps: PipelineStepWithContext[] }> = [];
		for (const s of pipeline.steps) {
			const existing = groups.find(g => g.position === s.position);
			if (existing) { existing.steps.push(s); }
			else { groups.push({ position: s.position, steps: [s] }); }
		}
		groups.sort((a, b) => a.position - b.position);
		return groups;
	});

	async function loadPipeline() {
		try {
			const res = await fetch(`/api/pipelines/${pipelineId}`);
			if (res.ok) pipeline = await res.json();
		} catch { /* ignore */ }
		loading = false;
	}

	function connectSSE() {
		eventSource = new EventSource(`/api/pipelines/${pipelineId}/stream`);
		eventSource.onmessage = () => {
			// Reload pipeline data on any event
			loadPipeline();
		};
		eventSource.onerror = () => {
			// Will auto-reconnect
		};
	}

	onMount(() => {
		loadPipeline();
		connectSSE();
	});

	onDestroy(() => {
		eventSource?.close();
		eventSource = null;
	});

	async function startPipeline() {
		try {
			const res = await fetch(`/api/pipelines/${pipelineId}/start`, { method: 'POST' });
			if (res.ok) {
				addToast('Pipeline started', 'success');
				await loadPipeline();
			} else {
				const body = await res.json().catch(() => ({}));
				addToast(body.message ?? 'Failed to start', 'error');
			}
		} catch { addToast('Network error', 'error'); }
	}

	async function cancelPipeline() {
		cancelling = true;
		try {
			const res = await fetch(`/api/pipelines/${pipelineId}/cancel`, { method: 'POST' });
			if (res.ok) {
				addToast('Pipeline cancelled', 'success');
				await loadPipeline();
				onRefresh();
			} else {
				const body = await res.json().catch(() => ({}));
				addToast(body.message ?? 'Failed to cancel', 'error');
			}
		} catch { addToast('Network error', 'error'); }
		finally { cancelling = false; }
	}

	async function deletePipeline() {
		try {
			const res = await fetch(`/api/pipelines/${pipelineId}`, { method: 'DELETE' });
			if (res.ok) {
				addToast('Pipeline deleted', 'success');
				onRefresh();
				onBack();
			} else {
				const body = await res.json().catch(() => ({}));
				addToast(body.message ?? 'Failed to delete', 'error');
			}
		} catch { addToast('Network error', 'error'); }
	}

	async function skipStep(stepId: string) {
		try {
			const res = await fetch(`/api/pipelines/${pipelineId}/steps/${stepId}/skip`, { method: 'POST' });
			if (res.ok) { addToast('Step skipped', 'success'); await loadPipeline(); }
			else { const body = await res.json().catch(() => ({})); addToast(body.message ?? 'Failed to skip', 'error'); }
		} catch { addToast('Network error', 'error'); }
	}

	async function retryStep(stepId: string) {
		try {
			const res = await fetch(`/api/pipelines/${pipelineId}/steps/${stepId}/retry`, { method: 'POST' });
			if (res.ok) { addToast('Step retrying', 'success'); await loadPipeline(); }
			else { const body = await res.json().catch(() => ({})); addToast(body.message ?? 'Failed to retry', 'error'); }
		} catch { addToast('Network error', 'error'); }
	}

	async function saveAsTemplate() {
		if (!templateName.trim()) return;
		savingTemplate = true;
		try {
			const res = await fetch('/api/pipeline-templates', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: templateName.trim(),
					description: pipeline?.description ?? null,
					env_id: pipeline?.env_id ?? null,
					steps: (pipeline?.steps ?? []).map(s => ({
						position: s.position, type: s.type, label: s.label,
						devcontainer_id: s.devcontainer_id, persona_id: s.persona_id,
						prompt_template: s.prompt_template, gate_instructions: s.gate_instructions,
						max_retries: s.max_retries
					}))
				})
			});
			if (res.ok) { addToast('Template saved', 'success'); showSaveTemplate = false; }
			else { const body = await res.json().catch(() => ({})); addToast(body.message ?? 'Failed to save', 'error'); }
		} catch { addToast('Network error', 'error'); }
		finally { savingTemplate = false; }
	}

	function statusIcon(status: string): string {
		switch (status) {
			case 'completed': return 'check';
			case 'running': return 'spinner';
			case 'error': return 'x';
			case 'waiting': return 'pause';
			case 'skipped': return 'skip';
			case 'cancelled': return 'slash';
			default: return 'circle';
		}
	}

	function statusColor(status: string): string {
		switch (status) {
			case 'completed': return 'var(--success)';
			case 'running': return 'var(--accent)';
			case 'error': return 'var(--error)';
			case 'waiting': return 'var(--warning)';
			case 'skipped': case 'cancelled': return 'var(--text-secondary)';
			default: return 'var(--border)';
		}
	}

	function formatDuration(start: string | null, end: string | null): string {
		if (!start) return '';
		const s = new Date(start);
		const e = end ? new Date(end) : new Date();
		const ms = e.getTime() - s.getTime();
		const sec = Math.floor(ms / 1000);
		if (sec < 60) return `${sec}s`;
		const min = Math.floor(sec / 60);
		return `${min}m ${sec % 60}s`;
	}
</script>

{#if loading}
	<div class="loading">Loading pipeline...</div>
{:else if !pipeline}
	<div class="loading">Pipeline not found.</div>
{:else}
	<div class="runner">
		<!-- Header -->
		<div class="runner-header">
			<div class="header-left">
				<button class="back-btn" onclick={onBack}>
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>
				</button>
				<div class="header-info">
					<h3>{pipeline.name}</h3>
					{#if pipeline.description}
						<span class="header-desc">{pipeline.description}</span>
					{/if}
				</div>
				<span class="pipeline-status" style="color: {statusColor(pipeline.status)}">{pipeline.status}</span>
			</div>
			<div class="header-actions">
				{#if pipeline.total_cost_usd > 0}
					<span class="cost-badge">${pipeline.total_cost_usd.toFixed(4)}</span>
				{/if}
				{#if pipeline.status === 'draft' || pipeline.status === 'failed'}
					<button class="btn btn-sm btn-primary" onclick={startPipeline}>
						{pipeline.status === 'failed' ? 'Restart' : 'Start'}
					</button>
				{/if}
				{#if pipeline.status === 'running' || pipeline.status === 'paused'}
					<button class="btn btn-sm btn-danger" disabled={cancelling} onclick={cancelPipeline}>
						{cancelling ? 'Cancelling...' : 'Cancel'}
					</button>
				{/if}
				{#if pipeline.status === 'draft' || pipeline.status === 'completed' || pipeline.status === 'failed' || pipeline.status === 'cancelled'}
					<button class="btn btn-sm btn-secondary" onclick={deletePipeline}>Delete</button>
				{/if}
				<button class="btn btn-sm btn-secondary" onclick={() => { templateName = pipeline?.name ?? ''; showSaveTemplate = !showSaveTemplate; }}>
					Save Template
				</button>
			</div>
		</div>

		{#if pipeline.error_message}
			<div class="error-bar">{pipeline.error_message}</div>
		{/if}

		{#if showSaveTemplate}
			<div class="save-template-bar">
				<input class="form-input" bind:value={templateName} placeholder="Template name" />
				<button class="btn btn-sm btn-primary" onclick={saveAsTemplate} disabled={savingTemplate || !templateName.trim()}>
					{savingTemplate ? 'Saving...' : 'Save'}
				</button>
				<button class="btn btn-sm btn-secondary" onclick={() => showSaveTemplate = false}>Cancel</button>
			</div>
		{/if}

		<!-- Timeline -->
		<div class="timeline">
			{#each groupedSteps() as group (group.position)}
				<div class="timeline-group" class:parallel={group.steps.length > 1}>
					<div class="timeline-position">
						<div class="position-line"></div>
						<div class="position-dot" style="border-color: {statusColor(group.steps[0].status)}"></div>
						<span class="position-num">{group.position}</span>
					</div>
					<div class="timeline-steps">
						{#each group.steps as step (step.id)}
							<div class="step-card" class:expanded={expandedStep === step.id}>
								<button class="step-header" onclick={() => expandedStep = expandedStep === step.id ? null : step.id}>
									<div class="step-status-indicator" style="background: {statusColor(step.status)}">
										{#if step.status === 'running'}
											<div class="pulse"></div>
										{/if}
									</div>
									<div class="step-info">
										<div class="step-top">
											<span class="step-type-badge" class:gate={step.type === 'gate'}>{step.type}</span>
											<span class="step-label">{step.label}</span>
										</div>
										<div class="step-meta">
											{#if step.persona_name}
												<span class="step-persona">{step.persona_avatar ?? ''} {step.persona_name}</span>
											{/if}
											{#if step.devcontainer_service}
												<span class="step-dc">{step.devcontainer_service}</span>
											{/if}
											<span class="step-status-text" style="color: {statusColor(step.status)}">{step.status}</span>
											{#if step.cost_usd}
												<span class="step-cost">${step.cost_usd.toFixed(4)}</span>
											{/if}
											{#if step.started_at}
												<span class="step-duration">{formatDuration(step.started_at, step.completed_at)}</span>
											{/if}
											{#if step.iteration > 0}
												<span class="step-iteration">rev #{step.iteration}</span>
											{/if}
										</div>
									</div>
									<svg class="expand-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
								</button>

								{#if expandedStep === step.id}
									<div class="step-detail">
										{#if step.prompt_template}
											<div class="detail-section">
												<span class="detail-label">Prompt</span>
												<pre class="detail-content">{step.prompt_template}</pre>
											</div>
										{/if}
										{#if step.result_summary}
											<div class="detail-section">
												<span class="detail-label">Result</span>
												<pre class="detail-content">{step.result_summary}</pre>
											</div>
										{/if}
										{#if step.gate_instructions}
											<div class="detail-section">
												<span class="detail-label">Gate Instructions</span>
												<pre class="detail-content">{step.gate_instructions}</pre>
											</div>
										{/if}
										{#if step.gate_feedback}
											<div class="detail-section">
												<span class="detail-label">Reviewer Feedback</span>
												<pre class="detail-content">{step.gate_feedback}</pre>
											</div>
										{/if}

										<!-- Step actions -->
										<div class="step-actions">
											{#if step.status === 'error' && pipeline.status === 'failed'}
												<button class="btn btn-sm btn-primary" onclick={() => retryStep(step.id)}>Retry Step</button>
											{/if}
											{#if step.status === 'pending' || step.status === 'waiting' || step.status === 'error'}
												<button class="btn btn-sm btn-secondary" onclick={() => skipStep(step.id)}>Skip</button>
											{/if}
										</div>
									</div>
								{/if}

								<!-- Gate review (inline) -->
								{#if step.type === 'gate' && step.status === 'waiting'}
									<PipelineGateReview
										{pipelineId}
										step={step}
										allSteps={pipeline.steps}
										onDecision={() => loadPipeline()}
									/>
								{/if}
							</div>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	</div>
{/if}

<style>
	.loading { text-align: center; padding: 32px; color: var(--text-secondary); }

	.runner { display: flex; flex-direction: column; gap: 12px; }
	.runner-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
	.header-left { display: flex; align-items: center; gap: 10px; }
	.back-btn {
		background: none; border: none; color: var(--text-secondary); cursor: pointer;
		padding: 4px; border-radius: var(--radius-sm); transition: color var(--transition);
	}
	.back-btn:hover { color: var(--text-primary); }
	.header-info { display: flex; flex-direction: column; gap: 2px; }
	.header-info h3 { font-size: 0.9375rem; font-weight: 600; margin: 0; }
	.header-desc { font-size: 0.75rem; color: var(--text-secondary); }
	.pipeline-status { font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; }
	.header-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
	.cost-badge { font-size: 0.75rem; color: var(--text-secondary); font-family: 'SF Mono', monospace; padding: 2px 8px; background: var(--bg-tertiary); border-radius: var(--radius-sm); }

	.error-bar {
		padding: 10px 16px; background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.2);
		border-radius: var(--radius-sm); color: var(--error); font-size: 0.8125rem;
	}

	.save-template-bar {
		display: flex; gap: 8px; align-items: center;
		padding: 10px 16px; background: var(--bg-secondary); border: 1px solid var(--border);
		border-radius: var(--radius-sm);
	}
	.save-template-bar .form-input { flex: 1; }

	/* Timeline */
	.timeline { display: flex; flex-direction: column; gap: 0; }
	.timeline-group { display: flex; gap: 16px; padding: 8px 0; }
	.timeline-group.parallel { }
	.timeline-position { display: flex; flex-direction: column; align-items: center; width: 32px; flex-shrink: 0; position: relative; }
	.position-line { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--border); z-index: 0; }
	.position-dot { width: 12px; height: 12px; border-radius: 50%; border: 2px solid var(--border); background: var(--bg-primary); z-index: 1; margin-top: 14px; }
	.position-num { font-size: 0.625rem; color: var(--text-secondary); font-weight: 700; margin-top: 4px; z-index: 1; }
	.timeline-steps { flex: 1; display: flex; flex-direction: column; gap: 6px; }

	.step-card {
		background: var(--bg-secondary); border: 1px solid var(--border);
		border-radius: var(--radius-sm); overflow: hidden;
	}
	.step-header {
		display: flex; align-items: center; gap: 10px; padding: 10px 14px;
		width: 100%; text-align: left; background: none; border: none;
		cursor: pointer; color: var(--text-primary); transition: background-color var(--transition);
	}
	.step-header:hover { background: rgba(255,255,255,0.02); }

	.step-status-indicator {
		width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; position: relative;
	}
	.pulse {
		position: absolute; inset: -3px; border-radius: 50%;
		border: 2px solid var(--accent); opacity: 0.5;
		animation: pulse-anim 1.5s ease-in-out infinite;
	}
	@keyframes pulse-anim { 0%, 100% { transform: scale(1); opacity: 0.5; } 50% { transform: scale(1.5); opacity: 0; } }

	.step-info { flex: 1; min-width: 0; }
	.step-top { display: flex; align-items: center; gap: 8px; }
	.step-type-badge {
		font-size: 0.625rem; font-weight: 700; text-transform: uppercase;
		padding: 1px 6px; border-radius: 3px; letter-spacing: 0.04em;
		background: rgba(99,102,241,0.1); color: var(--accent);
	}
	.step-type-badge.gate { background: rgba(245,158,11,0.1); color: var(--warning); }
	.step-label { font-size: 0.8125rem; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.step-meta { display: flex; flex-wrap: wrap; gap: 6px 12px; margin-top: 4px; }
	.step-meta > * { font-size: 0.6875rem; color: var(--text-secondary); }
	.step-persona { font-weight: 500; }
	.step-dc { font-family: 'SF Mono', monospace; font-size: 0.625rem; }
	.step-cost { font-family: 'SF Mono', monospace; }
	.step-iteration { font-weight: 600; color: var(--warning); }

	.expand-icon { flex-shrink: 0; color: var(--text-secondary); transition: transform var(--transition); }
	.step-card.expanded .expand-icon { transform: rotate(180deg); }

	.step-detail { padding: 0 14px 14px; display: flex; flex-direction: column; gap: 10px; }
	.detail-section { display: flex; flex-direction: column; gap: 4px; }
	.detail-label { font-size: 0.6875rem; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.04em; }
	.detail-content {
		font-size: 0.75rem; font-family: 'SF Mono', monospace;
		background: var(--bg-primary); padding: 8px 12px; border-radius: var(--radius-sm);
		white-space: pre-wrap; word-break: break-word; max-height: 200px; overflow-y: auto;
		margin: 0;
	}
	.step-actions { display: flex; gap: 8px; }
</style>
