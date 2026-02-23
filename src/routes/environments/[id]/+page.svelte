<script lang="ts">
	import type { PageData } from './$types';
	import type { Environment } from '$lib/types/environment';
	import TerminalTabs from '$lib/components/TerminalTabs.svelte';

	let { data }: { data: PageData } = $props();

	let env = $state<Environment>(data.environment);
	let metadata = $state<Record<string, unknown> | null>(data.metadata);
	let actionLoading = $state(false);
	let showPassword = $state(false);
	let copied = $state('');

	const rootPassword = $derived(
		metadata?.root_password ? String(metadata.root_password) : null
	);

	const communityScript = $derived(
		metadata?.community_script as { name?: string; interface_port?: number; slug?: string } | null
	);

	async function performAction(action: 'start' | 'stop') {
		actionLoading = true;
		try {
			const res = await fetch(`/api/environments/${env.id}/${action}`, { method: 'POST' });
			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				alert(body.message ?? `Failed to ${action} environment.`);
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
			alert(`Network error while trying to ${action} environment.`);
		} finally {
			actionLoading = false;
		}
	}

	function copyToClipboard(text: string, label: string) {
		navigator.clipboard.writeText(text);
		copied = label;
		setTimeout(() => { copied = ''; }, 2000);
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
							{copied === 'ip' ? '&#10003;' : '&#128203;'}
						</button>
					</span>
				</div>
			{/if}
			<div class="info-item">
				<span class="info-label">Type</span>
				<span class="info-value">{env.type.toUpperCase()}</span>
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
				<div class="info-item">
					<span class="info-label">SSH</span>
					<span class="info-value">
						<code>{env.ssh_user}@{env.ip_address}</code>
						<button class="copy-btn" onclick={() => copyToClipboard(`ssh ${env.ssh_user}@${env.ip_address}`, 'ssh')} title="Copy SSH command">
							{copied === 'ssh' ? '&#10003;' : '&#128203;'}
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
						<button class="copy-btn" onclick={() => { showPassword = !showPassword; }} title="Toggle password visibility">
							{showPassword ? '&#128065;' : '&#128064;'}
						</button>
						<button class="copy-btn" onclick={() => copyToClipboard(rootPassword, 'pw')} title="Copy password">
							{copied === 'pw' ? '&#10003;' : '&#128203;'}
						</button>
					</span>
				</div>
			{/if}
			{#if communityScript?.interface_port && env.ip_address}
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
	</div>

	<!-- Terminal -->
	{#if env.status === 'running'}
		<div class="terminal-section">
			<TerminalTabs envId={env.id} />
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

	/* ---- Info bar ---- */

	.info-bar {
		margin-bottom: 16px;
		flex-shrink: 0;
		padding: 14px 20px;
	}

	.info-items {
		display: flex;
		flex-wrap: wrap;
		gap: 12px 24px;
	}

	.info-item {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 0.8125rem;
	}

	.info-label {
		color: var(--text-secondary);
		font-weight: 500;
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
