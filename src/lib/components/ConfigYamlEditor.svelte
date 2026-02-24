<script lang="ts">
	import { onMount } from 'svelte';
	import YamlEditor from './YamlEditor.svelte';
	import type { ConfigValidationError } from '$lib/types/yaml-config';

	let { value = $bindable(), onchange }: { value: string; onchange?: () => void } = $props();

	let validationErrors = $state<ConfigValidationError[]>([]);
	let validationWarnings = $state<ConfigValidationError[]>([]);
	let preview = $state<Record<string, unknown> | null>(null);
	let validationTimer: ReturnType<typeof setTimeout> | undefined;

	function handleEditorChange(newValue: string) {
		value = newValue;
		onchange?.();

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
			preview = result.valid && result.config ? result.config : null;
		} catch {
			// Network error — don't update validation state
		}
	}

	onMount(() => {
		validateContent(value);
	});
</script>

<div class="yaml-editor-layout">
	<div class="editor-pane">
		<div class="pane-header">
			<span>YAML Editor</span>
			<span class="validation-status">
				{#if validationErrors.length > 0}
					<span class="v-badge v-badge-error">{validationErrors.length} error{validationErrors.length !== 1 ? 's' : ''}</span>
				{:else}
					<span class="v-badge v-badge-ok">Valid</span>
				{/if}
				{#if validationWarnings.length > 0}
					<span class="v-badge v-badge-warn">{validationWarnings.length} warning{validationWarnings.length !== 1 ? 's' : ''}</span>
				{/if}
			</span>
		</div>
		<div class="editor-container">
			<YamlEditor
				bind:value
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
				{@render previewPanel(preview)}
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
					<span class="preview-val">{meta?.name ?? '—'}</span>
				</div>
				{#if meta?.description}
					<div class="preview-item full-width">
						<span class="preview-key">Description</span>
						<span class="preview-val">{meta.description}</span>
					</div>
				{/if}
				{#if config.extends}
					<div class="preview-item">
						<span class="preview-key">Extends</span>
						<span class="preview-val code">{config.extends}</span>
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
						<span class="preview-val">{platform.type === 'lxc' ? 'LXC Container' : 'VM'}</span>
					</div>
					{#if platform.template}
						<div class="preview-item full-width">
							<span class="preview-key">Template</span>
							<span class="preview-val code">{platform.template}</span>
						</div>
					{/if}
					{#if resources?.cores}<div class="preview-item"><span class="preview-key">CPU</span><span class="preview-val">{resources.cores} cores</span></div>{/if}
					{#if resources?.memory}<div class="preview-item"><span class="preview-key">Memory</span><span class="preview-val">{resources.memory} MB</span></div>{/if}
					{#if resources?.disk}<div class="preview-item"><span class="preview-key">Disk</span><span class="preview-val">{resources.disk} GB</span></div>{/if}
					{#if network?.ip}<div class="preview-item"><span class="preview-key">IP</span><span class="preview-val">{network.ip}</span></div>{/if}
				</div>
			</div>
		{/if}

		{#if provision}
			<div class="preview-section">
				<span class="preview-section-title">Provisioning</span>
				{#if provision.packages && Array.isArray(provision.packages)}
					<div class="preview-list">
						<span class="preview-key">Packages ({(provision.packages as string[]).length})</span>
						<span class="preview-val code">{(provision.packages as string[]).join(', ')}</span>
					</div>
				{/if}
				{#if provision.scripts && Array.isArray(provision.scripts)}
					<div class="preview-list">
						<span class="preview-key">Scripts ({(provision.scripts as Array<Record<string, unknown>>).length})</span>
						{#each provision.scripts as script}
							{@const s = script as Record<string, unknown>}
							<span class="preview-val code">{s.name ?? (s.run ? 'inline script' : 'file copy')}</span>
						{/each}
					</div>
				{/if}
			</div>
		{/if}

		{#if lxcSettings}
			<div class="preview-section">
				<span class="preview-section-title">LXC Settings</span>
				<div class="preview-grid">
					{#if lxcSettings.unprivileged !== undefined}<div class="preview-item"><span class="preview-key">Unprivileged</span><span class="preview-val">{lxcSettings.unprivileged ? 'Yes' : 'No'}</span></div>{/if}
					{#if lxcSettings.nesting !== undefined}<div class="preview-item"><span class="preview-key">Nesting</span><span class="preview-val">{lxcSettings.nesting ? 'Yes' : 'No'}</span></div>{/if}
				</div>
			</div>
		{/if}

		{#if access}
			<div class="preview-section">
				<span class="preview-section-title">Access</span>
				<div class="preview-grid">
					{#if access.ssh_enabled !== undefined}<div class="preview-item"><span class="preview-key">SSH</span><span class="preview-val">{access.ssh_enabled ? 'Enabled' : 'Disabled'}</span></div>{/if}
					{#if access.default_user}<div class="preview-item"><span class="preview-key">Default User</span><span class="preview-val">{access.default_user}</span></div>{/if}
				</div>
			</div>
		{/if}
	</div>
{/snippet}

<style>
	.yaml-editor-layout {
		display: grid;
		grid-template-columns: 1fr 300px;
		gap: 16px;
		min-height: 500px;
		height: calc(100vh - 260px);
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

	.v-badge {
		font-size: 0.5625rem;
		font-weight: 700;
		padding: 2px 6px;
		border-radius: 3px;
		text-transform: uppercase;
	}

	.v-badge-ok {
		background-color: rgba(34, 197, 94, 0.15);
		color: #22c55e;
	}

	.v-badge-error {
		background-color: rgba(239, 68, 68, 0.15);
		color: var(--error);
	}

	.v-badge-warn {
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

	.preview-val {
		font-size: 0.8125rem;
		font-weight: 500;
	}

	.preview-val.code {
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
		.yaml-editor-layout {
			grid-template-columns: 1fr;
		}

		.preview-pane {
			max-height: 300px;
		}
	}
</style>
