<script lang="ts">
	import { goto } from '$app/navigation';
	import type { PageData } from './$types';
	import type { ResourcePreset, NetworkProfile, SoftwarePool } from '$lib/types/template';

	let { data }: { data: PageData } = $props();

	const t = data.template;

	// Section visibility
	let showOs = $state(false);
	let showResources = $state(false);
	let showNetwork = $state(false);
	let showContainer = $state(false);
	let showAccess = $state(false);
	let showSoftware = $state(false);
	let showScript = $state(false);

	// General
	let name = $state(t.name);
	let description = $state(t.description ?? '');
	let type = $state<'lxc' | 'vm'>(t.type);

	// OS
	let osTemplate = $state(t.os_template ?? '');
	let osTemplateManual = $state('');
	let osType = $state(t.os_type ?? '');
	let osVersion = $state(t.os_version ?? '');

	// Resources
	let resourcePresetId = $state(t.resource_preset_id ?? '');
	let cores = $state<number | ''>(t.cores ?? '');
	let memory = $state<number | ''>(t.memory ?? '');
	let swap = $state<number | ''>(t.swap ?? '');
	let disk = $state<number | ''>(t.disk ?? '');
	let storage = $state(t.storage ?? '');

	// Network
	let networkProfileId = $state(t.network_profile_id ?? '');
	let bridge = $state(t.bridge ?? '');
	let ipMode = $state<'dhcp' | 'static'>(t.ip_mode ?? 'dhcp');
	let ipAddress = $state(t.ip_address ?? '');
	let gateway = $state(t.gateway ?? '');
	let dns = $state(t.dns ?? '');
	let vlan = $state<number | ''>(t.vlan ?? '');

	// Container settings
	let unprivileged = $state(!!t.unprivileged);
	let nesting = $state(!!t.nesting);
	let features = $state(t.features ?? '');
	let startupOrder = $state<number | ''>(t.startup_order ?? '');
	let protection = $state(!!t.protection);

	// Access
	let sshEnabled = $state(!!t.ssh_enabled);
	let sshKeys = $state(t.ssh_keys ?? '');
	let rootPassword = $state(t.root_password ?? '');
	let defaultUser = $state(t.default_user ?? '');
	let timezone = $state(t.timezone ?? 'host');

	// Software pools
	let selectedPoolIds = $state<string[]>(t.software_pools.map(p => p.id));

	// Custom script
	let customScript = $state(t.custom_script ?? '');
	let tags = $state(t.tags ?? '');

	// UI state
	let submitting = $state(false);
	let errorMessage = $state('');

	let selectedPreset = $derived(
		resourcePresetId
			? (data.presets as ResourcePreset[]).find((p: ResourcePreset) => p.id === resourcePresetId) ?? null
			: null
	);

	let selectedProfile = $derived(
		networkProfileId
			? (data.profiles as NetworkProfile[]).find((p: NetworkProfile) => p.id === networkProfileId) ?? null
			: null
	);

	let effectiveOsTemplate = $derived(
		osTemplate || osTemplateManual
	);

	let isValid = $derived(name.trim().length > 0);

	function togglePool(poolId: string) {
		if (selectedPoolIds.includes(poolId)) {
			selectedPoolIds = selectedPoolIds.filter(id => id !== poolId);
		} else {
			selectedPoolIds = [...selectedPoolIds, poolId];
		}
	}

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		if (!isValid || submitting) return;

		submitting = true;
		errorMessage = '';

		const body: Record<string, unknown> = {
			name: name.trim(),
			description: description || undefined,
			type
		};

		// OS
		body.os_template = effectiveOsTemplate || undefined;
		body.os_type = osType || undefined;
		body.os_version = osVersion || undefined;

		// Resources
		body.resource_preset_id = resourcePresetId || undefined;
		body.cores = cores !== '' ? Number(cores) : undefined;
		body.memory = memory !== '' ? Number(memory) : undefined;
		body.swap = swap !== '' ? Number(swap) : undefined;
		body.disk = disk !== '' ? Number(disk) : undefined;
		body.storage = storage || undefined;

		// Network
		body.network_profile_id = networkProfileId || undefined;
		body.bridge = bridge || undefined;
		body.ip_mode = ipMode;
		body.ip_address = ipAddress || undefined;
		body.gateway = gateway || undefined;
		body.dns = dns || undefined;
		body.vlan = vlan !== '' ? Number(vlan) : undefined;

		// Container settings
		body.unprivileged = unprivileged;
		body.nesting = nesting;
		body.features = features || undefined;
		body.startup_order = startupOrder !== '' ? Number(startupOrder) : undefined;
		body.protection = protection;

		// Access
		body.ssh_enabled = sshEnabled;
		body.ssh_keys = sshKeys || undefined;
		body.root_password = rootPassword || undefined;
		body.default_user = defaultUser || undefined;
		body.timezone = timezone || undefined;

		// Software pools
		body.software_pool_ids = selectedPoolIds;

		// Custom script & tags
		body.custom_script = customScript || undefined;
		body.tags = tags || undefined;

		try {
			const res = await fetch(`/api/templates/${t.id}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});

			if (!res.ok) {
				const result = await res.json().catch(() => ({}));
				errorMessage = result.message ?? `Failed to update template (HTTP ${res.status}).`;
				return;
			}

			await goto('/templates');
		} catch {
			errorMessage = 'Network error. Please check your connection and try again.';
		} finally {
			submitting = false;
		}
	}
</script>

<div class="form-page">
	<header class="page-header">
		<a href="/templates" class="back-link">
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<path d="M19 12H5" />
				<polyline points="12 19 5 12 12 5" />
			</svg>
			Back to Templates
		</a>
		<h1>Edit Template</h1>
		<p class="subtitle">Update the blueprint for <strong>{t.name}</strong>.</p>
	</header>

	{#if !data.proxmoxConnected}
		<div class="alert alert-warning">
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<circle cx="12" cy="12" r="10" />
				<line x1="12" y1="8" x2="12" y2="12" />
				<line x1="12" y1="16" x2="12.01" y2="16" />
			</svg>
			<span>Proxmox is unreachable. OS template list could not be loaded. You can still enter values manually.</span>
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

	<form class="template-form" onsubmit={handleSubmit}>
		<!-- ============ General Section ============ -->
		<section class="form-section card">
			<h2 class="section-title">General</h2>

			<div class="section-content" style="margin-top: 16px; padding-top: 0; border-top: none;">
				<div class="form-group">
					<label for="tpl-name" class="form-label">Name <span class="required">*</span></label>
					<input
						id="tpl-name"
						type="text"
						class="form-input"
						placeholder="e.g. ubuntu-dev-large"
						autocomplete="off"
						bind:value={name}
						required
					/>
				</div>

				<div class="form-group">
					<label for="tpl-desc" class="form-label">Description</label>
					<textarea
						id="tpl-desc"
						class="form-input form-textarea"
						placeholder="What is this template for?"
						rows="2"
						bind:value={description}
					></textarea>
				</div>

				<div class="form-group">
					<label for="tpl-type" class="form-label">Type</label>
					<select id="tpl-type" class="form-select" bind:value={type}>
						<option value="lxc">LXC Container</option>
						<option value="vm">Virtual Machine</option>
					</select>
				</div>
			</div>
		</section>

		<!-- ============ OS Section ============ -->
		<section class="form-section card">
			<button type="button" class="section-toggle" onclick={() => showOs = !showOs}>
				<h2 class="section-title">OS</h2>
				<svg
					width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
					stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
					class="chevron" class:open={showOs}
				>
					<polyline points="6 9 12 15 18 9" />
				</svg>
			</button>

			{#if showOs}
				<div class="section-content">
					<div class="form-group">
						<label for="tpl-os-template" class="form-label">OS Template</label>
						{#if (data.osTemplates as Array<{volid: string}>).length > 0}
							<select id="tpl-os-template" class="form-select" bind:value={osTemplate}>
								<option value="">-- Select OS template --</option>
								{#each data.osTemplates as osTpl}
									<option value={osTpl.volid}>{osTpl.volid}</option>
								{/each}
							</select>
							{#if !osTemplate}
								<input
									type="text"
									class="form-input"
									placeholder="Or enter manually..."
									bind:value={osTemplateManual}
								/>
							{/if}
						{:else}
							<input
								type="text"
								class="form-input"
								placeholder="local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst"
								bind:value={osTemplate}
							/>
							<span class="form-hint">Proxmox not connected. Enter template ID manually.</span>
						{/if}
					</div>

					<div class="form-row">
						<div class="form-group">
							<label for="tpl-os-type" class="form-label">OS Type</label>
							<input id="tpl-os-type" type="text" class="form-input" placeholder="e.g. ubuntu" bind:value={osType} />
						</div>
						<div class="form-group">
							<label for="tpl-os-version" class="form-label">OS Version</label>
							<input id="tpl-os-version" type="text" class="form-input" placeholder="e.g. 22.04" bind:value={osVersion} />
						</div>
					</div>
				</div>
			{/if}
		</section>

		<!-- ============ Resources Section ============ -->
		<section class="form-section card">
			<button type="button" class="section-toggle" onclick={() => showResources = !showResources}>
				<h2 class="section-title">Resources</h2>
				<svg
					width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
					stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
					class="chevron" class:open={showResources}
				>
					<polyline points="6 9 12 15 18 9" />
				</svg>
			</button>

			{#if showResources}
				<div class="section-content">
					<div class="form-group">
						<label for="tpl-preset" class="form-label">Resource Preset</label>
						<select id="tpl-preset" class="form-select" bind:value={resourcePresetId}>
							<option value="">None &mdash; configure manually</option>
							{#each data.presets as preset}
								<option value={preset.id}>{preset.name} ({preset.cores} cores, {preset.memory} MB, {preset.disk} GB)</option>
							{/each}
						</select>
					</div>

					{#if selectedPreset}
						<div class="preset-summary">
							<span class="preset-label">Preset values:</span>
							<span class="preset-values">{selectedPreset.cores} cores, {selectedPreset.memory} MB RAM, {selectedPreset.swap} MB swap, {selectedPreset.disk} GB disk</span>
						</div>
					{/if}

					<p class="form-hint">
						{#if selectedPreset}
							Override specific values below, or leave blank to use the preset.
						{:else}
							Configure resource allocation manually.
						{/if}
					</p>

					<div class="form-row form-row-4">
						<div class="form-group">
							<label for="tpl-cores" class="form-label">
								Cores
								{#if selectedPreset}<span class="from-preset">(preset: {selectedPreset.cores})</span>{/if}
							</label>
							<input id="tpl-cores" type="number" class="form-input" min="1" max="128" placeholder={selectedPreset ? String(selectedPreset.cores) : '1'} bind:value={cores} />
						</div>
						<div class="form-group">
							<label for="tpl-memory" class="form-label">
								Memory (MB)
								{#if selectedPreset}<span class="from-preset">(preset: {selectedPreset.memory})</span>{/if}
							</label>
							<input id="tpl-memory" type="number" class="form-input" min="64" step="64" placeholder={selectedPreset ? String(selectedPreset.memory) : '512'} bind:value={memory} />
						</div>
						<div class="form-group">
							<label for="tpl-swap" class="form-label">
								Swap (MB)
								{#if selectedPreset}<span class="from-preset">(preset: {selectedPreset.swap})</span>{/if}
							</label>
							<input id="tpl-swap" type="number" class="form-input" min="0" step="64" placeholder={selectedPreset ? String(selectedPreset.swap) : '0'} bind:value={swap} />
						</div>
						<div class="form-group">
							<label for="tpl-disk" class="form-label">
								Disk (GB)
								{#if selectedPreset}<span class="from-preset">(preset: {selectedPreset.disk})</span>{/if}
							</label>
							<input id="tpl-disk" type="number" class="form-input" min="1" max="2000" placeholder={selectedPreset ? String(selectedPreset.disk) : '8'} bind:value={disk} />
						</div>
					</div>

					<div class="form-group">
						<label for="tpl-storage" class="form-label">Storage</label>
						<input id="tpl-storage" type="text" class="form-input" placeholder="Uses environment default if blank" bind:value={storage} />
					</div>
				</div>
			{/if}
		</section>

		<!-- ============ Network Section ============ -->
		<section class="form-section card">
			<button type="button" class="section-toggle" onclick={() => showNetwork = !showNetwork}>
				<h2 class="section-title">Network</h2>
				<svg
					width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
					stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
					class="chevron" class:open={showNetwork}
				>
					<polyline points="6 9 12 15 18 9" />
				</svg>
			</button>

			{#if showNetwork}
				<div class="section-content">
					<div class="form-group">
						<label for="tpl-profile" class="form-label">Network Profile</label>
						<select id="tpl-profile" class="form-select" bind:value={networkProfileId}>
							<option value="">None</option>
							{#each data.profiles as profile}
								<option value={profile.id}>{profile.name} ({profile.bridge}, {profile.ip_mode})</option>
							{/each}
						</select>
					</div>

					{#if selectedProfile}
						<div class="preset-summary">
							<span class="preset-label">Profile values:</span>
							<span class="preset-values">{selectedProfile.bridge}, {selectedProfile.ip_mode}{selectedProfile.vlan ? `, VLAN ${selectedProfile.vlan}` : ''}</span>
						</div>
					{/if}

					<p class="form-hint">Override specific values below, or leave blank to use the profile/defaults.</p>

					<div class="form-row">
						<div class="form-group">
							<label for="tpl-bridge" class="form-label">Bridge</label>
							<input id="tpl-bridge" type="text" class="form-input" placeholder={selectedProfile?.bridge ?? 'vmbr0'} bind:value={bridge} />
						</div>
						<div class="form-group">
							<label for="tpl-ip-mode" class="form-label">IP Mode</label>
							<select id="tpl-ip-mode" class="form-select" bind:value={ipMode}>
								<option value="dhcp">DHCP</option>
								<option value="static">Static</option>
							</select>
						</div>
					</div>

					{#if ipMode === 'static'}
						<div class="form-row">
							<div class="form-group">
								<label for="tpl-ip" class="form-label">IP Address</label>
								<input id="tpl-ip" type="text" class="form-input" placeholder="10.0.0.100/24" bind:value={ipAddress} />
							</div>
							<div class="form-group">
								<label for="tpl-gw" class="form-label">Gateway</label>
								<input id="tpl-gw" type="text" class="form-input" placeholder="10.0.0.1" bind:value={gateway} />
							</div>
						</div>
					{/if}

					<div class="form-row">
						<div class="form-group">
							<label for="tpl-dns" class="form-label">DNS</label>
							<input id="tpl-dns" type="text" class="form-input" placeholder="8.8.8.8" bind:value={dns} />
						</div>
						<div class="form-group">
							<label for="tpl-vlan" class="form-label">VLAN</label>
							<input id="tpl-vlan" type="number" class="form-input" min="1" max="4094" placeholder="None" bind:value={vlan} />
						</div>
					</div>
				</div>
			{/if}
		</section>

		<!-- ============ Container Settings Section ============ -->
		<section class="form-section card">
			<button type="button" class="section-toggle" onclick={() => showContainer = !showContainer}>
				<h2 class="section-title">Container Settings</h2>
				<svg
					width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
					stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
					class="chevron" class:open={showContainer}
				>
					<polyline points="6 9 12 15 18 9" />
				</svg>
			</button>

			{#if showContainer}
				<div class="section-content">
					<div class="checkbox-group">
						<label class="checkbox-label">
							<input type="checkbox" bind:checked={unprivileged} />
							<span>Unprivileged</span>
							<span class="form-hint">Recommended for security. Disable only if required.</span>
						</label>

						<label class="checkbox-label">
							<input type="checkbox" bind:checked={nesting} />
							<span>Nesting</span>
							<span class="form-hint">Required for Docker-in-LXC and nested virtualization.</span>
						</label>

						<label class="checkbox-label">
							<input type="checkbox" bind:checked={protection} />
							<span>Protection</span>
							<span class="form-hint">Prevent accidental deletion in Proxmox.</span>
						</label>
					</div>

					<div class="form-row">
						<div class="form-group">
							<label for="tpl-features" class="form-label">Features</label>
							<input id="tpl-features" type="text" class="form-input" placeholder="e.g. keyctl=1,fuse=1" bind:value={features} />
						</div>
						<div class="form-group">
							<label for="tpl-startup" class="form-label">Startup Order</label>
							<input id="tpl-startup" type="number" class="form-input" min="0" placeholder="None" bind:value={startupOrder} />
						</div>
					</div>
				</div>
			{/if}
		</section>

		<!-- ============ Access Section ============ -->
		<section class="form-section card">
			<button type="button" class="section-toggle" onclick={() => showAccess = !showAccess}>
				<h2 class="section-title">Access</h2>
				<svg
					width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
					stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
					class="chevron" class:open={showAccess}
				>
					<polyline points="6 9 12 15 18 9" />
				</svg>
			</button>

			{#if showAccess}
				<div class="section-content">
					<div class="checkbox-group">
						<label class="checkbox-label">
							<input type="checkbox" bind:checked={sshEnabled} />
							<span>SSH Enabled</span>
							<span class="form-hint">Inject controller SSH key for passwordless access.</span>
						</label>
					</div>

					<div class="form-group">
						<label for="tpl-ssh-keys" class="form-label">SSH Keys</label>
						<textarea
							id="tpl-ssh-keys"
							class="form-input form-textarea"
							rows="3"
							placeholder="ssh-ed25519 AAAA... (one per line)"
							bind:value={sshKeys}
						></textarea>
					</div>

					<div class="form-row">
						<div class="form-group">
							<label for="tpl-root-pw" class="form-label">Root Password</label>
							<input id="tpl-root-pw" type="text" class="form-input" placeholder="Leave blank for key-only" autocomplete="new-password" bind:value={rootPassword} />
						</div>
						<div class="form-group">
							<label for="tpl-default-user" class="form-label">Default User</label>
							<input id="tpl-default-user" type="text" class="form-input" placeholder="e.g. dev" bind:value={defaultUser} />
						</div>
					</div>

					<div class="form-group">
						<label for="tpl-timezone" class="form-label">Timezone</label>
						<input id="tpl-timezone" type="text" class="form-input" placeholder="host" bind:value={timezone} />
					</div>
				</div>
			{/if}
		</section>

		<!-- ============ Software Pools Section ============ -->
		<section class="form-section card">
			<button type="button" class="section-toggle" onclick={() => showSoftware = !showSoftware}>
				<h2 class="section-title">Software Pools</h2>
				{#if selectedPoolIds.length > 0}
					<span class="section-count">{selectedPoolIds.length}</span>
				{/if}
				<svg
					width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
					stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
					class="chevron" class:open={showSoftware}
				>
					<polyline points="6 9 12 15 18 9" />
				</svg>
			</button>

			{#if showSoftware}
				<div class="section-content">
					{#if (data.pools as SoftwarePool[]).length === 0}
						<p class="form-hint">No software pools have been created yet. <a href="/software-pools">Create one</a></p>
					{:else}
						<div class="pool-list">
							{#each data.pools as pool}
								<label class="pool-item">
									<input
										type="checkbox"
										checked={selectedPoolIds.includes(pool.id)}
										onchange={() => togglePool(pool.id)}
									/>
									<div class="pool-info">
										<span class="pool-name">{pool.name}</span>
										{#if pool.description}
											<span class="pool-desc">{pool.description}</span>
										{/if}
									</div>
								</label>
							{/each}
						</div>
					{/if}
				</div>
			{/if}
		</section>

		<!-- ============ Custom Script Section ============ -->
		<section class="form-section card">
			<button type="button" class="section-toggle" onclick={() => showScript = !showScript}>
				<h2 class="section-title">Custom Script &amp; Tags</h2>
				<svg
					width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
					stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
					class="chevron" class:open={showScript}
				>
					<polyline points="6 9 12 15 18 9" />
				</svg>
			</button>

			{#if showScript}
				<div class="section-content">
					<div class="form-group">
						<label for="tpl-script" class="form-label">Custom Provisioning Script</label>
						<textarea
							id="tpl-script"
							class="form-input form-textarea form-code"
							rows="6"
							placeholder="#!/bin/bash&#10;# Custom setup commands..."
							bind:value={customScript}
						></textarea>
						<span class="form-hint">Runs after all software pools. Use bash syntax.</span>
					</div>

					<div class="form-group">
						<label for="tpl-tags" class="form-label">Tags</label>
						<input id="tpl-tags" type="text" class="form-input" placeholder="dev, ubuntu, large (comma-separated)" bind:value={tags} />
					</div>
				</div>
			{/if}
		</section>

		<!-- ============ Actions ============ -->
		<div class="form-actions">
			<a href="/templates" class="btn btn-secondary">Cancel</a>
			<button
				type="submit"
				class="btn btn-primary"
				disabled={!isValid || submitting}
			>
				{#if submitting}
					<span class="spinner"></span>
					Saving...
				{:else}
					Save Changes
				{/if}
			</button>
		</div>
	</form>
</div>

<style>
	.form-page {
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

	.alert svg {
		flex-shrink: 0;
		margin-top: 1px;
	}

	.alert-error {
		background-color: rgba(239, 68, 68, 0.08);
		border: 1px solid rgba(239, 68, 68, 0.2);
		color: var(--error);
	}

	.alert-warning {
		background-color: rgba(245, 158, 11, 0.08);
		border: 1px solid rgba(245, 158, 11, 0.2);
		color: var(--warning);
	}

	/* ---- Form layout ---- */

	.template-form {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.form-section {
		display: flex;
		flex-direction: column;
		gap: 0;
	}

	.section-toggle {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		background: none;
		border: none;
		padding: 0;
		cursor: pointer;
		color: var(--text-primary);
		text-align: left;
	}

	.section-title {
		font-size: 0.9375rem;
		font-weight: 600;
		flex: 1;
	}

	.section-count {
		font-size: 0.6875rem;
		font-weight: 600;
		background-color: rgba(99, 102, 241, 0.12);
		color: var(--accent);
		padding: 1px 7px;
		border-radius: 9999px;
	}

	.chevron {
		color: var(--text-secondary);
		transition: transform 0.2s ease;
	}

	.chevron.open {
		transform: rotate(180deg);
	}

	.section-content {
		display: flex;
		flex-direction: column;
		gap: 16px;
		margin-top: 16px;
		padding-top: 16px;
		border-top: 1px solid var(--border);
	}

	/* ---- Form rows ---- */

	.form-row {
		display: grid;
		grid-template-columns: repeat(2, 1fr);
		gap: 16px;
	}

	.form-row-4 {
		grid-template-columns: repeat(4, 1fr);
	}

	@media (max-width: 640px) {
		.form-row {
			grid-template-columns: 1fr;
		}
		.form-row-4 {
			grid-template-columns: repeat(2, 1fr);
		}
	}

	/* ---- Form elements ---- */

	.form-textarea {
		resize: vertical;
		min-height: 60px;
	}

	.form-code {
		font-family: 'SF Mono', 'Fira Code', 'Fira Mono', monospace;
		font-size: 0.8125rem;
		tab-size: 2;
	}

	.form-hint {
		font-size: 0.75rem;
		color: var(--text-secondary);
		opacity: 0.7;
	}

	.required {
		color: var(--error);
	}

	.from-preset {
		font-weight: 400;
		font-size: 0.6875rem;
		color: var(--accent);
		opacity: 0.8;
	}

	/* ---- Preset summary ---- */

	.preset-summary {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 10px 14px;
		background-color: rgba(99, 102, 241, 0.05);
		border: 1px solid rgba(99, 102, 241, 0.15);
		border-radius: var(--radius-sm);
		font-size: 0.8125rem;
	}

	.preset-label {
		font-size: 0.6875rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: var(--text-secondary);
	}

	.preset-values {
		font-weight: 500;
		color: var(--text-primary);
	}

	/* ---- Checkboxes ---- */

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

	/* ---- Software pool list ---- */

	.pool-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.pool-item {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		padding: 10px 14px;
		background-color: rgba(255, 255, 255, 0.02);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		cursor: pointer;
		transition: border-color var(--transition), background-color var(--transition);
	}

	.pool-item:hover {
		border-color: var(--accent);
		background-color: rgba(99, 102, 241, 0.04);
	}

	.pool-item input[type='checkbox'] {
		margin-top: 2px;
		accent-color: var(--accent);
	}

	.pool-info {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.pool-name {
		font-size: 0.875rem;
		font-weight: 500;
	}

	.pool-desc {
		font-size: 0.75rem;
		color: var(--text-secondary);
	}

	/* ---- Actions ---- */

	.form-actions {
		display: flex;
		justify-content: flex-end;
		gap: 10px;
		padding-top: 8px;
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
