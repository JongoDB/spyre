<script lang="ts">
	import { goto } from '$app/navigation';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let importing = $state(false);
	let showImport = $state(false);
	let importName = $state(`${data.script.name} (Community)`);
	let importError = $state('');

	async function handleImport(e: SubmitEvent) {
		e.preventDefault();
		importing = true;
		importError = '';

		try {
			const res = await fetch(`/api/community-scripts/${data.script.slug}/import`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ name: importName })
			});

			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				importError = body.message ?? 'Import failed. Please try again.';
				return;
			}

			const template = await res.json();
			goto(`/templates/${template.id}`);
		} catch {
			importError = 'Network error during import. Please try again.';
		} finally {
			importing = false;
		}
	}

	function formatResource(value: number | null, unit: string): string {
		if (value === null || value === undefined) return '--';
		return `${value} ${unit}`;
	}
</script>

<div class="detail-page">
	<a href="/library" class="back-link">
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
			<path d="M19 12H5" />
			<polyline points="12 19 5 12 12 5" />
		</svg>
		Back to Library
	</a>

	<!-- Header -->
	<header class="detail-header">
		<div class="detail-logo">
			{#if data.script.logo_url}
				<img
					src={data.script.logo_url}
					alt="{data.script.name} logo"
					onerror={(e) => {
						const target = e.currentTarget as HTMLImageElement;
						target.style.display = 'none';
						const fallback = target.nextElementSibling as HTMLElement;
						if (fallback) fallback.style.display = 'flex';
					}}
				/>
				<div class="logo-fallback-large" style="display: none;">
					<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
						<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
					</svg>
				</div>
			{:else}
				<div class="logo-fallback-large">
					<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
						<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
					</svg>
				</div>
			{/if}
		</div>
		<div class="header-text">
			<h1>{data.script.name}</h1>
			{#if data.script.description}
				<p class="description">{data.script.description}</p>
			{/if}
		</div>
	</header>

	<div class="detail-grid">
		<!-- Info Section -->
		<section class="card info-section">
			<h2 class="section-title">Information</h2>
			<div class="info-grid">
				{#if data.script.type}
					<div class="info-item">
						<span class="info-label">Type</span>
						<span class="type-badge type-badge-{data.script.type}">
							{data.script.type === 'ct' ? 'LXC' : data.script.type.toUpperCase()}
						</span>
					</div>
				{/if}

				{#if data.script.categories.length > 0}
					<div class="info-item">
						<span class="info-label">Categories</span>
						<div class="category-badges">
							{#each data.script.categories as cat}
								<span class="category-badge">{data.categoryMap[String(cat)] ?? cat}</span>
							{/each}
						</div>
					</div>
				{/if}

				{#if data.script.website}
					<div class="info-item">
						<span class="info-label">Website</span>
						<a href={data.script.website} target="_blank" rel="noopener noreferrer" class="info-link">
							{data.script.website}
							<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
								<polyline points="15 3 21 3 21 9" />
								<line x1="10" y1="14" x2="21" y2="3" />
							</svg>
						</a>
					</div>
				{/if}

				{#if data.script.documentation}
					<div class="info-item">
						<span class="info-label">Documentation</span>
						<a href={data.script.documentation} target="_blank" rel="noopener noreferrer" class="info-link">
							View Documentation
							<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
								<polyline points="15 3 21 3 21 9" />
								<line x1="10" y1="14" x2="21" y2="3" />
							</svg>
						</a>
					</div>
				{/if}

				{#if data.script.interface_port}
					<div class="info-item">
						<span class="info-label">Interface Port</span>
						<span class="info-value mono">{data.script.interface_port}</span>
					</div>
				{/if}
			</div>
		</section>

		<!-- Default Resources -->
		<section class="card resources-section">
			<h2 class="section-title">Default Resources</h2>
			<div class="resource-grid">
				<div class="resource-box">
					<span class="resource-label">CPU</span>
					<span class="resource-value">{formatResource(data.script.default_cpu, data.script.default_cpu === 1 ? 'Core' : 'Cores')}</span>
				</div>
				<div class="resource-box">
					<span class="resource-label">RAM</span>
					<span class="resource-value">{formatResource(data.script.default_ram, 'MB')}</span>
				</div>
				<div class="resource-box">
					<span class="resource-label">Disk</span>
					<span class="resource-value">{formatResource(data.script.default_disk, 'GB')}</span>
				</div>
				{#if data.script.default_os}
					<div class="resource-box">
						<span class="resource-label">OS</span>
						<span class="resource-value">{data.script.default_os}{data.script.default_os_version ? ` ${data.script.default_os_version}` : ''}</span>
					</div>
				{/if}
			</div>
		</section>

		<!-- Install Methods -->
		{#if data.script.install_methods.length > 0}
			<section class="card methods-section">
				<h2 class="section-title">Install Methods</h2>
				<div class="methods-list">
					{#each data.script.install_methods as method, idx}
						<div class="method-item">
							<div class="method-header">
								<span class="method-type">{method.type}</span>
								{#if method.script}
									<code class="method-script">{method.script}</code>
								{/if}
							</div>
							<div class="method-resources">
								{#if method.resources.cpu}<span class="method-resource">CPU: {method.resources.cpu}</span>{/if}
								{#if method.resources.ram}<span class="method-resource">RAM: {method.resources.ram} MB</span>{/if}
								{#if method.resources.hdd}<span class="method-resource">Disk: {method.resources.hdd} GB</span>{/if}
								{#if method.resources.os}<span class="method-resource">OS: {method.resources.os} {method.resources.version ?? ''}</span>{/if}
							</div>
						</div>
					{/each}
				</div>
			</section>
		{/if}

		<!-- Credentials -->
		{#if data.script.default_username || data.script.default_password}
			<section class="card credentials-section">
				<h2 class="section-title">Default Credentials</h2>
				<div class="credentials-grid">
					{#if data.script.default_username}
						<div class="credential-item">
							<span class="info-label">Username</span>
							<code class="credential-value">{data.script.default_username}</code>
						</div>
					{/if}
					{#if data.script.default_password}
						<div class="credential-item">
							<span class="info-label">Password</span>
							<code class="credential-value">{data.script.default_password}</code>
						</div>
					{/if}
				</div>
			</section>
		{/if}

		<!-- Notes -->
		{#if data.script.notes.length > 0}
			<section class="card notes-section">
				<h2 class="section-title">Notes</h2>
				<ul class="notes-list">
					{#each data.script.notes as note}
						<li class="note-item">{typeof note === 'string' ? note : note.text}</li>
					{/each}
				</ul>
			</section>
		{/if}
	</div>

	<!-- Import as Template -->
	<section class="import-section">
		{#if !showImport}
			<button class="btn btn-primary import-btn" onclick={() => (showImport = true)}>
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
					<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
					<polyline points="7 10 12 15 17 10" />
					<line x1="12" y1="15" x2="12" y2="3" />
				</svg>
				Import as Template
			</button>
		{:else}
			<div class="card import-form-card">
				<h3 class="import-form-title">Import as Template</h3>
				<form onsubmit={handleImport}>
					<div class="form-group">
						<label for="import-name" class="form-label">Template Name</label>
						<input
							id="import-name"
							type="text"
							class="form-input"
							bind:value={importName}
							required
							placeholder="Enter a name for the template"
						/>
					</div>

					{#if importError}
						<div class="import-error">{importError}</div>
					{/if}

					<div class="import-actions">
						<button type="submit" class="btn btn-primary" disabled={importing || !importName.trim()}>
							{#if importing}
								<span class="spinner"></span>
								Importing...
							{:else}
								Import
							{/if}
						</button>
						<button type="button" class="btn btn-secondary" onclick={() => { showImport = false; importError = ''; }}>
							Cancel
						</button>
					</div>
				</form>
			</div>
		{/if}
	</section>
</div>

<style>
	.detail-page {
		max-width: 900px;
	}

	/* ---- Back link ---- */

	.back-link {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 0.8125rem;
		color: var(--text-secondary);
		margin-bottom: 24px;
		transition: color var(--transition);
	}

	.back-link:hover {
		color: var(--accent);
	}

	/* ---- Header ---- */

	.detail-header {
		display: flex;
		align-items: flex-start;
		gap: 20px;
		margin-bottom: 28px;
	}

	.detail-logo {
		width: 64px;
		height: 64px;
		border-radius: var(--radius);
		overflow: hidden;
		flex-shrink: 0;
		background-color: var(--bg-secondary);
		border: 1px solid var(--border);
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.detail-logo img {
		width: 100%;
		height: 100%;
		object-fit: contain;
	}

	.logo-fallback-large {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 100%;
		height: 100%;
		color: var(--text-secondary);
	}

	.header-text {
		flex: 1;
		min-width: 0;
	}

	.header-text h1 {
		font-size: 1.5rem;
		font-weight: 700;
		margin-bottom: 6px;
		line-height: 1.2;
	}

	.description {
		color: var(--text-secondary);
		font-size: 0.875rem;
		line-height: 1.5;
	}

	/* ---- Detail grid ---- */

	.detail-grid {
		display: flex;
		flex-direction: column;
		gap: 16px;
		margin-bottom: 28px;
	}

	.section-title {
		font-size: 0.875rem;
		font-weight: 600;
		margin-bottom: 16px;
		color: var(--text-primary);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	/* ---- Info section ---- */

	.info-grid {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	.info-item {
		display: flex;
		align-items: flex-start;
		gap: 12px;
	}

	.info-label {
		font-size: 0.8125rem;
		color: var(--text-secondary);
		min-width: 120px;
		flex-shrink: 0;
		padding-top: 1px;
	}

	.info-value {
		font-size: 0.8125rem;
		font-weight: 500;
	}

	.info-value.mono {
		font-family: 'SF Mono', 'Fira Code', 'Fira Mono', monospace;
	}

	.info-link {
		font-size: 0.8125rem;
		display: inline-flex;
		align-items: center;
		gap: 4px;
		word-break: break-all;
	}

	.type-badge {
		display: inline-flex;
		padding: 2px 10px;
		font-size: 0.6875rem;
		font-weight: 700;
		letter-spacing: 0.05em;
		border-radius: 9999px;
		text-transform: uppercase;
	}

	.type-badge-ct {
		background-color: rgba(34, 197, 94, 0.12);
		color: var(--success);
	}

	.type-badge-vm {
		background-color: rgba(99, 102, 241, 0.12);
		color: var(--accent);
	}

	.category-badges {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.category-badge {
		display: inline-flex;
		padding: 2px 10px;
		font-size: 0.6875rem;
		font-weight: 500;
		background-color: var(--bg-secondary);
		border: 1px solid var(--border);
		border-radius: 9999px;
		color: var(--text-secondary);
	}

	/* ---- Resources section ---- */

	.resource-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
		gap: 12px;
	}

	.resource-box {
		background-color: var(--bg-secondary);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: 12px 16px;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.resource-label {
		font-size: 0.6875rem;
		color: var(--text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		font-weight: 600;
	}

	.resource-value {
		font-size: 0.9375rem;
		font-weight: 600;
		font-family: 'SF Mono', 'Fira Code', 'Fira Mono', monospace;
	}

	/* ---- Install methods ---- */

	.methods-list {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.method-item {
		background-color: var(--bg-secondary);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: 12px 16px;
	}

	.method-header {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 8px;
	}

	.method-type {
		font-size: 0.8125rem;
		font-weight: 600;
		text-transform: capitalize;
	}

	.method-script {
		font-size: 0.75rem;
		background-color: rgba(255, 255, 255, 0.04);
		padding: 2px 8px;
		border-radius: var(--radius-sm);
		color: var(--text-secondary);
		word-break: break-all;
	}

	.method-resources {
		display: flex;
		gap: 16px;
		flex-wrap: wrap;
	}

	.method-resource {
		font-size: 0.75rem;
		color: var(--text-secondary);
		font-family: 'SF Mono', 'Fira Code', 'Fira Mono', monospace;
	}

	/* ---- Credentials ---- */

	.credentials-grid {
		display: flex;
		gap: 24px;
		flex-wrap: wrap;
	}

	.credential-item {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.credential-value {
		font-size: 0.875rem;
		background-color: var(--bg-secondary);
		padding: 4px 12px;
		border-radius: var(--radius-sm);
		border: 1px solid var(--border);
		color: var(--text-primary);
	}

	/* ---- Notes ---- */

	.notes-list {
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.note-item {
		font-size: 0.8125rem;
		color: var(--text-secondary);
		line-height: 1.5;
		padding-left: 16px;
		position: relative;
	}

	.note-item::before {
		content: '';
		position: absolute;
		left: 0;
		top: 8px;
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background-color: var(--border);
	}

	/* ---- Import section ---- */

	.import-section {
		padding-top: 24px;
		border-top: 1px solid var(--border);
	}

	.import-btn {
		font-size: 0.9375rem;
		padding: 10px 24px;
	}

	.import-form-card {
		max-width: 480px;
	}

	.import-form-title {
		font-size: 1rem;
		font-weight: 600;
		margin-bottom: 16px;
	}

	.import-error {
		background-color: rgba(239, 68, 68, 0.1);
		border: 1px solid var(--error);
		border-radius: var(--radius-sm);
		color: var(--error);
		padding: 8px 12px;
		margin-top: 12px;
		font-size: 0.8125rem;
	}

	.import-actions {
		display: flex;
		gap: 8px;
		margin-top: 16px;
	}

	/* ---- Spinner ---- */

	.spinner {
		display: inline-block;
		width: 14px;
		height: 14px;
		border: 2px solid rgba(255, 255, 255, 0.3);
		border-top-color: #fff;
		border-radius: 50%;
		animation: spin 0.6s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	/* ---- Responsive ---- */

	@media (max-width: 640px) {
		.detail-header {
			flex-direction: column;
			align-items: flex-start;
			gap: 12px;
		}

		.info-item {
			flex-direction: column;
			gap: 4px;
		}

		.info-label {
			min-width: unset;
		}

		.resource-grid {
			grid-template-columns: 1fr 1fr;
		}

		.method-resources {
			flex-direction: column;
			gap: 4px;
		}

		.credentials-grid {
			flex-direction: column;
		}
	}
</style>
