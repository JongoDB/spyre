<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import YamlEditor from '$lib/components/YamlEditor.svelte';
	import type { PageData } from './$types';
	import type { ConfigValidationError } from '$lib/types/yaml-config';

	let { data }: { data: PageData } = $props();

	let content = $state(data.content);
	let configName = $state(data.name);
	let saving = $state(false);
	let importing = $state(false);
	let statusMessage = $state('');
	let statusType = $state<'success' | 'error' | ''>('');
	let validationErrors = $state<ConfigValidationError[]>([]);
	let validationWarnings = $state<ConfigValidationError[]>([]);
	let validationTimer: ReturnType<typeof setTimeout> | undefined;

	// Preview data from resolved config
	let preview = $state<Record<string, unknown> | null>(null);

	function handleEditorChange(newValue: string) {
		content = newValue;

		// Debounce validation
		if (validationTimer) clearTimeout(validationTimer);
		validationTimer = setTimeout(() => validateContent(newValue), 300);
	}

	async function validateContent(text: string) {
		try {
			const res = await fetch('/api/configs/validate', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ content: text }),
			});
			const result = await res.json();
			validationErrors = result.errors ?? [];
			validationWarnings = result.warnings ?? [];

			if (result.valid && result.config) {
				preview = result.config;
			} else {
				preview = null;
			}
		} catch {
			// Network error — don't update validation state
		}
	}

	async function handleSave() {
		if (!configName.trim()) {
			statusMessage = 'Please enter a config name.';
			statusType = 'error';
			return;
		}

		saving = true;
		statusMessage = '';
		statusType = '';

		try {
			const method = data.isExisting ? 'PUT' : 'POST';
			const url = data.isExisting
				? `/api/configs/${encodeURIComponent(configName)}`
				: '/api/configs';

			const body = data.isExisting
				? { content }
				: { name: configName, content };

			const res = await fetch(url, {
				method,
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body),
			});

			const result = await res.json();

			if (res.ok && result.valid !== false) {
				statusMessage = 'Config saved.';
				statusType = 'success';
				// Update URL to editing mode if was new
				if (!data.isExisting) {
					goto(`/configs/editor?name=${encodeURIComponent(configName)}`, { replaceState: true });
				}
			} else {
				statusMessage = result.errors?.[0]?.message ?? 'Validation failed.';
				statusType = 'error';
				validationErrors = result.errors ?? [];
			}
		} catch {
			statusMessage = 'Network error.';
			statusType = 'error';
		} finally {
			saving = false;
		}
	}

	async function handleImport() {
		if (!configName.trim()) {
			statusMessage = 'Save the config first before importing.';
			statusType = 'error';
			return;
		}

		// Save first, then import
		await handleSave();
		if (statusType === 'error') return;

		importing = true;
		statusMessage = '';

		try {
			const res = await fetch(`/api/configs/${encodeURIComponent(configName)}/import`, {
				method: 'POST',
			});

			if (res.ok) {
				const tpl = await res.json();
				statusMessage = `Imported as template: "${tpl.name}"`;
				statusType = 'success';
			} else {
				const body = await res.json().catch(() => ({}));
				statusMessage = body.message ?? `Import failed (HTTP ${res.status}).`;
				statusType = 'error';
			}
		} catch {
			statusMessage = 'Network error.';
			statusType = 'error';
		} finally {
			importing = false;
		}
	}

	// Initial validation on mount
	onMount(() => {
		validateContent(content);
	});
</script>

<div class="editor-page">
	<header class="page-header">
		<a href="/configs" class="back-link">
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<path d="M19 12H5" />
				<polyline points="12 19 5 12 12 5" />
			</svg>
			Back to Configs
		</a>
		<div class="header-row">
			<div class="header-info">
				<h1>{data.isExisting ? 'Edit Config' : 'New Config'}</h1>
				{#if !data.isExisting}
					<div class="name-input-row">
						<label for="config-name" class="form-label">Config Path</label>
						<input
							id="config-name"
							type="text"
							class="form-input name-input"
							placeholder="e.g., bases/ubuntu-dev or my-project"
							bind:value={configName}
						/>
						<span class="form-hint">.yaml extension added automatically</span>
					</div>
				{:else}
					<p class="editing-path">
						<code>{configName}.yaml</code>
					</p>
				{/if}
			</div>
			<div class="header-actions">
				<button
					type="button"
					class="btn btn-secondary"
					disabled={saving || importing}
					onclick={handleSave}
					title="Save YAML file to configs/ directory on disk"
				>
					{saving ? 'Saving...' : 'Save to Disk'}
				</button>
				<button
					type="button"
					class="btn btn-primary"
					disabled={saving || importing || validationErrors.length > 0}
					onclick={handleImport}
					title="Create a Spyre template from this config (saves first, then imports)"
				>
					{importing ? 'Importing...' : 'Import as Template'}
				</button>
			</div>
		</div>
	</header>

	{#if statusMessage}
		<div class="status-bar" class:success={statusType === 'success'} class:error={statusType === 'error'}>
			{statusMessage}
		</div>
	{/if}

	<div class="editor-layout">
		<div class="editor-pane">
			<div class="pane-header">
				<span>YAML Editor</span>
				<span class="validation-status">
					{#if validationErrors.length > 0}
						<span class="badge badge-error">{validationErrors.length} error{validationErrors.length !== 1 ? 's' : ''}</span>
					{:else}
						<span class="badge badge-ok">Valid</span>
					{/if}
					{#if validationWarnings.length > 0}
						<span class="badge badge-warn">{validationWarnings.length} warning{validationWarnings.length !== 1 ? 's' : ''}</span>
					{/if}
				</span>
			</div>
			<div class="editor-container">
				<YamlEditor
					bind:value={content}
					errors={validationErrors}
					onchange={handleEditorChange}
				/>
			</div>
		</div>

		<div class="preview-pane">
			<div class="pane-header">Preview</div>
			<div class="preview-content">
				{#if validationErrors.length > 0}
					<div class="error-list">
						{#each validationErrors as err}
							<div class="error-item">
								<span class="error-path">{err.path || 'root'}</span>
								<span class="error-msg">{err.message}</span>
								{#if err.line}
									<span class="error-line">line {err.line}</span>
								{/if}
							</div>
						{/each}
					</div>
				{:else if preview}
					{@render previewPanel(preview as Record<string, unknown>)}
				{:else}
					<p class="preview-empty">Edit the YAML to see a preview.</p>
				{/if}

				{#if validationWarnings.length > 0}
					<div class="warning-list">
						{#each validationWarnings as warn}
							<div class="warning-item">
								<span class="warning-path">{warn.path || 'root'}</span>
								<span class="warning-msg">{warn.message}</span>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	</div>
</div>

{#snippet previewPanel(config: Record<string, unknown>)}
	{@const meta = config.metadata as Record<string, unknown> | undefined}
	{@const spec = config.spec as Record<string, unknown> | undefined}
	{@const platform = spec?.platform as Record<string, unknown> | undefined}
	{@const resources = platform?.resources as Record<string, unknown> | undefined}
	{@const network = platform?.network as Record<string, unknown> | undefined}
	{@const provision = spec?.provision as Record<string, unknown> | undefined}
	{@const lxcSettings = spec?.lxc as Record<string, unknown> | undefined}
	{@const access = spec?.access as Record<string, unknown> | undefined}

	<div class="preview-sections">
		<div class="preview-section">
			<span class="preview-section-title">Metadata</span>
			<div class="preview-grid">
				<div class="preview-item">
					<span class="preview-key">Name</span>
					<span class="preview-value">{meta?.name ?? '—'}</span>
				</div>
				{#if meta?.description}
					<div class="preview-item full-width">
						<span class="preview-key">Description</span>
						<span class="preview-value">{meta.description}</span>
					</div>
				{/if}
				{#if config.extends}
					<div class="preview-item">
						<span class="preview-key">Extends</span>
						<span class="preview-value code">{config.extends}</span>
					</div>
				{/if}
			</div>
		</div>

		{#if platform}
			<div class="preview-section">
				<span class="preview-section-title">Platform</span>
				<div class="preview-grid">
					<div class="preview-item">
						<span class="preview-key">Type</span>
						<span class="preview-value">{platform.type === 'lxc' ? 'LXC Container' : 'VM'}</span>
					</div>
					{#if platform.template}
						<div class="preview-item full-width">
							<span class="preview-key">Template</span>
							<span class="preview-value code">{platform.template}</span>
						</div>
					{/if}
					{#if resources?.cores}<div class="preview-item"><span class="preview-key">CPU</span><span class="preview-value">{resources.cores} cores</span></div>{/if}
					{#if resources?.memory}<div class="preview-item"><span class="preview-key">Memory</span><span class="preview-value">{resources.memory} MB</span></div>{/if}
					{#if resources?.disk}<div class="preview-item"><span class="preview-key">Disk</span><span class="preview-value">{resources.disk} GB</span></div>{/if}
					{#if network?.ip}<div class="preview-item"><span class="preview-key">IP</span><span class="preview-value">{network.ip}</span></div>{/if}
				</div>
			</div>
		{/if}

		{#if provision}
			<div class="preview-section">
				<span class="preview-section-title">Provisioning</span>
				{#if provision.packages && Array.isArray(provision.packages)}
					<div class="preview-list">
						<span class="preview-key">Packages ({(provision.packages as string[]).length})</span>
						<span class="preview-value code">{(provision.packages as string[]).join(', ')}</span>
					</div>
				{/if}
				{#if provision.scripts && Array.isArray(provision.scripts)}
					<div class="preview-list">
						<span class="preview-key">Scripts ({(provision.scripts as Array<Record<string, unknown>>).length})</span>
						{#each provision.scripts as script}
							{@const s = script as Record<string, unknown>}
							<span class="preview-value code">{s.name ?? (s.run ? 'inline script' : 'file copy')}</span>
						{/each}
					</div>
				{/if}
			</div>
		{/if}

		{#if lxcSettings}
			<div class="preview-section">
				<span class="preview-section-title">LXC Settings</span>
				<div class="preview-grid">
					{#if lxcSettings.unprivileged !== undefined}<div class="preview-item"><span class="preview-key">Unprivileged</span><span class="preview-value">{lxcSettings.unprivileged ? 'Yes' : 'No'}</span></div>{/if}
					{#if lxcSettings.nesting !== undefined}<div class="preview-item"><span class="preview-key">Nesting</span><span class="preview-value">{lxcSettings.nesting ? 'Yes' : 'No'}</span></div>{/if}
				</div>
			</div>
		{/if}

		{#if access}
			<div class="preview-section">
				<span class="preview-section-title">Access</span>
				<div class="preview-grid">
					{#if access.ssh_enabled !== undefined}<div class="preview-item"><span class="preview-key">SSH</span><span class="preview-value">{access.ssh_enabled ? 'Enabled' : 'Disabled'}</span></div>{/if}
					{#if access.default_user}<div class="preview-item"><span class="preview-key">Default User</span><span class="preview-value">{access.default_user}</span></div>{/if}
				</div>
			</div>
		{/if}
	</div>
{/snippet}

<style>
	.editor-page {
		max-width: 1200px;
		height: calc(100vh - 64px);
		display: flex;
		flex-direction: column;
	}

	.page-header {
		margin-bottom: 16px;
		flex-shrink: 0;
	}

	.back-link {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 0.8125rem;
		color: var(--text-secondary);
		margin-bottom: 12px;
		transition: color var(--transition);
	}

	.back-link:hover { color: var(--text-primary); }

	.header-row {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 16px;
	}

	.header-info h1 {
		font-size: 1.25rem;
		font-weight: 600;
		margin-bottom: 6px;
	}

	.name-input-row {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}

	.name-input-row .form-label {
		font-size: 0.8125rem;
		font-weight: 500;
		white-space: nowrap;
	}

	.name-input {
		min-width: 280px;
	}

	.name-input-row .form-hint {
		font-size: 0.6875rem;
		color: var(--text-secondary);
		opacity: 0.6;
	}

	.editing-path code {
		font-size: 0.875rem;
		background-color: rgba(255, 255, 255, 0.06);
		padding: 2px 8px;
		border-radius: 3px;
	}

	.header-actions {
		display: flex;
		gap: 8px;
		flex-shrink: 0;
	}

	/* ---- Status bar ---- */

	.status-bar {
		padding: 8px 14px;
		border-radius: var(--radius-sm);
		font-size: 0.8125rem;
		margin-bottom: 12px;
		flex-shrink: 0;
	}

	.status-bar.success {
		background-color: rgba(34, 197, 94, 0.08);
		border: 1px solid rgba(34, 197, 94, 0.2);
		color: #22c55e;
	}

	.status-bar.error {
		background-color: rgba(239, 68, 68, 0.08);
		border: 1px solid rgba(239, 68, 68, 0.2);
		color: var(--error);
	}

	/* ---- Editor layout ---- */

	.editor-layout {
		display: grid;
		grid-template-columns: 1fr 340px;
		gap: 16px;
		flex: 1;
		min-height: 0;
	}

	.editor-pane, .preview-pane {
		display: flex;
		flex-direction: column;
		min-height: 0;
		border: 1px solid var(--border);
		border-radius: var(--radius);
		overflow: hidden;
	}

	.pane-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px 12px;
		font-size: 0.6875rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-secondary);
		background-color: var(--bg-secondary);
		border-bottom: 1px solid var(--border);
		flex-shrink: 0;
	}

	.validation-status {
		display: flex;
		gap: 6px;
	}

	.badge {
		font-size: 0.5625rem;
		font-weight: 700;
		padding: 2px 6px;
		border-radius: 3px;
		text-transform: uppercase;
	}

	.badge-ok {
		background-color: rgba(34, 197, 94, 0.15);
		color: #22c55e;
	}

	.badge-error {
		background-color: rgba(239, 68, 68, 0.15);
		color: var(--error);
	}

	.badge-warn {
		background-color: rgba(251, 191, 36, 0.15);
		color: #fbbf24;
	}

	.editor-container {
		flex: 1;
		min-height: 0;
	}

	/* ---- Preview ---- */

	.preview-content {
		flex: 1;
		overflow-y: auto;
		padding: 12px;
	}

	.preview-empty {
		font-size: 0.8125rem;
		color: var(--text-secondary);
		opacity: 0.5;
		text-align: center;
		padding: 20px;
	}

	.preview-sections {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.preview-section {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.preview-section-title {
		font-size: 0.625rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--accent);
	}

	.preview-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 6px;
	}

	.full-width {
		grid-column: 1 / -1;
	}

	.preview-item {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.preview-key {
		font-size: 0.625rem;
		color: var(--text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.preview-value {
		font-size: 0.8125rem;
		font-weight: 500;
	}

	.preview-value.code {
		font-family: 'SF Mono', 'Fira Code', 'Fira Mono', monospace;
		font-size: 0.6875rem;
		word-break: break-all;
	}

	.preview-list {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	/* ---- Errors / Warnings ---- */

	.error-list, .warning-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.warning-list {
		margin-top: 12px;
		padding-top: 12px;
		border-top: 1px solid var(--border);
	}

	.error-item, .warning-item {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 8px;
		border-radius: var(--radius-sm);
	}

	.error-item {
		background-color: rgba(239, 68, 68, 0.06);
		border: 1px solid rgba(239, 68, 68, 0.15);
	}

	.warning-item {
		background-color: rgba(251, 191, 36, 0.06);
		border: 1px solid rgba(251, 191, 36, 0.15);
	}

	.error-path, .warning-path {
		font-size: 0.625rem;
		font-family: 'SF Mono', 'Fira Code', 'Fira Mono', monospace;
		opacity: 0.7;
	}

	.error-path { color: var(--error); }
	.warning-path { color: #fbbf24; }

	.error-msg { font-size: 0.75rem; color: var(--error); }
	.warning-msg { font-size: 0.75rem; color: #fbbf24; }
	.error-line { font-size: 0.625rem; color: var(--text-secondary); }

	@media (max-width: 768px) {
		.editor-layout {
			grid-template-columns: 1fr;
		}

		.preview-pane {
			max-height: 300px;
		}
	}
</style>
