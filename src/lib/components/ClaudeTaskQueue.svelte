<script lang="ts">
	import type { ClaudeTaskQueueItem } from '$lib/types/claude';
	import { addToast } from '$lib/stores/toast.svelte';

	interface Props {
		envId: string;
		items: ClaudeTaskQueueItem[];
		onQueueChanged?: () => void;
	}

	let { envId, items, onQueueChanged }: Props = $props();

	let newPrompt = $state('');
	let adding = $state(false);

	async function addToQueue() {
		if (!newPrompt.trim()) return;
		adding = true;
		try {
			const res = await fetch(`/api/claude/queue/${envId}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ prompt: newPrompt.trim() })
			});
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				addToast(body.message ?? 'Failed to add to queue', 'error');
			} else {
				newPrompt = '';
				onQueueChanged?.();
			}
		} catch {
			addToast('Network error adding to queue', 'error');
		} finally {
			adding = false;
		}
	}

	async function cancelItem(itemId: string) {
		try {
			const res = await fetch(`/api/claude/queue/${envId}/${itemId}`, { method: 'DELETE' });
			if (res.ok) {
				onQueueChanged?.();
			}
		} catch {
			addToast('Failed to cancel queue item', 'error');
		}
	}
</script>

<div class="queue-panel">
	<div class="queue-add">
		<input
			type="text"
			class="queue-input"
			placeholder="Add task to queue..."
			bind:value={newPrompt}
			onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addToQueue(); } }}
		/>
		<button class="btn btn-secondary btn-sm" onclick={addToQueue} disabled={adding || !newPrompt.trim()}>
			{adding ? 'Adding...' : 'Add'}
		</button>
	</div>

	{#if items.length === 0}
		<p class="queue-empty">Queue is empty.</p>
	{:else}
		<div class="queue-list">
			{#each items as item, idx (item.id)}
				<div class="queue-item" class:dispatched={item.status === 'dispatched'} class:cancelled={item.status === 'cancelled'}>
					<span class="queue-position">{idx + 1}</span>
					<span class="queue-prompt">{item.prompt.slice(0, 80)}{item.prompt.length > 80 ? '...' : ''}</span>
					<span class="badge badge-{item.status}">{item.status}</span>
					{#if item.status === 'queued'}
						<button class="cancel-btn" onclick={() => cancelItem(item.id)} title="Cancel">
							<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
								<line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
							</svg>
						</button>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.queue-panel {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.queue-add {
		display: flex;
		gap: 8px;
	}

	.queue-input {
		flex: 1;
		padding: 6px 12px;
		background-color: var(--bg-secondary);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		color: var(--text-primary);
		font-size: 0.8125rem;
	}

	.queue-input:focus {
		outline: none;
		border-color: var(--accent);
	}

	.queue-empty {
		text-align: center;
		color: var(--text-secondary);
		font-size: 0.8125rem;
		padding: 12px;
		margin: 0;
	}

	.queue-list {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.queue-item {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 12px;
		background-color: var(--bg-secondary);
		border-radius: var(--radius-sm);
		font-size: 0.8125rem;
	}

	.queue-item.cancelled {
		opacity: 0.5;
		text-decoration: line-through;
	}

	.queue-position {
		font-size: 0.6875rem;
		font-weight: 700;
		color: var(--text-secondary);
		width: 20px;
		text-align: center;
		flex-shrink: 0;
	}

	.queue-prompt {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.cancel-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		background: none;
		border: none;
		color: var(--text-secondary);
		cursor: pointer;
		border-radius: var(--radius-sm);
		padding: 0;
		transition: background-color var(--transition), color var(--transition);
	}

	.cancel-btn:hover {
		background-color: rgba(239, 68, 68, 0.1);
		color: var(--error);
	}
</style>
