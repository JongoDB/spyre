<script lang="ts">
	import { onMount } from 'svelte';
	import { addToast } from '$lib/stores/toast.svelte';

	interface Props {
		envId: string;
		onclose: () => void;
	}

	let { envId, onclose }: Props = $props();

	interface FileEntry {
		name: string;
		isDir: boolean;
		size: number;
	}

	let filePath = $state('');
	let downloading = $state(false);
	let entries = $state<FileEntry[]>([]);
	let showDropdown = $state(false);
	let selectedIndex = $state(-1);
	let loadingEntries = $state(false);
	let debounceTimer: ReturnType<typeof setTimeout> | undefined;
	let inputEl: HTMLInputElement | undefined;
	let dropdownEl: HTMLDivElement | undefined;

	function getDirname(path: string): string {
		if (!path || path === '/') return '/';
		// If path ends with /, it IS the directory
		if (path.endsWith('/')) return path;
		// Otherwise get the parent directory
		const lastSlash = path.lastIndexOf('/');
		if (lastSlash <= 0) return '/';
		return path.substring(0, lastSlash + 1);
	}

	async function fetchEntries(dirPath: string) {
		loadingEntries = true;
		try {
			const res = await fetch(`/api/terminal/${envId}/files?path=${encodeURIComponent(dirPath)}`);
			if (res.ok) {
				const data = await res.json();
				entries = data.entries ?? [];
				selectedIndex = -1;
				showDropdown = entries.length > 0;
			} else {
				entries = [];
				showDropdown = false;
			}
		} catch {
			entries = [];
			showDropdown = false;
		} finally {
			loadingEntries = false;
		}
	}

	function debouncedFetch() {
		if (debounceTimer) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			const dir = getDirname(filePath);
			fetchEntries(dir);
		}, 300);
	}

	function handleInput() {
		debouncedFetch();
	}

	function selectEntry(entry: FileEntry) {
		const dir = getDirname(filePath);
		const base = dir.endsWith('/') ? dir : dir + '/';

		if (entry.isDir) {
			filePath = base + entry.name + '/';
			fetchEntries(filePath);
			inputEl?.focus();
		} else {
			filePath = base + entry.name;
			showDropdown = false;
			inputEl?.focus();
		}
	}

	function formatSize(bytes: number): string {
		if (bytes === 0) return '';
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
		return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
	}

	function handleInputKeydown(e: KeyboardEvent) {
		if (!showDropdown || entries.length === 0) {
			if (e.key === 'Enter' && filePath.trim()) {
				e.preventDefault();
				handleDownload();
			} else if (e.key === 'Escape') {
				onclose();
			}
			return;
		}

		if (e.key === 'ArrowDown') {
			e.preventDefault();
			selectedIndex = Math.min(selectedIndex + 1, entries.length - 1);
			scrollSelectedIntoView();
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			selectedIndex = Math.max(selectedIndex - 1, -1);
			scrollSelectedIntoView();
		} else if (e.key === 'Enter') {
			e.preventDefault();
			if (selectedIndex >= 0 && selectedIndex < entries.length) {
				selectEntry(entries[selectedIndex]);
			} else if (filePath.trim()) {
				handleDownload();
			}
		} else if (e.key === 'Escape') {
			if (showDropdown) {
				showDropdown = false;
			} else {
				onclose();
			}
		} else if (e.key === 'Tab' && selectedIndex >= 0) {
			e.preventDefault();
			selectEntry(entries[selectedIndex]);
		}
	}

	function scrollSelectedIntoView() {
		requestAnimationFrame(() => {
			const item = dropdownEl?.querySelector('.dropdown-item.selected');
			item?.scrollIntoView({ block: 'nearest' });
		});
	}

	async function handleDownload() {
		const trimmed = filePath.trim();
		if (!trimmed) return;

		downloading = true;
		showDropdown = false;
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

	function handleWindowKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && !showDropdown) {
			onclose();
		}
	}

	onMount(() => {
		// Fetch root directory on open
		fetchEntries('/');
		filePath = '/';
	});
</script>

<svelte:window onkeydown={handleWindowKeydown} />

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
			<div class="input-wrapper">
				<!-- svelte-ignore a11y_autofocus -->
				<input
					id="dl-path"
					type="text"
					class="form-input"
					placeholder="/etc/hostname"
					bind:value={filePath}
					bind:this={inputEl}
					oninput={handleInput}
					onkeydown={handleInputKeydown}
					onfocus={() => { if (entries.length > 0) showDropdown = true; }}
					autocomplete="off"
					autofocus
				/>
				{#if loadingEntries}
					<div class="input-spinner"></div>
				{/if}
				{#if showDropdown && entries.length > 0}
					<div class="dropdown" bind:this={dropdownEl}>
						{#each entries as entry, i}
							<!-- svelte-ignore a11y_click_events_have_key_events -->
							<!-- svelte-ignore a11y_no_static_element_interactions -->
							<div
								class="dropdown-item"
								class:selected={i === selectedIndex}
								onclick={() => selectEntry(entry)}
								onmouseenter={() => { selectedIndex = i; }}
							>
								<span class="entry-icon">{entry.isDir ? '📁' : '📄'}</span>
								<span class="entry-name">{entry.name}{entry.isDir ? '/' : ''}</span>
								{#if !entry.isDir && entry.size > 0}
									<span class="entry-size">{formatSize(entry.size)}</span>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			</div>
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
		max-width: 480px;
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

	.input-wrapper {
		position: relative;
	}

	.input-spinner {
		position: absolute;
		right: 10px;
		top: 50%;
		transform: translateY(-50%);
		width: 14px;
		height: 14px;
		border: 2px solid var(--border);
		border-top-color: var(--accent);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	.dropdown {
		position: absolute;
		top: 100%;
		left: 0;
		right: 0;
		max-height: 240px;
		overflow-y: auto;
		background-color: var(--bg-card);
		border: 1px solid var(--border);
		border-top: none;
		border-radius: 0 0 var(--radius-sm) var(--radius-sm);
		z-index: 10;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
	}

	.dropdown-item {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 10px;
		font-size: 0.8125rem;
		color: var(--text-primary);
		cursor: pointer;
		transition: background-color 0.1s;
	}

	.dropdown-item:hover,
	.dropdown-item.selected {
		background-color: rgba(99, 102, 241, 0.12);
	}

	.entry-icon {
		flex-shrink: 0;
		font-size: 0.75rem;
	}

	.entry-name {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: var(--font-mono, monospace);
	}

	.entry-size {
		flex-shrink: 0;
		font-size: 0.6875rem;
		color: var(--text-secondary);
		font-family: var(--font-mono, monospace);
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

	@keyframes spin {
		to { transform: translateY(-50%) rotate(360deg); }
	}
</style>
