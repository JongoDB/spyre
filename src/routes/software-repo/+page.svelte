<script lang="ts">
	import type { PageData } from './$types';
	import { addToast } from '$lib/stores/toast.svelte';

	let { data }: { data: PageData } = $props();
	let entries = $state(data.entries);
	let search = $state('');
	let tagFilter = $state('');

	function parseOsFamilies(os: string): string[] {
		return os.split(',').map(s => s.trim()).filter(Boolean);
	}

	function parseTags(tags: string | null): string[] {
		if (!tags) return [];
		return tags.split(',').map(s => s.trim()).filter(Boolean);
	}

	let allTags = $derived(() => {
		const tagSet = new Set<string>();
		for (const e of entries) {
			for (const t of parseTags(e.tags)) tagSet.add(t);
		}
		return Array.from(tagSet).sort();
	});

	let filtered = $derived(
		entries.filter((e) => {
			const matchesSearch = search === '' ||
				e.name.toLowerCase().includes(search.toLowerCase()) ||
				(e.description?.toLowerCase().includes(search.toLowerCase()));
			const matchesTag = tagFilter === '' ||
				parseTags(e.tags).includes(tagFilter);
			return matchesSearch && matchesTag;
		})
	);

	let deleteLoading = $state<Record<string, boolean>>({});

	async function handleDelete(id: string, name: string) {
		if (!confirm(`Delete software entry "${name}"?`)) return;
		deleteLoading[id] = true;
		try {
			const res = await fetch(`/api/software-repo/${id}`, { method: 'DELETE' });
			if (res.ok) {
				entries = entries.filter(e => e.id !== id);
				addToast(`Deleted "${name}".`, 'success');
			} else {
				const body = await res.json().catch(() => ({}));
				addToast(body.message ?? 'Failed to delete.', 'error');
			}
		} catch {
			addToast('Network error.', 'error');
		} finally {
			deleteLoading[id] = false;
		}
	}
</script>

<div class="software-page">
	<header class="page-header">
		<h1>Software</h1>
		<a href="/software-repo/new" class="btn btn-primary">
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
				<path d="M12 5v14M5 12h14" />
			</svg>
			Add Software
		</a>
	</header>

	<div class="filters">
		<input
			type="text"
			class="form-input search-input"
			placeholder="Search software..."
			bind:value={search}
		/>
		<select class="form-select" bind:value={tagFilter}>
			<option value="">All tags</option>
			{#each allTags() as tag}
				<option value={tag}>{tag}</option>
			{/each}
		</select>
	</div>

	{#if filtered.length === 0}
		<div class="empty-state card">
			<p>No software entries found.</p>
		</div>
	{:else}
		<div class="software-grid">
			{#each filtered as entry (entry.id)}
				<div class="software-card card">
					<div class="card-header">
						<h3 class="software-name">{entry.name}</h3>
						{#if entry.is_builtin}
							<span class="builtin-badge">built-in</span>
						{/if}
					</div>
					{#if entry.description}
						<p class="software-desc">{entry.description}</p>
					{/if}
					<div class="card-meta">
						<div class="os-badges">
							{#each parseOsFamilies(entry.os_families) as os}
								<span class="os-badge">{os}</span>
							{/each}
						</div>
						{#if entry.tags}
							<div class="tag-badges">
								{#each parseTags(entry.tags) as tag}
									<span class="tag-badge">{tag}</span>
								{/each}
							</div>
						{/if}
					</div>
					<div class="card-stats">
						<span class="stat">{entry.instruction_count} instruction{entry.instruction_count !== 1 ? 's' : ''}</span>
						<span class="stat">{entry.usage_count} usage{entry.usage_count !== 1 ? 's' : ''}</span>
					</div>
					<div class="card-actions">
						<a href="/software-repo/{entry.id}" class="btn btn-secondary btn-sm">Edit</a>
						{#if !entry.is_builtin}
							<button
								class="btn btn-danger btn-sm"
								disabled={deleteLoading[entry.id]}
								onclick={() => handleDelete(entry.id, entry.name)}
							>
								{deleteLoading[entry.id] ? 'Deleting...' : 'Delete'}
							</button>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.software-page {
		max-width: 1100px;
	}

	.page-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 24px;
	}

	.page-header h1 {
		font-size: 1.5rem;
		font-weight: 600;
	}

	.filters {
		display: flex;
		gap: 12px;
		margin-bottom: 20px;
	}

	.search-input {
		flex: 1;
		min-width: 200px;
	}

	.software-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: 16px;
	}

	.software-card {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.card-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}

	.software-name {
		font-size: 0.9375rem;
		font-weight: 600;
	}

	.software-desc {
		font-size: 0.8125rem;
		color: var(--text-secondary);
		line-height: 1.4;
	}

	.card-meta {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.os-badges, .tag-badges {
		display: flex;
		gap: 3px;
	}

	.os-badge {
		font-size: 0.625rem;
		font-weight: 600;
		text-transform: uppercase;
		padding: 2px 5px;
		border-radius: 3px;
		background-color: rgba(99, 102, 241, 0.12);
		color: var(--accent);
		letter-spacing: 0.02em;
	}

	.tag-badge {
		font-size: 0.625rem;
		padding: 2px 5px;
		border-radius: 3px;
		background-color: rgba(255, 255, 255, 0.06);
		color: var(--text-secondary);
	}

	.builtin-badge {
		font-size: 0.625rem;
		font-weight: 600;
		padding: 2px 6px;
		border-radius: 3px;
		background-color: rgba(34, 197, 94, 0.12);
		color: var(--success);
	}

	.card-stats {
		display: flex;
		gap: 12px;
	}

	.stat {
		font-size: 0.6875rem;
		color: var(--text-secondary);
	}

	.card-actions {
		display: flex;
		gap: 8px;
		margin-top: auto;
		padding-top: 10px;
		border-top: 1px solid var(--border);
	}

	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 48px 24px;
		text-align: center;
		color: var(--text-secondary);
	}
</style>
