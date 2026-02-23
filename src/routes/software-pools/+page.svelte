<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let pools = $state(data.pools);
	let deleting = $state<Record<string, boolean>>({});
	let errorMessage = $state('');

	async function deletePool(id: string, name: string) {
		if (!confirm(`Delete software pool "${name}"? This cannot be undone.`)) return;

		deleting[id] = true;
		errorMessage = '';

		try {
			const res = await fetch(`/api/software-pools/${id}`, {
				method: 'DELETE'
			});

			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				errorMessage = body.message ?? `Failed to delete pool (HTTP ${res.status}).`;
				return;
			}

			pools = pools.filter((p) => p.id !== id);
		} catch {
			errorMessage = 'Network error. Please check your connection and try again.';
		} finally {
			deleting[id] = false;
		}
	}
</script>

<div class="pools-page">
	<header class="page-header">
		<div class="header-left">
			<h1>Software Pools</h1>
		</div>
		<a href="/software-pools/new" class="btn btn-primary">
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
				<path d="M12 5v14M5 12h14" />
			</svg>
			New Software Pool
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
		</div>
	{/if}

	{#if pools.length === 0}
		<div class="empty-state card">
			<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
				<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
				<polyline points="3.27 6.96 12 12.01 20.73 6.96" />
				<line x1="12" y1="22.08" x2="12" y2="12" />
			</svg>
			<p>No software pools have been created yet.</p>
			<p class="empty-hint">Software pools define reusable sets of packages, scripts, and files that can be attached to templates.</p>
			<a href="/software-pools/new" class="btn btn-primary">Create Software Pool</a>
		</div>
	{:else}
		<div class="pool-grid">
			{#each pools as pool (pool.id)}
				<div class="pool-card card">
					<div class="pool-card-header">
						<h3 class="pool-name">{pool.name}</h3>
						<span class="item-count-badge">{pool.item_count} item{pool.item_count !== 1 ? 's' : ''}</span>
					</div>

					{#if pool.description}
						<p class="pool-description">{pool.description}</p>
					{/if}

					<div class="pool-card-details">
						<div class="detail-row">
							<span class="detail-label">Used by</span>
							<span class="detail-value">{pool.usage_count} template{pool.usage_count !== 1 ? 's' : ''}</span>
						</div>
						<div class="detail-row">
							<span class="detail-label">Updated</span>
							<span class="detail-value">{new Date(pool.updated_at).toLocaleDateString()}</span>
						</div>
					</div>

					<div class="pool-card-actions">
						<a href="/software-pools/{pool.id}" class="btn btn-secondary btn-sm">Edit</a>
						<button
							class="btn btn-danger btn-sm"
							disabled={deleting[pool.id]}
							onclick={() => deletePool(pool.id, pool.name)}
						>
							{deleting[pool.id] ? 'Deleting...' : 'Delete'}
						</button>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.pools-page {
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
		gap: 12px;
	}

	.page-header h1 {
		font-size: 1.5rem;
		font-weight: 600;
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

	/* ---- Grid ---- */

	.pool-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
		gap: 16px;
	}

	/* ---- Card ---- */

	.pool-card {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.pool-card-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}

	.pool-name {
		font-size: 0.9375rem;
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.item-count-badge {
		display: inline-flex;
		align-items: center;
		padding: 2px 10px;
		font-size: 0.75rem;
		font-weight: 600;
		border-radius: 9999px;
		background-color: rgba(99, 102, 241, 0.12);
		color: var(--accent);
		white-space: nowrap;
		flex-shrink: 0;
	}

	.pool-description {
		font-size: 0.8125rem;
		color: var(--text-secondary);
		line-height: 1.5;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.pool-card-details {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.detail-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: 0.8125rem;
	}

	.detail-label {
		color: var(--text-secondary);
	}

	.detail-value {
		font-weight: 500;
	}

	.pool-card-actions {
		display: flex;
		gap: 8px;
		margin-top: auto;
		padding-top: 12px;
		border-top: 1px solid var(--border);
	}

	/* ---- Empty state ---- */

	.empty-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 16px;
		padding: 48px 24px;
		text-align: center;
		color: var(--text-secondary);
	}

	.empty-state svg {
		opacity: 0.4;
	}

	.empty-hint {
		font-size: 0.8125rem;
		max-width: 400px;
		opacity: 0.7;
	}
</style>
