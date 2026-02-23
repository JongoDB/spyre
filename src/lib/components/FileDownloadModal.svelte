<script lang="ts">
	import { addToast } from '$lib/stores/toast.svelte';

	interface Props {
		envId: string;
		onclose: () => void;
	}

	let { envId, onclose }: Props = $props();

	let filePath = $state('');
	let downloading = $state(false);

	async function handleDownload() {
		const trimmed = filePath.trim();
		if (!trimmed) return;

		downloading = true;
		try {
			const res = await fetch(`/api/terminal/${envId}/download?path=${encodeURIComponent(trimmed)}`);
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				addToast(body.message ?? 'Download failed', 'error');
				return;
			}

			const blob = await res.blob();
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			// Extract filename from path
			const filename = trimmed.split('/').pop() ?? 'download';
			a.download = filename;
			a.click();
			URL.revokeObjectURL(url);
			addToast(`Downloaded ${filename}`, 'success');
			onclose();
		} catch {
			addToast('Network error during download', 'error');
		} finally {
			downloading = false;
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
		} else if (e.key === 'Enter' && filePath.trim()) {
			handleDownload();
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="modal-backdrop" onclick={handleBackdropClick}>
	<div class="modal">
		<div class="modal-header">
			<h3 class="modal-title">Download File</h3>
			<button class="btn-close" onclick={onclose} title="Close">
				<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
					<line x1="3.5" y1="3.5" x2="10.5" y2="10.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
					<line x1="10.5" y1="3.5" x2="3.5" y2="10.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
				</svg>
			</button>
		</div>
		<div class="modal-body">
			<label class="form-label" for="dl-path">File path on remote server</label>
			<!-- svelte-ignore a11y_autofocus -->
			<input
				id="dl-path"
				type="text"
				class="form-input"
				placeholder="/etc/hostname"
				bind:value={filePath}
				autofocus
			/>
			<div class="modal-actions">
				<button class="btn btn-secondary btn-sm" onclick={onclose}>
					Cancel
				</button>
				<button
					class="btn btn-primary btn-sm"
					disabled={!filePath.trim() || downloading}
					onclick={handleDownload}
				>
					{downloading ? 'Downloading...' : 'Download'}
				</button>
			</div>
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
		max-width: 440px;
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
	}

	.modal-title {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--text-primary);
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
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.modal-actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 4px;
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
