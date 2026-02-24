<script lang="ts">
	import { goto } from '$app/navigation';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// Tab state — config is now the primary tab
	const initialTab = data.preselectedTab === 'config' || data.preselectedTab === 'quick' || data.preselectedTab === 'community' || data.preselectedTab === 'template'
		? data.preselectedTab as 'config' | 'quick' | 'community' | 'template'
		: 'config';
	let activeTab = $state<'config' | 'quick' | 'community' | 'template'>(initialTab);

	// Shared state
	let name = $state('');
	let submitting = $state(false);
	let errorMessage = $state('');

	// ── From Template tab ──
	let selectedTemplateId = $state('');
	let selectedTemplate = $derived(
		data.spyreTemplates.find(t => t.id === selectedTemplateId)
	);

	let templateIsValid = $derived(
		name.trim().length > 0 && selectedTemplateId.length > 0
	);

	// ── Quick Create tab ──
	let type = $state<'lxc' | 'vm'>('lxc');
	let template = $state('');
	let cores = $state(1);
	let memory = $state(512);
	let disk = $state(8);
	let password = $state('');
	let sshEnabled = $state(true);
	let dns = $state(data.defaultDns ?? '8.8.8.8');
	let unprivileged = $state(true);
	let nesting = $state(true);
	let showAdvanced = $state(false);
	let installClaude = $state(true);

	let quickIsValid = $derived(
		name.trim().length > 0 && template.length > 0 && cores > 0 && memory > 0 && disk > 0
	);

	// ── Community tab ──
	let communitySearch = $state(data.communityQuery ?? '');
	let selectedScriptSlug = $state('');
	let selectedScript = $derived(
		data.communityScripts.find(s => s.slug === selectedScriptSlug)
	);
	let selectedInstallMethod = $state('default');

	let communityIsValid = $derived(
		name.trim().length > 0 && selectedScriptSlug.length > 0
	);

	// ── From Config tab ──
	let selectedConfigName = $state(data.preselectedConfig ?? '');
	let configPreview = $state<Record<string, unknown> | null>(null);
	let configLoading = $state(false);

	// Auto-load preview if config was preselected
	$effect(() => {
		if (selectedConfigName && !configPreview && !configLoading) {
			loadConfigPreview(selectedConfigName);
		}
	});

	let configIsValid = $derived(
		name.trim().length > 0 && selectedConfigName.length > 0 && configPreview !== null
	);

	async function loadConfigPreview(configName: string) {
		if (!configName) {
			configPreview = null;
			return;
		}
		configLoading = true;
		try {
			const res = await fetch(`/api/configs/${encodeURIComponent(configName)}/resolve`);
			if (res.ok) {
				configPreview = await res.json();
			} else {
				configPreview = null;
			}
		} catch {
			configPreview = null;
		} finally {
			configLoading = false;
		}
	}

	// ── Handlers ──
	async function handleTemplateSubmit(e: SubmitEvent) {
		e.preventDefault();
		if (!templateIsValid || submitting) return;

		submitting = true;
		errorMessage = '';

		try {
			// Resolve the template first
			const resolveRes = await fetch(`/api/templates/${selectedTemplateId}/resolve`);
			if (!resolveRes.ok) {
				const body = await resolveRes.json().catch(() => ({}));
				errorMessage = body.message ?? 'Failed to resolve template.';
				return;
			}

			const resolved = await resolveRes.json();

			const res = await fetch('/api/environments', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: name.trim(),
					type: resolved.type,
					template: resolved.os_template,
					cores: resolved.cores,
					memory: resolved.memory,
					disk: resolved.disk,
					nameserver: resolved.dns,
					unprivileged: resolved.unprivileged,
					nesting: resolved.nesting,
					ssh_enabled: resolved.ssh_enabled,
					password: resolved.root_password || undefined,
					template_id: selectedTemplateId,
					// Provisioner pipeline fields
					default_user: resolved.default_user || undefined,
					community_script_slug: resolved.community_script_slug || undefined,
					software_pool_ids: resolved.software_pools?.map((p: { id: string }) => p.id) ?? [],
					custom_script: resolved.custom_script || undefined,
					install_claude: installClaude
				})
			});

			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				errorMessage = body.message ?? `Creation failed (HTTP ${res.status}).`;
				return;
			}

			const env = await res.json();
			await goto(`/environments/${env.id}`);
		} catch {
			errorMessage = 'Network error. Please check your connection and try again.';
		} finally {
			submitting = false;
		}
	}

	async function handleQuickSubmit(e: SubmitEvent) {
		e.preventDefault();
		if (!quickIsValid || submitting) return;

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
					disk,
					password: password || undefined,
					ssh_enabled: sshEnabled,
					nameserver: dns,
					unprivileged,
					nesting,
					install_claude: installClaude
				})
			});

			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				errorMessage = body.message ?? `Creation failed (HTTP ${res.status}).`;
				return;
			}

			const env = await res.json();
			await goto(`/environments/${env.id}`);
		} catch {
			errorMessage = 'Network error. Please check your connection and try again.';
		} finally {
			submitting = false;
		}
	}

	async function handleCommunitySubmit(e: SubmitEvent) {
		e.preventDefault();
		if (!communityIsValid || submitting) return;

		submitting = true;
		errorMessage = '';

		try {
			const script = selectedScript!;
			const method = script.install_methods.find(
				(m: { type: string }) => m.type === selectedInstallMethod
			) ?? script.install_methods[0];

			const res = await fetch('/api/environments', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: name.trim(),
					type: script.type === 'vm' ? 'vm' : 'lxc',
					template: '',
					cores: method?.resources?.cpu ?? script.default_cpu ?? 1,
					memory: method?.resources?.ram ?? script.default_ram ?? 512,
					disk: method?.resources?.hdd ?? script.default_disk ?? 8,
					community_script_slug: script.slug,
					install_method_type: method?.type ?? 'default',
					unprivileged: true,
					nesting: true,
					ssh_enabled: true,
					install_claude: installClaude
				})
			});

			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				errorMessage = body.message ?? `Creation failed (HTTP ${res.status}).`;
				return;
			}

			const env = await res.json();
			await goto(`/environments/${env.id}`);
		} catch {
			errorMessage = 'Network error. Please check your connection and try again.';
		} finally {
			submitting = false;
		}
	}

	async function handleConfigSubmit(e: SubmitEvent) {
		e.preventDefault();
		if (!configIsValid || submitting || !configPreview) return;

		submitting = true;
		errorMessage = '';

		try {
			// Use /api/configs/:name/create-env to create environment directly from config
			const res = await fetch(`/api/configs/${encodeURIComponent(selectedConfigName)}/create-env`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: name.trim(),
					install_claude: installClaude
				})
			});

			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				errorMessage = body.message ?? `Creation failed (HTTP ${res.status}).`;
				return;
			}

			const env = await res.json();
			await goto(`/environments/${env.id}`);
		} catch {
			errorMessage = 'Network error. Please check your connection and try again.';
		} finally {
			submitting = false;
		}
	}

	function searchCommunity() {
		goto(`/environments/create?cq=${encodeURIComponent(communitySearch)}`);
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

	<!-- Tab bar -->
	<div class="tab-bar">
		<button
			type="button"
			class="tab"
			class:active={activeTab === 'config'}
			onclick={() => activeTab = 'config'}
		>
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
				<polyline points="14 2 14 8 20 8" />
				<line x1="16" y1="13" x2="8" y2="13" />
				<line x1="16" y1="17" x2="8" y2="17" />
			</svg>
			From Config
		</button>
		<button
			type="button"
			class="tab"
			class:active={activeTab === 'quick'}
			onclick={() => activeTab = 'quick'}
		>
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
			</svg>
			Quick Create
		</button>
		<button
			type="button"
			class="tab"
			class:active={activeTab === 'community'}
			onclick={() => activeTab = 'community'}
		>
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
				<path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
			</svg>
			Community
		</button>
		<button
			type="button"
			class="tab"
			class:active={activeTab === 'template'}
			onclick={() => activeTab = 'template'}
		>
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<rect x="3" y="3" width="18" height="18" rx="2" />
				<path d="M3 9h18" />
				<path d="M9 21V9" />
			</svg>
			From Template
		</button>
	</div>

	<!-- ═══════════════ FROM TEMPLATE TAB ═══════════════ -->
	{#if activeTab === 'template'}
		<form class="create-form card" onsubmit={handleTemplateSubmit}>
			<div class="form-group">
				<label for="tpl-name" class="form-label">Environment Name</label>
				<input
					id="tpl-name"
					type="text"
					class="form-input"
					placeholder="my-dev-env"
					autocomplete="off"
					bind:value={name}
					required
				/>
			</div>

			<div class="form-group">
				<label for="tpl-select" class="form-label">Template</label>
				{#if data.spyreTemplates.length > 0}
					<select id="tpl-select" class="form-select" bind:value={selectedTemplateId} required>
						<option value="" disabled>Select a template</option>
						{#each data.spyreTemplates as tpl (tpl.id)}
							<option value={tpl.id}>
								{tpl.name}
								{#if tpl.description} — {tpl.description}{/if}
							</option>
						{/each}
					</select>
				{:else}
					<p class="empty-hint">
						No templates created yet. <a href="/templates/new">Create a template</a> first, or use the Quick Create tab.
					</p>
				{/if}
			</div>

			{#if selectedTemplate}
				<div class="preview-card">
					<div class="preview-label">Template Preview</div>
					<div class="preview-grid">
						<div class="preview-item">
							<span class="preview-key">Type</span>
							<span class="preview-value">{selectedTemplate.type === 'lxc' ? 'LXC Container' : 'VM'}</span>
						</div>
						{#if selectedTemplate.os_template}
							<div class="preview-item">
								<span class="preview-key">OS</span>
								<span class="preview-value code">{selectedTemplate.os_template}</span>
							</div>
						{/if}
						{#if selectedTemplate.cores}
							<div class="preview-item">
								<span class="preview-key">CPU</span>
								<span class="preview-value">{selectedTemplate.cores} cores</span>
							</div>
						{/if}
						{#if selectedTemplate.memory}
							<div class="preview-item">
								<span class="preview-key">Memory</span>
								<span class="preview-value">{selectedTemplate.memory} MB</span>
							</div>
						{/if}
						{#if selectedTemplate.disk}
							<div class="preview-item">
								<span class="preview-key">Disk</span>
								<span class="preview-value">{selectedTemplate.disk} GB</span>
							</div>
						{/if}
						{#if selectedTemplate.tags}
							<div class="preview-item">
								<span class="preview-key">Tags</span>
								<span class="preview-value">{selectedTemplate.tags}</span>
							</div>
						{/if}
					</div>
				</div>
			{/if}

			<label class="checkbox-label claude-checkbox">
				<input type="checkbox" bind:checked={installClaude} />
				<span>Install Claude Code</span>
				<span class="form-hint">Install the Claude CLI and propagate credentials into this environment.</span>
			</label>

			<div class="form-actions">
				<a href="/environments" class="btn btn-secondary">Cancel</a>
				<button
					type="submit"
					class="btn btn-primary"
					disabled={!templateIsValid || submitting || !data.proxmoxConnected}
				>
					{#if submitting}
						<span class="spinner"></span>
						Creating...
					{:else}
						Create from Template
					{/if}
				</button>
			</div>
		</form>
	{/if}

	<!-- ═══════════════ QUICK CREATE TAB ═══════════════ -->
	{#if activeTab === 'quick'}
		<form class="create-form card" onsubmit={handleQuickSubmit}>
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

			<div class="form-group">
				<label for="env-type" class="form-label">Type</label>
				<select id="env-type" class="form-select" bind:value={type}>
					<option value="lxc">LXC Container</option>
					<option value="vm">Virtual Machine</option>
				</select>
			</div>

			<div class="form-group">
				<label for="env-template" class="form-label">OS Template</label>
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

			<div class="resource-grid">
				<div class="form-group">
					<label for="env-cores" class="form-label">CPU Cores</label>
					<input id="env-cores" type="number" class="form-input" min="1" max="64" bind:value={cores} required />
				</div>
				<div class="form-group">
					<label for="env-memory" class="form-label">Memory (MB)</label>
					<input id="env-memory" type="number" class="form-input" min="128" step="128" bind:value={memory} required />
				</div>
				<div class="form-group">
					<label for="env-disk" class="form-label">Disk (GB)</label>
					<input id="env-disk" type="number" class="form-input" min="1" max="1000" bind:value={disk} required />
				</div>
			</div>

			<div class="section-divider">
				<button type="button" class="toggle-advanced" onclick={() => showAdvanced = !showAdvanced}>
					<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class:rotated={showAdvanced}>
						<polyline points="6 9 12 15 18 9" />
					</svg>
					{showAdvanced ? 'Hide' : 'Show'} Advanced Settings
				</button>
			</div>

			{#if showAdvanced}
				<div class="advanced-section">
					<div class="form-group">
						<label for="env-password" class="form-label">Root Password</label>
						<input id="env-password" type="text" class="form-input" placeholder="Auto-generated if left blank" autocomplete="new-password" bind:value={password} />
						<span class="form-hint">Leave blank to auto-generate a secure password. Viewable in environment details after creation.</span>
					</div>

					<div class="form-group">
						<label for="env-dns" class="form-label">DNS Server</label>
						<input id="env-dns" type="text" class="form-input" placeholder="8.8.8.8" bind:value={dns} />
					</div>

					<div class="checkbox-group">
						<label class="checkbox-label">
							<input type="checkbox" bind:checked={sshEnabled} />
							<span>SSH Enabled</span>
							<span class="form-hint">Inject controller SSH public key for passwordless access</span>
						</label>
						<label class="checkbox-label">
							<input type="checkbox" bind:checked={unprivileged} />
							<span>Unprivileged Container</span>
							<span class="form-hint">Recommended for security. Disable only if required by software.</span>
						</label>
						<label class="checkbox-label">
							<input type="checkbox" bind:checked={nesting} />
							<span>Nesting</span>
							<span class="form-hint">Required for Docker-in-LXC and other nested virtualization.</span>
						</label>
					</div>
				</div>
			{/if}

			<label class="checkbox-label claude-checkbox">
				<input type="checkbox" bind:checked={installClaude} />
				<span>Install Claude Code</span>
				<span class="form-hint">Install the Claude CLI and propagate credentials into this environment.</span>
			</label>

			<div class="summary">
				<span class="summary-label">Summary</span>
				<span class="summary-text">
					{type === 'lxc' ? 'LXC Container' : 'Virtual Machine'}
					&mdash; {cores} vCPU, {memory} MB RAM, {disk} GB disk
					{#if showAdvanced}
						&mdash; {unprivileged ? 'unprivileged' : 'privileged'}{nesting ? ', nesting' : ''}
					{/if}
				</span>
			</div>

			<div class="form-actions">
				<a href="/environments" class="btn btn-secondary">Cancel</a>
				<button type="submit" class="btn btn-primary" disabled={!quickIsValid || submitting || !data.proxmoxConnected}>
					{#if submitting}
						<span class="spinner"></span>
						Creating...
					{:else}
						Create Environment
					{/if}
				</button>
			</div>
		</form>
	{/if}

	<!-- ═══════════════ COMMUNITY TAB ═══════════════ -->
	{#if activeTab === 'community'}
		<div class="community-tab">
			<div class="community-search">
				<input
					type="text"
					class="form-input"
					placeholder="Search community scripts..."
					bind:value={communitySearch}
					onkeydown={(e: KeyboardEvent) => e.key === 'Enter' && searchCommunity()}
				/>
				<button type="button" class="btn btn-secondary" onclick={searchCommunity}>Search</button>
			</div>

			{#if data.communityScripts.length > 0}
				<div class="script-grid">
					{#each data.communityScripts as script (script.slug)}
						<button
							type="button"
							class="script-card card"
							class:selected={selectedScriptSlug === script.slug}
							onclick={() => selectedScriptSlug = selectedScriptSlug === script.slug ? '' : script.slug}
						>
							<div class="script-header">
								<span class="script-name">{script.name}</span>
								{#if script.type}
									<span class="type-badge" class:vm={script.type === 'vm'}>{script.type === 'ct' ? 'LXC' : script.type.toUpperCase()}</span>
								{/if}
							</div>
							{#if script.description}
								<p class="script-desc">{script.description}</p>
							{/if}
							<div class="script-resources">
								{#if script.default_cpu}<span>{script.default_cpu} CPU</span>{/if}
								{#if script.default_ram}<span>{script.default_ram} MB</span>{/if}
								{#if script.default_disk}<span>{script.default_disk} GB</span>{/if}
							</div>
						</button>
					{/each}
				</div>
			{:else}
				<div class="empty-state">
					<p>No community scripts found. <a href="/library">Visit the Library</a> to sync scripts from GitHub.</p>
				</div>
			{/if}

			{#if selectedScript}
				<form class="create-form card" onsubmit={handleCommunitySubmit}>
					<div class="selected-script-info">
						<span class="preview-label">Selected: {selectedScript.name}</span>
						{#if selectedScript.description}
							<p class="script-desc">{selectedScript.description}</p>
						{/if}
					</div>

					<div class="form-group">
						<label for="comm-name" class="form-label">Environment Name</label>
						<input
							id="comm-name"
							type="text"
							class="form-input"
							placeholder="my-dev-env"
							autocomplete="off"
							bind:value={name}
							required
						/>
					</div>

					{#if selectedScript.install_methods.length > 1}
						<div class="form-group">
							<label class="form-label">Install Method</label>
							<div class="method-options">
								{#each selectedScript.install_methods as method}
									<label class="method-option">
										<input type="radio" value={method.type} bind:group={selectedInstallMethod} />
										<span class="method-label">
											{method.type} — {method.resources.os} {method.resources.version},
											{method.resources.cpu} CPU, {method.resources.ram} MB, {method.resources.hdd} GB
										</span>
									</label>
								{/each}
							</div>
						</div>
					{/if}

					{#if selectedScript.notes?.length}
						<div class="notes-panel">
							{#each selectedScript.notes as note}
								<p class="note {typeof note === 'object' && note.type ? note.type : 'info'}">
									{typeof note === 'string' ? note : note.text}
								</p>
							{/each}
						</div>
					{/if}

					<label class="checkbox-label claude-checkbox">
						<input type="checkbox" bind:checked={installClaude} />
						<span>Install Claude Code</span>
						<span class="form-hint">Install the Claude CLI and propagate credentials into this environment.</span>
					</label>

					<div class="form-actions">
						<button type="button" class="btn btn-secondary" onclick={() => selectedScriptSlug = ''}>Cancel</button>
						<button type="submit" class="btn btn-primary" disabled={!communityIsValid || submitting || !data.proxmoxConnected}>
							{#if submitting}
								<span class="spinner"></span>
								Creating...
							{:else}
								Create from Community Script
							{/if}
						</button>
					</div>
				</form>
			{/if}
		</div>
	{/if}

	<!-- ═══════════════ FROM CONFIG TAB ═══════════════ -->
	{#if activeTab === 'config'}
		<form class="create-form card" onsubmit={handleConfigSubmit}>
			<div class="form-group">
				<label for="cfg-name" class="form-label">Environment Name</label>
				<input
					id="cfg-name"
					type="text"
					class="form-input"
					placeholder="my-dev-env"
					autocomplete="off"
					bind:value={name}
					required
				/>
			</div>

			<div class="form-group">
				<label for="cfg-select" class="form-label">YAML Config</label>
				{#if data.yamlConfigs.length > 0}
					<select
						id="cfg-select"
						class="form-select"
						bind:value={selectedConfigName}
						onchange={() => loadConfigPreview(selectedConfigName)}
						required
					>
						<option value="" disabled>Select a config</option>
						{#each data.yamlConfigs as cfg (cfg.name)}
							<option value={cfg.name}>
								{cfg.name}
								{#if cfg.description} — {cfg.description}{/if}
								{#if cfg.extends} (extends {cfg.extends}){/if}
							</option>
						{/each}
					</select>
				{:else}
					<p class="empty-hint">
						No YAML configs found. <a href="/configs/new">Create a config</a> first, or add <code>.yaml</code> files to the <code>configs/</code> directory.
					</p>
				{/if}
			</div>

			{#if configLoading}
				<div class="preview-card">
					<div class="preview-label">Loading config preview...</div>
				</div>
			{:else if configPreview}
				{@const spec = configPreview.spec as Record<string, unknown> | undefined}
				{@const platform = spec?.platform as Record<string, unknown> | undefined}
				{@const resources = platform?.resources as Record<string, unknown> | undefined}
				{@const provision = spec?.provision as Record<string, unknown> | undefined}

				<div class="preview-card">
					<div class="preview-label">Resolved Config Preview</div>
					<div class="preview-grid">
						<div class="preview-item">
							<span class="preview-key">Type</span>
							<span class="preview-value">{platform?.type === 'lxc' ? 'LXC Container' : platform?.type === 'vm' ? 'VM' : '—'}</span>
						</div>
						{#if platform?.template}
							<div class="preview-item">
								<span class="preview-key">OS</span>
								<span class="preview-value code">{platform.template}</span>
							</div>
						{/if}
						{#if resources?.cores}
							<div class="preview-item">
								<span class="preview-key">CPU</span>
								<span class="preview-value">{resources.cores} cores</span>
							</div>
						{/if}
						{#if resources?.memory}
							<div class="preview-item">
								<span class="preview-key">Memory</span>
								<span class="preview-value">{resources.memory} MB</span>
							</div>
						{/if}
						{#if resources?.disk}
							<div class="preview-item">
								<span class="preview-key">Disk</span>
								<span class="preview-value">{resources.disk} GB</span>
							</div>
						{/if}
						{#if provision?.packages && Array.isArray(provision.packages)}
							<div class="preview-item">
								<span class="preview-key">Packages</span>
								<span class="preview-value">{(provision.packages as string[]).length} packages</span>
							</div>
						{/if}
					</div>
				</div>
			{/if}

			<label class="checkbox-label claude-checkbox">
				<input type="checkbox" bind:checked={installClaude} />
				<span>Install Claude Code</span>
				<span class="form-hint">Install the Claude CLI and propagate credentials into this environment.</span>
			</label>

			<div class="form-actions">
				<a href="/environments" class="btn btn-secondary">Cancel</a>
				<button
					type="submit"
					class="btn btn-primary"
					disabled={!configIsValid || submitting || !data.proxmoxConnected}
				>
					{#if submitting}
						<span class="spinner"></span>
						Creating...
					{:else}
						Create from Config
					{/if}
				</button>
			</div>
		</form>
	{/if}
</div>

<style>
	.create-page {
		max-width: 720px;
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

	.alert svg { flex-shrink: 0; margin-top: 1px; }

	.alert-error {
		background-color: rgba(239, 68, 68, 0.08);
		border: 1px solid rgba(239, 68, 68, 0.2);
		color: var(--error);
	}

	/* ---- Tab bar ---- */

	.tab-bar {
		display: flex;
		gap: 2px;
		background-color: var(--bg-secondary);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		padding: 3px;
		margin-bottom: 20px;
	}

	.tab {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		padding: 10px 16px;
		border: none;
		border-radius: var(--radius-sm);
		background: transparent;
		color: var(--text-secondary);
		font-size: 0.8125rem;
		font-weight: 500;
		cursor: pointer;
		transition: all var(--transition);
	}

	.tab:hover {
		color: var(--text-primary);
		background-color: rgba(255, 255, 255, 0.04);
	}

	.tab.active {
		background-color: rgba(99, 102, 241, 0.15);
		color: var(--accent);
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
		.resource-grid { grid-template-columns: 1fr; }
	}

	.form-hint {
		font-size: 0.75rem;
		color: var(--text-secondary);
		opacity: 0.7;
	}

	.empty-hint {
		font-size: 0.875rem;
		color: var(--text-secondary);
		line-height: 1.5;
	}

	.empty-hint a {
		color: var(--accent);
	}

	/* ---- Template preview ---- */

	.preview-card {
		background-color: rgba(255, 255, 255, 0.02);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: 16px;
	}

	.preview-label {
		font-size: 0.6875rem;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: var(--text-secondary);
		margin-bottom: 10px;
	}

	.preview-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
		gap: 8px;
	}

	.preview-item {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.preview-key {
		font-size: 0.6875rem;
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
		font-size: 0.75rem;
		word-break: break-all;
	}

	/* ---- Advanced section ---- */

	.section-divider {
		border-top: 1px solid var(--border);
		padding-top: 4px;
	}

	.toggle-advanced {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		background: none;
		border: none;
		color: var(--text-secondary);
		font-size: 0.8125rem;
		font-weight: 500;
		cursor: pointer;
		padding: 4px 0;
		transition: color var(--transition);
	}

	.toggle-advanced:hover { color: var(--text-primary); }
	.toggle-advanced svg { transition: transform 0.2s ease; }
	.toggle-advanced svg.rotated { transform: rotate(180deg); }

	.advanced-section {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.checkbox-group {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.checkbox-label {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		font-size: 0.875rem;
		cursor: pointer;
		flex-wrap: wrap;
	}

	.checkbox-label input[type='checkbox'] {
		margin-top: 2px;
		accent-color: var(--accent);
	}

	.checkbox-label .form-hint {
		width: 100%;
		padding-left: 26px;
		margin-top: -4px;
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

	/* ---- Community tab ---- */

	.community-tab {
		display: flex;
		flex-direction: column;
		gap: 20px;
	}

	.community-search {
		display: flex;
		gap: 10px;
	}

	.community-search .form-input {
		flex: 1;
	}

	.script-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		gap: 12px;
	}

	.script-card {
		text-align: left;
		cursor: pointer;
		transition: all var(--transition);
		border: 1px solid var(--border);
		padding: 14px;
	}

	.script-card:hover {
		border-color: var(--accent);
	}

	.script-card.selected {
		border-color: var(--accent);
		background-color: rgba(99, 102, 241, 0.08);
	}

	.script-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		margin-bottom: 6px;
	}

	.script-name {
		font-weight: 600;
		font-size: 0.875rem;
	}

	.type-badge {
		font-size: 0.625rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: 2px 6px;
		border-radius: 3px;
		background-color: rgba(99, 102, 241, 0.15);
		color: var(--accent);
	}

	.type-badge.vm {
		background-color: rgba(251, 191, 36, 0.15);
		color: #fbbf24;
	}

	.script-desc {
		font-size: 0.75rem;
		color: var(--text-secondary);
		line-height: 1.4;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
		margin-bottom: 8px;
	}

	.script-resources {
		display: flex;
		gap: 8px;
		font-size: 0.6875rem;
		color: var(--text-secondary);
	}

	.script-resources span {
		background-color: rgba(255, 255, 255, 0.05);
		padding: 2px 6px;
		border-radius: 3px;
	}

	.selected-script-info {
		padding-bottom: 12px;
		border-bottom: 1px solid var(--border);
	}

	.empty-state {
		text-align: center;
		padding: 40px 20px;
		color: var(--text-secondary);
		font-size: 0.875rem;
	}

	.empty-state a {
		color: var(--accent);
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

	/* ---- Install method selector ---- */

	.method-options {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.method-option {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 0.8125rem;
		cursor: pointer;
		padding: 8px 12px;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		transition: all var(--transition);
	}

	.method-option:hover {
		border-color: var(--accent);
	}

	.method-option input[type='radio'] {
		accent-color: var(--accent);
	}

	.method-label {
		color: var(--text-primary);
	}

	/* ---- Notes panel ---- */

	.notes-panel {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 12px 16px;
		background-color: rgba(251, 191, 36, 0.06);
		border: 1px solid rgba(251, 191, 36, 0.15);
		border-radius: var(--radius-sm);
	}

	.note {
		font-size: 0.8125rem;
		line-height: 1.5;
		color: var(--text-secondary);
		margin: 0;
	}

	.note.warning {
		color: #fbbf24;
	}

	.note.info {
		color: var(--text-secondary);
	}

	/* ---- Claude checkbox ---- */

	.claude-checkbox {
		padding: 12px 16px;
		background-color: rgba(99, 102, 241, 0.04);
		border: 1px solid rgba(99, 102, 241, 0.15);
		border-radius: var(--radius-sm);
	}
</style>
