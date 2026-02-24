<script lang="ts">
	import type { PageData } from './$types';
	import ConfigFormEditor from '$lib/components/ConfigFormEditor.svelte';
	import ConfigYamlEditor from '$lib/components/ConfigYamlEditor.svelte';
	import { goto } from '$app/navigation';

	let { data }: { data: PageData } = $props();

	let mode = $state<'form' | 'yaml'>('form');
	let yamlText = $state(data.rawYaml);
	let formData = $state<Record<string, unknown> | null>(null);
	let saving = $state(false);
	let errorMessage = $state('');
	let successMessage = $state('');
	let loadingForm = $state(true);

	// Load form data on mount
	$effect(() => {
		loadFormData();
	});

	async function loadFormData() {
		loadingForm = true;
		try {
			const res = await fetch(`/api/configs/${encodeURIComponent(data.configName)}/form`);
			if (res.ok) {
				formData = await res.json();
			}
		} catch {
			// Fall back to YAML mode if form data can't be loaded
			mode = 'yaml';
		} finally {
			loadingForm = false;
		}
	}

	function switchToYaml() {
		// When switching from form to YAML, sync form data to YAML
		if (mode === 'form' && formData) {
			syncFormToYaml();
		}
		mode = 'yaml';
	}

	function switchToForm() {
		// When switching from YAML to form, sync YAML to form data
		if (mode === 'yaml') {
			syncYamlToForm();
		}
		mode = 'form';
	}

	async function syncFormToYaml() {
		if (!formData) return;
		try {
			// Use the API to convert form data back to YAML
			const res = await fetch(`/api/configs/${encodeURIComponent(data.configName)}/form`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(formData)
			});
			if (res.ok) {
				// Re-load the raw YAML
				const rawRes = await fetch(`/api/configs/${encodeURIComponent(data.configName)}`);
				if (rawRes.ok) {
					const result = await rawRes.json();
					yamlText = result.content ?? yamlText;
				}
			}
		} catch {
			// Keep current YAML
		}
	}

	async function syncYamlToForm() {
		try {
			// Save YAML first then load form data
			const saveRes = await fetch(`/api/configs/${encodeURIComponent(data.configName)}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ content: yamlText })
			});
			if (saveRes.ok) {
				await loadFormData();
			}
		} catch {
			// Keep current form data
		}
	}

	async function handleSave() {
		saving = true;
		errorMessage = '';
		successMessage = '';

		try {
			if (mode === 'form' && formData) {
				const res = await fetch(`/api/configs/${encodeURIComponent(data.configName)}/form`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(formData)
				});
				if (!res.ok) {
					const body = await res.json().catch(() => ({}));
					errorMessage = body.message ?? `Save failed (HTTP ${res.status}).`;
					return;
				}
				// Reload YAML text
				const rawRes = await fetch(`/api/configs/${encodeURIComponent(data.configName)}`);
				if (rawRes.ok) {
					const result = await rawRes.json();
					yamlText = result.content ?? yamlText;
				}
			} else {
				const res = await fetch(`/api/configs/${encodeURIComponent(data.configName)}`, {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ content: yamlText })
				});
				if (!res.ok) {
					const body = await res.json().catch(() => ({}));
					errorMessage = body.message ?? `Save failed (HTTP ${res.status}).`;
					return;
				}
			}
			successMessage = 'Config saved successfully.';
			setTimeout(() => successMessage = '', 3000);
		} catch {
			errorMessage = 'Network error.';
		} finally {
			saving = false;
		}
	}

	async function handleCreateEnv() {
		// Save first, then redirect to create page with this config pre-selected
		await handleSave();
		if (!errorMessage) {
			goto(`/environments/create?tab=config&config=${encodeURIComponent(data.configName)}`);
		}
	}
</script>

<div class="config-editor-page" class:yaml-mode={mode === 'yaml'}>
	<header class="page-header">
		<div class="header-left">
			<a href="/configs" class="back-link">
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>
				Configs
			</a>
			<h1>{data.configName}</h1>
		</div>
		<div class="header-actions">
			<button type="button" class="btn btn-secondary" onclick={handleCreateEnv}>
				Create Environment
			</button>
			<button type="button" class="btn btn-primary" onclick={handleSave} disabled={saving}>
				{saving ? 'Saving...' : 'Save'}
			</button>
		</div>
	</header>

	{#if errorMessage}
		<div class="alert alert-error">{errorMessage}</div>
	{/if}
	{#if successMessage}
		<div class="alert alert-success">{successMessage}</div>
	{/if}

	<!-- Mode toggle -->
	<div class="mode-toggle">
		<button type="button" class="mode-btn" class:active={mode === 'form'} onclick={switchToForm}>Form</button>
		<button type="button" class="mode-btn" class:active={mode === 'yaml'} onclick={switchToYaml}>YAML</button>
	</div>

	<!-- Editor -->
	<div class="editor-container">
		{#if mode === 'form'}
			{#if loadingForm}
				<div class="loading">Loading form data...</div>
			{:else if formData}
				<ConfigFormEditor bind:formData={formData as any} />
			{:else}
				<div class="loading">Unable to load form data. <button type="button" class="btn btn-secondary" onclick={() => mode = 'yaml'}>Switch to YAML</button></div>
			{/if}
		{:else}
			<ConfigYamlEditor bind:value={yamlText} />
		{/if}
	</div>
</div>

<style>
	.config-editor-page {
		max-width: 960px;
	}

	.config-editor-page.yaml-mode {
		max-width: 1200px;
	}

	.page-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 20px;
		gap: 16px;
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

	.page-header h1 {
		font-size: 1.25rem;
		font-weight: 600;
		font-family: 'SF Mono', 'Fira Code', monospace;
	}

	.header-actions {
		display: flex;
		gap: 8px;
	}

	.alert {
		padding: 10px 16px;
		border-radius: var(--radius-sm);
		margin-bottom: 16px;
		font-size: 0.8125rem;
	}

	.alert-error {
		background-color: rgba(239, 68, 68, 0.08);
		border: 1px solid rgba(239, 68, 68, 0.2);
		color: var(--error);
	}

	.alert-success {
		background-color: rgba(34, 197, 94, 0.08);
		border: 1px solid rgba(34, 197, 94, 0.2);
		color: var(--success);
	}

	.mode-toggle {
		display: flex;
		gap: 2px;
		background-color: var(--bg-secondary);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: 3px;
		margin-bottom: 16px;
		max-width: 240px;
	}

	.mode-btn {
		flex: 1;
		padding: 6px 16px;
		border: none;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--text-secondary);
		font-size: 0.8125rem;
		font-weight: 500;
		cursor: pointer;
		transition: all var(--transition);
	}

	.mode-btn:hover {
		color: var(--text-primary);
	}

	.mode-btn.active {
		background-color: rgba(99, 102, 241, 0.15);
		color: var(--accent);
	}

	.editor-container {
		flex: 1;
		min-height: 0;
	}

	.loading {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 24px;
		color: var(--text-secondary);
		font-size: 0.875rem;
	}
</style>
