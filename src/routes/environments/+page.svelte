<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let search = $state('');
	let statusFilter = $state('all');

	let filtered = $derived(
		data.environments.filter((env) => {
			const matchesSearch =
				search === '' ||
				env.name.toLowerCase().includes(search.toLowerCase());
			const matchesStatus =
				statusFilter === 'all' || env.status === statusFilter;
			return matchesSearch && matchesStatus;
		})
	);

	let actionLoading = $state<Record<string, boolean>>({});

	async function performAction(envId: string, action: 'start' | 'stop' | 'delete') {
		actionLoading[envId] = true;

		try {
			const res = await fetch(`/api/environments/${envId}/${action}`, {
				method: 'POST'
			});

			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				alert(body.message ?? `Failed to ${action} environment.`);
				return;
			}

			// Reload page to reflect new state
			window.location.reload();
		} catch {
			alert(`Network error while trying to ${action} environment.`);
		} finally {
			actionLoading[envId] = false;
		}
	}
</script>

<div class="environments-page">
	<header class="page-header">
		<div class="header-left">
			<h1>Environments</h1>
			{#if !data.proxmoxConnected}
				<span class="offline-badge badge badge-error">Proxmox offline</span>
			{/if}
		</div>
		<a href="/environments/create" class="btn btn-primary">
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
				<path d="M12 5v14M5 12h14" />
			</svg>
			New Environment
		</a>
	</header>

	<!-- Filters -->
	<div class="filters">
		<input
			type="text"
			class="form-input search-input"
			placeholder="Search environments..."
			bind:value={search}
		/>
		<select class="form-select status-select" bind:value={statusFilter}>
			<option value="all">All statuses</option>
			<option value="running">Running</option>
			<option value="stopped">Stopped</option>
			<option value="provisioning">Provisioning</option>
			<option value="error">Error</option>
		</select>
	</div>

	<!-- Environment cards -->
	{#if filtered.length === 0}
		<div class="empty-state card">
			{#if data.environments.length === 0}
				<p>No environments have been created yet.</p>
				<a href="/environments/create" class="btn btn-primary">Create Environment</a>
			{:else}
				<p>No environments match your filters.</p>
			{/if}
		</div>
	{:else}
		<div class="env-grid">
			{#each filtered as env (env.id)}
				<div class="env-card card">
					<div class="env-card-header">
						<h3 class="env-name">{env.name}</h3>
						<span class="badge badge-{env.status}">{env.status}</span>
					</div>

					<div class="env-card-details">
						<div class="detail-row">
							<span class="detail-label">Type</span>
							<span class="detail-value">{env.type}</span>
						</div>
						{#if env.ip_address}
							<div class="detail-row">
								<span class="detail-label">IP</span>
								<code class="detail-value ip">{env.ip_address}</code>
							</div>
						{/if}
						{#if env.vmid}
							<div class="detail-row">
								<span class="detail-label">VMID</span>
								<span class="detail-value">{env.vmid}</span>
							</div>
						{/if}
						<div class="detail-row">
							<span class="detail-label">Node</span>
							<span class="detail-value">{env.node}</span>
						</div>
					</div>

					<div class="env-card-actions">
						{#if env.status === 'stopped'}
							<button
								class="btn btn-secondary btn-sm"
								disabled={actionLoading[env.id]}
								onclick={() => performAction(env.id, 'start')}
							>
								{actionLoading[env.id] ? 'Starting...' : 'Start'}
							</button>
						{/if}
						{#if env.status === 'running'}
							<button
								class="btn btn-secondary btn-sm"
								disabled={actionLoading[env.id]}
								onclick={() => performAction(env.id, 'stop')}
							>
								{actionLoading[env.id] ? 'Stopping...' : 'Stop'}
							</button>
						{/if}
						<button
							class="btn btn-danger btn-sm"
							disabled={actionLoading[env.id]}
							onclick={() => {
								if (confirm(`Delete environment "${env.name}"?`)) {
									performAction(env.id, 'delete');
								}
							}}
						>
							Delete
						</button>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.environments-page {
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

	.offline-badge {
		font-size: 0.6875rem;
	}

	/* ---- Filters ---- */

	.filters {
		display: flex;
		gap: 12px;
		margin-bottom: 20px;
		flex-wrap: wrap;
	}

	.search-input {
		flex: 1;
		min-width: 200px;
	}

	.status-select {
		min-width: 160px;
	}

	/* ---- Grid ---- */

	.env-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
		gap: 16px;
	}

	/* ---- Card ---- */

	.env-card {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.env-card-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}

	.env-name {
		font-size: 0.9375rem;
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.env-card-details {
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

	.detail-value.ip {
		font-size: 0.75rem;
		background-color: rgba(255, 255, 255, 0.04);
		padding: 1px 8px;
		border-radius: var(--radius-sm);
	}

	.env-card-actions {
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
</style>
