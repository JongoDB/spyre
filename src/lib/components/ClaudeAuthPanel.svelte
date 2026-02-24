<script lang="ts">
	import type { ClaudeAuthState } from '$lib/types/claude';
	import { addToast } from '$lib/stores/toast.svelte';

	interface Props {
		authState: ClaudeAuthState;
		compact?: boolean;
	}

	let { authState, compact = false }: Props = $props();

	let loading = $state(false);

	const statusColor = $derived(
		authState.status === 'authenticated' ? 'var(--success)' :
		authState.status === 'error' ? 'var(--error)' :
		authState.status === 'waiting_for_oauth' || authState.status === 'waiting_for_callback' ? 'var(--warning)' :
		'var(--text-secondary)'
	);

	const statusLabel = $derived(
		authState.status === 'authenticated' ? 'Authenticated' :
		authState.status === 'error' ? 'Error' :
		authState.status === 'waiting_for_oauth' ? 'Waiting for OAuth...' :
		authState.status === 'waiting_for_callback' ? 'Complete login in browser...' :
		'Not authenticated'
	);

	async function initiate() {
		loading = true;
		try {
			const res = await fetch('/auth/claude/initiate', { method: 'POST' });
			const data = await res.json();
			if (data.oauthUrl) {
				window.open(data.oauthUrl, '_blank');
			} else if (!res.ok) {
				addToast(data.message ?? 'Failed to start authentication', 'error');
			}
		} catch {
			addToast('Network error during authentication', 'error');
		} finally {
			loading = false;
		}
	}

	async function cancel() {
		await fetch('/auth/claude/cancel', { method: 'POST' });
	}

	async function refresh() {
		const res = await fetch('/auth/claude/status');
		if (res.ok) {
			authState = await res.json();
		}
	}
</script>

{#if compact}
	<!-- Compact banner for dashboard -->
	<div class="auth-banner" class:authenticated={authState.status === 'authenticated'} class:error={authState.status === 'error'}>
		<div class="auth-dot" style="background-color: {statusColor}"></div>
		<span class="auth-label">Claude: {statusLabel}</span>
		{#if authState.status !== 'authenticated' && authState.status !== 'waiting_for_oauth' && authState.status !== 'waiting_for_callback'}
			<a href="/settings/claude" class="auth-action">Configure</a>
		{/if}
	</div>
{:else}
	<!-- Full panel for settings -->
	<div class="auth-panel card">
		<div class="auth-header">
			<div class="auth-status">
				<div class="status-dot" style="background-color: {statusColor}; box-shadow: 0 0 6px {statusColor}"></div>
				<div>
					<h3>Claude Code Authentication</h3>
					<p class="status-text">{statusLabel}</p>
				</div>
			</div>
			<div class="auth-actions">
				{#if authState.status === 'idle' || authState.status === 'error'}
					<button class="btn btn-primary btn-sm" onclick={initiate} disabled={loading}>
						{loading ? 'Starting...' : 'Authenticate'}
					</button>
				{:else if authState.status === 'waiting_for_oauth' || authState.status === 'waiting_for_callback'}
					{#if authState.oauthUrl}
						<a href={authState.oauthUrl} target="_blank" rel="noopener noreferrer" class="btn btn-primary btn-sm">
							Open Login Page
						</a>
					{/if}
					<button class="btn btn-secondary btn-sm" onclick={cancel}>Cancel</button>
				{:else if authState.status === 'authenticated'}
					<button class="btn btn-secondary btn-sm" onclick={refresh}>Refresh</button>
				{/if}
			</div>
		</div>

		{#if authState.error}
			<div class="auth-error">
				<p>{authState.error}</p>
			</div>
		{/if}

		{#if authState.status === 'authenticated'}
			<div class="auth-details">
				{#if authState.lastAuthenticated}
					<div class="detail-item">
						<span class="detail-label">Authenticated</span>
						<span class="detail-value">{new Date(authState.lastAuthenticated).toLocaleString()}</span>
					</div>
				{/if}
				{#if authState.tokenExpiresAt}
					<div class="detail-item">
						<span class="detail-label">Token Expires</span>
						<span class="detail-value">{new Date(authState.tokenExpiresAt).toLocaleString()}</span>
					</div>
				{/if}
			</div>
		{/if}
	</div>
{/if}

<style>
	/* Compact banner */
	.auth-banner {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 16px;
		border-radius: var(--radius);
		border: 1px solid var(--border);
		font-size: 0.8125rem;
	}

	.auth-banner.authenticated {
		background-color: rgba(34, 197, 94, 0.06);
		border-color: rgba(34, 197, 94, 0.2);
	}

	.auth-banner.error {
		background-color: rgba(239, 68, 68, 0.06);
		border-color: rgba(239, 68, 68, 0.2);
	}

	.auth-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.auth-label {
		flex: 1;
		font-weight: 500;
	}

	.auth-action {
		font-size: 0.75rem;
		color: var(--accent);
		text-decoration: none;
		font-weight: 500;
	}

	.auth-action:hover {
		text-decoration: underline;
	}

	/* Full panel */
	.auth-panel {
		padding: 20px;
	}

	.auth-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
	}

	.auth-status {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.status-dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.auth-status h3 {
		font-size: 0.9375rem;
		font-weight: 600;
		margin-bottom: 2px;
	}

	.status-text {
		font-size: 0.8125rem;
		color: var(--text-secondary);
	}

	.auth-actions {
		display: flex;
		gap: 8px;
	}

	.auth-error {
		margin-top: 12px;
		padding: 10px 14px;
		background-color: rgba(239, 68, 68, 0.08);
		border-radius: var(--radius-sm);
		color: var(--error);
		font-size: 0.8125rem;
	}

	.auth-details {
		margin-top: 16px;
		padding-top: 16px;
		border-top: 1px solid var(--border);
		display: flex;
		flex-wrap: wrap;
		gap: 8px 24px;
	}

	.detail-item {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.detail-label {
		font-size: 0.6875rem;
		color: var(--text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.03em;
		font-weight: 500;
	}

	.detail-value {
		font-size: 0.8125rem;
		font-family: 'SF Mono', 'Fira Code', monospace;
	}
</style>
