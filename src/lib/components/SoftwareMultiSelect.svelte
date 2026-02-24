<script lang="ts">
	interface SoftwareEntry {
		id: string;
		name: string;
		description: string | null;
		os_families: string;
		tags: string | null;
		is_builtin: number;
	}

	let {
		selectedIds = $bindable([]),
		selectedNames = $bindable([]),
		osFilter = undefined,
		onchange = undefined
	}: {
		selectedIds?: string[];
		selectedNames?: string[];
		osFilter?: string;
		onchange?: () => void;
	} = $props();

	// Track whether we're in names mode
	let namesMode = $derived(selectedNames.length > 0 || selectedIds.length === 0);

	let searchQuery = $state('');
	let results = $state<SoftwareEntry[]>([]);
	let allSoftware = $state<SoftwareEntry[]>([]);
	let showDropdown = $state(false);
	let loading = $state(false);

	// Load all software on mount
	$effect(() => {
		loadSoftware();
	});

	async function loadSoftware() {
		loading = true;
		try {
			const res = await fetch('/api/software-repo');
			if (res.ok) {
				allSoftware = await res.json();
				filterResults();
			}
		} catch {
			// ignore
		} finally {
			loading = false;
		}
	}

	function filterResults() {
		const q = searchQuery.toLowerCase();
		const excluded = namesMode
			? new Set(selectedNames)
			: new Set(selectedIds);

		results = allSoftware.filter(s => {
			if (namesMode ? excluded.has(s.name) : excluded.has(s.id)) return false;
			if (q && !s.name.toLowerCase().includes(q) && !(s.description?.toLowerCase().includes(q))) return false;
			if (osFilter && !s.os_families.includes(osFilter)) return false;
			return true;
		});
	}

	$effect(() => {
		searchQuery;
		osFilter;
		selectedIds;
		selectedNames;
		filterResults();
	});

	function addSoftware(id: string) {
		const entry = allSoftware.find(s => s.id === id);
		if (namesMode && entry) {
			selectedNames = [...selectedNames, entry.name];
		} else {
			selectedIds = [...selectedIds, id];
		}
		searchQuery = '';
		showDropdown = false;
		onchange?.();
	}

	function removeSoftware(id: string) {
		const entry = allSoftware.find(s => s.id === id);
		if (namesMode && entry) {
			selectedNames = selectedNames.filter(n => n !== entry.name);
		} else {
			selectedIds = selectedIds.filter(sid => sid !== id);
		}
		onchange?.();
	}

	function getSelectedEntry(id: string): SoftwareEntry | undefined {
		return allSoftware.find(s => s.id === id);
	}

	function getEffectiveSelectedIds(): string[] {
		if (namesMode) {
			return selectedNames
				.map(name => allSoftware.find(s => s.name === name)?.id)
				.filter((id): id is string => !!id);
		}
		return selectedIds;
	}

	function parseOsFamilies(os: string): string[] {
		return os.split(',').map(s => s.trim()).filter(Boolean);
	}
</script>

<div class="software-select">
	<!-- Selected items -->
	{#if getEffectiveSelectedIds().length > 0}
		<div class="selected-items">
			{#each getEffectiveSelectedIds() as id (id)}
				{@const entry = getSelectedEntry(id)}
				{#if entry}
					<div class="selected-tag">
						<span class="tag-name">{entry.name}</span>
						<div class="tag-badges">
							{#each parseOsFamilies(entry.os_families).slice(0, 3) as os}
								<span class="os-badge">{os}</span>
							{/each}
						</div>
						<button class="tag-remove" onclick={() => removeSoftware(id)} title="Remove">
							<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
						</button>
					</div>
				{/if}
			{/each}
		</div>
	{/if}

	<!-- Search input -->
	<div class="search-wrapper">
		<input
			type="text"
			class="form-input"
			placeholder="Search software to add..."
			bind:value={searchQuery}
			onfocus={() => { showDropdown = true; }}
			onblur={() => { setTimeout(() => { showDropdown = false; }, 200); }}
		/>
	</div>

	<!-- Dropdown results -->
	{#if showDropdown && results.length > 0}
		<div class="dropdown">
			{#each results.slice(0, 10) as entry (entry.id)}
				<button class="dropdown-item" onmousedown={() => addSoftware(entry.id)}>
					<div class="item-info">
						<span class="item-name">{entry.name}</span>
						{#if entry.description}
							<span class="item-desc">{entry.description}</span>
						{/if}
					</div>
					<div class="item-badges">
						{#each parseOsFamilies(entry.os_families) as os}
							<span class="os-badge">{os}</span>
						{/each}
						{#if entry.is_builtin}
							<span class="builtin-badge">built-in</span>
						{/if}
					</div>
				</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.software-select {
		position: relative;
	}

	.selected-items {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-bottom: 8px;
	}

	.selected-tag {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 4px 8px 4px 10px;
		background-color: rgba(99, 102, 241, 0.1);
		border: 1px solid rgba(99, 102, 241, 0.2);
		border-radius: var(--radius-sm);
		font-size: 0.8125rem;
	}

	.tag-name {
		font-weight: 500;
	}

	.tag-badges {
		display: flex;
		gap: 2px;
	}

	.tag-remove {
		display: flex;
		align-items: center;
		background: none;
		border: none;
		color: var(--text-secondary);
		cursor: pointer;
		padding: 2px;
		border-radius: 3px;
		transition: color var(--transition), background-color var(--transition);
	}

	.tag-remove:hover {
		color: var(--error);
		background-color: rgba(239, 68, 68, 0.1);
	}

	.search-wrapper {
		position: relative;
	}

	.dropdown {
		position: absolute;
		top: 100%;
		left: 0;
		right: 0;
		z-index: 100;
		background-color: var(--bg-card);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
		max-height: 280px;
		overflow-y: auto;
		margin-top: 4px;
	}

	.dropdown-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		width: 100%;
		padding: 8px 12px;
		background: none;
		border: none;
		border-bottom: 1px solid var(--border);
		color: var(--text-primary);
		cursor: pointer;
		text-align: left;
		transition: background-color var(--transition);
	}

	.dropdown-item:last-child {
		border-bottom: none;
	}

	.dropdown-item:hover {
		background-color: rgba(99, 102, 241, 0.06);
	}

	.item-info {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}

	.item-name {
		font-size: 0.8125rem;
		font-weight: 500;
	}

	.item-desc {
		font-size: 0.6875rem;
		color: var(--text-secondary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.item-badges {
		display: flex;
		gap: 3px;
		flex-shrink: 0;
	}

	.os-badge {
		font-size: 0.5625rem;
		font-weight: 600;
		text-transform: uppercase;
		padding: 1px 4px;
		border-radius: 3px;
		background-color: rgba(255, 255, 255, 0.06);
		color: var(--text-secondary);
		letter-spacing: 0.02em;
	}

	.builtin-badge {
		font-size: 0.5625rem;
		font-weight: 600;
		padding: 1px 4px;
		border-radius: 3px;
		background-color: rgba(99, 102, 241, 0.15);
		color: var(--accent);
	}
</style>
