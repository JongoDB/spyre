<script lang="ts">
	import { onMount } from 'svelte';
	import Terminal from './Terminal.svelte';

	interface Props {
		envId: string;
	}

	let { envId }: Props = $props();

	interface Tab {
		id: string;
		windowIndex: number;
		name: string;
	}

	let tabs = $state<Tab[]>([]);
	let activeTabId = $state('');
	let loading = $state(true);
	let creating = $state(false);

	async function loadWindows() {
		loading = true;
		try {
			const res = await fetch(`/api/terminal/${envId}/windows`);
			if (res.ok) {
				const windows: Array<{ index: number; name: string }> = await res.json();
				if (windows.length > 0) {
					tabs = windows.map((w) => ({
						id: `tab-${w.index}`,
						windowIndex: w.index,
						name: w.name
					}));
					activeTabId = tabs[0].id;
				} else {
					// No existing windows — create the first one
					await createTab();
				}
			} else {
				// No tmux session yet — create the first tab
				await createTab();
			}
		} catch {
			// Server may not have a session yet — create one
			await createTab();
		} finally {
			loading = false;
		}
	}

	async function createTab() {
		creating = true;
		try {
			const res = await fetch(`/api/terminal/${envId}/windows`, { method: 'POST' });
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				console.error('Failed to create window:', body.message);
				return;
			}
			const result: { windowIndex: number; name: string } = await res.json();
			const tab: Tab = {
				id: `tab-${result.windowIndex}`,
				windowIndex: result.windowIndex,
				name: result.name
			};
			tabs = [...tabs, tab];
			activeTabId = tab.id;
		} catch (err) {
			console.error('Failed to create terminal tab:', err);
		} finally {
			creating = false;
		}
	}

	function closeTab(tabId: string) {
		const tab = tabs.find((t) => t.id === tabId);
		if (!tab) return;

		tabs = tabs.filter((t) => t.id !== tabId);

		// Switch to another tab if we closed the active one
		if (activeTabId === tabId && tabs.length > 0) {
			activeTabId = tabs[tabs.length - 1].id;
		}
	}

	onMount(() => {
		loadWindows();
	});
</script>

<div class="terminal-tabs">
	<div class="tab-bar">
		{#each tabs as tab (tab.id)}
			<button
				class="tab"
				class:active={tab.id === activeTabId}
				onclick={() => (activeTabId = tab.id)}
			>
				<span class="tab-name">{tab.name}</span>
				{#if tabs.length > 1}
					<button
						class="tab-close"
						onclick={(e: MouseEvent) => { e.stopPropagation(); closeTab(tab.id); }}
						title="Close tab"
					>
						&times;
					</button>
				{/if}
			</button>
		{/each}
		<button
			class="tab tab-new"
			onclick={createTab}
			disabled={creating}
			title="New terminal tab"
		>
			{creating ? '...' : '+'}
		</button>
	</div>

	<div class="tab-content">
		{#if loading}
			<div class="tab-loading">
				<div class="spinner"></div>
				<span>Initializing terminal...</span>
			</div>
		{:else}
			{#each tabs as tab (tab.id)}
				<Terminal
					{envId}
					windowIndex={tab.windowIndex}
					active={tab.id === activeTabId}
					onconnected={(idx) => {
						const t = tabs.find(t => t.id === tab.id);
						if (t) t.windowIndex = idx;
					}}
				/>
			{/each}
		{/if}
	</div>
</div>

<style>
	.terminal-tabs {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-height: 0;
	}

	.tab-bar {
		display: flex;
		align-items: stretch;
		gap: 1px;
		background-color: var(--bg-secondary);
		border: 1px solid var(--border);
		border-bottom: none;
		border-radius: var(--radius-sm) var(--radius-sm) 0 0;
		overflow-x: auto;
		flex-shrink: 0;
	}

	.tab {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 12px;
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--text-secondary);
		background: transparent;
		border: none;
		border-bottom: 2px solid transparent;
		cursor: pointer;
		white-space: nowrap;
		transition:
			color var(--transition),
			background-color var(--transition),
			border-color var(--transition);
	}

	.tab:hover {
		color: var(--text-primary);
		background-color: rgba(255, 255, 255, 0.03);
	}

	.tab.active {
		color: var(--text-primary);
		border-bottom-color: var(--accent);
		background-color: rgba(99, 102, 241, 0.05);
	}

	.tab-close {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 16px;
		height: 16px;
		font-size: 0.875rem;
		line-height: 1;
		color: var(--text-secondary);
		background: none;
		border: none;
		border-radius: 2px;
		cursor: pointer;
		padding: 0;
		opacity: 0.5;
		transition: opacity var(--transition), background-color var(--transition);
	}

	.tab-close:hover {
		opacity: 1;
		background-color: rgba(239, 68, 68, 0.2);
		color: var(--error);
	}

	.tab-new {
		color: var(--text-secondary);
		font-size: 1rem;
		padding: 6px 10px;
		opacity: 0.7;
	}

	.tab-new:hover {
		opacity: 1;
		color: var(--accent);
	}

	.tab-content {
		flex: 1;
		min-height: 0;
		border: 1px solid var(--border);
		border-top: none;
		border-radius: 0 0 var(--radius-sm) var(--radius-sm);
		overflow: hidden;
	}

	.tab-loading {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 12px;
		height: 100%;
		min-height: 300px;
		color: var(--text-secondary);
		font-size: 0.875rem;
		background-color: #0f1117;
	}

	.spinner {
		width: 24px;
		height: 24px;
		border: 2px solid var(--border);
		border-top-color: var(--accent);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}
</style>
