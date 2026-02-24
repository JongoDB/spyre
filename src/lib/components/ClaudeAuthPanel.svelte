<script lang="ts">
	import type { ClaudeAuthState, ClaudeCliStatus } from '$lib/types/claude';
	import { addToast } from '$lib/stores/toast.svelte';

	interface Props {
		authState: ClaudeAuthState;
		cliStatus?: ClaudeCliStatus;
		compact?: boolean;
	}

	let { authState, cliStatus, compact = false }: Props = $props();

	let loading = $state(false);
	let installing = $state(false);
	let authTab = $state<'token' | 'oauth'>('token');
	let tokenInput = $state('');
	let codeInput = $state('');
	let submittingToken = $state(false);
	let submittingCode = $state(false);

	const isCliInstalled = $derived(cliStatus?.installed ?? authState.cliInstalled);

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

	async function installCli() {
		installing = true;
		try {
			const res = await fetch('/api/claude/cli/install', { method: 'POST' });
			const data = await res.json();
			if (res.ok) {
				addToast('Claude CLI installed successfully', 'success');
				// Refresh CLI status
				const statusRes = await fetch('/api/claude/cli');
				if (statusRes.ok) {
					cliStatus = await statusRes.json();
				}
			} else {
				addToast(data.error ?? 'Installation failed', 'error');
			}
		} catch {
			addToast('Network error during installation', 'error');
		} finally {
			installing = false;
		}
	}

	async function submitToken() {
		if (!tokenInput.trim()) return;
		submittingToken = true;
		try {
			const res = await fetch('/api/claude/auth/setup-token', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ token: tokenInput.trim() })
			});
			const data = await res.json();
			if (res.ok) {
				addToast('Token configured successfully', 'success');
				tokenInput = '';
				await refresh();
			} else {
				addToast(data.error ?? 'Token setup failed', 'error');
			}
		} catch {
			addToast('Network error during token setup', 'error');
		} finally {
			submittingToken = false;
		}
	}

	async function initiateOAuth() {
		loading = true;
		try {
			const res = await fetch('/auth/claude/initiate', { method: 'POST' });
			const data = await res.json();
			if (data.oauthUrl) {
				authState = { ...authState, status: 'waiting_for_callback', oauthUrl: data.oauthUrl };
				window.open(data.oauthUrl, '_blank');
			} else if (data.error) {
				addToast(data.error, 'error');
			} else if (!res.ok) {
				addToast(data.message ?? 'Failed to start authentication', 'error');
			}
		} catch {
			addToast('Network error during authentication', 'error');
		} finally {
			loading = false;
		}
	}

	async function submitOAuthCode() {
		if (!codeInput.trim()) return;
		submittingCode = true;
		try {
			const res = await fetch('/api/claude/auth/submit-code', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ code: codeInput.trim() })
			});
			const data = await res.json();
			if (res.ok) {
				addToast('Authentication completed successfully', 'success');
				codeInput = '';
				await refresh();
			} else {
				addToast(data.error ?? 'Code submission failed', 'error');
			}
		} catch {
			addToast('Network error during code submission', 'error');
		} finally {
			submittingCode = false;
		}
	}

	async function cancel() {
		await fetch('/auth/claude/cancel', { method: 'POST' });
		await refresh();
	}

	async function refresh() {
		const res = await fetch('/auth/claude/status');
		if (res.ok) {
			authState = await res.json();
		}
	}

	async function signOut() {
		await fetch('/auth/claude/cancel', { method: 'POST' });
		authState = { ...authState, status: 'idle', email: null, subscriptionType: null, authMethod: null };
		addToast('Signed out', 'success');
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
	<!-- CLI Status Section -->
	<div class="cli-panel card">
		<div class="cli-header">
			<div class="cli-status">
				<div class="status-dot" style="background-color: {isCliInstalled ? 'var(--success)' : 'var(--text-secondary)'}; box-shadow: 0 0 6px {isCliInstalled ? 'var(--success)' : 'transparent'}"></div>
				<div>
					<h3>Claude CLI</h3>
					<p class="status-text">
						{#if isCliInstalled}
							Installed{#if cliStatus?.version} — {cliStatus.version}{/if}
						{:else}
							Not installed
						{/if}
					</p>
				</div>
			</div>
			<div class="cli-actions">
				{#if !isCliInstalled}
					<button class="btn btn-primary btn-sm" onclick={installCli} disabled={installing}>
						{installing ? 'Installing...' : 'Install Claude CLI'}
					</button>
				{:else if cliStatus?.path}
					<code class="cli-path">{cliStatus.path}</code>
				{/if}
			</div>
		</div>
	</div>

	<!-- Auth Panel -->
	<div class="auth-panel card">
		<div class="auth-header">
			<div class="auth-status">
				<div class="status-dot" style="background-color: {statusColor}; box-shadow: 0 0 6px {statusColor}"></div>
				<div>
					<h3>Authentication</h3>
					<p class="status-text">{statusLabel}</p>
				</div>
			</div>
			{#if authState.status === 'authenticated'}
				<div class="auth-actions">
					<button class="btn btn-secondary btn-sm" onclick={refresh}>Refresh</button>
					<button class="btn btn-secondary btn-sm" onclick={signOut}>Sign Out</button>
				</div>
			{/if}
		</div>

		{#if authState.error}
			<div class="auth-error">
				<p>{authState.error}</p>
			</div>
		{/if}

		{#if authState.status === 'authenticated'}
			<!-- Authenticated details -->
			<div class="auth-details">
				{#if authState.email}
					<div class="detail-item">
						<span class="detail-label">Account</span>
						<span class="detail-value">{authState.email}</span>
					</div>
				{/if}
				{#if authState.subscriptionType}
					<div class="detail-item">
						<span class="detail-label">Plan</span>
						<span class="detail-value">{authState.subscriptionType}</span>
					</div>
				{/if}
				{#if authState.authMethod}
					<div class="detail-item">
						<span class="detail-label">Method</span>
						<span class="detail-value">{authState.authMethod === 'token' ? 'API Key / Token' : 'OAuth'}</span>
					</div>
				{/if}
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
		{:else if !isCliInstalled}
			<!-- CLI not installed — disable auth -->
			<div class="auth-disabled">
				<p>Install the Claude CLI above before configuring authentication.</p>
			</div>
		{:else if authState.status === 'waiting_for_callback'}
			<!-- OAuth in progress — show code paste input -->
			<div class="oauth-active">
				<p class="oauth-hint">Complete the authorization in your browser. Once approved, you'll receive an auth code — paste it below.</p>
				<div class="code-input-row">
					<input
						type="text"
						class="form-input"
						placeholder="Paste auth code here..."
						bind:value={codeInput}
					/>
					<button class="btn btn-primary btn-sm" onclick={submitOAuthCode} disabled={submittingCode || !codeInput.trim()}>
						{submittingCode ? 'Submitting...' : 'Submit'}
					</button>
					<button class="btn btn-secondary btn-sm" onclick={cancel}>Cancel</button>
				</div>
			</div>
		{:else}
			<!-- Not authenticated — show two-tab auth UI -->
			<div class="auth-tabs">
				<div class="auth-tab-bar">
					<button
						type="button"
						class="auth-tab"
						class:active={authTab === 'token'}
						onclick={() => authTab = 'token'}
					>
						API Key / Token
					</button>
					<button
						type="button"
						class="auth-tab"
						class:active={authTab === 'oauth'}
						onclick={() => authTab = 'oauth'}
					>
						OAuth
					</button>
				</div>

				{#if authTab === 'token'}
					<div class="auth-tab-content">
						<p class="auth-tab-hint">
							Go to <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener noreferrer">console.anthropic.com</a> and generate an API key. Paste it below.
						</p>
						<div class="token-input-row">
							<input
								type="password"
								class="form-input"
								placeholder="sk-ant-..."
								bind:value={tokenInput}
								autocomplete="off"
							/>
							<button class="btn btn-primary btn-sm" onclick={submitToken} disabled={submittingToken || !tokenInput.trim()}>
								{submittingToken ? 'Setting up...' : 'Submit'}
							</button>
						</div>
					</div>
				{:else}
					<div class="auth-tab-content">
						<p class="auth-tab-hint">
							Start an OAuth flow. You'll authorize in your browser, then paste the auth code back here.
						</p>
						<button class="btn btn-primary btn-sm" onclick={initiateOAuth} disabled={loading}>
							{loading ? 'Starting...' : 'Start OAuth Flow'}
						</button>
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

	/* CLI panel */
	.cli-panel {
		padding: 20px;
		margin-bottom: 16px;
	}

	.cli-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
	}

	.cli-status {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.cli-status h3 {
		font-size: 0.9375rem;
		font-weight: 600;
		margin-bottom: 2px;
	}

	.cli-path {
		font-size: 0.75rem;
		font-family: 'SF Mono', 'Fira Code', monospace;
		color: var(--text-secondary);
		background-color: rgba(255, 255, 255, 0.04);
		padding: 4px 8px;
		border-radius: var(--radius-sm);
	}

	.cli-actions {
		display: flex;
		gap: 8px;
		align-items: center;
	}

	/* Auth panel */
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

	.auth-status h3, .cli-status h3 {
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

	/* Auth disabled */
	.auth-disabled {
		margin-top: 16px;
		padding: 16px;
		background-color: rgba(255, 255, 255, 0.02);
		border-radius: var(--radius-sm);
		border: 1px solid var(--border);
		text-align: center;
	}

	.auth-disabled p {
		font-size: 0.8125rem;
		color: var(--text-secondary);
	}

	/* Auth tabs */
	.auth-tabs {
		margin-top: 16px;
		padding-top: 16px;
		border-top: 1px solid var(--border);
	}

	.auth-tab-bar {
		display: flex;
		gap: 2px;
		background-color: var(--bg-secondary);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: 2px;
		margin-bottom: 16px;
	}

	.auth-tab {
		flex: 1;
		padding: 8px 12px;
		border: none;
		border-radius: 4px;
		background: transparent;
		color: var(--text-secondary);
		font-size: 0.8125rem;
		font-weight: 500;
		cursor: pointer;
		transition: all var(--transition);
	}

	.auth-tab:hover {
		color: var(--text-primary);
	}

	.auth-tab.active {
		background-color: rgba(99, 102, 241, 0.15);
		color: var(--accent);
	}

	.auth-tab-content {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.auth-tab-hint {
		font-size: 0.8125rem;
		color: var(--text-secondary);
		line-height: 1.5;
	}

	.auth-tab-hint a {
		color: var(--accent);
	}

	.token-input-row,
	.code-input-row {
		display: flex;
		gap: 8px;
	}

	.token-input-row .form-input,
	.code-input-row .form-input {
		flex: 1;
	}

	/* OAuth active state */
	.oauth-active {
		margin-top: 16px;
		padding-top: 16px;
		border-top: 1px solid var(--border);
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.oauth-hint {
		font-size: 0.8125rem;
		color: var(--text-secondary);
		line-height: 1.5;
	}
</style>
