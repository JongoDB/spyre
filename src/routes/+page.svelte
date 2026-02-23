<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let greeting = $derived(() => {
		const hour = new Date().getHours();
		if (hour < 12) return 'Good morning';
		if (hour < 18) return 'Good afternoon';
		return 'Good evening';
	});
</script>

<div class="dashboard">
	<header class="page-header">
		<h1>{greeting()}</h1>
		<p class="subtitle">Here is an overview of your Spyre infrastructure.</p>
	</header>

	<!-- Proxmox connectivity -->
	<section class="connectivity-banner" class:connected={data.proxmoxConnected} class:disconnected={!data.proxmoxConnected}>
		<div class="connectivity-dot"></div>
		<div class="connectivity-info">
			<span class="connectivity-label">
				Proxmox VE
				{#if data.proxmoxHost}
					<code>{data.proxmoxHost}</code>
				{/if}
			</span>
			<span class="connectivity-status">
				{data.proxmoxConnected ? 'Connected' : 'Unreachable'}
			</span>
		</div>
	</section>

	<!-- Stats grid -->
	<section class="stats-grid">
		<div class="stat-card card">
			<span class="stat-value">{data.counts.total}</span>
			<span class="stat-label">Total Environments</span>
		</div>
		<div class="stat-card card">
			<span class="stat-value stat-running">{data.counts.running}</span>
			<span class="stat-label">Running</span>
		</div>
		<div class="stat-card card">
			<span class="stat-value stat-stopped">{data.counts.stopped}</span>
			<span class="stat-label">Stopped</span>
		</div>
		<div class="stat-card card">
			<span class="stat-value stat-error">{data.counts.error}</span>
			<span class="stat-label">Errors</span>
		</div>
	</section>

	<!-- Recent environments -->
	<section class="recent-section">
		<div class="section-header">
			<h2>Recent Environments</h2>
			<a href="/environments" class="btn btn-secondary btn-sm">View all</a>
		</div>

		{#if data.recentEnvironments.length === 0}
			<div class="empty-state card">
				<p>No environments yet.</p>
				<a href="/environments/create" class="btn btn-primary">Create your first environment</a>
			</div>
		{:else}
			<div class="recent-list">
				{#each data.recentEnvironments as env (env.id)}
					<div class="recent-item card">
						<div class="recent-item-info">
							<span class="recent-item-name">{env.name}</span>
							<span class="badge badge-{env.status}">{env.status}</span>
						</div>
						<div class="recent-item-meta">
							{#if env.ip_address}
								<code class="ip-label">{env.ip_address}</code>
							{/if}
							<span class="type-label">{env.type}</span>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</section>
</div>

<style>
	.dashboard {
		max-width: 960px;
	}

	.page-header {
		margin-bottom: 28px;
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

	/* ---- Connectivity banner ---- */

	.connectivity-banner {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 14px 18px;
		border-radius: var(--radius);
		margin-bottom: 24px;
		border: 1px solid var(--border);
	}

	.connectivity-banner.connected {
		background-color: rgba(34, 197, 94, 0.06);
		border-color: rgba(34, 197, 94, 0.2);
	}

	.connectivity-banner.disconnected {
		background-color: rgba(239, 68, 68, 0.06);
		border-color: rgba(239, 68, 68, 0.2);
	}

	.connectivity-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.connected .connectivity-dot {
		background-color: var(--success);
		box-shadow: 0 0 6px rgba(34, 197, 94, 0.5);
	}

	.disconnected .connectivity-dot {
		background-color: var(--error);
		box-shadow: 0 0 6px rgba(239, 68, 68, 0.5);
	}

	.connectivity-info {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}

	.connectivity-label {
		font-size: 0.875rem;
		font-weight: 500;
	}

	.connectivity-label code {
		font-size: 0.75rem;
		color: var(--text-secondary);
		background-color: rgba(255, 255, 255, 0.05);
		padding: 1px 6px;
		border-radius: var(--radius-sm);
		margin-left: 4px;
	}

	.connectivity-status {
		font-size: 0.75rem;
		color: var(--text-secondary);
	}

	/* ---- Stats grid ---- */

	.stats-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: 16px;
		margin-bottom: 32px;
	}

	.stat-card {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 20px;
	}

	.stat-value {
		font-size: 2rem;
		font-weight: 700;
		line-height: 1;
		font-variant-numeric: tabular-nums;
	}

	.stat-label {
		font-size: 0.8125rem;
		color: var(--text-secondary);
	}

	.stat-running { color: var(--success); }
	.stat-stopped { color: var(--text-secondary); }
	.stat-error   { color: var(--error); }

	/* ---- Recent section ---- */

	.section-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 14px;
	}

	.section-header h2 {
		font-size: 1rem;
		font-weight: 600;
	}

	.recent-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.recent-item {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 14px 18px;
	}

	.recent-item-info {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.recent-item-name {
		font-weight: 500;
		font-size: 0.875rem;
	}

	.recent-item-meta {
		display: flex;
		align-items: center;
		gap: 14px;
	}

	.ip-label {
		font-size: 0.75rem;
		color: var(--text-secondary);
		background-color: rgba(255, 255, 255, 0.04);
		padding: 2px 8px;
		border-radius: var(--radius-sm);
	}

	.type-label {
		font-size: 0.75rem;
		color: var(--text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

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
