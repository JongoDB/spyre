<script lang="ts">
	import { addToast } from '$lib/stores/toast.svelte';

	interface AskUserReq {
		id: string;
		question: string;
		options?: string[] | null;
	}

	let { request, orchestratorId, onClose }: {
		request: AskUserReq;
		orchestratorId: string;
		onClose: () => void;
	} = $props();

	let response = $state('');
	let submitting = $state(false);
	let selectedOption = $state<string | null>(null);

	let parsedOptions = $derived.by(() => {
		if (!request.options) return null;
		if (Array.isArray(request.options)) return request.options;
		try {
			return JSON.parse(request.options as unknown as string) as string[];
		} catch {
			return null;
		}
	});

	async function submit() {
		const answer = selectedOption ?? response.trim();
		if (!answer) return;

		submitting = true;
		try {
			const res = await fetch(`/api/orchestrator/${orchestratorId}/ask-user`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					request_id: request.id,
					response: answer,
				}),
			});

			if (!res.ok) {
				const data = await res.json().catch(() => ({ message: 'Failed to submit' }));
				addToast(data.message ?? 'Failed to submit answer', 'error');
				return;
			}

			addToast('Answer submitted', 'success');
			onClose();
		} catch (err) {
			addToast('Failed to submit answer', 'error');
		} finally {
			submitting = false;
		}
	}
</script>

<div class="dialog-overlay" onclick={onClose} role="presentation">
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div class="dialog" onclick={(e) => e.stopPropagation()} role="dialog">
		<div class="dialog-header">
			<h3>Agent Question</h3>
			<button class="close-btn" onclick={onClose}>&times;</button>
		</div>

		<div class="dialog-body">
			<p class="question">{request.question}</p>

			{#if parsedOptions && parsedOptions.length > 0}
				<div class="options">
					{#each parsedOptions as opt}
						<label class="option-label">
							<input
								type="radio"
								name="ask-user-option"
								value={opt}
								bind:group={selectedOption}
							/>
							<span>{opt}</span>
						</label>
					{/each}
				</div>
			{/if}

			<div class="free-text">
				<textarea
					bind:value={response}
					placeholder={parsedOptions ? 'Or type a custom response...' : 'Type your response...'}
					rows="3"
					onfocus={() => { selectedOption = null; }}
				></textarea>
			</div>
		</div>

		<div class="dialog-footer">
			<button class="btn btn-secondary" onclick={onClose}>Cancel</button>
			<button
				class="btn btn-primary"
				onclick={submit}
				disabled={submitting || (!selectedOption && !response.trim())}
			>
				{submitting ? 'Submitting...' : 'Submit'}
			</button>
		</div>
	</div>
</div>

<style>
	.dialog-overlay {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.6);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 1000;
	}

	.dialog {
		background: var(--bg-secondary, #1e1e2e);
		border: 1px solid var(--border-color, #333);
		border-radius: 12px;
		min-width: 400px;
		max-width: 560px;
		width: 90vw;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
	}

	.dialog-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.75rem 1rem;
		border-bottom: 1px solid var(--border-color, #333);
	}

	.dialog-header h3 {
		margin: 0;
		font-size: 0.9rem;
		color: var(--text-primary, #e4e4e7);
	}

	.close-btn {
		all: unset;
		cursor: pointer;
		font-size: 1.25rem;
		color: var(--text-secondary, #a1a1aa);
		padding: 0.25rem;
	}

	.close-btn:hover {
		color: var(--text-primary, #e4e4e7);
	}

	.dialog-body {
		padding: 1rem;
	}

	.question {
		margin: 0 0 0.75rem;
		font-size: 0.9rem;
		color: var(--text-primary, #e4e4e7);
		line-height: 1.5;
	}

	.options {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		margin-bottom: 0.75rem;
	}

	.option-label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.625rem;
		border-radius: 6px;
		background: var(--bg-tertiary, #27272a);
		cursor: pointer;
		font-size: 0.85rem;
		color: var(--text-primary, #e4e4e7);
		transition: background 0.15s;
	}

	.option-label:hover {
		background: var(--bg-hover, #3f3f46);
	}

	.free-text textarea {
		width: 100%;
		background: var(--bg-tertiary, #27272a);
		border: 1px solid var(--border-color, #333);
		border-radius: 6px;
		padding: 0.5rem;
		color: var(--text-primary, #e4e4e7);
		font-family: inherit;
		font-size: 0.85rem;
		resize: vertical;
	}

	.free-text textarea:focus {
		outline: none;
		border-color: var(--accent, #6d5dfc);
	}

	.dialog-footer {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
		padding: 0.75rem 1rem;
		border-top: 1px solid var(--border-color, #333);
	}

	.btn {
		all: unset;
		cursor: pointer;
		padding: 0.375rem 0.875rem;
		border-radius: 6px;
		font-size: 0.8rem;
		font-weight: 500;
	}

	.btn-secondary {
		color: var(--text-secondary, #a1a1aa);
		background: var(--bg-tertiary, #27272a);
	}

	.btn-secondary:hover {
		background: var(--bg-hover, #3f3f46);
	}

	.btn-primary {
		color: white;
		background: var(--accent, #6d5dfc);
	}

	.btn-primary:hover:not(:disabled) {
		filter: brightness(1.1);
	}

	.btn-primary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
