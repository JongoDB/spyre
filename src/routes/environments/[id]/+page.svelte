<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import type { PageData } from './$types';
	import type { Environment } from '$lib/types/environment';
	import type { ClaudeProgress, ClaudeGitActivity, ClaudeTask, ClaudeTaskQueueItem, ClaudeEnvironmentLiveData } from '$lib/types/claude';
	import type { DevcontainerWithPersona } from '$lib/types/devcontainer';
	import TerminalTabs from '$lib/components/TerminalTabs.svelte';
	import ResourceBar from '$lib/components/ResourceBar.svelte';
	import ProvisioningProgressComponent from '$lib/components/ProvisioningProgress.svelte';
	import ClaudeDispatch from '$lib/components/ClaudeDispatch.svelte';
	import ClaudeProgressComponent from '$lib/components/ClaudeProgress.svelte';
	import ClaudeGitActivityComponent from '$lib/components/ClaudeGitActivity.svelte';
	import ClaudeTaskHistory from '$lib/components/ClaudeTaskHistory.svelte';
	import ClaudeTaskQueue from '$lib/components/ClaudeTaskQueue.svelte';
	import PipelineList from '$lib/components/PipelineList.svelte';
	import PipelineBuilder from '$lib/components/PipelineBuilder.svelte';
	import PipelineRunner from '$lib/components/PipelineRunner.svelte';
	import AgentTaskActivity from '$lib/components/AgentTaskActivity.svelte';
	import { addToast } from '$lib/stores/toast.svelte';
	import type { Pipeline } from '$lib/types/pipeline';

	type PipelineListItem = Pipeline & { step_count: number; completed_count: number };

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

	let env = $state<Environment>(data.environment);
	let metadata = $state<Record<string, unknown> | null>(data.metadata);
	let actionLoading = $state(false);
	let showPassword = $state(false);
	let copied = $state('');

	let resources = $state<ResourceMetrics | null>(null);
	let health = $state<HealthStatus | null>(null);
	let provisioningProgress = $state<{
		phases: Array<{
			phase: string;
			steps: Array<{
				id: number;
				phase: string;
				step: string;
				status: 'running' | 'success' | 'error' | 'skipped';
				output: string | null;
				started_at: string;
				completed_at: string | null;
			}>;
			status: 'pending' | 'running' | 'success' | 'error' | 'skipped';
		}>;
		percentComplete: number;
		currentPhase: string | null;
		isComplete: boolean;
		hasError: boolean;
	} | null>(data.provisioningProgress ?? null);
	let previousStatus = $state(env.status);

	// Claude state
	let claudeProgress = $state<ClaudeProgress | null>(data.claude?.progress ?? null);
	let claudeGitActivity = $state<ClaudeGitActivity | null>(data.claude?.gitActivity ?? null);
	let claudeActiveTask = $state<ClaudeTask | null>(data.claude?.activeTask ?? null);
	let claudeTaskHistory = $state<ClaudeTask[]>(data.claude?.taskHistory ?? []);
	let claudeQueueItems = $state<ClaudeTaskQueueItem[]>((data.claude?.queueItems ?? []) as ClaudeTaskQueueItem[]);
	let activeTab = $state<'terminal' | 'claude' | 'pipelines'>('terminal');

	// Devcontainer state (docker multi-agent mode)
	let devcontainers = $state<DevcontainerWithPersona[]>(data.devcontainers ?? []);
	let addingAgent = $state(false);
	let addAgentPersonaId = $state('');
	let showAddAgent = $state(false);
	let dcDispatchId = $state('');
	let dcDispatchPrompt = $state('');
	let dcDispatching = $state(false);
	let activeAgentTaskId = $state<string | null>(null);
	let activeAgentDcId = $state<string | null>(null);

	// Pipeline state
	let pipelines = $state<PipelineListItem[]>(data.pipelines ?? []);
	let pipelineView = $state<'list' | 'builder' | 'runner'>('list');
	let selectedPipelineId = $state<string | null>(null);

	async function refreshDevcontainers() {
		try {
			const res = await fetch(`/api/devcontainers?envId=${env.id}`);
			if (res.ok) devcontainers = await res.json();
		} catch { /* ignore */ }
	}

	// Poll devcontainer status while any are in a transient state
	let dcPollTimer: ReturnType<typeof setInterval> | null = null;
	$effect(() => {
		const hasTransient = devcontainers.some(d => d.status === 'creating' || d.status === 'removing');
		if (hasTransient && !dcPollTimer) {
			dcPollTimer = setInterval(refreshDevcontainers, 3000);
		} else if (!hasTransient && dcPollTimer) {
			clearInterval(dcPollTimer);
			dcPollTimer = null;
		}
		return () => { if (dcPollTimer) { clearInterval(dcPollTimer); dcPollTimer = null; } };
	});

	async function addDevcontainer() {
		if (!addAgentPersonaId || addingAgent) return;
		addingAgent = true;
		try {
			const res = await fetch('/api/devcontainers', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ env_id: env.id, persona_id: addAgentPersonaId })
			});
			if (res.ok) {
				addToast('Agent created', 'success');
				showAddAgent = false;
				addAgentPersonaId = '';
				await refreshDevcontainers();
			} else {
				const body = await res.json().catch(() => ({}));
				addToast(body.message ?? 'Failed to create agent', 'error');
			}
		} catch {
			addToast('Network error', 'error');
		} finally {
			addingAgent = false;
		}
	}

	async function dcAction(dcId: string, action: 'start' | 'stop' | 'rebuild') {
		try {
			const res = await fetch(`/api/devcontainers/${dcId}/${action}`, { method: 'POST' });
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				addToast(body.message ?? `Failed to ${action}`, 'error');
			}
			await refreshDevcontainers();
		} catch {
			addToast(`Network error during ${action}`, 'error');
		}
	}

	async function dcDelete(dcId: string) {
		try {
			const res = await fetch(`/api/devcontainers/${dcId}`, { method: 'DELETE' });
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				addToast(body.message ?? 'Failed to remove agent', 'error');
			}
			await refreshDevcontainers();
		} catch {
			addToast('Network error', 'error');
		}
	}

	async function dispatchToDevcontainer() {
		if (!dcDispatchId || !dcDispatchPrompt.trim() || dcDispatching) return;
		dcDispatching = true;
		try {
			const res = await fetch(`/api/devcontainers/${dcDispatchId}/dispatch`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ prompt: dcDispatchPrompt.trim() })
			});
			if (res.ok) {
				const body = await res.json();
				addToast('Task dispatched', 'success');
				dcDispatchPrompt = '';
				activeAgentTaskId = body.taskId;
				activeAgentDcId = dcDispatchId;
				dcDispatchId = '';
				setTimeout(refreshClaudeData, 2000);
			} else {
				const body = await res.json().catch(() => ({}));
				addToast(body.message ?? 'Failed to dispatch', 'error');
			}
		} catch {
			addToast('Network error', 'error');
		} finally {
			dcDispatching = false;
		}
	}

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
					claudeActiveTask = mine.activeTask ?? null;
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

	async function refreshPipelines() {
		try {
			const res = await fetch(`/api/pipelines?envId=${env.id}`);
			if (res.ok) pipelines = await res.json();
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
						// Toast on provisioning completion
						if (previousStatus === 'provisioning' && mine.status !== 'provisioning') {
							if (mine.status === 'running') {
								addToast(`Environment "${env.name}" is ready!`, 'success');
							} else if (mine.status === 'error') {
								addToast(`Environment "${env.name}" provisioning failed.`, 'error');
							}
						}
						previousStatus = mine.status as Environment['status'];
						env.status = mine.status as Environment['status'];
					}
					if (mine.ipAddress && !env.ip_address) {
						env.ip_address = mine.ipAddress;
					}
					resources = mine.resources;
					health = mine.health;
					if (mine.provisioning) {
						provisioningProgress = {
							...provisioningProgress!,
							percentComplete: mine.provisioning.percentComplete,
							currentPhase: mine.provisioning.currentPhase,
							hasError: mine.provisioning.hasError
						};
					}
				}
			} catch {
				// ignore
			}
		};
		// Listen for real-time provisioning events
		eventSource.addEventListener('provisioning', (event) => {
			try {
				const provEvent = JSON.parse(event.data);
				if (provEvent.envId === env.id) {
					// Refresh full provisioning log
					fetchProvisioningLog();
				}
			} catch {
				// ignore
			}
		});
	}

	async function fetchProvisioningLog() {
		try {
			const res = await fetch(`/api/environments/${env.id}/provisioning-log`);
			if (res.ok) {
				provisioningProgress = await res.json();
			}
		} catch {
			// ignore
		}
	}

	onMount(() => {
		connectSSE();
		connectClaudeSSE();
		// Fetch provisioning log immediately if env is provisioning
		if (env.status === 'provisioning') {
			fetchProvisioningLog();
		}
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

	async function retryProvisioning() {
		actionLoading = true;
		try {
			const res = await fetch(`/api/environments/${env.id}/start`, { method: 'POST' });
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				addToast(body.message ?? 'Failed to retry provisioning.', 'error');
				return;
			}
			addToast('Retrying provisioning...', 'success');
			const envRes = await fetch(`/api/environments/${env.id}`);
			if (envRes.ok) {
				const updated = await envRes.json();
				env = updated;
				if (updated.metadata) {
					try { metadata = JSON.parse(updated.metadata); } catch { /* ignore */ }
				}
			}
		} catch {
			addToast('Network error while retrying.', 'error');
		} finally {
			actionLoading = false;
		}
	}

	async function destroyAndGoBack() {
		if (!confirm('Destroy this environment? This cannot be undone.')) return;
		actionLoading = true;
		try {
			const res = await fetch(`/api/environments/${env.id}`, { method: 'DELETE' });
			if (res.ok) {
				addToast('Environment destroyed.', 'success');
				window.location.href = '/environments';
			} else {
				const body = await res.json().catch(() => ({}));
				addToast(body.message ?? 'Failed to destroy environment.', 'error');
			}
		} catch {
			addToast('Network error while destroying.', 'error');
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
			{#if env.docker_enabled}
				<div class="info-divider"></div>
				<div class="info-item">
					<span class="info-label">Mode</span>
					<span class="info-value"><span class="docker-tag">Docker Multi-Agent</span></span>
				</div>
				{#if env.repo_url}
					<div class="info-item">
						<span class="info-label">Repo</span>
						<span class="info-value"><code>{env.repo_url}</code></span>
					</div>
				{/if}
				<div class="info-item">
					<span class="info-label">Branch</span>
					<span class="info-value"><code>{env.git_branch ?? 'main'}</code></span>
				</div>
			{/if}
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
			{#if env.docker_enabled}
				<button class="tab-btn" class:active={activeTab === 'pipelines'} onclick={() => activeTab = 'pipelines'}>Pipelines</button>
			{/if}
		</div>
	{/if}

	<!-- Terminal -->
	{#if env.status === 'running' && env.ip_address && activeTab === 'terminal'}
		<div class="terminal-section">
			<TerminalTabs envId={env.id} />
		</div>
	{:else if env.status === 'running' && env.ip_address && activeTab === 'claude'}
		<div class="claude-section">
			{#if env.docker_enabled}
				<!-- Docker Multi-Agent Mode -->
				<div class="agent-header">
					<h3>Agents</h3>
					<button class="btn btn-primary btn-sm" onclick={() => showAddAgent = !showAddAgent}>
						{showAddAgent ? 'Cancel' : '+ Add Agent'}
					</button>
				</div>

				{#if showAddAgent}
					<div class="add-agent-form card">
						<div class="form-group">
							<label for="agent-persona">Persona</label>
							<select id="agent-persona" class="form-select" bind:value={addAgentPersonaId}>
								<option value="" disabled>Select a persona</option>
								{#each data.personas ?? [] as p}
									<option value={p.id}>{p.avatar} {p.name} — {p.role}</option>
								{/each}
							</select>
						</div>
						<button class="btn btn-primary btn-sm" disabled={!addAgentPersonaId || addingAgent} onclick={addDevcontainer}>
							{addingAgent ? 'Creating...' : 'Create Agent'}
						</button>
					</div>
				{/if}

				{#if devcontainers.length > 0}
					<div class="agent-grid">
						{#each devcontainers as dc (dc.id)}
							<div class="agent-card card">
								<div class="agent-card-header">
									<div class="agent-identity">
										{#if dc.persona_avatar}
											<span class="agent-avatar">{dc.persona_avatar}</span>
										{/if}
										<div>
											<div class="agent-name">{dc.persona_name ?? dc.service_name}</div>
											{#if dc.persona_role}
												<div class="agent-role">{dc.persona_role}</div>
											{/if}
										</div>
									</div>
									<span class="badge badge-{dc.status}">{dc.status}</span>
								</div>
								<div class="agent-service">
									<code>{dc.service_name}</code>
								</div>
								{#if dc.error_message}
									<div class="agent-error">{dc.error_message}</div>
								{/if}
								<div class="agent-actions">
									{#if dc.status === 'running'}
										<button class="btn btn-sm btn-secondary" onclick={() => { dcDispatchId = dc.id; }}>Dispatch</button>
										<button class="btn btn-sm btn-danger" onclick={() => dcAction(dc.id, 'stop')}>Stop</button>
									{:else if dc.status === 'stopped'}
										<button class="btn btn-sm btn-primary" onclick={() => dcAction(dc.id, 'start')}>Start</button>
									{/if}
									<button class="btn btn-sm btn-secondary" onclick={() => dcAction(dc.id, 'rebuild')}>Rebuild</button>
									<button class="btn btn-sm btn-danger" onclick={() => dcDelete(dc.id)}>Remove</button>
								</div>
							</div>
						{/each}
					</div>
				{:else}
					<div class="empty-agents card">
						<p>No agents yet. Add an agent to get started with multi-agent development.</p>
					</div>
				{/if}

				<!-- Dispatch to devcontainer -->
				{#if dcDispatchId}
					{@const targetDc = devcontainers.find(d => d.id === dcDispatchId)}
					<div class="dc-dispatch-section card">
						<div class="dispatch-header">
							<h3>Dispatch to {targetDc?.persona_name ?? targetDc?.service_name}</h3>
							<button class="btn btn-sm btn-secondary" onclick={() => dcDispatchId = ''}>Cancel</button>
						</div>
						<div class="dc-dispatch-form">
							<textarea
								class="form-input"
								placeholder="Enter task prompt..."
								bind:value={dcDispatchPrompt}
								rows="3"
								onkeydown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); dispatchToDevcontainer(); } }}
							></textarea>
							<div class="dispatch-actions">
								<button class="btn btn-primary" disabled={!dcDispatchPrompt.trim() || dcDispatching} onclick={dispatchToDevcontainer}>
									{dcDispatching ? 'Dispatching...' : 'Dispatch'}
								</button>
								<span class="keyboard-hint">Ctrl+Enter</span>
							</div>
						</div>
					</div>
				{/if}

				<!-- Live task activity -->
				{#if activeAgentTaskId}
					{@const activeDc = devcontainers.find(d => d.id === activeAgentDcId)}
					<div class="active-task-section card">
						<div class="dispatch-header">
							<h3>
								{#if activeDc}
									{activeDc.persona_avatar ?? ''} {activeDc.persona_name ?? activeDc.service_name} — Active Task
								{:else}
									Active Task
								{/if}
							</h3>
							<button class="btn btn-sm btn-secondary" onclick={() => { activeAgentTaskId = null; activeAgentDcId = null; }}>Dismiss</button>
						</div>
						<AgentTaskActivity
							taskId={activeAgentTaskId}
							onComplete={() => { refreshClaudeData(); }}
						/>
					</div>
				{/if}

				<!-- Shared Git Activity & Progress -->
				<div class="claude-grid">
					<div class="claude-card card">
						<h3>Progress</h3>
						<ClaudeProgressComponent progress={claudeProgress} />
					</div>
					<div class="claude-card card">
						<h3>Git Activity</h3>
						<ClaudeGitActivityComponent activity={claudeGitActivity} />
					</div>
				</div>

				<div class="claude-card card">
					<h3>Task Queue</h3>
					<ClaudeTaskQueue envId={env.id} items={claudeQueueItems} onQueueChanged={refreshClaudeData} />
				</div>

				<div class="claude-card card">
					<h3>Task History</h3>
					<ClaudeTaskHistory tasks={claudeTaskHistory} />
				</div>
			{:else}
				<!-- Standard single-agent mode -->
				<div class="claude-card card">
					<div class="dispatch-header">
						<h3>Dispatch Task</h3>
						{#if data.persona}
							<span class="persona-badge" title="{data.persona.name} — {data.persona.role}">
								{data.persona.avatar} {data.persona.role}
							</span>
						{/if}
					</div>
					<ClaudeDispatch
						envId={env.id}
						activeTask={claudeActiveTask}
						onTaskStarted={() => { setTimeout(refreshClaudeData, 2000); }}
						onTaskCompleted={() => { refreshClaudeData(); }}
					/>
				</div>

				<div class="claude-grid">
					<div class="claude-card card">
						<h3>Progress</h3>
						<ClaudeProgressComponent progress={claudeProgress} />
					</div>
					<div class="claude-card card">
						<h3>Git Activity</h3>
						<ClaudeGitActivityComponent activity={claudeGitActivity} />
					</div>
				</div>

				<div class="claude-card card">
					<h3>Task Queue</h3>
					<ClaudeTaskQueue envId={env.id} items={claudeQueueItems} onQueueChanged={refreshClaudeData} />
				</div>

				<div class="claude-card card">
					<h3>Task History</h3>
					<ClaudeTaskHistory tasks={claudeTaskHistory} />
				</div>
			{/if}
		</div>
	{:else if env.status === 'running' && env.ip_address && activeTab === 'pipelines'}
		<div class="claude-section">
			{#if pipelineView === 'list'}
				<div class="claude-card card">
					<PipelineList
						envId={env.id}
						{pipelines}
						onSelect={(id) => { selectedPipelineId = id; pipelineView = 'runner'; }}
						onCreateNew={() => { pipelineView = 'builder'; }}
						onRefresh={refreshPipelines}
					/>
				</div>
			{:else if pipelineView === 'builder'}
				<div class="claude-card card">
					<PipelineBuilder
						envId={env.id}
						{devcontainers}
						personas={data.personas ?? []}
						onCreated={(id) => { selectedPipelineId = id; pipelineView = 'runner'; refreshPipelines(); }}
						onCancel={() => { pipelineView = 'list'; }}
					/>
				</div>
			{:else if pipelineView === 'runner' && selectedPipelineId}
				<div class="claude-card card">
					<PipelineRunner
						pipelineId={selectedPipelineId}
						onBack={() => { pipelineView = 'list'; selectedPipelineId = null; refreshPipelines(); }}
						onRefresh={refreshPipelines}
						onClone={(id) => { selectedPipelineId = id; refreshPipelines(); }}
					/>
				</div>
			{/if}
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
		<div class="provisioning-section card">
			{#if provisioningProgress && provisioningProgress.phases.length > 0}
				<h3 class="provisioning-title">Provisioning in Progress</h3>
				<ProvisioningProgressComponent progress={provisioningProgress} />
			{:else}
				<div class="placeholder-content">
					<div class="spinner"></div>
					<p>Environment is provisioning...</p>
					<p class="placeholder-sub">Terminal will be available once the environment is running.</p>
				</div>
			{/if}
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
				<div class="error-header-icon">
					<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--error)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
				</div>
				<p class="error-title">Provisioning Failed</p>
				{#if env.error_message}
					<div class="error-detail-box">
						{#if env.error_message.includes('lacks privileges') || env.error_message.includes('FORBIDDEN')}
							<div class="error-category">Proxmox Permission Error</div>
						{:else if env.error_message.includes('AUTH_FAILED') || env.error_message.includes('authentication')}
							<div class="error-category">Proxmox Authentication Error</div>
						{:else if env.error_message.includes('ECONNREFUSED') || env.error_message.includes('Cannot reach')}
							<div class="error-category">Proxmox Connection Error</div>
						{:else if env.error_message.includes('timed out') || env.error_message.includes('TIMEOUT')}
							<div class="error-category">Timeout Error</div>
						{:else if env.error_message.includes('template') || env.error_message.includes('no such file')}
							<div class="error-category">Template Error</div>
						{/if}
						<pre class="error-detail">{env.error_message}</pre>
					</div>
				{/if}
				<div class="error-actions">
					<button class="btn btn-sm btn-primary" onclick={() => retryProvisioning()} disabled={actionLoading}>
						{actionLoading ? 'Retrying...' : 'Retry Provisioning'}
					</button>
					<button class="btn btn-sm btn-danger" onclick={() => destroyAndGoBack()} disabled={actionLoading}>
						Destroy Environment
					</button>
				</div>
			</div>
		</div>
		{#if provisioningProgress && provisioningProgress.phases.length > 0}
			<div class="provisioning-section card" style="margin-top: 16px">
				<h3 class="provisioning-title">Provisioning Log</h3>
				<ProvisioningProgressComponent progress={provisioningProgress} />
			</div>
		{/if}
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

	.dispatch-header {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 4px;
	}
	.dispatch-header h3 { margin-bottom: 0; }
	.persona-badge {
		font-size: 0.75rem;
		padding: 2px 10px;
		background: var(--bg-tertiary);
		border-radius: 10px;
		color: var(--text-secondary);
		white-space: nowrap;
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

	/* ---- Provisioning section ---- */

	.provisioning-section {
		padding: 20px 24px;
	}

	.provisioning-title {
		font-size: 0.9375rem;
		font-weight: 600;
		margin-bottom: 16px;
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

	.error-header-icon { margin-bottom: 8px; }
	.error-title { font-size: 1rem; font-weight: 600; color: var(--error); margin: 0 0 12px; }

	.error-detail-box {
		max-width: 700px; text-align: left; width: 100%;
	}
	.error-category {
		font-size: 0.6875rem; font-weight: 700; text-transform: uppercase;
		letter-spacing: 0.04em; color: var(--error); margin-bottom: 6px;
		padding: 2px 8px; background: rgba(239,68,68,0.1); border-radius: 3px;
		display: inline-block;
	}
	.error-detail {
		max-width: 700px;
		font-size: 0.75rem;
		font-family: 'SF Mono', monospace;
		background-color: rgba(239, 68, 68, 0.06);
		border: 1px solid rgba(239, 68, 68, 0.15);
		color: var(--text-primary);
		padding: 12px 16px;
		border-radius: var(--radius-sm);
		white-space: pre-wrap;
		word-break: break-word;
		text-align: left;
		max-height: 250px;
		overflow-y: auto;
		line-height: 1.6;
		margin: 0;
	}
	.error-actions {
		display: flex; gap: 8px; margin-top: 16px;
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

	.docker-tag {
		font-size: 0.6875rem;
		font-weight: 600;
		padding: 2px 8px;
		background-color: rgba(34, 197, 94, 0.12);
		color: #22c55e;
		border-radius: 3px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	/* ---- Agent Grid (Docker Multi-Agent) ---- */

	.agent-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 4px;
	}

	.agent-header h3 {
		font-size: 0.9375rem;
		font-weight: 600;
		margin: 0;
	}

	.add-agent-form {
		display: flex;
		align-items: flex-end;
		gap: 12px;
		padding: 16px 20px;
	}

	.add-agent-form .form-group {
		flex: 1;
		margin: 0;
	}

	.add-agent-form label {
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--text-secondary);
		margin-bottom: 4px;
		display: block;
	}

	.agent-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
		gap: 12px;
	}

	.agent-card {
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.agent-card-header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 8px;
	}

	.agent-identity {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.agent-avatar {
		font-size: 1.5rem;
	}

	.agent-name {
		font-weight: 600;
		font-size: 0.875rem;
	}

	.agent-role {
		font-size: 0.75rem;
		color: var(--text-secondary);
	}

	.agent-service code {
		font-size: 0.6875rem;
		color: var(--text-secondary);
		background-color: rgba(255, 255, 255, 0.04);
		padding: 2px 6px;
		border-radius: 3px;
		font-family: 'SF Mono', 'Fira Code', monospace;
	}

	.agent-error {
		font-size: 0.75rem;
		color: var(--error);
		background-color: rgba(239, 68, 68, 0.08);
		padding: 6px 10px;
		border-radius: var(--radius-sm);
	}

	.agent-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-top: auto;
	}

	.empty-agents {
		text-align: center;
		padding: 32px 20px;
		color: var(--text-secondary);
		font-size: 0.875rem;
	}

	.dc-dispatch-section {
		padding: 16px 20px;
	}

	.dc-dispatch-form {
		display: flex;
		flex-direction: column;
		gap: 10px;
		margin-top: 8px;
	}

	.dc-dispatch-form textarea {
		resize: vertical;
		min-height: 60px;
	}

	.dispatch-actions {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 10px;
	}

	.keyboard-hint {
		font-size: 0.6875rem;
		font-family: 'SF Mono', 'Fira Code', monospace;
		color: var(--text-secondary);
		background: rgba(255, 255, 255, 0.06);
		padding: 2px 8px;
		border-radius: 4px;
		border: 1px solid var(--border);
	}

</style>
