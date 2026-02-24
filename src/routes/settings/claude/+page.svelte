<script lang="ts">
	import type { PageData } from './$types';
	import ClaudeAuthPanel from '$lib/components/ClaudeAuthPanel.svelte';
	import { addToast } from '$lib/stores/toast.svelte';

	let { data }: { data: PageData } = $props();

	let propagating = $state(false);
	let propagateResult = $state<{ message: string; results: Array<{ envId: string; name: string; success: boolean; error?: string }> } | null>(null);

	async function propagateAuth() {
		propagating = true;
		propagateResult = null;
		try {
			const res = await fetch('/api/claude/propagate-auth', { method: 'POST' });
			const body = await res.json();
			if (!res.ok) {
				addToast(body.error ?? 'Failed to propagate credentials', 'error');
			} else {
				propagateResult = body;
				addToast(body.message, 'success');
			}
		} catch {
			addToast('Network error during credential propagation', 'error');
		} finally {
			propagating = false;
		}
	}
</script>

<div class="claude-settings">
	<header class="page-header">
		<a href="/settings" class="back-link">
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<path d="M19 12H5" /><path d="M12 19l-7-7 7-7" />
			</svg>
			Settings
		</a>
		<h1>Claude Code</h1>
		<p class="subtitle">Manage Claude Code authentication and configuration.</p>
	</header>

	<!-- Auth Panel -->
	<section class="section">
		<ClaudeAuthPanel authState={data.authState} />
	</section>

	<!-- Configuration -->
	<section class="section">
		<h2>Configuration</h2>
		<div class="config-grid card">
			<div class="config-item">
				<span class="config-label">Auth Method</span>
				<code>{data.claudeConfig.auth_method ?? 'oauth'}</code>
			</div>
			<div class="config-item">
				<span class="config-label">Health Check Interval</span>
				<code>{((data.claudeConfig.health_check_interval ?? 60000) / 1000).toFixed(0)}s</code>
			</div>
			<div class="config-item">
				<span class="config-label">Task Timeout</span>
				<code>{((data.claudeConfig.task_timeout ?? 600000) / 1000).toFixed(0)}s</code>
			</div>
			<div class="config-item">
				<span class="config-label">Auth JSON Path</span>
				<code>{data.claudeConfig.auth_json_path ?? '~/.claude/.credentials.json'}</code>
			</div>
		</div>
	</section>

	<!-- Environment Setup -->
	<section class="section">
		<h2>Environment Setup</h2>
		<div class="card setup-card">
			<div class="setup-info">
				<p>Claude CLI is automatically installed in new environments during provisioning. Credentials from this controller are propagated so Claude works immediately.</p>
				<p class="setup-hint">If you re-authenticate or environments were created before auth was configured, use the button below to push credentials to all running environments.</p>
			</div>
			<div class="setup-actions">
				<button class="btn btn-primary btn-sm" onclick={propagateAuth} disabled={propagating}>
					{propagating ? 'Propagating...' : 'Propagate Auth to Environments'}
				</button>
			</div>
			{#if propagateResult}
				<div class="propagate-results">
					{#each propagateResult.results as r}
						<div class="propagate-item" class:success={r.success} class:fail={!r.success}>
							<span class="propagate-dot"></span>
							<span class="propagate-name">{r.name}</span>
							<span class="propagate-status">{r.success ? 'Done' : r.error ?? 'Failed'}</span>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</section>

	<!-- Auth Log -->
	<section class="section">
		<h2>Auth Event Log</h2>
		{#if data.authLog.length === 0}
			<div class="card empty-log">No events recorded yet.</div>
		{:else}
			<div class="log-table card">
				<table>
					<thead>
						<tr>
							<th>Time</th>
							<th>Event</th>
							<th>Details</th>
						</tr>
					</thead>
					<tbody>
						{#each data.authLog as entry}
							<tr>
								<td class="log-time">{new Date(entry.timestamp).toLocaleString()}</td>
								<td>
									<span class="badge badge-{entry.event === 'authenticated' ? 'running' : entry.event === 'error' ? 'error' : 'stopped'}">
										{entry.event}
									</span>
								</td>
								<td class="log-details">{entry.details ?? '-'}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>
</div>

<style>
	.claude-settings {
		max-width: 800px;
	}

	.page-header {
		margin-bottom: 24px;
	}

	.back-link {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		color: var(--text-secondary);
		font-size: 0.8125rem;
		font-weight: 500;
		text-decoration: none;
		margin-bottom: 8px;
		transition: color var(--transition);
	}

	.back-link:hover {
		color: var(--text-primary);
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

	.section {
		margin-bottom: 28px;
	}

	.section h2 {
		font-size: 1rem;
		font-weight: 600;
		margin-bottom: 12px;
	}

	.config-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		gap: 16px;
		padding: 16px 20px;
	}

	.config-item {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.config-label {
		font-size: 0.6875rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.03em;
		color: var(--text-secondary);
	}

	.config-item code {
		font-size: 0.8125rem;
		font-family: 'SF Mono', 'Fira Code', monospace;
	}

	.log-table {
		overflow-x: auto;
		padding: 0;
	}

	.log-table table {
		width: 100%;
		border-collapse: collapse;
	}

	.log-table th {
		font-size: 0.6875rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-secondary);
		text-align: left;
		padding: 10px 16px;
		border-bottom: 1px solid var(--border);
	}

	.log-table td {
		padding: 8px 16px;
		font-size: 0.8125rem;
		border-bottom: 1px solid var(--border);
		vertical-align: top;
	}

	.log-table tr:last-child td {
		border-bottom: none;
	}

	.log-time {
		font-size: 0.75rem;
		color: var(--text-secondary);
		white-space: nowrap;
	}

	.log-details {
		font-size: 0.75rem;
		font-family: 'SF Mono', 'Fira Code', monospace;
		color: var(--text-secondary);
		max-width: 300px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.empty-log {
		text-align: center;
		padding: 24px;
		color: var(--text-secondary);
		font-size: 0.875rem;
	}

	/* ---- Environment Setup ---- */

	.setup-card {
		padding: 20px;
	}

	.setup-info p {
		font-size: 0.8125rem;
		color: var(--text-secondary);
		margin-bottom: 8px;
		line-height: 1.5;
	}

	.setup-hint {
		font-size: 0.75rem !important;
		opacity: 0.7;
	}

	.setup-actions {
		margin-top: 12px;
	}

	.propagate-results {
		margin-top: 16px;
		padding-top: 12px;
		border-top: 1px solid var(--border);
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.propagate-item {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 0.8125rem;
	}

	.propagate-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.propagate-item.success .propagate-dot {
		background-color: var(--success);
	}

	.propagate-item.fail .propagate-dot {
		background-color: var(--error);
	}

	.propagate-name {
		font-weight: 500;
	}

	.propagate-status {
		color: var(--text-secondary);
		font-size: 0.75rem;
		margin-left: auto;
	}
</style>
