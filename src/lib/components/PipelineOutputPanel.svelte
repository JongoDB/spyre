<script lang="ts">
	import type { PipelineOutputArtifacts } from '$lib/types/pipeline';

	interface Props {
		envId: string;
		pipelineId: string;
		artifacts: PipelineOutputArtifacts | null;
		onRescan: () => void;
		scanning: boolean;
	}

	let { envId, pipelineId, artifacts, onRescan, scanning }: Props = $props();

	// File browser state
	let showFileBrowser = $state(false);
	let browserPath = $state('');
	let browserFiles = $state<Array<{ name: string; type: 'file' | 'directory'; size: number }>>([]);
	let browserLoading = $state(false);
	let browserError = $state('');

	// Initialize browser path from artifacts
	$effect(() => {
		if (artifacts?.projectDir && !browserPath) {
			browserPath = artifacts.projectDir;
		}
	});

	async function loadDirectory(path: string) {
		browserLoading = true;
		browserError = '';
		try {
			const res = await fetch(`/api/terminal/${envId}/files?path=${encodeURIComponent(path)}`);
			if (res.ok) {
				const data = await res.json();
				browserFiles = data.entries ?? data;
				browserPath = path;
			} else {
				browserError = 'Failed to load directory';
				browserFiles = [];
			}
		} catch {
			browserError = 'Failed to load directory';
			browserFiles = [];
		} finally {
			browserLoading = false;
		}
	}

	function toggleFileBrowser() {
		showFileBrowser = !showFileBrowser;
		if (showFileBrowser && browserFiles.length === 0 && browserPath) {
			loadDirectory(browserPath);
		}
	}

	function navigateUp() {
		const parent = browserPath.replace(/\/[^/]+\/?$/, '') || '/';
		loadDirectory(parent);
	}

	function navigateTo(name: string) {
		const newPath = browserPath.endsWith('/') ? `${browserPath}${name}` : `${browserPath}/${name}`;
		loadDirectory(newPath);
	}

	function downloadUrl(path: string): string {
		return `/api/terminal/${envId}/download?path=${encodeURIComponent(path)}`;
	}

	function formatSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	function fileIcon(filename: string): string {
		const ext = filename.split('.').pop()?.toLowerCase();
		if (!ext) return 'file';
		if (['md', 'txt', 'doc', 'pdf'].includes(ext)) return 'doc';
		if (['js', 'ts', 'jsx', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'svelte', 'vue'].includes(ext)) return 'code';
		if (['html', 'htm', 'css', 'scss'].includes(ext)) return 'web';
		if (['json', 'yaml', 'yml', 'toml', 'xml', 'env', 'conf'].includes(ext)) return 'config';
		if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico'].includes(ext)) return 'image';
		if (['zip', 'tar', 'gz', 'tgz'].includes(ext)) return 'archive';
		if (['sh', 'bash'].includes(ext)) return 'script';
		if (['sql', 'db', 'sqlite'].includes(ext)) return 'data';
		return 'file';
	}

	// Breadcrumb segments from browser path
	const breadcrumbs = $derived(() => {
		if (!browserPath) return [];
		const parts = browserPath.split('/').filter(Boolean);
		const crumbs: Array<{ label: string; path: string }> = [{ label: '/', path: '/' }];
		let running = '';
		for (const p of parts) {
			running += '/' + p;
			crumbs.push({ label: p, path: running });
		}
		return crumbs;
	});

	const hasServices = $derived(artifacts && artifacts.services.length > 0);
	const hasFiles = $derived(artifacts && artifacts.files.length > 0);
	const hasOutputs = $derived(hasServices || hasFiles);
</script>

<div class="output-panel">
	<!-- Section 1: Detected Services -->
	{#if hasServices}
		<div class="output-section services-section">
			<div class="section-header">
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
				<span class="section-title">Web Services</span>
			</div>
			<div class="services-list">
				{#each artifacts!.services as svc (svc.port)}
					<a
						href="/preview/{envId}/{svc.port}"
						target="_blank"
						rel="noopener noreferrer"
						class="service-chip"
					>
						<span class="service-dot"></span>
						<span class="service-chip-name">{svc.name}</span>
						<code class="service-chip-port">:{svc.port}</code>
						<span class="service-chip-open">Open</span>
					</a>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Section 2: Output Files -->
	{#if hasFiles}
		<div class="output-section files-section">
			<div class="section-header">
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>
				<span class="section-title">Output Files</span>
				<span class="file-count">{artifacts!.files.length}</span>
			</div>
			<div class="files-list">
				{#each artifacts!.files as file (file.path)}
					<div class="file-item">
						<div class="file-icon" data-type={fileIcon(file.filename)}>
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>
						</div>
						<div class="file-info">
							<span class="file-name">{file.filename}</span>
							<span class="file-path">{file.path}</span>
						</div>
						<span class="file-size">{formatSize(file.size)}</span>
						<a href={downloadUrl(file.path)} class="file-download" title="Download file">
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
						</a>
					</div>
				{/each}
			</div>
		</div>
	{/if}

	<!-- Section 3: File Browser (collapsible) -->
	{#if artifacts}
		<div class="output-section browser-section">
			<button class="browser-toggle" onclick={toggleFileBrowser}>
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
				<span class="section-title">Browse Project Files</span>
				<svg class="browser-chevron" class:open={showFileBrowser} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
			</button>

			{#if showFileBrowser}
				<div class="browser-content">
					<!-- Breadcrumbs -->
					<div class="browser-breadcrumbs">
						{#each breadcrumbs() as crumb, i (crumb.path)}
							{#if i > 0}<span class="breadcrumb-sep">/</span>{/if}
							<button class="breadcrumb-btn" onclick={() => loadDirectory(crumb.path)}>
								{crumb.label}
							</button>
						{/each}
					</div>

					{#if browserLoading}
						<div class="browser-loading">Loading...</div>
					{:else if browserError}
						<div class="browser-error">{browserError}</div>
					{:else}
						<div class="browser-entries">
							<!-- Parent directory -->
							{#if browserPath !== '/'}
								<button class="browser-entry dir" onclick={navigateUp}>
									<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>
									<span class="entry-name">..</span>
								</button>
							{/if}
							{#each browserFiles as entry (entry.name)}
								{#if entry.type === 'directory'}
									<button class="browser-entry dir" onclick={() => navigateTo(entry.name)}>
										<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
										<span class="entry-name">{entry.name}</span>
									</button>
								{:else}
									<div class="browser-entry file">
										<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>
										<span class="entry-name">{entry.name}</span>
										{#if entry.size != null}
											<span class="entry-size">{formatSize(entry.size)}</span>
										{/if}
										<a href={downloadUrl(browserPath + '/' + entry.name)} class="entry-download" title="Download">
											<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
										</a>
									</div>
								{/if}
							{/each}
							{#if browserFiles.length === 0}
								<div class="browser-empty">Empty directory</div>
							{/if}
						</div>
					{/if}
				</div>
			{/if}
		</div>
	{/if}

	<!-- Section 4: Rescan / No outputs state -->
	<div class="output-actions">
		{#if !hasOutputs && artifacts}
			<div class="no-outputs">
				No services or output files detected. Try rescanning or check the terminal.
			</div>
		{/if}
		<button class="btn btn-sm btn-secondary" onclick={onRescan} disabled={scanning}>
			{#if scanning}
				<span class="rescan-spinner"></span>
				Scanning...
			{:else}
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
				Rescan
			{/if}
		</button>
	</div>
</div>

<style>
	.output-panel {
		display: flex; flex-direction: column; gap: 8px;
	}

	.output-section {
		border-radius: var(--radius-sm); overflow: hidden;
	}

	.section-header {
		display: flex; align-items: center; gap: 8px;
		padding: 8px 0; color: var(--text-secondary);
	}
	.section-title {
		font-size: 0.6875rem; font-weight: 600; text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.file-count {
		font-size: 0.625rem; font-weight: 700;
		background: var(--bg-tertiary); padding: 1px 6px;
		border-radius: 8px; color: var(--text-secondary);
	}

	/* Services */
	.services-list { display: flex; flex-wrap: wrap; gap: 6px; }
	.service-chip {
		display: flex; align-items: center; gap: 6px;
		padding: 6px 12px; border-radius: var(--radius-sm);
		background: rgba(99,102,241,0.08); border: 1px solid rgba(99,102,241,0.2);
		text-decoration: none; color: var(--text-primary);
		font-size: 0.8125rem; transition: background 0.15s, border-color 0.15s;
	}
	.service-chip:hover {
		background: rgba(99,102,241,0.15); border-color: rgba(99,102,241,0.35);
	}
	.service-dot {
		width: 6px; height: 6px; border-radius: 50%; background: var(--success); flex-shrink: 0;
	}
	.service-chip-name { font-weight: 500; }
	.service-chip-port {
		font-size: 0.75rem; font-family: 'SF Mono', monospace; color: var(--text-secondary);
	}
	.service-chip-open {
		font-size: 0.6875rem; color: var(--accent); font-weight: 600; margin-left: 4px;
	}

	/* Files */
	.files-list { display: flex; flex-direction: column; gap: 2px; }
	.file-item {
		display: flex; align-items: center; gap: 10px;
		padding: 8px 12px; border-radius: var(--radius-sm);
		background: rgba(0,0,0,0.15);
	}
	.file-icon { color: var(--text-secondary); flex-shrink: 0; display: flex; }
	.file-icon[data-type="code"] { color: var(--accent); }
	.file-icon[data-type="doc"] { color: #60a5fa; }
	.file-icon[data-type="web"] { color: #f59e0b; }
	.file-icon[data-type="config"] { color: #a78bfa; }
	.file-icon[data-type="image"] { color: #34d399; }
	.file-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
	.file-name { font-size: 0.8125rem; font-weight: 500; }
	.file-path {
		font-size: 0.6875rem; color: var(--text-secondary);
		font-family: 'SF Mono', monospace; white-space: nowrap;
		overflow: hidden; text-overflow: ellipsis;
	}
	.file-size {
		font-size: 0.6875rem; font-family: 'SF Mono', monospace;
		color: var(--text-secondary); flex-shrink: 0;
	}
	.file-download {
		color: var(--text-secondary); padding: 4px;
		border-radius: var(--radius-sm); transition: color 0.15s;
		display: flex; flex-shrink: 0;
	}
	.file-download:hover { color: var(--accent); }

	/* File Browser */
	.browser-toggle {
		display: flex; align-items: center; gap: 8px; width: 100%;
		padding: 8px 12px; background: rgba(0,0,0,0.1);
		border: 1px solid var(--border); border-radius: var(--radius-sm);
		cursor: pointer; color: var(--text-secondary);
		transition: background var(--transition);
	}
	.browser-toggle:hover { background: rgba(0,0,0,0.15); }
	.browser-chevron { margin-left: auto; transition: transform var(--transition); }
	.browser-chevron.open { transform: rotate(180deg); }

	.browser-content {
		border: 1px solid var(--border); border-top: none;
		border-radius: 0 0 var(--radius-sm) var(--radius-sm);
		background: var(--bg-secondary);
	}
	.browser-breadcrumbs {
		display: flex; align-items: center; gap: 2px;
		padding: 8px 12px; font-size: 0.75rem;
		border-bottom: 1px solid var(--border); overflow-x: auto;
	}
	.breadcrumb-btn {
		background: none; border: none; color: var(--accent); cursor: pointer;
		font-size: 0.75rem; font-family: 'SF Mono', monospace;
		padding: 1px 3px; border-radius: 2px;
	}
	.breadcrumb-btn:hover { background: rgba(99,102,241,0.1); }
	.breadcrumb-sep { color: var(--text-secondary); font-size: 0.75rem; }

	.browser-entries { max-height: 300px; overflow-y: auto; }
	.browser-entry {
		display: flex; align-items: center; gap: 8px;
		padding: 6px 12px; width: 100%;
		text-align: left; font-size: 0.8125rem;
		border-bottom: 1px solid rgba(255,255,255,0.02);
	}
	.browser-entry.dir {
		background: none; border: none; cursor: pointer;
		color: var(--text-primary); transition: background var(--transition);
		border-bottom: 1px solid rgba(255,255,255,0.02);
	}
	.browser-entry.dir:hover { background: rgba(255,255,255,0.03); }
	.browser-entry.dir .entry-name { color: var(--accent); font-weight: 500; }
	.entry-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.entry-size {
		font-size: 0.6875rem; font-family: 'SF Mono', monospace;
		color: var(--text-secondary); flex-shrink: 0;
	}
	.entry-download {
		color: var(--text-secondary); padding: 2px;
		display: flex; flex-shrink: 0; transition: color 0.15s;
	}
	.entry-download:hover { color: var(--accent); }

	.browser-loading, .browser-error, .browser-empty {
		padding: 16px; text-align: center; font-size: 0.8125rem;
		color: var(--text-secondary);
	}
	.browser-error { color: var(--error); }

	/* Actions */
	.output-actions {
		display: flex; align-items: center; gap: 10px;
		padding-top: 4px;
	}
	.no-outputs {
		font-size: 0.75rem; color: var(--text-secondary); font-style: italic; flex: 1;
	}

	.rescan-spinner {
		display: inline-block; width: 12px; height: 12px;
		border-radius: 50%; border: 2px solid rgba(255,255,255,0.2);
		border-top-color: var(--text-primary);
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin { to { transform: rotate(360deg); } }
</style>
