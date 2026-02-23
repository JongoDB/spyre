<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let searchInput = $state(data.query);
	let syncing = $state(false);
	let syncError = $state('');

	let totalPages = $derived(Math.max(1, Math.ceil(data.total / data.limit)));

	let lastSyncLabel = $derived.by(() => {
		if (!data.lastSync) return 'Never synced';
		const diff = Date.now() - new Date(data.lastSync).getTime();
		const mins = Math.floor(diff / 60000);
		if (mins < 1) return 'Last synced: just now';
		if (mins < 60) return `Last synced: ${mins}m ago`;
		const hours = Math.floor(mins / 60);
		if (hours < 24) return `Last synced: ${hours}h ago`;
		const days = Math.floor(hours / 24);
		return `Last synced: ${days}d ago`;
	});

	function buildUrl(overrides: Record<string, string | number | undefined>): string {
		const params = new URLSearchParams();
		const q = overrides.query !== undefined ? String(overrides.query) : data.query;
		const t = overrides.type !== undefined ? String(overrides.type) : data.selectedType;
		const c = overrides.category !== undefined ? String(overrides.category) : data.selectedCategory;
		const p = overrides.page !== undefined ? String(overrides.page) : String(data.page);

		if (q) params.set('query', q);
		if (t) params.set('type', t);
		if (c) params.set('category', c);
		if (p && p !== '1') params.set('page', p);

		const qs = params.toString();
		return qs ? `/library?${qs}` : '/library';
	}

	function handleSearch(e: SubmitEvent) {
		e.preventDefault();
		goto(buildUrl({ query: searchInput, page: 1 }));
	}

	function setType(type: string) {
		goto(buildUrl({ type: type || undefined, page: 1 }));
	}

	function setCategory(category: string) {
		goto(buildUrl({ category: category || undefined, page: 1 }));
	}

	function goToPage(p: number) {
		goto(buildUrl({ page: p }));
	}

	async function syncNow() {
		syncing = true;
		syncError = '';
		try {
			const res = await fetch('/api/community-scripts/sync', { method: 'POST' });
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				syncError = body.message ?? 'Sync failed. Please try again.';
				return;
			}
			// Reload to pick up new data
			window.location.reload();
		} catch {
			syncError = 'Network error during sync. Please try again.';
		} finally {
			syncing = false;
		}
	}

	function formatResource(value: number | null, unit: string): string {
		if (value === null || value === undefined) return '--';
		return `${value}${unit}`;
	}
</script>

<div class="library-page">
	<header class="page-header">
		<div class="header-left">
			<h1>Community Library</h1>
			<span class="sync-label">{lastSyncLabel}</span>
		</div>
		<button class="btn btn-primary" onclick={syncNow} disabled={syncing}>
			{#if syncing}
				<span class="spinner"></span>
				Syncing...
			{:else}
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
					<polyline points="23 4 23 10 17 10" />
					<polyline points="1 20 1 14 7 14" />
					<path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
				</svg>
				Sync Now
			{/if}
		</button>
	</header>

	{#if syncError}
		<div class="sync-error">{syncError}</div>
	{/if}

	<!-- Search & Filters -->
	<div class="filters">
		<form class="search-form" onsubmit={handleSearch}>
			<input
				type="text"
				class="form-input search-input"
				placeholder="Search scripts..."
				bind:value={searchInput}
			/>
			<button type="submit" class="btn btn-secondary search-btn">Search</button>
		</form>

		<div class="filter-row">
			<div class="type-filters">
				<button
					class="btn btn-sm"
					class:btn-active={data.selectedType === ''}
					class:btn-secondary={data.selectedType !== ''}
					onclick={() => setType('')}
				>All</button>
				<button
					class="btn btn-sm"
					class:btn-active={data.selectedType === 'ct'}
					class:btn-secondary={data.selectedType !== 'ct'}
					onclick={() => setType('ct')}
				>CT</button>
				<button
					class="btn btn-sm"
					class:btn-active={data.selectedType === 'vm'}
					class:btn-secondary={data.selectedType !== 'vm'}
					onclick={() => setType('vm')}
				>VM</button>
			</div>

			<select
				class="form-select category-select"
				value={data.selectedCategory}
				onchange={(e) => setCategory((e.target as HTMLSelectElement).value)}
			>
				<option value="">All Categories</option>
				{#each data.categories as cat}
					<option value={cat}>{cat}</option>
				{/each}
			</select>
		</div>
	</div>

	<!-- Results info -->
	<div class="results-info">
		<span class="result-count">{data.total} script{data.total !== 1 ? 's' : ''} found</span>
	</div>

	<!-- Script Grid -->
	{#if data.scripts.length === 0}
		<div class="empty-state card">
			<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="empty-icon">
				<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
				<path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
			</svg>
			<p>No scripts found. Try syncing from GitHub.</p>
			<button class="btn btn-primary" onclick={syncNow} disabled={syncing}>
				{#if syncing}
					<span class="spinner"></span>
					Syncing...
				{:else}
					Sync Now
				{/if}
			</button>
		</div>
	{:else}
		<div class="script-grid">
			{#each data.scripts as script (script.slug)}
				<a href="/library/{script.slug}" class="script-card card">
					<div class="script-card-header">
						<div class="script-logo">
							{#if script.logo_url}
								<img
									src={script.logo_url}
									alt="{script.name} logo"
									onerror={(e) => {
										const target = e.currentTarget as HTMLImageElement;
										target.style.display = 'none';
										const fallback = target.nextElementSibling as HTMLElement;
										if (fallback) fallback.style.display = 'flex';
									}}
								/>
								<div class="logo-fallback" style="display: none;">
									<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
										<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
									</svg>
								</div>
							{:else}
								<div class="logo-fallback">
									<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
										<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
									</svg>
								</div>
							{/if}
						</div>
						{#if script.type}
							<span class="type-badge type-badge-{script.type}">
								{script.type.toUpperCase()}
							</span>
						{/if}
					</div>

					<div class="script-card-body">
						<h3 class="script-name">{script.name}</h3>
						{#if script.description}
							<p class="script-desc">{script.description}</p>
						{/if}
					</div>

					<div class="script-card-footer">
						<div class="resource-row">
							<span class="resource-item" title="CPU Cores">
								<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
									<rect x="4" y="4" width="16" height="16" rx="2" />
									<rect x="9" y="9" width="6" height="6" />
									<path d="M15 2v2M15 20v2M2 15h2M20 15h2M9 2v2M9 20v2M2 9h2M20 9h2" />
								</svg>
								{formatResource(script.default_cpu, ' Core' + ((script.default_cpu ?? 0) !== 1 ? 's' : ''))}
							</span>
							<span class="resource-item" title="RAM">
								<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
									<path d="M6 19v-3M10 19v-3M14 19v-3M18 19v-3M3 7h18a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z" />
								</svg>
								{formatResource(script.default_ram, ' MB')}
							</span>
							<span class="resource-item" title="Disk">
								<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
									<ellipse cx="12" cy="5" rx="9" ry="3" />
									<path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
									<path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
								</svg>
								{formatResource(script.default_disk, ' GB')}
							</span>
						</div>
					</div>
				</a>
			{/each}
		</div>

		<!-- Pagination -->
		{#if totalPages > 1}
			<nav class="pagination">
				<button
					class="btn btn-secondary btn-sm"
					disabled={data.page <= 1}
					onclick={() => goToPage(data.page - 1)}
				>Previous</button>

				<div class="page-numbers">
					{#each Array.from({ length: totalPages }, (_, i) => i + 1) as p}
						{#if p === 1 || p === totalPages || (p >= data.page - 2 && p <= data.page + 2)}
							<button
								class="btn btn-sm page-btn"
								class:btn-active={p === data.page}
								class:btn-secondary={p !== data.page}
								onclick={() => goToPage(p)}
							>{p}</button>
						{:else if p === data.page - 3 || p === data.page + 3}
							<span class="page-ellipsis">...</span>
						{/if}
					{/each}
				</div>

				<button
					class="btn btn-secondary btn-sm"
					disabled={data.page >= totalPages}
					onclick={() => goToPage(data.page + 1)}
				>Next</button>
			</nav>
		{/if}
	{/if}
</div>

<style>
	.library-page {
		max-width: 1200px;
	}

	/* ---- Header ---- */

	.page-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 24px;
		flex-wrap: wrap;
		gap: 12px;
	}

	.header-left {
		display: flex;
		align-items: center;
		gap: 16px;
	}

	.page-header h1 {
		font-size: 1.5rem;
		font-weight: 600;
	}

	.sync-label {
		font-size: 0.75rem;
		color: var(--text-secondary);
	}

	.sync-error {
		background-color: rgba(239, 68, 68, 0.1);
		border: 1px solid var(--error);
		border-radius: var(--radius-sm);
		color: var(--error);
		padding: 10px 16px;
		margin-bottom: 16px;
		font-size: 0.8125rem;
	}

	/* ---- Spinner ---- */

	.spinner {
		display: inline-block;
		width: 14px;
		height: 14px;
		border: 2px solid rgba(255, 255, 255, 0.3);
		border-top-color: #fff;
		border-radius: 50%;
		animation: spin 0.6s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	/* ---- Filters ---- */

	.filters {
		display: flex;
		flex-direction: column;
		gap: 12px;
		margin-bottom: 16px;
	}

	.search-form {
		display: flex;
		gap: 8px;
	}

	.search-input {
		flex: 1;
		min-width: 200px;
	}

	.search-btn {
		flex-shrink: 0;
	}

	.filter-row {
		display: flex;
		align-items: center;
		gap: 12px;
		flex-wrap: wrap;
	}

	.type-filters {
		display: flex;
		gap: 4px;
	}

	.category-select {
		min-width: 180px;
	}

	.btn-active {
		background-color: var(--accent);
		color: #fff;
		border-color: var(--accent);
	}

	.btn-active:hover {
		background-color: var(--accent-hover);
		border-color: var(--accent-hover);
	}

	/* ---- Results info ---- */

	.results-info {
		margin-bottom: 16px;
	}

	.result-count {
		font-size: 0.8125rem;
		color: var(--text-secondary);
	}

	/* ---- Script Grid ---- */

	.script-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: 16px;
	}

	/* ---- Script Card ---- */

	.script-card {
		display: flex;
		flex-direction: column;
		gap: 12px;
		text-decoration: none;
		color: var(--text-primary);
		transition: border-color var(--transition), box-shadow var(--transition), transform var(--transition);
	}

	.script-card:hover {
		border-color: var(--accent);
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
		transform: translateY(-1px);
		color: var(--text-primary);
	}

	.script-card-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 8px;
	}

	.script-logo {
		width: 40px;
		height: 40px;
		border-radius: var(--radius-sm);
		overflow: hidden;
		flex-shrink: 0;
		background-color: var(--bg-secondary);
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.script-logo img {
		width: 100%;
		height: 100%;
		object-fit: contain;
	}

	.logo-fallback {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		height: 100%;
		color: var(--text-secondary);
	}

	.type-badge {
		display: inline-flex;
		padding: 2px 8px;
		font-size: 0.625rem;
		font-weight: 700;
		letter-spacing: 0.05em;
		border-radius: 9999px;
		text-transform: uppercase;
		flex-shrink: 0;
	}

	.type-badge-ct {
		background-color: rgba(34, 197, 94, 0.12);
		color: var(--success);
	}

	.type-badge-vm {
		background-color: rgba(99, 102, 241, 0.12);
		color: var(--accent);
	}

	.script-card-body {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-height: 0;
	}

	.script-name {
		font-size: 0.9375rem;
		font-weight: 600;
		line-height: 1.3;
	}

	.script-desc {
		font-size: 0.8125rem;
		color: var(--text-secondary);
		line-height: 1.4;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.script-card-footer {
		padding-top: 10px;
		border-top: 1px solid var(--border);
	}

	.resource-row {
		display: flex;
		align-items: center;
		gap: 12px;
		flex-wrap: wrap;
	}

	.resource-item {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 0.6875rem;
		color: var(--text-secondary);
		font-family: 'SF Mono', 'Fira Code', 'Fira Mono', monospace;
	}

	.resource-item svg {
		flex-shrink: 0;
		opacity: 0.6;
	}

	/* ---- Empty State ---- */

	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 16px;
		padding: 64px 24px;
		text-align: center;
		color: var(--text-secondary);
	}

	.empty-icon {
		opacity: 0.3;
	}

	/* ---- Pagination ---- */

	.pagination {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		margin-top: 32px;
		padding-top: 24px;
		border-top: 1px solid var(--border);
	}

	.page-numbers {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.page-btn {
		min-width: 32px;
	}

	.page-ellipsis {
		padding: 0 4px;
		color: var(--text-secondary);
		font-size: 0.8125rem;
	}

	/* ---- Responsive ---- */

	@media (max-width: 640px) {
		.search-form {
			flex-direction: column;
		}

		.filter-row {
			flex-direction: column;
			align-items: stretch;
		}

		.type-filters {
			width: 100%;
		}

		.type-filters .btn {
			flex: 1;
		}

		.category-select {
			width: 100%;
		}

		.script-grid {
			grid-template-columns: 1fr;
		}

		.pagination {
			flex-wrap: wrap;
		}
	}
</style>
