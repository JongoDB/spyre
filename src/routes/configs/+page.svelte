<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let deleting = $state('');
	let searchQuery = $state('');
	let filterKind = $state<'all' | 'Environment' | 'EnvironmentBase'>('all');

	interface EnhancedConfigEntry {
		name: string;
		kind: 'Environment' | 'EnvironmentBase';
		description?: string;
		extends?: string;
		labels?: Record<string, string>;
		osType?: string;
		osTemplate?: string;
		hasServices: boolean;
		hasClaude: boolean;
		modifiedAt: string;
	}

	let allConfigs = $derived<EnhancedConfigEntry[]>([...data.bases, ...data.environments]);

	let filteredConfigs = $derived(() => {
		let result = allConfigs;
		if (filterKind !== 'all') {
			result = result.filter(c => c.kind === filterKind);
		}
		if (searchQuery.trim()) {
			const q = searchQuery.toLowerCase();
			result = result.filter(c =>
				c.name.toLowerCase().includes(q) ||
				(c.description ?? '').toLowerCase().includes(q)
			);
		}
		return result;
	});

	let bases = $derived(filteredConfigs().filter(c => c.kind === 'EnvironmentBase'));
	let environments = $derived(filteredConfigs().filter(c => c.kind === 'Environment'));

	async function handleDelete(name: string) {
		if (!confirm(`Delete config '${name}'? This cannot be undone.`)) return;
		deleting = name;
		try {
			const res = await fetch(`/api/configs/${encodeURIComponent(name)}`, { method: 'DELETE' });
			if (res.ok) {
				window.location.reload();
			} else {
				const body = await res.json().catch(() => ({}));
				alert(body.message ?? `Delete failed (HTTP ${res.status}).`);
			}
		} catch {
			alert('Network error.');
		} finally {
			deleting = '';
		}
	}

	function formatDate(iso: string): string {
		return new Date(iso).toLocaleDateString('en-US', {
			month: 'short', day: 'numeric', year: 'numeric',
			hour: '2-digit', minute: '2-digit'
		});
	}
</script>

<div class="configs-page">
	<header class="page-header">
		<div class="header-row">
			<div>
				<h1>Configs</h1>
				<p class="subtitle">File-based environment definitions with inheritance. Stored in <code>configs/</code>.</p>
			</div>
			<a href="/configs/new" class="btn btn-primary">
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<line x1="12" y1="5" x2="12" y2="19" />
					<line x1="5" y1="12" x2="19" y2="12" />
				</svg>
				New Config
			</a>
		</div>
	</header>

	<!-- Search and Filters -->
	<div class="search-bar">
		<input
			type="text"
			class="form-input search-input"
			placeholder="Search configs..."
			bind:value={searchQuery}
		/>
		<select class="form-select filter-select" bind:value={filterKind}>
			<option value="all">All Kinds</option>
			<option value="Environment">Environment</option>
			<option value="EnvironmentBase">Base</option>
		</select>
	</div>

	{#if filteredConfigs().length === 0}
		<div class="empty-state card">
			<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="empty-icon">
				<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
				<polyline points="14 2 14 8 20 8" />
				<line x1="16" y1="13" x2="8" y2="13" />
				<line x1="16" y1="17" x2="8" y2="17" />
			</svg>
			{#if searchQuery || filterKind !== 'all'}
				<p>No configs match your search.</p>
			{:else}
				<p>No YAML configs found.</p>
				<p class="empty-hint">Create a new config or add <code>.yaml</code> files to the <code>configs/</code> directory.</p>
			{/if}
		</div>
	{/if}

	{#if bases.length > 0}
		<section class="config-section">
			<h2 class="section-title">Base Configs</h2>
			<div class="config-grid">
				{#each bases as config (config.name)}
					{@render configCard(config)}
				{/each}
			</div>
		</section>
	{/if}

	{#if environments.length > 0}
		<section class="config-section">
			<h2 class="section-title">Environment Configs</h2>
			<div class="config-grid">
				{#each environments as config (config.name)}
					{@render configCard(config)}
				{/each}
			</div>
		</section>
	{/if}
</div>

{#snippet configCard(config: EnhancedConfigEntry)}
	<a href="/configs/{encodeURIComponent(config.name)}" class="config-card card">
		<div class="config-header">
			<span class="config-name">{config.name}</span>
			<span class="kind-badge" class:base={config.kind === 'EnvironmentBase'}>
				{config.kind === 'EnvironmentBase' ? 'BASE' : 'ENV'}
			</span>
		</div>

		{#if config.description}
			<p class="config-desc">{config.description}</p>
		{/if}

		<div class="config-badges">
			{#if config.osType}
				<span class="info-badge">{config.osType}</span>
			{/if}
			{#if config.extends}
				<span class="info-badge extends-badge">extends {config.extends}</span>
			{/if}
			{#if config.hasServices}
				<span class="info-badge services-badge">services</span>
			{/if}
			{#if config.hasClaude}
				<span class="info-badge claude-badge">claude</span>
			{/if}
		</div>

		{#if config.labels && Object.keys(config.labels).length > 0}
			<div class="config-labels">
				{#each Object.entries(config.labels) as [key, val]}
					<span class="label-tag">{key}: {val}</span>
				{/each}
			</div>
		{/if}

		<div class="config-footer">
			<span class="config-date">{formatDate(config.modifiedAt)}</span>
			<button
				type="button"
				class="btn btn-small btn-danger"
				disabled={deleting === config.name}
				onclick={(e: MouseEvent) => { e.stopPropagation(); e.preventDefault(); handleDelete(config.name); }}
			>
				{deleting === config.name ? 'Deleting...' : 'Delete'}
			</button>
		</div>
	</a>
{/snippet}

<style>
	.configs-page {
		max-width: 960px;
	}

	.page-header {
		margin-bottom: 20px;
	}

	.header-row {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 16px;
	}

	.page-header h1 {
		font-size: 1.5rem;
		font-weight: 600;
		margin-bottom: 4px;
	}

	.subtitle {
		color: var(--text-secondary);
		font-size: 0.875rem;
	}

	.subtitle code {
		font-size: 0.8125rem;
		background-color: rgba(255, 255, 255, 0.06);
		padding: 1px 5px;
		border-radius: 3px;
	}

	/* ---- Search ---- */

	.search-bar {
		display: flex;
		gap: 10px;
		margin-bottom: 20px;
	}

	.search-input {
		flex: 1;
	}

	.filter-select {
		max-width: 180px;
	}

	/* ---- Empty state ---- */

	.empty-state {
		text-align: center;
		padding: 48px 20px;
		color: var(--text-secondary);
	}

	.empty-icon {
		opacity: 0.3;
		margin-bottom: 16px;
	}

	.empty-state p {
		font-size: 0.9375rem;
		margin-bottom: 4px;
	}

	.empty-hint {
		font-size: 0.8125rem;
		opacity: 0.7;
	}

	.empty-hint code {
		font-size: 0.75rem;
		background-color: rgba(255, 255, 255, 0.06);
		padding: 1px 5px;
		border-radius: 3px;
	}

	/* ---- Sections ---- */

	.config-section {
		margin-bottom: 28px;
	}

	.section-title {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin-bottom: 12px;
	}

	.config-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: 14px;
	}

	/* ---- Config card ---- */

	.config-card {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 16px;
		text-decoration: none;
		color: inherit;
		transition: border-color var(--transition);
	}

	.config-card:hover {
		border-color: var(--accent);
	}

	.config-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}

	.config-name {
		font-weight: 600;
		font-size: 0.9375rem;
		font-family: 'SF Mono', 'Fira Code', 'Fira Mono', monospace;
	}

	.kind-badge {
		font-size: 0.5625rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		padding: 2px 6px;
		border-radius: 3px;
		background-color: rgba(99, 102, 241, 0.15);
		color: var(--accent);
		flex-shrink: 0;
	}

	.kind-badge.base {
		background-color: rgba(251, 191, 36, 0.15);
		color: #fbbf24;
	}

	.config-desc {
		font-size: 0.8125rem;
		color: var(--text-secondary);
		line-height: 1.4;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.config-badges {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}

	.info-badge {
		font-size: 0.625rem;
		font-weight: 500;
		padding: 2px 6px;
		border-radius: 3px;
		background-color: rgba(255, 255, 255, 0.06);
		color: var(--text-secondary);
	}

	.extends-badge {
		background-color: rgba(251, 191, 36, 0.1);
		color: #fbbf24;
	}

	.services-badge {
		background-color: rgba(34, 197, 94, 0.1);
		color: var(--success);
	}

	.claude-badge {
		background-color: rgba(99, 102, 241, 0.1);
		color: var(--accent);
	}

	.config-labels {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}

	.label-tag {
		font-size: 0.625rem;
		font-family: 'SF Mono', 'Fira Code', 'Fira Mono', monospace;
		background-color: rgba(255, 255, 255, 0.05);
		padding: 2px 6px;
		border-radius: 3px;
		color: var(--text-secondary);
	}

	.config-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-top: 4px;
		padding-top: 10px;
		border-top: 1px solid var(--border);
	}

	.config-date {
		font-size: 0.6875rem;
		color: var(--text-secondary);
		opacity: 0.6;
	}

	.btn-small {
		font-size: 0.6875rem;
		padding: 4px 10px;
	}

	.btn-danger {
		color: var(--error);
		border-color: rgba(239, 68, 68, 0.3);
	}

	.btn-danger:hover {
		background-color: rgba(239, 68, 68, 0.1);
	}
</style>
