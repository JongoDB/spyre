<script lang="ts">
	import type { PageData } from './$types';
	import { addToast } from '$lib/stores/toast.svelte';
	import { goto } from '$app/navigation';

	let { data }: { data: PageData } = $props();

	let name = $state(data.entry.name);
	let description = $state(data.entry.description ?? '');
	let osFamilies = $state(data.entry.os_families);
	let tags = $state(data.entry.tags ?? '');
	let instructions = $state(data.entry.instructions.map(i => ({ ...i })));
	let saving = $state(false);

	const osOptions = ['apt', 'apk', 'dnf', 'yum', 'any'] as const;
	const typeOptions = ['package', 'script', 'file'] as const;

	let activeOsTab = $state(getInitialOsTab());

	function getInitialOsTab(): string {
		if (instructions.length > 0) return instructions[0].os_family;
		return 'apt';
	}

	let filteredInstructions = $derived(
		instructions.filter(i => i.os_family === activeOsTab)
	);

	function addInstruction() {
		instructions = [...instructions, {
			id: crypto.randomUUID(),
			software_id: data.entry.id,
			os_family: activeOsTab as 'apt' | 'apk' | 'dnf' | 'yum' | 'any',
			sort_order: instructions.filter(i => i.os_family === activeOsTab).length,
			item_type: 'package' as const,
			content: '',
			destination: null,
			label: null,
			post_command: null,
			package_manager: null,
			interpreter: null,
			source_url: null,
			file_mode: null,
			file_owner: null,
			condition: null,
			created_at: new Date().toISOString()
		}];
	}

	function removeInstruction(id: string) {
		instructions = instructions.filter(i => i.id !== id);
	}

	async function save() {
		saving = true;
		try {
			const res = await fetch(`/api/software-repo/${data.entry.id}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name,
					description: description || null,
					os_families: osFamilies,
					tags: tags || null,
					instructions: instructions.map((i, idx) => ({
						os_family: i.os_family,
						sort_order: idx,
						item_type: i.item_type,
						content: i.content,
						destination: i.destination,
						label: i.label,
						post_command: i.post_command,
						package_manager: i.package_manager,
						interpreter: i.interpreter,
						source_url: i.source_url,
						file_mode: i.file_mode,
						file_owner: i.file_owner,
						condition: i.condition
					}))
				})
			});

			if (res.ok) {
				addToast('Software entry saved.', 'success');
			} else {
				const body = await res.json().catch(() => ({}));
				addToast(body.message ?? 'Failed to save.', 'error');
			}
		} catch {
			addToast('Network error.', 'error');
		} finally {
			saving = false;
		}
	}
</script>

<div class="edit-page">
	<header class="page-header">
		<div class="header-left">
			<a href="/software-repo" class="back-link">
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>
				Software
			</a>
			<h1>{data.entry.name}</h1>
			{#if data.entry.is_builtin}
				<span class="builtin-badge">built-in</span>
			{/if}
		</div>
		<button class="btn btn-primary" onclick={save} disabled={saving}>
			{saving ? 'Saving...' : 'Save'}
		</button>
	</header>

	<!-- Metadata -->
	<div class="form-section card">
		<h3>Details</h3>
		<div class="form-grid">
			<div class="form-group">
				<label class="form-label" for="sw-name">Name</label>
				<input id="sw-name" type="text" class="form-input" bind:value={name} />
			</div>
			<div class="form-group">
				<label class="form-label" for="sw-desc">Description</label>
				<input id="sw-desc" type="text" class="form-input" bind:value={description} />
			</div>
			<div class="form-group">
				<label class="form-label" for="sw-os">OS Families (comma-separated)</label>
				<input id="sw-os" type="text" class="form-input" bind:value={osFamilies} placeholder="apt,apk,dnf,yum" />
			</div>
			<div class="form-group">
				<label class="form-label" for="sw-tags">Tags (comma-separated)</label>
				<input id="sw-tags" type="text" class="form-input" bind:value={tags} placeholder="dev,tools" />
			</div>
		</div>
	</div>

	<!-- Instructions -->
	<div class="form-section card">
		<h3>Install Instructions</h3>

		<!-- OS tabs -->
		<div class="os-tabs">
			{#each osOptions as os}
				<button
					class="os-tab"
					class:active={activeOsTab === os}
					onclick={() => { activeOsTab = os; }}
				>
					{os}
					{#if instructions.filter(i => i.os_family === os).length > 0}
						<span class="tab-count">{instructions.filter(i => i.os_family === os).length}</span>
					{/if}
				</button>
			{/each}
		</div>

		<div class="instructions-list">
			{#each filteredInstructions as inst, idx (inst.id)}
				<div class="instruction-item">
					<div class="inst-header">
						<span class="inst-num">#{idx + 1}</span>
						<select class="form-select inst-type" bind:value={inst.item_type}>
							{#each typeOptions as t}
								<option value={t}>{t}</option>
							{/each}
						</select>
						<button class="btn-icon" onclick={() => removeInstruction(inst.id)} title="Remove">
							<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
						</button>
					</div>
					<div class="inst-fields">
						<div class="form-group">
							<label class="form-label">Content</label>
							<textarea class="form-input" rows="2" bind:value={inst.content} placeholder={inst.item_type === 'package' ? 'package names' : inst.item_type === 'script' ? 'script content' : 'file content'}></textarea>
						</div>
						{#if inst.item_type !== 'package'}
							<div class="form-group">
								<label class="form-label">Label</label>
								<input type="text" class="form-input" bind:value={inst.label} placeholder="Human-readable label" />
							</div>
						{/if}
						{#if inst.post_command !== undefined}
							<div class="form-group">
								<label class="form-label">Post-command</label>
								<input type="text" class="form-input" bind:value={inst.post_command} placeholder="Command to run after" />
							</div>
						{/if}
					</div>
				</div>
			{/each}
		</div>

		<button class="btn btn-secondary btn-sm" onclick={addInstruction}>
			+ Add Instruction for {activeOsTab}
		</button>
	</div>
</div>

<style>
	.edit-page {
		max-width: 900px;
	}

	.page-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 24px;
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
		text-decoration: none;
		transition: color var(--transition);
	}

	.back-link:hover {
		color: var(--text-primary);
	}

	h1 {
		font-size: 1.25rem;
		font-weight: 600;
	}

	.builtin-badge {
		font-size: 0.625rem;
		font-weight: 600;
		padding: 2px 6px;
		border-radius: 3px;
		background-color: rgba(34, 197, 94, 0.12);
		color: var(--success);
	}

	.form-section {
		margin-bottom: 20px;
		padding: 20px 24px;
	}

	.form-section h3 {
		font-size: 0.9375rem;
		font-weight: 600;
		margin-bottom: 16px;
	}

	.form-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
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

	.os-tabs {
		display: flex;
		gap: 2px;
		margin-bottom: 16px;
	}

	.os-tab {
		padding: 6px 14px;
		font-size: 0.8125rem;
		font-weight: 500;
		background: none;
		border: 1px solid var(--border);
		color: var(--text-secondary);
		cursor: pointer;
		transition: all var(--transition);
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.os-tab:first-child {
		border-radius: var(--radius-sm) 0 0 var(--radius-sm);
	}

	.os-tab:last-child {
		border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
	}

	.os-tab.active {
		background-color: rgba(99, 102, 241, 0.1);
		border-color: var(--accent);
		color: var(--accent);
	}

	.tab-count {
		font-size: 0.625rem;
		font-weight: 700;
		background-color: rgba(255, 255, 255, 0.1);
		padding: 0 5px;
		border-radius: 8px;
		min-width: 16px;
		text-align: center;
	}

	.instructions-list {
		display: flex;
		flex-direction: column;
		gap: 12px;
		margin-bottom: 12px;
	}

	.instruction-item {
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: 12px;
	}

	.inst-header {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 10px;
	}

	.inst-num {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--text-secondary);
	}

	.inst-type {
		width: auto;
		min-width: 100px;
	}

	.btn-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		background: none;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		color: var(--text-secondary);
		cursor: pointer;
		margin-left: auto;
		transition: all var(--transition);
	}

	.btn-icon:hover {
		border-color: var(--error);
		color: var(--error);
		background-color: rgba(239, 68, 68, 0.08);
	}

	.inst-fields {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
</style>
