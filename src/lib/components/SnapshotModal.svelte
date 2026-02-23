<script lang="ts">
	interface Props {
		content: string;
		onclose: () => void;
	}

	let { content, onclose }: Props = $props();

	let copied = $state(false);

	async function copyToClipboard() {
		try {
			await navigator.clipboard.writeText(content);
			copied = true;
			setTimeout(() => { copied = false; }, 2000);
		} catch {
			// Fallback: select text
			const pre = document.querySelector('.snapshot-content');
			if (pre) {
				const range = document.createRange();
				range.selectNodeContents(pre);
				const sel = window.getSelection();
				sel?.removeAllRanges();
				sel?.addRange(range);
			}
		}
	}

	function handleBackdropClick(e: MouseEvent) {
		if ((e.target as HTMLElement).classList.contains('modal-backdrop')) {
			onclose();
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			onclose();
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="modal-backdrop" onclick={handleBackdropClick}>
	<div class="modal">
		<div class="modal-header">
			<h3 class="modal-title">Terminal Snapshot</h3>
			<div class="modal-actions">
				<button class="btn-copy" onclick={copyToClipboard}>
					{#if copied}
						<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
							<polyline points="3,7 6,10 11,4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
						</svg>
						Copied
					{:else}
						<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
							<rect x="4" y="4" width="8" height="8" rx="1" stroke="currentColor" stroke-width="1.3"/>
							<path d="M10 4V3a1 1 0 00-1-1H3a1 1 0 00-1 1v6a1 1 0 001 1h1" stroke="currentColor" stroke-width="1.3"/>
						</svg>
						Copy
					{/if}
				</button>
				<button class="btn-close" onclick={onclose} title="Close">
					<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
						<line x1="3.5" y1="3.5" x2="10.5" y2="10.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
						<line x1="10.5" y1="3.5" x2="3.5" y2="10.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
					</svg>
				</button>
			</div>
		</div>
		<div class="modal-body">
			<pre class="snapshot-content">{content}</pre>
		</div>
	</div>
</div>

<style>
	.modal-backdrop {
		position: fixed;
		inset: 0;
		z-index: 100;
		display: flex;
		align-items: center;
		justify-content: center;
		background-color: rgba(0, 0, 0, 0.6);
		animation: fadeIn 0.15s ease;
	}

	.modal {
		width: 90vw;
		max-width: 800px;
		max-height: 80vh;
		display: flex;
		flex-direction: column;
		background-color: var(--bg-card);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
		animation: scaleIn 0.15s ease;
	}

	.modal-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 16px;
		border-bottom: 1px solid var(--border);
		flex-shrink: 0;
	}

	.modal-title {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--text-primary);
	}

	.modal-actions {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.btn-copy {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 4px 10px;
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--text-primary);
		background-color: var(--accent);
		border: none;
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition: background-color var(--transition);
	}

	.btn-copy:hover {
		background-color: var(--accent-hover);
	}

	.btn-close {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		color: var(--text-secondary);
		background: none;
		border: none;
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition: color var(--transition), background-color var(--transition);
	}

	.btn-close:hover {
		color: var(--text-primary);
		background-color: rgba(255, 255, 255, 0.08);
	}

	.modal-body {
		flex: 1;
		overflow: auto;
		padding: 0;
		min-height: 0;
	}

	.snapshot-content {
		margin: 0;
		padding: 12px 16px;
		font-family: 'SF Mono', 'Fira Code', 'Fira Mono', Menlo, monospace;
		font-size: 0.75rem;
		line-height: 1.5;
		color: var(--text-primary);
		background-color: var(--bg-primary);
		white-space: pre;
		overflow-x: auto;
		tab-size: 4;
	}

	@keyframes fadeIn {
		from { opacity: 0; }
		to { opacity: 1; }
	}

	@keyframes scaleIn {
		from { opacity: 0; transform: scale(0.95); }
		to { opacity: 1; transform: scale(1); }
	}
</style>
