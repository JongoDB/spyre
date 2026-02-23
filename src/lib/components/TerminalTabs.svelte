<script lang="ts">
	import { onMount } from 'svelte';
	import Terminal from './Terminal.svelte';
	import TerminalToolbar from './TerminalToolbar.svelte';
	import TerminalSearch from './TerminalSearch.svelte';
	import SnapshotModal from './SnapshotModal.svelte';

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
	let editingTabId = $state('');
	let editName = $state('');

	// Feature state
	let sessionRestored = $state(false);
	let broadcastActive = $state(false);
	let searchOpen = $state(false);
	let snapshotContent = $state('');
	let snapshotOpen = $state(false);

	// Terminal component refs keyed by tab ID
	let terminalRefs = $state<Record<string, Terminal>>({});

	function getActiveTab(): Tab | undefined {
		return tabs.find(t => t.id === activeTabId);
	}

	function getActiveTerminal(): Terminal | undefined {
		return terminalRefs[activeTabId];
	}

	function sendKeysToActive(data: string) {
		const terminal = getActiveTerminal();
		if (terminal) {
			terminal.sendKeys(data);
		}
	}

	// Tab management
	async function loadWindows() {
		loading = true;
		try {
			const res = await fetch(`/api/terminal/${envId}/windows`);
			if (res.ok) {
				const windows = await res.json();
				if (Array.isArray(windows) && windows.length > 0) {
					tabs = windows.map((w: { index: number; name: string }) => ({
						id: `tab-${w.index}`,
						windowIndex: w.index,
						name: w.name
					}));
					activeTabId = tabs[0].id;
				} else {
					await createTab();
				}
			} else {
				await createTab();
			}
		} catch {
			await createTab();
		} finally {
			loading = false;
		}
	}

	async function createTab() {
		creating = true;
		try {
			const res = await fetch(`/api/terminal/${envId}/windows`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({})
			});
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

	async function closeTab(tabId: string) {
		const tab = tabs.find((t) => t.id === tabId);
		if (!tab) return;

		try {
			await fetch(`/api/terminal/${envId}/windows/${tab.windowIndex}`, {
				method: 'DELETE'
			});
		} catch {
			// Still remove the tab locally
		}

		// Clean up ref
		delete terminalRefs[tabId];
		tabs = tabs.filter((t) => t.id !== tabId);

		if (activeTabId === tabId && tabs.length > 0) {
			activeTabId = tabs[tabs.length - 1].id;
		}
	}

	function startRename(tab: Tab) {
		editingTabId = tab.id;
		editName = tab.name;
	}

	async function commitRename(tab: Tab) {
		const trimmed = editName.trim();
		editingTabId = '';

		if (!trimmed || trimmed === tab.name) return;

		tab.name = trimmed;

		try {
			await fetch(`/api/terminal/${envId}/windows/${tab.windowIndex}`, {
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: trimmed })
			});
		} catch {
			// Name updated locally even if server fails
		}
	}

	function handleRenameKeydown(e: KeyboardEvent, tab: Tab) {
		if (e.key === 'Enter') {
			e.preventDefault();
			commitRename(tab);
		} else if (e.key === 'Escape') {
			editingTabId = '';
		}
	}

	// Window reordering
	async function moveTab(tabId: string, direction: -1 | 1) {
		const idx = tabs.findIndex(t => t.id === tabId);
		if (idx < 0) return;
		const targetIdx = idx + direction;
		if (targetIdx < 0 || targetIdx >= tabs.length) return;

		const sourceTab = tabs[idx];
		const targetTab = tabs[targetIdx];

		try {
			await fetch(`/api/terminal/${envId}/windows/${sourceTab.windowIndex}/reorder`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ targetIndex: targetTab.windowIndex })
			});

			// Swap in local array
			const srcWin = sourceTab.windowIndex;
			sourceTab.windowIndex = targetTab.windowIndex;
			targetTab.windowIndex = srcWin;

			// Swap positions
			const newTabs = [...tabs];
			newTabs[idx] = targetTab;
			newTabs[targetIdx] = sourceTab;
			tabs = newTabs;

			// Update tab IDs to match new window indices
			sourceTab.id = `tab-${sourceTab.windowIndex}`;
			targetTab.id = `tab-${targetTab.windowIndex}`;

			// Keep active on the moved tab
			activeTabId = sourceTab.id;
		} catch (err) {
			console.error('Failed to reorder window:', err);
		}
	}

	// Broadcast toggle
	async function toggleBroadcast() {
		const tab = getActiveTab();
		if (!tab) return;

		const newState = !broadcastActive;

		try {
			await fetch(`/api/terminal/${envId}/windows/${tab.windowIndex}/broadcast`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ enabled: newState })
			});
			broadcastActive = newState;
		} catch (err) {
			console.error('Failed to toggle broadcast:', err);
		}
	}

	// Snapshot
	async function takeSnapshot() {
		const tab = getActiveTab();
		if (!tab) return;

		try {
			const res = await fetch(`/api/terminal/${envId}/windows/${tab.windowIndex}/snapshot`);
			if (res.ok) {
				const data = await res.json();
				snapshotContent = data.content ?? '';
				snapshotOpen = true;
			}
		} catch (err) {
			console.error('Failed to capture snapshot:', err);
		}
	}

	// Toolbar command dispatch
	function handleCommand(cmd: string) {
		const keys: Record<string, string> = {
			'kill': '\x03',
			'clear': 'clear\r',
			'reset': 'reset\r',
			'close-pane': '\x02x',
			'zoom-pane': '\x02z',
			'nav-up': '\x02\x1b[A',
			'nav-down': '\x02\x1b[B',
			'nav-left': '\x02\x1b[D',
			'nav-right': '\x02\x1b[C'
		};
		const seq = keys[cmd];
		if (seq) {
			sendKeysToActive(seq);
			// Refocus terminal after command
			const terminal = getActiveTerminal();
			if (terminal) terminal.focusTerminal();
		}
	}

	// Toolbar actions
	function handleSplitH() {
		sendKeysToActive('\x02%');
	}

	function handleSplitV() {
		sendKeysToActive('\x02"');
	}

	function handleZoom() {
		sendKeysToActive('\x02z');
	}

	function handleSearchToggle() {
		if (searchOpen) {
			searchOpen = false;
			const terminal = getActiveTerminal();
			if (terminal) terminal.focusTerminal();
		} else {
			searchOpen = true;
		}
	}

	function handleSearchClose() {
		searchOpen = false;
		const terminal = getActiveTerminal();
		if (terminal) terminal.focusTerminal();
	}

	// Global keyboard shortcut for search
	function handleGlobalKeydown(e: KeyboardEvent) {
		if (e.ctrlKey && e.shiftKey && e.key === 'F') {
			e.preventDefault();
			handleSearchToggle();
		}
	}

	// Reset broadcast when switching tabs
	$effect(() => {
		// When active tab changes, reset broadcast state
		if (activeTabId) {
			broadcastActive = false;
		}
	});

	onMount(() => {
		loadWindows();
	});
</script>

<svelte:window onkeydown={handleGlobalKeydown} />

<div class="terminal-tabs">
	<div class="tab-bar">
		{#each tabs as tab, i (tab.id)}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="tab"
				class:active={tab.id === activeTabId}
				onclick={() => (activeTabId = tab.id)}
				ondblclick={() => startRename(tab)}
				role="tab"
				tabindex="0"
				onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') activeTabId = tab.id; }}
			>
				{#if tab.id === activeTabId && editingTabId !== tab.id}
					{#if i > 0}
						<button
							class="reorder-btn"
							onclick={(e) => { e.stopPropagation(); moveTab(tab.id, -1); }}
							title="Move left"
						>
							<svg width="10" height="10" viewBox="0 0 10 10" fill="none">
								<path d="M6 2L3 5l3 3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
							</svg>
						</button>
					{/if}
				{/if}

				{#if editingTabId === tab.id}
					<!-- svelte-ignore a11y_autofocus -->
					<input
						class="tab-rename-input"
						type="text"
						bind:value={editName}
						onblur={() => commitRename(tab)}
						onkeydown={(e) => handleRenameKeydown(e, tab)}
						onclick={(e) => e.stopPropagation()}
						autofocus
					/>
				{:else}
					<span class="tab-name">{tab.name}</span>
				{/if}

				{#if tab.id === activeTabId && editingTabId !== tab.id}
					{#if i < tabs.length - 1}
						<button
							class="reorder-btn"
							onclick={(e) => { e.stopPropagation(); moveTab(tab.id, 1); }}
							title="Move right"
						>
							<svg width="10" height="10" viewBox="0 0 10 10" fill="none">
								<path d="M4 2l3 3-3 3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
							</svg>
						</button>
					{/if}
				{/if}

				{#if tabs.length > 1 && editingTabId !== tab.id}
					<button
						class="tab-close"
						onclick={(e) => { e.stopPropagation(); closeTab(tab.id); }}
						title="Close tab"
					>
						&times;
					</button>
				{/if}
			</div>
		{/each}
		<button
			class="tab tab-new"
			onclick={createTab}
			disabled={creating}
			title="New terminal tab"
		>
			{creating ? '...' : '+'}
		</button>

		<div class="tab-bar-end">
			<button
				class="broadcast-btn"
				class:active={broadcastActive}
				onclick={toggleBroadcast}
				title={broadcastActive ? 'Disable broadcast to all panes' : 'Broadcast input to all panes'}
			>
				<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
					<circle cx="7" cy="7" r="2" stroke="currentColor" stroke-width="1.5"/>
					<path d="M4 4a4.24 4.24 0 000 6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
					<path d="M10 4a4.24 4.24 0 010 6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
					<path d="M2 2a7.07 7.07 0 000 10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
					<path d="M12 2a7.07 7.07 0 010 10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
				</svg>
				<span>Broadcast</span>
			</button>
		</div>
	</div>

	<TerminalToolbar
		{sessionRestored}
		{broadcastActive}
		onsplith={handleSplitH}
		onsplitv={handleSplitV}
		onzoom={handleZoom}
		onsearch={handleSearchToggle}
		onsnapshot={takeSnapshot}
		onbroadcast={toggleBroadcast}
		oncommand={handleCommand}
	/>

	<div class="tab-content">
		{#if loading}
			<div class="tab-loading">
				<div class="spinner"></div>
				<span>Initializing terminal...</span>
			</div>
		{:else}
			{#if searchOpen}
				{@const activeTab = getActiveTab()}
				{#if activeTab}
					<TerminalSearch
						{envId}
						windowIndex={activeTab.windowIndex}
						onclose={handleSearchClose}
					/>
				{/if}
			{/if}
			{#each tabs as tab (tab.id)}
				<Terminal
					bind:this={terminalRefs[tab.id]}
					{envId}
					windowIndex={tab.windowIndex}
					active={tab.id === activeTabId}
					onconnected={(idx, restored) => {
						const t = tabs.find(t => t.id === tab.id);
						if (t) t.windowIndex = idx;
						if (restored) sessionRestored = true;
					}}
				/>
			{/each}
		{/if}
	</div>
</div>

{#if snapshotOpen}
	<SnapshotModal
		content={snapshotContent}
		onclose={() => { snapshotOpen = false; }}
	/>
{/if}

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
		gap: 4px;
		padding: 6px 10px;
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

	.tab-name {
		max-width: 120px;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.tab-rename-input {
		width: 90px;
		padding: 1px 4px;
		font-size: 0.75rem;
		font-weight: 500;
		font-family: inherit;
		color: var(--text-primary);
		background-color: var(--bg-primary);
		border: 1px solid var(--accent);
		border-radius: 2px;
		outline: none;
	}

	.reorder-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 16px;
		height: 16px;
		padding: 0;
		color: var(--text-secondary);
		background: none;
		border: none;
		border-radius: 2px;
		cursor: pointer;
		opacity: 0.4;
		transition: opacity var(--transition), color var(--transition), background-color var(--transition);
	}

	.reorder-btn:hover {
		opacity: 1;
		color: var(--accent);
		background-color: rgba(99, 102, 241, 0.1);
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

	.tab-bar-end {
		margin-left: auto;
		display: flex;
		align-items: center;
		padding-right: 4px;
		flex-shrink: 0;
	}

	.broadcast-btn {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 4px 8px;
		font-size: 0.6875rem;
		font-weight: 500;
		color: var(--text-secondary);
		background: transparent;
		border: none;
		border-radius: var(--radius-sm);
		cursor: pointer;
		white-space: nowrap;
		transition: color var(--transition), background-color var(--transition), box-shadow var(--transition);
	}

	.broadcast-btn:hover {
		color: var(--text-primary);
		background-color: rgba(255, 255, 255, 0.06);
	}

	.broadcast-btn.active {
		color: var(--accent);
		background-color: rgba(99, 102, 241, 0.1);
		box-shadow: 0 0 8px rgba(99, 102, 241, 0.3);
	}

	.tab-content {
		flex: 1;
		min-height: 0;
		position: relative;
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
