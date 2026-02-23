<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import type { PageData } from './$types';
	import type { Template } from '$lib/types/template';

	let { data }: { data: PageData } = $props();

	let search = $state('');
	let deleteConfirmId = $state<string | null>(null);
	let actionLoading = $state<Record<string, boolean>>({});
	let errorMessage = $state('');

	let filtered = $derived(
		data.templates.filter((t: Template) => {
			if (search === '') return true;
			const q = search.toLowerCase();
			const tags = t.tags ? t.tags.toLowerCase() : '';
			return (
				t.name.toLowerCase().includes(q) ||
				(t.description?.toLowerCase().includes(q) ?? false) ||
				tags.includes(q)
			);
		})
	);

	function parseTags(tags: string | null): string[] {
		if (!tags) return [];
		return tags.split(',').map(s => s.trim()).filter(Boolean);
	}

	function formatMemory(mb: number | null): string {
		if (mb == null) return '--';
		if (mb >= 1024) return `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)} GB`;
		return `${mb} MB`;
	}

	async function handleDelete(id: string) {
		actionLoading[id] = true;
		errorMessage = '';

		try {
			const res = await fetch(`/api/templates/${id}`, { method: 'DELETE' });
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				errorMessage = body.message ?? `Failed to delete template (HTTP ${res.status}).`;
				return;
			}
			deleteConfirmId = null;
			await invalidateAll();
		} catch {
			errorMessage = 'Network error while deleting template.';
		} finally {
			actionLoading[id] = false;
		}
	}

	async function handleDuplicate(id: string) {
		actionLoading[id] = true;
		errorMessage = '';

		try {
			const res = await fetch(`/api/templates/${id}/duplicate`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({})
			});

			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				errorMessage = body.message ?? `Failed to duplicate template (HTTP ${res.status}).`;
				return;
			}
			await invalidateAll();
		} catch {
			errorMessage = 'Network error while duplicating template.';
		} finally {
			actionLoading[id] = false;
		}
	}
</script>

<div class="templates-page">
	<header class="page-header">
		<div class="header-left">
			<h1>Templates</h1>
			<span class="count-badge">{data.templates.length}</span>
		</div>
		<a href="/templates/new" class="btn btn-primary">
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
				<path d="M12 5v14M5 12h14" />
			</svg>
			New Template
		</a>
	</header>

	{#if errorMessage}
		<div class="alert alert-error">
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<circle cx="12" cy="12" r="10" />
				<line x1="15" y1="9" x2="9" y2="15" />
				<line x1="9" y1="9" x2="15" y2="15" />
			</svg>
			<span>{errorMessage}</span>
			<button class="alert-dismiss" onclick={() => errorMessage = ''}>
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
					<path d="M18 6L6 18M6 6l12 12" />
				</svg>
			</button>
		</div>
	{/if}

	<div class="filters">
		<input
			type="text"
			class="form-input search-input"
			placeholder="Search by name, description, or tags..."
			bind:value={search}
		/>
	</div>

	{#if filtered.length === 0}
		<div class="empty-state card">
			{#if data.templates.length === 0}
				<div class="empty-icon">
					<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
						<rect x="3" y="3" width="18" height="18" rx="2" />
						<path d="M3 9h18" />
						<path d="M9 21V9" />
					</svg>
				</div>
				<p class="empty-title">No templates yet</p>
				<p class="empty-desc">Templates define the blueprint for your development environments.</p>
				<a href="/templates/new" class="btn btn-primary">Create First Template</a>
			{:else}
				<p class="empty-desc">No templates match your search.</p>
			{/if}
		</div>
	{:else}
		<div class="template-grid">
			{#each filtered as tpl (tpl.id)}
				<div class="template-card card">
					<div class="card-header">
						<h3 class="card-name">{tpl.name}</h3>
						<span class="type-badge" class:type-vm={tpl.type === 'vm'}>
							{tpl.type.toUpperCase()}
						</span>
					</div>

					{#if tpl.description}
						<p class="card-desc">{tpl.description}</p>
					{/if}

					{#if tpl.os_template}
						<div class="card-meta">
							<span class="meta-label">OS</span>
							<code class="meta-value">{tpl.os_template}</code>
						</div>
					{/if}

					<div class="card-resources">
						{#if tpl.cores != null}
							<span class="resource-chip">
								<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
									<rect x="4" y="4" width="16" height="16" rx="2" />
									<rect x="9" y="9" width="6" height="6" />
								</svg>
								{tpl.cores} cores
							</span>
						{/if}
						{#if tpl.memory != null}
							<span class="resource-chip">
								<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
									<path d="M6 19v-3m4 3v-6m4 6V9m4 10V5" />
								</svg>
								{formatMemory(tpl.memory)}
							</span>
						{/if}
						{#if tpl.disk != null}
							<span class="resource-chip">
								<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
									<ellipse cx="12" cy="5" rx="9" ry="3" />
									<path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
									<path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
								</svg>
								{tpl.disk} GB
							</span>
						{/if}
					</div>

					{#if parseTags(tpl.tags).length > 0}
						<div class="card-tags">
							{#each parseTags(tpl.tags) as tag}
								<span class="tag-badge">{tag}</span>
							{/each}
						</div>
					{/if}

					<div class="card-actions">
						<a href="/templates/{tpl.id}" class="btn btn-secondary btn-sm">Edit</a>
						<button
							class="btn btn-secondary btn-sm"
							disabled={actionLoading[tpl.id]}
							onclick={() => handleDuplicate(tpl.id)}
						>
							{actionLoading[tpl.id] ? 'Duplicating...' : 'Duplicate'}
						</button>
						{#if deleteConfirmId === tpl.id}
							<button
								class="btn btn-danger btn-sm"
								disabled={actionLoading[tpl.id]}
								onclick={() => handleDelete(tpl.id)}
							>
								{actionLoading[tpl.id] ? 'Deleting...' : 'Confirm Delete'}
							</button>
							<button
								class="btn btn-secondary btn-sm"
								onclick={() => deleteConfirmId = null}
							>
								Cancel
							</button>
						{:else}
							<button
								class="btn btn-danger btn-sm"
								onclick={() => deleteConfirmId = tpl.id}
							>
								Delete
							</button>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.templates-page {
		max-width: 1100px;
	}

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
		gap: 10px;
	}

	.page-header h1 {
		font-size: 1.5rem;
		font-weight: 600;
	}

	.count-badge {
		font-size: 0.6875rem;
		font-weight: 600;
		background-color: rgba(99, 102, 241, 0.12);
		color: var(--accent);
		padding: 2px 8px;
		border-radius: 9999px;
	}

	/* ---- Alert ---- */

	.alert {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		padding: 12px 16px;
		border-radius: var(--radius);
		margin-bottom: 20px;
		font-size: 0.8125rem;
		line-height: 1.5;
	}

	.alert svg {
		flex-shrink: 0;
		margin-top: 1px;
	}

	.alert-error {
		background-color: rgba(239, 68, 68, 0.08);
		border: 1px solid rgba(239, 68, 68, 0.2);
		color: var(--error);
	}

	.alert-dismiss {
		margin-left: auto;
		background: none;
		border: none;
		color: var(--error);
		opacity: 0.6;
		padding: 2px;
		cursor: pointer;
		transition: opacity var(--transition);
	}

	.alert-dismiss:hover {
		opacity: 1;
	}

	/* ---- Filters ---- */

	.filters {
		margin-bottom: 20px;
	}

	.search-input {
		width: 100%;
		max-width: 400px;
	}

	/* ---- Grid ---- */

	.template-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
		gap: 16px;
	}

	/* ---- Card ---- */

	.template-card {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.card-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}

	.card-name {
		font-size: 0.9375rem;
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.type-badge {
		flex-shrink: 0;
		font-size: 0.625rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		padding: 2px 8px;
		border-radius: var(--radius-sm);
		background-color: rgba(34, 197, 94, 0.1);
		color: var(--success);
	}

	.type-badge.type-vm {
		background-color: rgba(99, 102, 241, 0.1);
		color: var(--accent);
	}

	.card-desc {
		font-size: 0.8125rem;
		color: var(--text-secondary);
		line-height: 1.5;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.card-meta {
		display: flex;
		align-items: baseline;
		gap: 8px;
		font-size: 0.8125rem;
	}

	.meta-label {
		color: var(--text-secondary);
		font-weight: 500;
		flex-shrink: 0;
	}

	.meta-value {
		font-size: 0.75rem;
		background-color: rgba(255, 255, 255, 0.04);
		padding: 1px 8px;
		border-radius: var(--radius-sm);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* ---- Resources ---- */

	.card-resources {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.resource-chip {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--text-secondary);
		background-color: rgba(255, 255, 255, 0.03);
		border: 1px solid var(--border);
		padding: 2px 8px;
		border-radius: var(--radius-sm);
	}

	.resource-chip svg {
		opacity: 0.6;
	}

	/* ---- Tags ---- */

	.card-tags {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}

	.tag-badge {
		font-size: 0.6875rem;
		font-weight: 500;
		color: var(--accent);
		background-color: rgba(99, 102, 241, 0.08);
		padding: 1px 8px;
		border-radius: 9999px;
	}

	/* ---- Actions ---- */

	.card-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: auto;
		padding-top: 12px;
		border-top: 1px solid var(--border);
	}

	/* ---- Empty state ---- */

	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		padding: 48px 24px;
		text-align: center;
	}

	.empty-icon {
		color: var(--text-secondary);
		opacity: 0.3;
		margin-bottom: 4px;
	}

	.empty-title {
		font-size: 1.125rem;
		font-weight: 600;
	}

	.empty-desc {
		color: var(--text-secondary);
		font-size: 0.875rem;
		max-width: 400px;
	}
</style>
