<script lang="ts">
	import type { PageData } from './$types';
	import { addToast } from '$lib/stores/toast.svelte';

	let { data }: { data: PageData } = $props();

	let configured = $state(data.configured);
	let preview = $state(data.preview);
	let tokenInput = $state('');
	let saving = $state(false);
	let deleting = $state(false);

	async function handleSave() {
		if (!tokenInput.trim()) return;
		saving = true;

		try {
			const res = await fetch('/api/settings/github', {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ token: tokenInput.trim() })
			});

			if (!res.ok) {
				const err = await res.json().catch(() => ({ message: res.statusText }));
				throw new Error(err.message ?? `HTTP ${res.status}`);
			}

			configured = true;
			preview = `${tokenInput.slice(0, 8)}...${tokenInput.slice(-4)}`;
			tokenInput = '';
			addToast('GitHub token saved.', 'success');
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			addToast(msg, 'error');
		} finally {
			saving = false;
		}
	}

	async function handleDelete() {
		if (!confirm('Remove the GitHub token? Environments will no longer be able to push/pull.')) return;
		deleting = true;

		try {
			const res = await fetch('/api/settings/github', { method: 'DELETE' });
			if (!res.ok) {
				const err = await res.json().catch(() => ({ message: res.statusText }));
				throw new Error(err.message ?? `HTTP ${res.status}`);
			}

			configured = false;
			preview = null;
			addToast('GitHub token removed.', 'success');
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			addToast(msg, 'error');
		} finally {
			deleting = false;
		}
	}
</script>

<div class="github-page">
	<header class="page-header">
		<a href="/settings" class="back-link">&larr; Settings</a>
		<h1>GitHub</h1>
		<p class="subtitle">Configure a Personal Access Token for git operations in environments.</p>
	</header>

	<div class="card">
		<h3>Personal Access Token</h3>

		{#if configured}
			<div class="token-status">
				<span class="status-dot configured"></span>
				<span>Configured: <code>{preview}</code></span>
			</div>
		{:else}
			<div class="token-status">
				<span class="status-dot not-configured"></span>
				<span>Not configured</span>
			</div>
		{/if}

		<div class="token-form">
			<div class="form-group">
				<label for="token">{configured ? 'Replace token' : 'Token'}</label>
				<input
					id="token"
					type="password"
					bind:value={tokenInput}
					placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
					autocomplete="off"
				/>
			</div>

			<div class="form-actions">
				{#if configured}
					<button
						class="btn btn-ghost btn-danger"
						onclick={handleDelete}
						disabled={deleting}
					>
						{deleting ? 'Removing...' : 'Remove Token'}
					</button>
				{/if}
				<button
					class="btn btn-primary"
					onclick={handleSave}
					disabled={saving || !tokenInput.trim()}
				>
					{saving ? 'Saving...' : 'Save Token'}
				</button>
			</div>
		</div>

		<div class="scope-info">
			<h4>Required token scopes</h4>
			<ul>
				<li><code>repo</code> — Full control of private repositories</li>
				<li><code>read:org</code> — Read org membership (for org repos)</li>
			</ul>
			<p class="help-text">Create a token at GitHub Settings &gt; Developer settings &gt; Personal access tokens.</p>
		</div>
	</div>
</div>

<style>
	.github-page { max-width: 600px; }
	.page-header { margin-bottom: 24px; }
	.back-link { color: var(--text-secondary); text-decoration: none; font-size: 0.8125rem; }
	.back-link:hover { color: var(--accent); }
	.page-header h1 { font-size: 1.5rem; font-weight: 600; margin: 4px 0; }
	.subtitle { color: var(--text-secondary); font-size: 0.875rem; }

	.card h3 { font-size: 1.125rem; font-weight: 600; margin-bottom: 12px; }

	.token-status { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; font-size: 0.875rem; }
	.status-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
	.status-dot.configured { background: var(--success, #38a169); }
	.status-dot.not-configured { background: var(--text-tertiary); }
	.token-status code { font-size: 0.8125rem; background: var(--bg-tertiary); padding: 2px 6px; border-radius: 4px; }

	.token-form { margin-bottom: 20px; }
	.form-group { margin-bottom: 12px; }
	.form-group label { display: block; font-size: 0.8125rem; font-weight: 500; margin-bottom: 4px; color: var(--text-secondary); }
	.form-group input { width: 100%; }
	.form-actions { display: flex; justify-content: flex-end; gap: 8px; }

	.scope-info { border-top: 1px solid var(--border); padding-top: 16px; }
	.scope-info h4 { font-size: 0.8125rem; font-weight: 600; margin-bottom: 8px; }
	.scope-info ul { list-style: none; padding: 0; margin: 0 0 8px; }
	.scope-info li { font-size: 0.8125rem; color: var(--text-secondary); margin-bottom: 4px; }
	.scope-info code { font-size: 0.75rem; background: var(--bg-tertiary); padding: 1px 4px; border-radius: 3px; }
	.help-text { font-size: 0.75rem; color: var(--text-tertiary); }

	.btn-danger { color: var(--error, #e53e3e); }
	.btn-danger:hover { background: rgba(229, 62, 62, 0.1); }
</style>
