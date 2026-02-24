<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import type { PageData } from './$types';
	import type { Environment } from '$lib/types/environment';
	import { addToast } from '$lib/stores/toast.svelte';
	import ResourceBar from '$lib/components/ResourceBar.svelte';
	import ProvisioningProgressCompact from '$lib/components/ProvisioningProgressCompact.svelte';

	interface ResourceMetrics {
		cpuPercent: number;
		memUsed: number;
		memTotal: number;
		diskUsed: number;
		diskTotal: number;
		netIn: number;
		netOut: number;
		uptime: number;
	}

	interface HealthStatus {
		state: 'healthy' | 'degraded' | 'unreachable';
		responseMs: number | null;
		lastChecked: string;
	}

	interface ProvisioningLiveData {
		currentPhase: string | null;
		percentComplete: number;
		hasError: boolean;
	}

	interface EnvironmentLiveData {
		id: string;
		status: string;
		ipAddress: string | null;
		resources: ResourceMetrics | null;
		health: HealthStatus | null;
		provisioning: ProvisioningLiveData | null;
	}

	let { data }: { data: PageData } = $props();

	let environments = $state<Environment[]>(data.environments);
	let search = $state('');
	let statusFilter = $state('all');

	// Live data maps
	let resourceMap = $state<Map<string, ResourceMetrics>>(new Map());
	let healthMap = $state<Map<string, HealthStatus>>(new Map());
	let provisioningMap = $state<Map<string, ProvisioningLiveData>>(new Map());
	let previousStatuses = $state<Map<string, string>>(new Map(data.environments.map(e => [e.id, e.status])));

	// Bulk selection
	let selectedIds = $state<Set<string>>(new Set());
	let bulkLoading = $state(false);

	let filtered = $derived(
		environments.filter((env) => {
			const matchesSearch =
				search === '' ||
				env.name.toLowerCase().includes(search.toLowerCase());
			const matchesStatus =
				statusFilter === 'all' || env.status === statusFilter;
			return matchesSearch && matchesStatus;
		})
	);

	let allFilteredSelected = $derived(
		filtered.length > 0 && filtered.every((e) => selectedIds.has(e.id))
	);

	let actionLoading = $state<Record<string, boolean>>({});

	// SSE connection
	let eventSource: EventSource | null = null;

	function connectSSE() {
		eventSource = new EventSource('/api/environments/stream');
		eventSource.onmessage = (event) => {
			try {
				const liveData: EnvironmentLiveData[] = JSON.parse(event.data);
				const newResourceMap = new Map<string, ResourceMetrics>();
				const newHealthMap = new Map<string, HealthStatus>();
				const newProvisioningMap = new Map<string, ProvisioningLiveData>();

				for (const item of liveData) {
					// Update environment status from live data
					const env = environments.find((e) => e.id === item.id);
					if (env && env.status !== item.status) {
						// Toast when provisioning completes
						const prev = previousStatuses.get(item.id);
						if (prev === 'provisioning' && item.status !== 'provisioning') {
							if (item.status === 'running') {
								addToast(`"${env.name}" is ready!`, 'success');
							} else if (item.status === 'error') {
								addToast(`"${env.name}" provisioning failed.`, 'error');
							}
						}
						previousStatuses.set(item.id, item.status);
						env.status = item.status as Environment['status'];
					}
					if (env && item.ipAddress && !env.ip_address) {
						env.ip_address = item.ipAddress;
					}
					if (item.resources) {
						newResourceMap.set(item.id, item.resources);
					}
					if (item.health) {
						newHealthMap.set(item.id, item.health);
					}
					if (item.provisioning) {
						newProvisioningMap.set(item.id, item.provisioning);
					}
				}

				// Reassign to trigger reactivity
				environments = [...environments];
				resourceMap = newResourceMap;
				healthMap = newHealthMap;
				provisioningMap = newProvisioningMap;
			} catch {
				// Ignore parse errors
			}
		};
		eventSource.onerror = () => {
			// EventSource will auto-reconnect
		};
	}

	onMount(() => {
		connectSSE();
	});

	onDestroy(() => {
		eventSource?.close();
		eventSource = null;
	});

	async function performAction(envId: string, action: 'start' | 'stop' | 'delete') {
		actionLoading[envId] = true;

		try {
			let res: Response;
			if (action === 'delete') {
				res = await fetch(`/api/environments/${envId}`, {
					method: 'DELETE'
				});
			} else {
				res = await fetch(`/api/environments/${envId}/${action}`, {
					method: 'POST'
				});
			}

			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				addToast(body.message ?? `Failed to ${action} environment.`, 'error');
				return;
			}

			addToast(`Environment ${action === 'delete' ? 'deleted' : action === 'start' ? 'started' : 'stopped'} successfully.`, 'success');

			if (action === 'delete') {
				environments = environments.filter((e) => e.id !== envId);
				selectedIds.delete(envId);
				selectedIds = new Set(selectedIds);
			} else {
				// Immediately update the local environment status so the UI
				// reflects the change without waiting for the next SSE poll (30s)
				const env = environments.find((e) => e.id === envId);
				if (env) {
					env.status = action === 'start' ? 'running' : 'stopped';
					environments = [...environments];
				}
			}
		} catch {
			addToast(`Network error while trying to ${action} environment.`, 'error');
		} finally {
			actionLoading[envId] = false;
		}
	}

	// Bulk selection helpers
	function toggleSelection(envId: string) {
		const next = new Set(selectedIds);
		if (next.has(envId)) {
			next.delete(envId);
		} else {
			next.add(envId);
		}
		selectedIds = next;
	}

	function toggleSelectAll() {
		if (allFilteredSelected) {
			selectedIds = new Set();
		} else {
			selectedIds = new Set(filtered.map((e) => e.id));
		}
	}

	async function performBulkAction(action: 'start' | 'stop' | 'destroy') {
		if (selectedIds.size === 0) return;

		if (action === 'destroy' && !confirm(`Delete ${selectedIds.size} environment(s)? This cannot be undone.`)) {
			return;
		}

		bulkLoading = true;
		try {
			const res = await fetch('/api/environments/bulk', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action, ids: Array.from(selectedIds) })
			});

			if (res.ok) {
				const body = await res.json();
				const results: Array<{ id: string; success: boolean; error?: string }> = body.results;
				const succeeded = results.filter((r) => r.success).length;
				const failed = results.filter((r) => !r.success);

				const verb = action === 'destroy' ? 'Deleted' : action === 'start' ? 'Started' : 'Stopped';

				if (succeeded > 0) {
					addToast(`${verb} ${succeeded} environment${succeeded > 1 ? 's' : ''}.`, 'success');
				}
				if (failed.length > 0) {
					addToast(`${failed.length} failed: ${failed[0].error ?? 'Unknown error'}${failed.length > 1 ? ` (+${failed.length - 1} more)` : ''}`, 'error');
				}

				// Update local state immediately so UI reflects changes
				if (action === 'destroy') {
					const destroyedIds = new Set(results.filter((r) => r.success).map((r) => r.id));
					environments = environments.filter((e) => !destroyedIds.has(e.id));
				} else {
					const successIds = new Set(results.filter((r) => r.success).map((r) => r.id));
					const newStatus = action === 'start' ? 'running' : 'stopped';
					for (const env of environments) {
						if (successIds.has(env.id)) {
							env.status = newStatus as Environment['status'];
						}
					}
					environments = [...environments];
				}

				selectedIds = new Set();
			} else {
				const body = await res.json().catch(() => ({}));
				addToast(body.message ?? 'Bulk action failed.', 'error');
			}
		} catch {
			addToast('Network error during bulk action.', 'error');
		} finally {
			bulkLoading = false;
		}
	}

	function formatBytes(bytes: number): string {
		if (bytes < 1024) return `${bytes}B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
		if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)}MB`;
		return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
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
		{#if environments.length > 0}
			<button
				class="select-toggle"
				class:active={selectedIds.size > 0}
				onclick={toggleSelectAll}
			>
				{#if allFilteredSelected}
					Deselect All
				{:else}
					Select All
				{/if}
			</button>
		{/if}
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
				{@const resources = resourceMap.get(env.id)}
				{@const health = healthMap.get(env.id)}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="env-card card"
					class:selected={selectedIds.has(env.id)}
					onclick={(e) => {
						const target = e.target as HTMLElement;
						if (!target.closest('button, a, input, select')) {
							toggleSelection(env.id);
						}
					}}
				>
					{#if selectedIds.has(env.id)}
						<div class="selected-indicator">
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
								<path d="M20 6L9 17l-5-5" />
							</svg>
						</div>
					{/if}

					<div class="env-card-header">
						<h3 class="env-name">{env.name}</h3>
						<div class="status-group">
							{#if health}
								<span
									class="health-dot health-{health.state}"
									title="{health.state}{health.responseMs != null ? ` (${health.responseMs}ms)` : ''}"
								></span>
							{/if}
							<span class="badge badge-{env.status}">{env.status}</span>
						</div>
					</div>

					<div class="env-card-details">
						<div class="detail-row">
							<span class="detail-label">Type</span>
							<span class="detail-value">{env.type}</span>
						</div>
						{#if env.ip_address}
							{@const meta = env.metadata ? JSON.parse(env.metadata) : null}
							<div class="detail-row">
								<span class="detail-label">IP</span>
								<span class="detail-value ip-row">
									<code class="ip">{env.ip_address}</code>
									{#if meta?.community_script?.interface_port}
										<a href="http://{env.ip_address}:{meta.community_script.interface_port}"
											target="_blank"
											rel="noopener noreferrer"
											class="port-link">
											:{meta.community_script.interface_port}
										</a>
									{/if}
								</span>
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

					<!-- Provisioning progress for provisioning environments -->
					{#if env.status === 'provisioning'}
						{@const prov = provisioningMap.get(env.id)}
						<div class="env-provisioning">
							<ProvisioningProgressCompact
								percentComplete={prov?.percentComplete ?? 0}
								currentPhase={prov?.currentPhase ?? null}
								hasError={prov?.hasError ?? false}
							/>
						</div>
					{/if}

					<!-- Resource bars for running environments -->
					{#if resources}
						<div class="env-resources">
							<ResourceBar
								label="CPU"
								value={resources.cpuPercent}
								max={100}
								warnAt={80}
								critAt={90}
							/>
							<ResourceBar
								label="Mem"
								value={resources.memUsed}
								max={resources.memTotal}
								warnAt={80}
								critAt={95}
							/>
							<ResourceBar
								label="Disk"
								value={resources.diskUsed}
								max={resources.diskTotal}
								warnAt={80}
								critAt={90}
							/>
						</div>
					{/if}

					<div class="env-card-actions">
						{#if env.status === 'running'}
							<a href="/environments/{env.id}" class="btn btn-primary btn-sm">
								Open
							</a>
							<button
								class="btn btn-secondary btn-sm"
								disabled={actionLoading[env.id]}
								onclick={() => performAction(env.id, 'stop')}
							>
								{actionLoading[env.id] ? 'Stopping...' : 'Stop'}
							</button>
						{/if}
						{#if env.status === 'stopped'}
							<a href="/environments/{env.id}" class="btn btn-secondary btn-sm">
								Open
							</a>
							<button
								class="btn btn-secondary btn-sm"
								disabled={actionLoading[env.id]}
								onclick={() => performAction(env.id, 'start')}
							>
								{actionLoading[env.id] ? 'Starting...' : 'Start'}
							</button>
						{/if}
						{#if env.status === 'running' || env.status === 'provisioning'}
							<button
								class="btn btn-danger btn-sm"
								disabled
								title="Stop the environment before deleting"
							>
								Delete
							</button>
						{:else}
							<button
								class="btn btn-danger btn-sm"
								disabled={actionLoading[env.id]}
								onclick={() => {
									if (confirm(`Delete environment "${env.name}"? This cannot be undone.`)) {
										performAction(env.id, 'delete');
									}
								}}
							>
								{actionLoading[env.id] ? 'Deleting...' : 'Delete'}
							</button>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<!-- Bulk action bar -->
{#if selectedIds.size > 0}
	<div class="bulk-bar">
		<div class="bulk-left">
			<span class="bulk-count">{selectedIds.size}</span>
			<span class="bulk-label">environment{selectedIds.size > 1 ? 's' : ''} selected</span>
		</div>
		<div class="bulk-actions">
			<button
				class="btn btn-secondary btn-sm"
				disabled={bulkLoading}
				onclick={() => performBulkAction('start')}
			>
				{bulkLoading ? 'Working...' : 'Start'}
			</button>
			<button
				class="btn btn-secondary btn-sm"
				disabled={bulkLoading}
				onclick={() => performBulkAction('stop')}
			>
				{bulkLoading ? 'Working...' : 'Stop'}
			</button>
			<button
				class="btn btn-danger btn-sm"
				disabled={bulkLoading}
				onclick={() => performBulkAction('destroy')}
			>
				{bulkLoading ? 'Working...' : 'Delete'}
			</button>
		</div>
		<button
			class="bulk-clear"
			onclick={() => { selectedIds = new Set(); }}
			title="Clear selection"
		>
			<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
				<path d="M18 6L6 18M6 6l12 12" />
			</svg>
		</button>
	</div>
{/if}

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
		align-items: center;
	}

	.search-input {
		flex: 1;
		min-width: 200px;
	}

	.status-select {
		min-width: 160px;
	}

	.select-toggle {
		padding: 7px 14px;
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--text-secondary);
		background: transparent;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition: all var(--transition);
		white-space: nowrap;
	}

	.select-toggle:hover {
		color: var(--text-primary);
		border-color: var(--accent);
		background-color: rgba(99, 102, 241, 0.06);
	}

	.select-toggle.active {
		color: var(--accent);
		border-color: var(--accent);
		background-color: rgba(99, 102, 241, 0.1);
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
		position: relative;
	}

	.env-card {
		cursor: pointer;
	}

	.env-card:hover {
		border-color: rgba(99, 102, 241, 0.3);
	}

	.env-card.selected {
		border-color: var(--accent);
		box-shadow: 0 0 0 1px var(--accent);
		background-color: rgba(99, 102, 241, 0.04);
	}

	.selected-indicator {
		position: absolute;
		top: 10px;
		right: 10px;
		width: 22px;
		height: 22px;
		border-radius: 50%;
		background-color: var(--accent);
		display: flex;
		align-items: center;
		justify-content: center;
		color: white;
	}

	.env-card-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}

	.status-group {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.health-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.health-healthy {
		background-color: var(--success);
		box-shadow: 0 0 4px rgba(34, 197, 94, 0.5);
	}

	.health-degraded {
		background-color: var(--warning);
		box-shadow: 0 0 4px rgba(245, 158, 11, 0.5);
	}

	.health-unreachable {
		background-color: var(--error);
		box-shadow: 0 0 4px rgba(239, 68, 68, 0.5);
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

	.ip {
		font-size: 0.75rem;
		background-color: rgba(255, 255, 255, 0.04);
		padding: 1px 8px;
		border-radius: var(--radius-sm);
	}

	.ip-row {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.port-link {
		font-size: 0.6875rem;
		font-weight: 600;
		color: var(--accent);
		background-color: rgba(99, 102, 241, 0.1);
		padding: 1px 6px;
		border-radius: 3px;
		text-decoration: none;
		transition: background-color var(--transition);
	}

	.port-link:hover {
		background-color: rgba(99, 102, 241, 0.2);
	}

	/* ---- Provisioning ---- */

	.env-provisioning {
		padding-top: 4px;
	}

	/* ---- Resources ---- */

	.env-resources {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding-top: 4px;
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

	/* ---- Bulk action bar ---- */

	.bulk-bar {
		position: fixed;
		bottom: 24px;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: 16px;
		padding: 10px 12px 10px 16px;
		background-color: var(--bg-card);
		border: 1px solid var(--accent);
		border-radius: var(--radius);
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5), 0 0 0 1px rgba(99, 102, 241, 0.2);
		z-index: 50;
		animation: slideUp 0.2s ease;
	}

	.bulk-left {
		display: flex;
		align-items: center;
		gap: 6px;
		white-space: nowrap;
	}

	.bulk-count {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 22px;
		height: 22px;
		padding: 0 6px;
		font-size: 0.75rem;
		font-weight: 700;
		color: white;
		background-color: var(--accent);
		border-radius: 11px;
		font-variant-numeric: tabular-nums;
	}

	.bulk-label {
		font-size: 0.8125rem;
		color: var(--text-secondary);
	}

	.bulk-actions {
		display: flex;
		gap: 6px;
	}

	.bulk-clear {
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

	.bulk-clear:hover {
		color: var(--text-primary);
		background-color: rgba(255, 255, 255, 0.08);
	}

	@keyframes slideUp {
		from {
			opacity: 0;
			transform: translateX(-50%) translateY(10px);
		}
		to {
			opacity: 1;
			transform: translateX(-50%) translateY(0);
		}
	}
</style>
