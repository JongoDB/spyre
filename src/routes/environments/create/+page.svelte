<script lang="ts">
	import { goto } from '$app/navigation';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// Form state
	let name = $state('');
	let type = $state<'lxc' | 'vm'>('lxc');
	let template = $state('');
	let cores = $state(1);
	let memory = $state(512);
	let disk = $state(8);

	// UI state
	let submitting = $state(false);
	let errorMessage = $state('');

	let isValid = $derived(
		name.trim().length > 0 && template.length > 0 && cores > 0 && memory > 0 && disk > 0
	);

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		if (!isValid || submitting) return;

		submitting = true;
		errorMessage = '';

		try {
			const res = await fetch('/api/environments', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: name.trim(),
					type,
					template,
					cores,
					memory,
					disk
				})
			});

			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				errorMessage = body.message ?? `Creation failed (HTTP ${res.status}).`;
				return;
			}

			await goto('/environments');
		} catch {
			errorMessage = 'Network error. Please check your connection and try again.';
		} finally {
			submitting = false;
		}
	}
</script>

<div class="create-page">
	<header class="page-header">
		<a href="/environments" class="back-link">
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<path d="M19 12H5" />
				<polyline points="12 19 5 12 12 5" />
			</svg>
			Back to Environments
		</a>
		<h1>Create Environment</h1>
		<p class="subtitle">Provision a new development environment on Proxmox.</p>
	</header>

	{#if !data.proxmoxConnected}
		<div class="alert alert-error">
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<circle cx="12" cy="12" r="10" />
				<line x1="12" y1="8" x2="12" y2="12" />
				<line x1="12" y1="16" x2="12.01" y2="16" />
			</svg>
			<span>Proxmox is unreachable. Templates could not be loaded. Please check connectivity and reload.</span>
		</div>
	{/if}

	{#if errorMessage}
		<div class="alert alert-error">
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<circle cx="12" cy="12" r="10" />
				<line x1="15" y1="9" x2="9" y2="15" />
				<line x1="9" y1="9" x2="15" y2="15" />
			</svg>
			<span>{errorMessage}</span>
		</div>
	{/if}

	<form class="create-form card" onsubmit={handleSubmit}>
		<!-- Name -->
		<div class="form-group">
			<label for="env-name" class="form-label">Environment Name</label>
			<input
				id="env-name"
				type="text"
				class="form-input"
				placeholder="my-dev-env"
				autocomplete="off"
				bind:value={name}
				required
			/>
		</div>

		<!-- Type -->
		<div class="form-group">
			<label for="env-type" class="form-label">Type</label>
			<select id="env-type" class="form-select" bind:value={type}>
				<option value="lxc">LXC Container</option>
				<option value="vm">Virtual Machine</option>
			</select>
		</div>

		<!-- Template -->
		<div class="form-group">
			<label for="env-template" class="form-label">Template</label>
			{#if data.templates.length > 0}
				<select id="env-template" class="form-select" bind:value={template} required>
					<option value="" disabled>Select a template</option>
					{#each data.templates as tpl (tpl.volid)}
						<option value={tpl.volid}>{tpl.volid}</option>
					{/each}
				</select>
			{:else}
				<input
					id="env-template"
					type="text"
					class="form-input"
					placeholder="local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst"
					bind:value={template}
					required
				/>
				<span class="form-hint">No templates loaded from Proxmox. Enter a template ID manually.</span>
			{/if}
		</div>

		<!-- Resources row -->
		<div class="resource-grid">
			<div class="form-group">
				<label for="env-cores" class="form-label">CPU Cores</label>
				<input
					id="env-cores"
					type="number"
					class="form-input"
					min="1"
					max="64"
					bind:value={cores}
					required
				/>
			</div>

			<div class="form-group">
				<label for="env-memory" class="form-label">Memory (MB)</label>
				<input
					id="env-memory"
					type="number"
					class="form-input"
					min="128"
					step="128"
					bind:value={memory}
					required
				/>
			</div>

			<div class="form-group">
				<label for="env-disk" class="form-label">Disk (GB)</label>
				<input
					id="env-disk"
					type="number"
					class="form-input"
					min="1"
					max="1000"
					bind:value={disk}
					required
				/>
			</div>
		</div>

		<!-- Summary -->
		<div class="summary">
			<span class="summary-label">Summary</span>
			<span class="summary-text">
				{type === 'lxc' ? 'LXC Container' : 'Virtual Machine'}
				&mdash; {cores} vCPU, {memory} MB RAM, {disk} GB disk
			</span>
		</div>

		<!-- Actions -->
		<div class="form-actions">
			<a href="/environments" class="btn btn-secondary">Cancel</a>
			<button
				type="submit"
				class="btn btn-primary"
				disabled={!isValid || submitting || !data.proxmoxConnected}
			>
				{#if submitting}
					<span class="spinner"></span>
					Creating...
				{:else}
					Create Environment
				{/if}
			</button>
		</div>
	</form>
</div>

<style>
	.create-page {
		max-width: 640px;
	}

	.page-header {
		margin-bottom: 24px;
	}

	.back-link {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 0.8125rem;
		color: var(--text-secondary);
		margin-bottom: 16px;
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

	/* ---- Alert ---- */

	.alert {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		padding: 12px 16px;
		border-radius: var(--radius);
		margin-bottom: 20px;
		font-size: 0.8125rem;
		line-height: 1.5;
	}

	.alert svg {
		flex-shrink: 0;
		margin-top: 1px;
	}

	.alert-error {
		background-color: rgba(239, 68, 68, 0.08);
		border: 1px solid rgba(239, 68, 68, 0.2);
		color: var(--error);
	}

	/* ---- Form ---- */

	.create-form {
		display: flex;
		flex-direction: column;
		gap: 20px;
	}

	.resource-grid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 16px;
	}

	@media (max-width: 540px) {
		.resource-grid {
			grid-template-columns: 1fr;
		}
	}

	.form-hint {
		font-size: 0.75rem;
		color: var(--text-secondary);
		opacity: 0.7;
	}

	/* ---- Summary ---- */

	.summary {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 12px 16px;
		background-color: rgba(255, 255, 255, 0.02);
		border-radius: var(--radius-sm);
		border: 1px solid var(--border);
	}

	.summary-label {
		font-size: 0.6875rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-secondary);
	}

	.summary-text {
		font-size: 0.875rem;
		font-weight: 500;
	}

	/* ---- Actions ---- */

	.form-actions {
		display: flex;
		justify-content: flex-end;
		gap: 10px;
		padding-top: 8px;
		border-top: 1px solid var(--border);
	}

	/* ---- Spinner ---- */

	.spinner {
		display: inline-block;
		width: 14px;
		height: 14px;
		border: 2px solid rgba(255, 255, 255, 0.25);
		border-top-color: #fff;
		border-radius: 50%;
		animation: spin 0.6s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}
</style>
