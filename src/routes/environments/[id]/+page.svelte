<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import type { PageData } from './$types';
	import type { Environment } from '$lib/types/environment';
	import type { ClaudeProgress, ClaudeGitActivity, ClaudeTask, ClaudeTaskQueueItem, ClaudeEnvironmentLiveData } from '$lib/types/claude';
	import TerminalTabs from '$lib/components/TerminalTabs.svelte';
	import ResourceBar from '$lib/components/ResourceBar.svelte';
	import ClaudeDispatch from '$lib/components/ClaudeDispatch.svelte';
	import ClaudeProgressComponent from '$lib/components/ClaudeProgress.svelte';
	import ClaudeGitActivityComponent from '$lib/components/ClaudeGitActivity.svelte';
	import ClaudeTaskHistory from '$lib/components/ClaudeTaskHistory.svelte';
	import ClaudeTaskQueue from '$lib/components/ClaudeTaskQueue.svelte';
	import { addToast } from '$lib/stores/toast.svelte';

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

	interface EnvironmentLiveData {
		id: string;
		status: string;
		ipAddress: string | null;
		resources: ResourceMetrics | null;
		health: HealthStatus | null;
	}

	let { data }: { data: PageData } = $props();

	let env = $state<Environment>(data.environment);
	let metadata = $state<Record<string, unknown> | null>(data.metadata);
	let actionLoading = $state(false);
	let showPassword = $state(false);
	let copied = $state('');

	let resources = $state<ResourceMetrics | null>(null);
	let health = $state<HealthStatus | null>(null);

	// Claude state
	let claudeProgress = $state<ClaudeProgress | null>(data.claude?.progress ?? null);
	let claudeGitActivity = $state<ClaudeGitActivity | null>(data.claude?.gitActivity ?? null);
	let claudeActiveTask = $state<ClaudeTask | null>(data.claude?.activeTask ?? null);
	let claudeTaskHistory = $state<ClaudeTask[]>(data.claude?.taskHistory ?? []);
	let claudeQueueItems = $state<ClaudeTaskQueueItem[]>((data.claude?.queueItems ?? []) as ClaudeTaskQueueItem[]);
	let activeTab = $state<'terminal' | 'claude'>('terminal');

	// Claude SSE
	let claudeEventSource: EventSource | null = null;

	function connectClaudeSSE() {
		claudeEventSource = new EventSource('/api/claude/stream');
		claudeEventSource.onmessage = (event) => {
			try {
				const liveData: ClaudeEnvironmentLiveData[] = JSON.parse(event.data);
				const mine = liveData.find(d => d.envId === env.id);
				if (mine) {
					if (mine.progress) claudeProgress = mine.progress;
					if (mine.gitActivity) claudeGitActivity = mine.gitActivity;
					if (mine.activeTask) claudeActiveTask = mine.activeTask;
				}
			} catch {
				// ignore
			}
		};
	}

	async function refreshClaudeData() {
		try {
			const res = await fetch(`/api/claude/tasks?envId=${env.id}&limit=20`);
			if (res.ok) claudeTaskHistory = await res.json();
		} catch { /* ignore */ }
		try {
			const res = await fetch(`/api/claude/queue/${env.id}`);
			if (res.ok) claudeQueueItems = await res.json();
		} catch { /* ignore */ }
	}

	const rootPassword = $derived(
		metadata?.root_password ? String(metadata.root_password) : null
	);

	const communityScript = $derived(
		metadata?.community_script as { name?: string; interface_port?: number; slug?: string } | null
	);

	// SSE connection
	let eventSource: EventSource | null = null;

	function connectSSE() {
		eventSource = new EventSource('/api/environments/stream');
		eventSource.onmessage = (event) => {
			try {
				const liveData: EnvironmentLiveData[] = JSON.parse(event.data);
				const mine = liveData.find((d) => d.id === env.id);
				if (mine) {
					if (mine.status && env.status !== mine.status) {
						env.status = mine.status as Environment['status'];
					}
					if (mine.ipAddress && !env.ip_address) {
						env.ip_address = mine.ipAddress;
					}
					resources = mine.resources;
					health = mine.health;
				}
			} catch {
				// ignore
			}
		};
	}

	onMount(() => {
		connectSSE();
		connectClaudeSSE();
	});

	onDestroy(() => {
		eventSource?.close();
		eventSource = null;
		claudeEventSource?.close();
		claudeEventSource = null;
	});

	async function performAction(action: 'start' | 'stop') {
		actionLoading = true;
		try {
			const res = await fetch(`/api/environments/${env.id}/${action}`, { method: 'POST' });
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				addToast(body.message ?? `Failed to ${action} environment.`, 'error');
				return;
			}
			// Refresh environment data
			const envRes = await fetch(`/api/environments/${env.id}`);
			if (envRes.ok) {
				const updated = await envRes.json();
				env = updated;
				if (updated.metadata) {
					try { metadata = JSON.parse(updated.metadata); } catch { /* ignore */ }
				}
			}
		} catch {
			addToast(`Network error while trying to ${action} environment.`, 'error');
		} finally {
			actionLoading = false;
		}
	}

	function copyToClipboard(text: string, label: string) {
		navigator.clipboard.writeText(text);
		copied = label;
		setTimeout(() => { copied = ''; }, 2000);
	}

	function formatBytes(bytes: number): string {
		if (bytes < 1024) return `${bytes}B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
		if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)}MB`;
		return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
	}

	function formatUptime(seconds: number): string {
		const days = Math.floor(seconds / 86400);
		const hours = Math.floor((seconds % 86400) / 3600);
		const mins = Math.floor((seconds % 3600) / 60);
		if (days > 0) return `${days}d ${hours}h`;
		if (hours > 0) return `${hours}h ${mins}m`;
		return `${mins}m`;
	}
</script>

<div class="detail-page">
	<!-- Header -->
	<header class="page-header">
		<div class="header-left">
			<a href="/environments" class="back-link">
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M19 12H5" /><path d="M12 19l-7-7 7-7" />
				</svg>
				Back
			</a>
			<h1 class="env-title">{env.name}</h1>
			{#if health}
				<span
					class="health-dot health-{health.state}"
					title="{health.state}{health.responseMs != null ? ` (${health.responseMs}ms)` : ''}"
				></span>
			{/if}
			<span class="badge badge-{env.status}">{env.status}</span>
		</div>
		<div class="header-actions">
			{#if env.status === 'stopped'}
				<button
					class="btn btn-primary btn-sm"
					disabled={actionLoading}
					onclick={() => performAction('start')}
				>
					{actionLoading ? 'Starting...' : 'Start'}
				</button>
			{/if}
			{#if env.status === 'running'}
				<button
					class="btn btn-danger btn-sm"
					disabled={actionLoading}
					onclick={() => performAction('stop')}
				>
					{actionLoading ? 'Stopping...' : 'Stop'}
				</button>
			{/if}
		</div>
	</header>

	<!-- Info bar -->
	<div class="info-bar card">
		<div class="info-items">
			{#if env.ip_address}
				<div class="info-item">
					<span class="info-label">IP</span>
					<span class="info-value">
						<code>{env.ip_address}</code>
						<button class="copy-btn" onclick={() => copyToClipboard(env.ip_address!, 'ip')} title="Copy IP">
							{#if copied === 'ip'}
								<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
							{:else}
								<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
							{/if}
						</button>
					</span>
				</div>
			{/if}
			<div class="info-divider"></div>
			<div class="info-item">
				<span class="info-label">Type</span>
				<span class="info-value">{env.type?.toUpperCase() ?? 'N/A'}</span>
			</div>
			{#if env.vmid}
				<div class="info-item">
					<span class="info-label">VMID</span>
					<span class="info-value">{env.vmid}</span>
				</div>
			{/if}
			<div class="info-item">
				<span class="info-label">Node</span>
				<span class="info-value">{env.node}</span>
			</div>
			{#if env.ip_address}
				<div class="info-divider"></div>
				<div class="info-item">
					<span class="info-label">SSH</span>
					<span class="info-value">
						<code>{env.ssh_user}@{env.ip_address}</code>
						<button class="copy-btn" onclick={() => copyToClipboard(`ssh ${env.ssh_user}@${env.ip_address}`, 'ssh')} title="Copy SSH command">
							{#if copied === 'ssh'}
								<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
							{:else}
								<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
							{/if}
						</button>
					</span>
				</div>
			{/if}
			{#if rootPassword}
				<div class="info-item">
					<span class="info-label">Password</span>
					<span class="info-value">
						{#if showPassword}
							<code>{rootPassword}</code>
						{:else}
							<code class="masked">{'*'.repeat(12)}</code>
						{/if}
						<button class="copy-btn" onclick={() => { showPassword = !showPassword; }} title={showPassword ? 'Hide password' : 'Show password'}>
							{#if showPassword}
								<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
							{:else}
								<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
							{/if}
						</button>
						<button class="copy-btn" onclick={() => copyToClipboard(rootPassword, 'pw')} title="Copy password">
							{#if copied === 'pw'}
								<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
							{:else}
								<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
							{/if}
						</button>
					</span>
				</div>
			{/if}
			{#if communityScript?.interface_port && env.ip_address}
				<div class="info-divider"></div>
				<div class="info-item">
					<span class="info-label">Web UI</span>
					<span class="info-value">
						<a href="http://{env.ip_address}:{communityScript.interface_port}" target="_blank" rel="noopener noreferrer" class="port-link">
							:{communityScript.interface_port}
						</a>
					</span>
				</div>
			{/if}
		</div>

		<!-- Resource metrics -->
		{#if resources}
			<div class="resource-section">
				<div class="resource-bars">
					<ResourceBar label="CPU" value={resources.cpuPercent} max={100} warnAt={80} critAt={90} />
					<ResourceBar label="Memory" value={resources.memUsed} max={resources.memTotal} warnAt={80} critAt={95} />
					<ResourceBar label="Disk" value={resources.diskUsed} max={resources.diskTotal} warnAt={80} critAt={90} />
				</div>
				<div class="resource-stats">
					<span class="stat">Mem: {formatBytes(resources.memUsed)}/{formatBytes(resources.memTotal)}</span>
					<span class="stat">Disk: {formatBytes(resources.diskUsed)}/{formatBytes(resources.diskTotal)}</span>
					<span class="stat">Net In: {formatBytes(resources.netIn)}</span>
					<span class="stat">Net Out: {formatBytes(resources.netOut)}</span>
					<span class="stat">Uptime: {formatUptime(resources.uptime)}</span>
				</div>
			</div>
		{/if}
	</div>

	<!-- Tab switcher for running environments -->
	{#if env.status === 'running' && env.ip_address}
		<div class="tab-switcher">
			<button class="tab-btn" class:active={activeTab === 'terminal'} onclick={() => activeTab = 'terminal'}>Terminal</button>
			<button class="tab-btn" class:active={activeTab === 'claude'} onclick={() => activeTab = 'claude'}>Claude</button>
		</div>
	{/if}

	<!-- Terminal -->
	{#if env.status === 'running' && env.ip_address && activeTab === 'terminal'}
		<div class="terminal-section">
			<TerminalTabs envId={env.id} />
		</div>
	{:else if env.status === 'running' && env.ip_address && activeTab === 'claude'}
		<div class="claude-section">
			<!-- Dispatch -->
			<div class="claude-card card">
				<h3>Dispatch Task</h3>
				<ClaudeDispatch
					envId={env.id}
					activeTask={claudeActiveTask}
					onTaskStarted={() => { setTimeout(refreshClaudeData, 2000); }}
				/>
			</div>

			<div class="claude-grid">
				<!-- Progress -->
				<div class="claude-card card">
					<h3>Progress</h3>
					<ClaudeProgressComponent progress={claudeProgress} />
				</div>

				<!-- Git Activity -->
				<div class="claude-card card">
					<h3>Git Activity</h3>
					<ClaudeGitActivityComponent activity={claudeGitActivity} />
				</div>
			</div>

			<!-- Task Queue -->
			<div class="claude-card card">
				<h3>Task Queue</h3>
				<ClaudeTaskQueue envId={env.id} items={claudeQueueItems} onQueueChanged={refreshClaudeData} />
			</div>

			<!-- Task History -->
			<div class="claude-card card">
				<h3>Task History</h3>
				<ClaudeTaskHistory tasks={claudeTaskHistory} />
			</div>
		</div>
	{:else if env.status === 'running' && !env.ip_address}
		<div class="terminal-placeholder card">
			<div class="placeholder-content">
				<div class="spinner"></div>
				<p>Waiting for IP address...</p>
				<p class="placeholder-sub">The environment is running but hasn't received an IP yet.</p>
			</div>
		</div>
	{:else if env.status === 'provisioning'}
		<div class="terminal-placeholder card">
			<div class="placeholder-content">
				<div class="spinner"></div>
				<p>Environment is provisioning...</p>
				<p class="placeholder-sub">Terminal will be available once the environment is running.</p>
			</div>
		</div>
	{:else if env.status === 'stopped'}
		<div class="terminal-placeholder card">
			<div class="placeholder-content">
				<p>Environment is stopped.</p>
				<p class="placeholder-sub">Start the environment to access the terminal.</p>
			</div>
		</div>
	{:else if env.status === 'error'}
		<div class="terminal-placeholder card error">
			<div class="placeholder-content">
				<p>Environment encountered an error.</p>
				{#if env.error_message}
					<pre class="error-detail">{env.error_message}</pre>
				{/if}
			</div>
		</div>
	{/if}
</div>

<style>
	.detail-page {
		display: flex;
		flex-direction: column;
		height: calc(100vh - 64px);
		max-width: 1400px;
	}

	/* ---- Header ---- */

	.page-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 16px;
		flex-wrap: wrap;
		gap: 12px;
		flex-shrink: 0;
	}

	.header-left {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.back-link {
		display: flex;
		align-items: center;
		gap: 4px;
		color: var(--text-secondary);
		font-size: 0.8125rem;
		font-weight: 500;
		text-decoration: none;
		transition: color var(--transition);
	}

	.back-link:hover {
		color: var(--text-primary);
	}

	.env-title {
		font-size: 1.25rem;
		font-weight: 600;
	}

	.header-actions {
		display: flex;
		gap: 8px;
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

	/* ---- Info bar ---- */

	.info-bar {
		margin-bottom: 16px;
		flex-shrink: 0;
		padding: 14px 20px;
	}

	.info-items {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 10px 20px;
	}

	.info-divider {
		width: 1px;
		height: 20px;
		background-color: var(--border);
		flex-shrink: 0;
	}

	.info-item {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 0.8125rem;
	}

	.info-label {
		color: var(--text-secondary);
		font-weight: 500;
		font-size: 0.6875rem;
		text-transform: uppercase;
		letter-spacing: 0.03em;
	}

	.info-value {
		display: flex;
		align-items: center;
		gap: 4px;
		font-weight: 500;
	}

	.info-value code {
		font-size: 0.75rem;
		background-color: rgba(255, 255, 255, 0.04);
		padding: 1px 6px;
		border-radius: var(--radius-sm);
		font-family: 'SF Mono', 'Fira Code', monospace;
	}

	.info-value code.masked {
		letter-spacing: 1px;
	}

	.copy-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		font-size: 0.75rem;
		background: none;
		border: none;
		color: var(--text-secondary);
		cursor: pointer;
		border-radius: var(--radius-sm);
		transition: background-color var(--transition), color var(--transition);
		padding: 0;
	}

	.copy-btn:hover {
		background-color: rgba(255, 255, 255, 0.06);
		color: var(--text-primary);
	}

	.port-link {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--accent);
		background-color: rgba(99, 102, 241, 0.1);
		padding: 1px 8px;
		border-radius: 3px;
		text-decoration: none;
		transition: background-color var(--transition);
	}

	.port-link:hover {
		background-color: rgba(99, 102, 241, 0.2);
	}

	/* ---- Resource section ---- */

	.resource-section {
		margin-top: 14px;
		padding-top: 14px;
		border-top: 1px solid var(--border);
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.resource-bars {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 12px;
	}

	.resource-stats {
		display: flex;
		flex-wrap: wrap;
		gap: 8px 16px;
	}

	.stat {
		font-size: 0.6875rem;
		color: var(--text-secondary);
		font-family: 'SF Mono', 'Fira Code', monospace;
	}

	/* ---- Tab switcher ---- */

	.tab-switcher {
		display: flex;
		gap: 2px;
		margin-bottom: 8px;
		flex-shrink: 0;
	}

	.tab-btn {
		padding: 6px 16px;
		font-size: 0.8125rem;
		font-weight: 500;
		background: none;
		border: 1px solid var(--border);
		color: var(--text-secondary);
		cursor: pointer;
		transition: background-color var(--transition), color var(--transition), border-color var(--transition);
	}

	.tab-btn:first-child {
		border-radius: var(--radius-sm) 0 0 var(--radius-sm);
	}

	.tab-btn:last-child {
		border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
	}

	.tab-btn.active {
		background-color: rgba(99, 102, 241, 0.1);
		border-color: var(--accent);
		color: var(--accent);
	}

	.tab-btn:hover:not(.active) {
		background-color: rgba(255, 255, 255, 0.04);
		color: var(--text-primary);
	}

	/* ---- Claude section ---- */

	.claude-section {
		flex: 1;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 16px;
		padding-bottom: 24px;
	}

	.claude-card {
		padding: 16px 20px;
	}

	.claude-card h3 {
		font-size: 0.875rem;
		font-weight: 600;
		margin-bottom: 12px;
	}

	.claude-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 16px;
	}

	@media (max-width: 900px) {
		.claude-grid {
			grid-template-columns: 1fr;
		}
	}

	/* ---- Terminal section ---- */

	.terminal-section {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}

	/* ---- Placeholder ---- */

	.terminal-placeholder {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 200px;
	}

	.terminal-placeholder.error {
		border-color: rgba(239, 68, 68, 0.3);
	}

	.placeholder-content {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		text-align: center;
		color: var(--text-secondary);
	}

	.placeholder-sub {
		font-size: 0.8125rem;
		opacity: 0.7;
	}

	.error-detail {
		max-width: 600px;
		font-size: 0.75rem;
		font-family: 'SF Mono', monospace;
		background-color: rgba(239, 68, 68, 0.08);
		color: var(--error);
		padding: 12px 16px;
		border-radius: var(--radius-sm);
		white-space: pre-wrap;
		word-break: break-word;
		text-align: left;
		max-height: 200px;
		overflow-y: auto;
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
