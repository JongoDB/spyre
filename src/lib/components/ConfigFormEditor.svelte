<script lang="ts">
	import SoftwareMultiSelect from './SoftwareMultiSelect.svelte';

	interface ConfigFormData {
		name: string;
		kind: 'Environment' | 'EnvironmentBase';
		extends?: string;
		description?: string;
		labels: Record<string, string>;
		platformType: 'lxc' | 'vm';
		template?: string;
		cores?: number;
		memory?: number;
		swap?: number;
		disk?: number;
		storage?: string;
		bridge?: string;
		ip?: string;
		gateway?: string;
		dns?: string;
		vlan?: number;
		software: string[];
		communityScriptSlug?: string;
		communityScriptInstallMethod?: string;
		packages: string[];
		scripts: Array<{
			name?: string;
			type: 'run' | 'copy' | 'url';
			content?: string;
			destination?: string;
			interpreter?: string;
			url?: string;
			postCommand?: string;
			mode?: string;
			owner?: string;
			condition?: string;
		}>;
		authorizedKeys: string[];
		services: Array<{ name: string; port: number; protocol?: 'http' | 'https' | 'tcp' }>;
		claudeWorkingDirectory?: string;
		claudeMd?: string;
		unprivileged?: boolean;
		nesting?: boolean;
		features?: string;
		startupOrder?: number;
		protection?: boolean;
		sshEnabled?: boolean;
		rootPassword?: string;
		defaultUser?: string;
		timezone?: string;
		helperScript?: string;
	}

	let { formData = $bindable(), onchange }: { formData: ConfigFormData; onchange?: () => void } = $props();

	let newLabelKey = $state('');
	let newLabelValue = $state('');
	let newPackage = $state('');
	let newAuthorizedKey = $state('');

	// Section collapse state
	let expandedSections = $state<Record<string, boolean>>({
		metadata: true,
		platform: true,
		software: false,
		provision: false,
		services: false,
		claude: false,
		lxc: false,
		access: false,
	});

	function toggleSection(section: string) {
		expandedSections[section] = !expandedSections[section];
	}

	function notify() {
		onchange?.();
	}

	function addLabel() {
		if (newLabelKey.trim()) {
			formData.labels[newLabelKey.trim()] = newLabelValue.trim();
			newLabelKey = '';
			newLabelValue = '';
			notify();
		}
	}

	function removeLabel(key: string) {
		delete formData.labels[key];
		formData.labels = { ...formData.labels };
		notify();
	}

	function addPackage() {
		if (newPackage.trim()) {
			formData.packages = [...formData.packages, newPackage.trim()];
			newPackage = '';
			notify();
		}
	}

	function removePackage(idx: number) {
		formData.packages = formData.packages.filter((_, i) => i !== idx);
		notify();
	}

	function addScript() {
		formData.scripts = [...formData.scripts, { type: 'run', content: '' }];
		notify();
	}

	function removeScript(idx: number) {
		formData.scripts = formData.scripts.filter((_, i) => i !== idx);
		notify();
	}

	function addService() {
		formData.services = [...formData.services, { name: '', port: 80, protocol: 'http' }];
		notify();
	}

	function removeService(idx: number) {
		formData.services = formData.services.filter((_, i) => i !== idx);
		notify();
	}

	function addAuthorizedKey() {
		if (newAuthorizedKey.trim()) {
			formData.authorizedKeys = [...formData.authorizedKeys, newAuthorizedKey.trim()];
			newAuthorizedKey = '';
			notify();
		}
	}

	function removeAuthorizedKey(idx: number) {
		formData.authorizedKeys = formData.authorizedKeys.filter((_, i) => i !== idx);
		notify();
	}
</script>

<div class="form-editor">
	<!-- ═══ Metadata ═══ -->
	<section class="form-section">
		<button type="button" class="section-header" onclick={() => toggleSection('metadata')}>
			<span class="section-title">Metadata</span>
			<span class="section-chevron" class:open={expandedSections.metadata}></span>
		</button>
		{#if expandedSections.metadata}
			<div class="section-body">
				<div class="form-row">
					<div class="form-group">
						<label class="form-label">Name</label>
						<input type="text" class="form-input" bind:value={formData.name} oninput={notify} placeholder="my-config" />
					</div>
					<div class="form-group" style="max-width: 180px">
						<label class="form-label">Kind</label>
						<select class="form-select" bind:value={formData.kind} onchange={notify}>
							<option value="Environment">Environment</option>
							<option value="EnvironmentBase">EnvironmentBase</option>
						</select>
					</div>
				</div>
				<div class="form-group">
					<label class="form-label">Description</label>
					<input type="text" class="form-input" bind:value={formData.description} oninput={notify} placeholder="A short description of this config" />
				</div>
				<div class="form-group">
					<label class="form-label">Extends</label>
					<input type="text" class="form-input" bind:value={formData.extends} oninput={notify} placeholder="bases/ubuntu-dev" />
					<span class="form-hint">Name of a base config to inherit from</span>
				</div>
				<div class="form-group">
					<label class="form-label">Labels</label>
					<div class="tag-list">
						{#each Object.entries(formData.labels) as [key, val]}
							<span class="tag">
								{key}: {val}
								<button type="button" class="tag-remove" onclick={() => removeLabel(key)}>x</button>
							</span>
						{/each}
					</div>
					<div class="inline-add">
						<input type="text" class="form-input small" bind:value={newLabelKey} placeholder="key" />
						<input type="text" class="form-input small" bind:value={newLabelValue} placeholder="value" />
						<button type="button" class="btn btn-small btn-secondary" onclick={addLabel}>Add</button>
					</div>
				</div>
			</div>
		{/if}
	</section>

	<!-- ═══ Platform ═══ -->
	<section class="form-section">
		<button type="button" class="section-header" onclick={() => toggleSection('platform')}>
			<span class="section-title">Platform</span>
			<span class="section-chevron" class:open={expandedSections.platform}></span>
		</button>
		{#if expandedSections.platform}
			<div class="section-body">
				<div class="form-row">
					<div class="form-group" style="max-width: 180px">
						<label class="form-label">Type</label>
						<select class="form-select" bind:value={formData.platformType} onchange={notify}>
							<option value="lxc">LXC Container</option>
							<option value="vm">Virtual Machine</option>
						</select>
					</div>
					<div class="form-group">
						<label class="form-label">OS Template</label>
						<input type="text" class="form-input" bind:value={formData.template} oninput={notify} placeholder="local:vztmpl/ubuntu-22.04-..." />
					</div>
				</div>
				<div class="form-row resource-row">
					<div class="form-group">
						<label class="form-label">Cores</label>
						<input type="number" class="form-input" bind:value={formData.cores} oninput={notify} min="1" max="64" />
					</div>
					<div class="form-group">
						<label class="form-label">Memory (MB)</label>
						<input type="number" class="form-input" bind:value={formData.memory} oninput={notify} min="128" step="128" />
					</div>
					<div class="form-group">
						<label class="form-label">Swap (MB)</label>
						<input type="number" class="form-input" bind:value={formData.swap} oninput={notify} min="0" />
					</div>
					<div class="form-group">
						<label class="form-label">Disk (GB)</label>
						<input type="number" class="form-input" bind:value={formData.disk} oninput={notify} min="1" />
					</div>
				</div>
				<div class="form-group">
					<label class="form-label">Storage Pool</label>
					<input type="text" class="form-input" bind:value={formData.storage} oninput={notify} placeholder="local-lvm" />
				</div>
				<div class="form-row">
					<div class="form-group">
						<label class="form-label">Bridge</label>
						<input type="text" class="form-input" bind:value={formData.bridge} oninput={notify} placeholder="vmbr0" />
					</div>
					<div class="form-group">
						<label class="form-label">IP</label>
						<input type="text" class="form-input" bind:value={formData.ip} oninput={notify} placeholder="dhcp or 10.0.0.100/24" />
					</div>
				</div>
				<div class="form-row">
					<div class="form-group">
						<label class="form-label">Gateway</label>
						<input type="text" class="form-input" bind:value={formData.gateway} oninput={notify} placeholder="10.0.0.1" />
					</div>
					<div class="form-group">
						<label class="form-label">DNS</label>
						<input type="text" class="form-input" bind:value={formData.dns} oninput={notify} placeholder="8.8.8.8" />
					</div>
					<div class="form-group" style="max-width: 120px">
						<label class="form-label">VLAN</label>
						<input type="number" class="form-input" bind:value={formData.vlan} oninput={notify} />
					</div>
				</div>
			</div>
		{/if}
	</section>

	<!-- ═══ Software ═══ -->
	<section class="form-section">
		<button type="button" class="section-header" onclick={() => toggleSection('software')}>
			<span class="section-title">Software</span>
			{#if formData.software.length > 0}
				<span class="section-badge">{formData.software.length}</span>
			{/if}
			<span class="section-chevron" class:open={expandedSections.software}></span>
		</button>
		{#if expandedSections.software}
			<div class="section-body">
				<div class="form-group">
					<label class="form-label">Software from Repo</label>
					<span class="form-hint">Select software entries to install. These are resolved at provision time based on OS.</span>
					<SoftwareMultiSelect bind:selectedNames={formData.software} onchange={notify} />
				</div>
			</div>
		{/if}
	</section>

	<!-- ═══ Provision ═══ -->
	<section class="form-section">
		<button type="button" class="section-header" onclick={() => toggleSection('provision')}>
			<span class="section-title">Provision</span>
			{#if formData.packages.length > 0 || formData.scripts.length > 0}
				<span class="section-badge">{formData.packages.length + formData.scripts.length}</span>
			{/if}
			<span class="section-chevron" class:open={expandedSections.provision}></span>
		</button>
		{#if expandedSections.provision}
			<div class="section-body">
				<!-- Packages -->
				<div class="form-group">
					<label class="form-label">Packages</label>
					<div class="tag-list">
						{#each formData.packages as pkg, idx}
							<span class="tag">
								{pkg}
								<button type="button" class="tag-remove" onclick={() => removePackage(idx)}>x</button>
							</span>
						{/each}
					</div>
					<div class="inline-add">
						<input
							type="text"
							class="form-input"
							bind:value={newPackage}
							placeholder="package-name"
							onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), addPackage())}
						/>
						<button type="button" class="btn btn-small btn-secondary" onclick={addPackage}>Add</button>
					</div>
				</div>

				<!-- Scripts -->
				<div class="form-group">
					<label class="form-label">Scripts</label>
					{#each formData.scripts as script, idx}
						<div class="script-entry card">
							<div class="script-entry-header">
								<input type="text" class="form-input small" bind:value={script.name} oninput={notify} placeholder="Script name" />
								<select class="form-select small" bind:value={script.type} onchange={notify}>
									<option value="run">Inline Script</option>
									<option value="url">URL Script</option>
									<option value="copy">Copy File</option>
								</select>
								<button type="button" class="btn btn-small btn-danger" onclick={() => removeScript(idx)}>Remove</button>
							</div>
							{#if script.type === 'run'}
								<textarea class="form-input code-input" bind:value={script.content} oninput={notify} placeholder="#!/bin/bash&#10;echo hello" rows="4"></textarea>
							{:else if script.type === 'url'}
								<input type="text" class="form-input" bind:value={script.url} oninput={notify} placeholder="https://..." />
							{:else if script.type === 'copy'}
								<input type="text" class="form-input" bind:value={script.destination} oninput={notify} placeholder="/etc/myfile.conf" />
								<textarea class="form-input code-input" bind:value={script.content} oninput={notify} placeholder="File content..." rows="4"></textarea>
							{/if}
							{#if script.type !== 'copy'}
								<div class="form-row">
									<div class="form-group" style="max-width: 160px">
										<label class="form-label small-label">Interpreter</label>
										<select class="form-select small" bind:value={script.interpreter} onchange={notify}>
											<option value="">Default (bash)</option>
											<option value="bash">bash</option>
											<option value="sh">sh</option>
											<option value="python3">python3</option>
											<option value="node">node</option>
										</select>
									</div>
									<div class="form-group">
										<label class="form-label small-label">Post-command</label>
										<input type="text" class="form-input small" bind:value={script.postCommand} oninput={notify} placeholder="systemctl restart nginx" />
									</div>
								</div>
							{/if}
						</div>
					{/each}
					<button type="button" class="btn btn-small btn-secondary" onclick={addScript}>+ Add Script</button>
				</div>

				<!-- Authorized Keys -->
				<div class="form-group">
					<label class="form-label">Authorized Keys</label>
					{#each formData.authorizedKeys as key, idx}
						<div class="key-row">
							<code class="key-preview">{key.slice(0, 60)}...</code>
							<button type="button" class="btn btn-small btn-danger" onclick={() => removeAuthorizedKey(idx)}>Remove</button>
						</div>
					{/each}
					<div class="inline-add">
						<input type="text" class="form-input" bind:value={newAuthorizedKey} placeholder="ssh-ed25519 AAAA..." />
						<button type="button" class="btn btn-small btn-secondary" onclick={addAuthorizedKey}>Add</button>
					</div>
				</div>

				<!-- Helper Script -->
				<div class="form-group">
					<label class="form-label">Helper Script</label>
					<textarea class="form-input code-input" bind:value={formData.helperScript} oninput={notify} placeholder="#!/bin/bash&#10;# Custom provisioning script" rows="4"></textarea>
				</div>
			</div>
		{/if}
	</section>

	<!-- ═══ Services ═══ -->
	<section class="form-section">
		<button type="button" class="section-header" onclick={() => toggleSection('services')}>
			<span class="section-title">Services</span>
			{#if formData.services.length > 0}
				<span class="section-badge">{formData.services.length}</span>
			{/if}
			<span class="section-chevron" class:open={expandedSections.services}></span>
		</button>
		{#if expandedSections.services}
			<div class="section-body">
				{#each formData.services as svc, idx}
					<div class="service-entry">
						<input type="text" class="form-input small" bind:value={svc.name} oninput={notify} placeholder="Service name" />
						<input type="number" class="form-input small" bind:value={svc.port} oninput={notify} placeholder="Port" style="max-width: 100px" />
						<select class="form-select small" bind:value={svc.protocol} onchange={notify} style="max-width: 120px">
							<option value="http">HTTP</option>
							<option value="https">HTTPS</option>
							<option value="tcp">TCP</option>
						</select>
						<button type="button" class="btn btn-small btn-danger" onclick={() => removeService(idx)}>Remove</button>
					</div>
				{/each}
				<button type="button" class="btn btn-small btn-secondary" onclick={addService}>+ Add Service</button>
			</div>
		{/if}
	</section>

	<!-- ═══ Claude ═══ -->
	<section class="form-section">
		<button type="button" class="section-header" onclick={() => toggleSection('claude')}>
			<span class="section-title">Claude</span>
			<span class="section-chevron" class:open={expandedSections.claude}></span>
		</button>
		{#if expandedSections.claude}
			<div class="section-body">
				<div class="form-group">
					<label class="form-label">Working Directory</label>
					<input type="text" class="form-input" bind:value={formData.claudeWorkingDirectory} oninput={notify} placeholder="/home/user/project" />
				</div>
				<div class="form-group">
					<label class="form-label">CLAUDE.md Content</label>
					<textarea class="form-input code-input" bind:value={formData.claudeMd} oninput={notify} placeholder="# Claude Instructions" rows="6"></textarea>
				</div>
			</div>
		{/if}
	</section>

	<!-- ═══ LXC ═══ -->
	<section class="form-section">
		<button type="button" class="section-header" onclick={() => toggleSection('lxc')}>
			<span class="section-title">LXC Settings</span>
			<span class="section-chevron" class:open={expandedSections.lxc}></span>
		</button>
		{#if expandedSections.lxc}
			<div class="section-body">
				<div class="checkbox-group">
					<label class="checkbox-label">
						<input type="checkbox" bind:checked={formData.unprivileged} onchange={notify} />
						<span>Unprivileged</span>
					</label>
					<label class="checkbox-label">
						<input type="checkbox" bind:checked={formData.nesting} onchange={notify} />
						<span>Nesting</span>
					</label>
					<label class="checkbox-label">
						<input type="checkbox" bind:checked={formData.protection} onchange={notify} />
						<span>Protection</span>
					</label>
				</div>
				<div class="form-row">
					<div class="form-group">
						<label class="form-label">Features</label>
						<input type="text" class="form-input" bind:value={formData.features} oninput={notify} placeholder="nesting=1,keyctl=1" />
					</div>
					<div class="form-group" style="max-width: 120px">
						<label class="form-label">Startup Order</label>
						<input type="number" class="form-input" bind:value={formData.startupOrder} oninput={notify} />
					</div>
				</div>
			</div>
		{/if}
	</section>

	<!-- ═══ Access ═══ -->
	<section class="form-section">
		<button type="button" class="section-header" onclick={() => toggleSection('access')}>
			<span class="section-title">Access</span>
			<span class="section-chevron" class:open={expandedSections.access}></span>
		</button>
		{#if expandedSections.access}
			<div class="section-body">
				<label class="checkbox-label">
					<input type="checkbox" bind:checked={formData.sshEnabled} onchange={notify} />
					<span>SSH Enabled</span>
				</label>
				<div class="form-row">
					<div class="form-group">
						<label class="form-label">Root Password</label>
						<input type="text" class="form-input" bind:value={formData.rootPassword} oninput={notify} placeholder="Leave blank to auto-generate" />
					</div>
					<div class="form-group">
						<label class="form-label">Default User</label>
						<input type="text" class="form-input" bind:value={formData.defaultUser} oninput={notify} placeholder="ubuntu" />
					</div>
				</div>
				<div class="form-group">
					<label class="form-label">Timezone</label>
					<input type="text" class="form-input" bind:value={formData.timezone} oninput={notify} placeholder="UTC" />
				</div>
			</div>
		{/if}
	</section>
</div>

<style>
	.form-editor {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.form-section {
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
	}

	.section-header {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 10px 14px;
		background: rgba(255, 255, 255, 0.02);
		border: none;
		border-radius: var(--radius-sm);
		color: var(--text-primary);
		font-size: 0.8125rem;
		font-weight: 600;
		cursor: pointer;
		transition: background-color var(--transition);
	}

	.section-header:hover {
		background: rgba(255, 255, 255, 0.04);
	}

	.section-chevron {
		margin-left: auto;
		width: 0;
		height: 0;
		border-left: 4px solid transparent;
		border-right: 4px solid transparent;
		border-top: 5px solid var(--text-secondary);
		transition: transform 0.2s ease;
	}

	.section-chevron.open {
		transform: rotate(180deg);
	}

	.section-badge {
		font-size: 0.625rem;
		font-weight: 600;
		padding: 1px 6px;
		border-radius: 8px;
		background-color: rgba(99, 102, 241, 0.15);
		color: var(--accent);
	}

	.section-body {
		padding: 14px;
		display: flex;
		flex-direction: column;
		gap: 14px;
		border-top: 1px solid var(--border);
	}

	.form-row {
		display: flex;
		gap: 12px;
	}

	.form-row .form-group {
		flex: 1;
	}

	.resource-row {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
	}

	.form-group {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.form-label {
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--text-secondary);
	}

	.small-label {
		font-size: 0.6875rem;
	}

	.form-hint {
		font-size: 0.6875rem;
		color: var(--text-secondary);
		opacity: 0.7;
	}

	.tag-list {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}

	.tag {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 0.6875rem;
		font-family: 'SF Mono', 'Fira Code', monospace;
		background-color: rgba(255, 255, 255, 0.05);
		padding: 2px 8px;
		border-radius: 3px;
		color: var(--text-secondary);
	}

	.tag-remove {
		background: none;
		border: none;
		color: var(--error);
		cursor: pointer;
		font-size: 0.625rem;
		padding: 0 2px;
	}

	.inline-add {
		display: flex;
		gap: 6px;
		align-items: flex-end;
	}

	.inline-add .form-input.small {
		max-width: 160px;
	}

	.code-input {
		font-family: 'SF Mono', 'Fira Code', monospace;
		font-size: 0.75rem;
		resize: vertical;
	}

	.script-entry {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 10px;
		margin-bottom: 8px;
	}

	.script-entry-header {
		display: flex;
		gap: 8px;
		align-items: center;
	}

	.script-entry-header .form-input.small {
		flex: 1;
	}

	.script-entry-header .form-select.small {
		max-width: 160px;
	}

	.service-entry {
		display: flex;
		gap: 8px;
		align-items: center;
		margin-bottom: 6px;
	}

	.service-entry .form-input.small {
		flex: 1;
	}

	.key-row {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 4px;
	}

	.key-preview {
		font-size: 0.6875rem;
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		background: rgba(255, 255, 255, 0.03);
		padding: 4px 8px;
		border-radius: 3px;
	}

	.checkbox-group {
		display: flex;
		gap: 20px;
		flex-wrap: wrap;
	}

	.checkbox-label {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 0.8125rem;
		cursor: pointer;
	}

	.checkbox-label input[type='checkbox'] {
		accent-color: var(--accent);
	}

	.btn-small {
		font-size: 0.6875rem;
		padding: 4px 10px;
	}

	.btn-danger {
		color: var(--error);
		border-color: rgba(239, 68, 68, 0.3);
	}

	.btn-danger:hover {
		background-color: rgba(239, 68, 68, 0.1);
	}

	@media (max-width: 600px) {
		.form-row {
			flex-direction: column;
		}

		.resource-row {
			grid-template-columns: repeat(2, 1fr);
		}
	}
</style>
