<script lang="ts">
	import type { Pipeline } from '$lib/types/pipeline';
	import type { PipelineTemplate } from '$lib/types/pipeline';
	import { addToast } from '$lib/stores/toast.svelte';

	interface PipelineListItem extends Pipeline {
		step_count: number;
		completed_count: number;
	}

	interface Props {
		envId: string;
		pipelines: PipelineListItem[];
		onSelect: (pipelineId: string) => void;
		onCreateNew: () => void;
		onRefresh: () => void;
	}

	let { envId, pipelines, onSelect, onCreateNew, onRefresh }: Props = $props();

	let templates = $state<PipelineTemplate[]>([]);
	let showTemplates = $state(false);

	async function loadTemplates() {
		try {
			const res = await fetch('/api/pipeline-templates');
			if (res.ok) templates = await res.json();
		} catch { /* ignore */ }
		showTemplates = true;
	}

	async function createFromTemplate(templateId: string) {
		try {
			const res = await fetch(`/api/pipeline-templates/${templateId}`);
			if (!res.ok) { addToast('Failed to load template', 'error'); return; }
			const tmpl = await res.json();

			const pipelineRes = await fetch('/api/pipelines', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					env_id: envId,
					name: `${tmpl.name} — ${new Date().toLocaleDateString()}`,
					description: tmpl.description,
					template_id: templateId,
					steps: tmpl.steps.map((s: Record<string, unknown>) => ({
						position: s.position,
						type: s.type,
						label: s.label,
						devcontainer_id: s.devcontainer_id,
						persona_id: s.persona_id,
						prompt_template: s.prompt_template,
						gate_instructions: s.gate_instructions,
						max_retries: s.max_retries
					}))
				})
			});

			if (pipelineRes.ok) {
				const pipeline = await pipelineRes.json();
				addToast('Pipeline created from template', 'success');
				showTemplates = false;
				onRefresh();
				onSelect(pipeline.id);
			} else {
				const body = await pipelineRes.json().catch(() => ({}));
				addToast(body.message ?? 'Failed to create pipeline', 'error');
			}
		} catch {
			addToast('Network error', 'error');
		}
	}

	function statusColor(status: string): string {
		switch (status) {
			case 'running': return 'var(--accent)';
			case 'completed': return 'var(--success)';
			case 'failed': return 'var(--error)';
			case 'paused': return 'var(--warning)';
			case 'cancelled': return 'var(--text-secondary)';
			default: return 'var(--text-secondary)';
		}
	}

	function formatDate(d: string): string {
		return new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
	}
</script>

<div class="pipeline-list">
	<div class="list-header">
		<h3>Pipelines</h3>
		<div class="list-actions">
			<button class="btn btn-sm btn-secondary" onclick={loadTemplates}>From Template</button>
			<button class="btn btn-sm btn-primary" onclick={onCreateNew}>New Pipeline</button>
		</div>
	</div>

	{#if showTemplates}
		<div class="templates-panel">
			<div class="templates-header">
				<span class="templates-title">Templates</span>
				<button class="btn btn-sm btn-secondary" onclick={() => showTemplates = false}>Close</button>
			</div>
			{#if templates.length === 0}
				<p class="empty-text">No templates saved yet.</p>
			{:else}
				{#each templates as t (t.id)}
					<button class="template-item" onclick={() => createFromTemplate(t.id)}>
						<span class="template-name">{t.name}</span>
						{#if t.description}<span class="template-desc">{t.description}</span>{/if}
					</button>
				{/each}
			{/if}
		</div>
	{/if}

	{#if pipelines.length === 0}
		<div class="empty-state">
			<p>No pipelines yet. Create one to orchestrate multi-agent workflows.</p>
		</div>
	{:else}
		<div class="pipeline-table">
			{#each pipelines as p (p.id)}
				<button class="pipeline-row" onclick={() => onSelect(p.id)}>
					<div class="pipeline-info">
						<span class="pipeline-name">{p.name}</span>
						{#if p.description}
							<span class="pipeline-desc">{p.description}</span>
						{/if}
					</div>
					<div class="pipeline-meta">
						{#if p.step_count > 0}
							<span class="step-progress">{p.completed_count}/{p.step_count}</span>
						{/if}
						<span class="status-badge" style="color: {statusColor(p.status)}">
							{#if p.status === 'running'}<span class="running-dot"></span>{/if}
							{p.status}
						</span>
						{#if p.total_cost_usd > 0}
							<span class="cost">${p.total_cost_usd.toFixed(4)}</span>
						{/if}
						<span class="date">{formatDate(p.created_at)}</span>
					</div>
				</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.pipeline-list { display: flex; flex-direction: column; gap: 12px; }
	.list-header { display: flex; align-items: center; justify-content: space-between; }
	.list-header h3 { font-size: 0.9375rem; font-weight: 600; margin: 0; }
	.list-actions { display: flex; gap: 8px; }

	.templates-panel {
		background: var(--bg-secondary);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 12px 16px;
	}
	.templates-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
	.templates-title { font-size: 0.8125rem; font-weight: 600; }
	.template-item {
		display: flex; flex-direction: column; gap: 2px;
		width: 100%; text-align: left; padding: 8px 12px;
		background: none; border: 1px solid var(--border); border-radius: var(--radius-sm);
		cursor: pointer; transition: background-color var(--transition); margin-top: 6px;
		color: var(--text-primary);
	}
	.template-item:hover { background-color: rgba(255,255,255,0.04); }
	.template-name { font-size: 0.8125rem; font-weight: 500; }
	.template-desc { font-size: 0.75rem; color: var(--text-secondary); }

	.empty-state {
		text-align: center; padding: 32px; color: var(--text-secondary); font-size: 0.875rem;
	}
	.empty-text { color: var(--text-secondary); font-size: 0.8125rem; padding: 8px 0; }

	.pipeline-table { display: flex; flex-direction: column; gap: 4px; }
	.pipeline-row {
		display: flex; align-items: center; justify-content: space-between;
		padding: 12px 16px; background: var(--bg-secondary); border: 1px solid var(--border);
		border-radius: var(--radius-sm); cursor: pointer; transition: background-color var(--transition);
		text-align: left; width: 100%; color: var(--text-primary);
	}
	.pipeline-row:hover { background-color: rgba(255,255,255,0.04); }
	.pipeline-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
	.pipeline-name { font-size: 0.875rem; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.pipeline-desc { font-size: 0.75rem; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.pipeline-meta { display: flex; align-items: center; gap: 12px; flex-shrink: 0; }
	.step-progress {
		font-size: 0.6875rem; font-family: 'SF Mono', monospace;
		color: var(--text-secondary); padding: 1px 6px;
		background: var(--bg-tertiary); border-radius: 8px;
	}
	.status-badge { font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; display: flex; align-items: center; gap: 4px; }
	.running-dot {
		width: 6px; height: 6px; border-radius: 50%; background: var(--accent);
		animation: dot-pulse 1.5s ease-in-out infinite;
	}
	@keyframes dot-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
	.cost { font-size: 0.75rem; color: var(--text-secondary); font-family: 'SF Mono', monospace; }
	.date { font-size: 0.6875rem; color: var(--text-secondary); white-space: nowrap; }
</style>
