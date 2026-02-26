<script lang="ts">
	import type { PipelineStepWithContext } from '$lib/types/pipeline';
	import { addToast } from '$lib/stores/toast.svelte';

	interface Props {
		pipelineId: string;
		step: PipelineStepWithContext;
		allSteps: PipelineStepWithContext[];
		onDecision: () => void;
	}

	let { pipelineId, step, allSteps, onDecision }: Props = $props();

	let feedback = $state('');
	let reviseToStepId = $state('');
	let processing = $state(false);
	let showRevise = $state(false);

	// Previous completed steps for context display
	const prevSteps = $derived(
		allSteps.filter(s => s.position < step.position && s.status === 'completed' && s.result_summary)
	);

	// Steps that can be targeted for revision (completed agent steps before this gate)
	const revisableSteps = $derived(
		allSteps.filter(s => s.position < step.position && s.type === 'agent' && s.status === 'completed')
	);

	async function submitDecision(action: 'approve' | 'reject' | 'revise') {
		processing = true;
		try {
			const body: Record<string, unknown> = { action };
			if (feedback.trim()) body.feedback = feedback.trim();
			if (action === 'revise' && reviseToStepId) body.revise_to_step_id = reviseToStepId;

			const res = await fetch(`/api/pipelines/${pipelineId}/steps/${step.id}/gate`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});

			if (res.ok) {
				addToast(`Gate ${action}d`, 'success');
				onDecision();
			} else {
				const err = await res.json().catch(() => ({}));
				addToast(err.message ?? `Failed to ${action}`, 'error');
			}
		} catch {
			addToast('Network error', 'error');
		} finally {
			processing = false;
		}
	}
</script>

<div class="gate-review">
	{#if step.gate_instructions}
		<div class="gate-instructions">
			<span class="gate-label">Review Instructions</span>
			<p>{step.gate_instructions}</p>
		</div>
	{/if}

	<!-- Show previous step results for context -->
	{#if prevSteps.length > 0}
		<div class="prev-results">
			<span class="gate-label">Previous Step Results</span>
			{#each prevSteps as ps (ps.id)}
				<div class="prev-result">
					<span class="prev-label">{ps.persona_avatar ?? ''} {ps.label}</span>
					<pre class="prev-summary">{ps.result_summary}</pre>
				</div>
			{/each}
		</div>
	{/if}

	<div class="gate-form">
		<textarea
			class="form-input feedback-input"
			placeholder="Feedback (optional for approve, recommended for reject/revise)"
			bind:value={feedback}
			rows="2"
		></textarea>

		<div class="gate-actions">
			<button class="btn btn-sm gate-approve" disabled={processing} onclick={() => submitDecision('approve')}>
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
				Approve
			</button>
			<button class="btn btn-sm gate-reject" disabled={processing} onclick={() => submitDecision('reject')}>
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
				Reject
			</button>
			<button class="btn btn-sm gate-revise" disabled={processing} onclick={() => showRevise = !showRevise}>
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>
				Send Back
			</button>
		</div>

		{#if showRevise}
			<div class="revise-options">
				<div class="form-group">
					<label>Send back to step:</label>
					<select class="form-select" bind:value={reviseToStepId}>
						<option value="">Most recent agent step</option>
						{#each revisableSteps as rs (rs.id)}
							<option value={rs.id}>Step {rs.position}: {rs.label} ({rs.persona_name ?? 'agent'})</option>
						{/each}
					</select>
				</div>
				<button class="btn btn-sm gate-revise" disabled={processing || !feedback.trim()} onclick={() => submitDecision('revise')}>
					Confirm Send Back
				</button>
			</div>
		{/if}
	</div>
</div>

<style>
	.gate-review {
		padding: 14px; border-top: 1px solid var(--border);
		background: rgba(245,158,11,0.03);
	}

	.gate-instructions {
		margin-bottom: 12px;
	}
	.gate-instructions p {
		font-size: 0.8125rem; color: var(--text-primary); margin: 4px 0 0;
	}
	.gate-label {
		font-size: 0.6875rem; font-weight: 600; color: var(--text-secondary);
		text-transform: uppercase; letter-spacing: 0.04em;
	}

	.prev-results { margin-bottom: 12px; display: flex; flex-direction: column; gap: 8px; }
	.prev-result { display: flex; flex-direction: column; gap: 2px; }
	.prev-label { font-size: 0.75rem; font-weight: 500; color: var(--text-secondary); }
	.prev-summary {
		font-size: 0.75rem; font-family: 'SF Mono', monospace;
		background: var(--bg-secondary); padding: 6px 10px; border-radius: var(--radius-sm);
		white-space: pre-wrap; word-break: break-word; max-height: 400px; overflow-y: auto;
		margin: 0;
	}

	.gate-form { display: flex; flex-direction: column; gap: 10px; }
	.feedback-input { resize: vertical; min-height: 48px; font-size: 0.8125rem; }

	.gate-actions { display: flex; gap: 8px; }
	.gate-approve { background: rgba(34,197,94,0.1); color: #22c55e; border: 1px solid rgba(34,197,94,0.3); }
	.gate-approve:hover { background: rgba(34,197,94,0.2); }
	.gate-reject { background: rgba(239,68,68,0.1); color: #ef4444; border: 1px solid rgba(239,68,68,0.3); }
	.gate-reject:hover { background: rgba(239,68,68,0.2); }
	.gate-revise { background: rgba(245,158,11,0.1); color: #f59e0b; border: 1px solid rgba(245,158,11,0.3); }
	.gate-revise:hover { background: rgba(245,158,11,0.2); }

	.gate-actions .btn { display: flex; align-items: center; gap: 4px; }

	.revise-options {
		display: flex; flex-direction: column; gap: 10px;
		padding: 10px 12px; background: var(--bg-secondary); border: 1px solid var(--border);
		border-radius: var(--radius-sm);
	}
	.revise-options .form-group { display: flex; flex-direction: column; gap: 4px; }
	.revise-options label { font-size: 0.75rem; color: var(--text-secondary); }
</style>
