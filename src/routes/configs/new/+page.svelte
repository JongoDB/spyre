<script lang="ts">
	import { goto } from '$app/navigation';
	import ConfigFormEditor from '$lib/components/ConfigFormEditor.svelte';
	import ConfigYamlEditor from '$lib/components/ConfigYamlEditor.svelte';

	let mode = $state<'form' | 'yaml'>('form');
	let saving = $state(false);
	let errorMessage = $state('');

	// Default YAML template — matches the scope of the form editor
	const defaultYaml = `apiVersion: spyre/v1
kind: Environment
metadata:
  name: my-config
  description: A new development environment

spec:
  platform:
    type: lxc
    # template: local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst
    resources:
      cores: 2
      memory: 2048
      disk: 16
    network:
      ip: dhcp
      # bridge: vmbr0
      # gateway: 192.168.1.1
      # dns: 8.8.8.8

  provision:
    packages:
      - curl
      - git
      - vim
    # scripts:
    #   - name: setup
    #     run: |
    #       echo "Custom setup script"
    #     interpreter: bash

  # software:
  #   - git
  #   - nodejs

  lxc:
    unprivileged: true
    nesting: true

  access:
    ssh_enabled: true
    # default_user: devuser
    # root_password: auto

  # services:
  #   - name: web
  #     port: 3000
  #     protocol: http

  # claude:
  #   working_directory: /root/project
`;

	let yamlText = $state(defaultYaml);

	let formData = $state({
		name: 'my-config',
		kind: 'Environment' as 'Environment' | 'EnvironmentBase',
		extends: undefined as string | undefined,
		description: '',
		labels: {} as Record<string, string>,
		platformType: 'lxc' as 'lxc' | 'vm',
		template: undefined as string | undefined,
		cores: 1,
		memory: 512,
		swap: undefined as number | undefined,
		disk: 8,
		storage: undefined as string | undefined,
		bridge: undefined as string | undefined,
		ip: undefined as string | undefined,
		gateway: undefined as string | undefined,
		dns: undefined as string | undefined,
		vlan: undefined as number | undefined,
		software: [] as string[],
		communityScriptSlug: undefined as string | undefined,
		communityScriptInstallMethod: undefined as string | undefined,
		packages: [] as string[],
		scripts: [] as Array<{ name?: string; type: 'run' | 'copy' | 'url'; content?: string; destination?: string; interpreter?: string; url?: string; postCommand?: string; mode?: string; owner?: string; condition?: string }>,
		authorizedKeys: [] as string[],
		services: [] as Array<{ name: string; port: number; protocol?: 'http' | 'https' | 'tcp' }>,
		claudeWorkingDirectory: undefined as string | undefined,
		claudeMd: undefined as string | undefined,
		unprivileged: true,
		nesting: true,
		features: undefined as string | undefined,
		startupOrder: undefined as number | undefined,
		protection: undefined as boolean | undefined,
		sshEnabled: true,
		rootPassword: undefined as string | undefined,
		defaultUser: undefined as string | undefined,
		timezone: undefined as string | undefined,
		helperScript: undefined as string | undefined,
	});

	async function handleCreate() {
		saving = true;
		errorMessage = '';

		const configName = mode === 'form' ? formData.name : extractNameFromYaml(yamlText);
		if (!configName?.trim()) {
			errorMessage = 'Config name is required.';
			saving = false;
			return;
		}

		try {
			if (mode === 'form') {
				const res = await fetch(`/api/configs/${encodeURIComponent(configName)}/form`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(formData)
				});
				if (!res.ok) {
					const body = await res.json().catch(() => ({}));
					errorMessage = body.message ?? `Save failed (HTTP ${res.status}).`;
					return;
				}
			} else {
				const res = await fetch(`/api/configs/${encodeURIComponent(configName)}`, {
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
			goto(`/configs/${encodeURIComponent(configName)}`);
		} catch {
			errorMessage = 'Network error.';
		} finally {
			saving = false;
		}
	}

	function extractNameFromYaml(yaml: string): string {
		const match = yaml.match(/^\s*name:\s*(.+)$/m);
		return match ? match[1].trim().replace(/^['"]|['"]$/g, '') : '';
	}
</script>

<div class="new-config-page" class:yaml-mode={mode === 'yaml'}>
	<header class="page-header">
		<div class="header-left">
			<a href="/configs" class="back-link">
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>
				Configs
			</a>
			<h1>New Config</h1>
		</div>
		<button type="button" class="btn btn-primary" onclick={handleCreate} disabled={saving}>
			{saving ? 'Creating...' : 'Create Config'}
		</button>
	</header>

	{#if errorMessage}
		<div class="alert alert-error">{errorMessage}</div>
	{/if}

	<div class="mode-toggle">
		<button type="button" class="mode-btn" class:active={mode === 'form'} onclick={() => mode = 'form'}>Form</button>
		<button type="button" class="mode-btn" class:active={mode === 'yaml'} onclick={() => mode = 'yaml'}>YAML</button>
	</div>

	<div class="editor-container">
		{#if mode === 'form'}
			<ConfigFormEditor bind:formData={formData as any} />
		{:else}
			<ConfigYamlEditor bind:value={yamlText} />
		{/if}
	</div>
</div>

<style>
	.new-config-page {
		max-width: 960px;
	}

	.new-config-page.yaml-mode {
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
</style>
