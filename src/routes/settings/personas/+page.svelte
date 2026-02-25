<script lang="ts">
	import type { PageData } from './$types';
	import type { Persona } from '$lib/types/persona';
	import { addToast } from '$lib/stores/toast.svelte';

	let { data }: { data: PageData } = $props();

	let personas = $state<Persona[]>(data.personas);
	let usageCounts = $state<Record<string, number>>(data.usageCounts);

	// Form state
	let showForm = $state(false);
	let editingId = $state<string | null>(null);
	let formName = $state('');
	let formRole = $state('');
	let formAvatar = $state('🤖');
	let formDescription = $state('');
	let formInstructions = $state('');
	let saving = $state(false);
	let deletingId = $state<string | null>(null);

	const ROLE_SUGGESTIONS = [
		'DevOps Engineer',
		'Security Analyst',
		'Frontend Engineer',
		'Backend Engineer',
		'UI/UX Designer',
		'Scrum Master',
		'Business Ops',
		'QA Engineer',
		'Data Engineer',
		'Systems Administrator'
	];

	function openCreate() {
		editingId = null;
		formName = '';
		formRole = '';
		formAvatar = '🤖';
		formDescription = '';
		formInstructions = '';
		showForm = true;
	}

	function openEdit(persona: Persona) {
		editingId = persona.id;
		formName = persona.name;
		formRole = persona.role;
		formAvatar = persona.avatar;
		formDescription = persona.description ?? '';
		formInstructions = persona.instructions;
		showForm = true;
	}

	function cancelForm() {
		showForm = false;
		editingId = null;
	}

	async function handleSave() {
		if (!formName.trim() || !formRole.trim()) return;
		saving = true;

		try {
			const body = {
				name: formName.trim(),
				role: formRole.trim(),
				avatar: formAvatar || '🤖',
				description: formDescription.trim() || null,
				instructions: formInstructions
			};

			let res: Response;
			if (editingId) {
				res = await fetch(`/api/personas/${editingId}`, {
					method: 'PUT',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(body)
				});
			} else {
				res = await fetch('/api/personas', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(body)
				});
			}

			if (!res.ok) {
				const err = await res.json().catch(() => ({ message: res.statusText }));
				throw new Error(err.message ?? `HTTP ${res.status}`);
			}

			const saved = await res.json() as Persona;
			if (editingId) {
				personas = personas.map(p => p.id === saved.id ? saved : p);
				addToast(`Persona '${saved.name}' updated.`, 'success');
			} else {
				personas = [...personas, saved];
				addToast(`Persona '${saved.name}' created.`, 'success');
			}

			showForm = false;
			editingId = null;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			addToast(msg, 'error');
		} finally {
			saving = false;
		}
	}

	async function handleDelete(persona: Persona) {
		if (!confirm(`Delete persona '${persona.name}'?`)) return;
		deletingId = persona.id;

		try {
			const res = await fetch(`/api/personas/${persona.id}`, { method: 'DELETE' });
			if (!res.ok) {
				const err = await res.json().catch(() => ({ message: res.statusText }));
				throw new Error(err.message ?? `HTTP ${res.status}`);
			}

			personas = personas.filter(p => p.id !== persona.id);
			addToast(`Persona '${persona.name}' deleted.`, 'success');
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			addToast(msg, 'error');
		} finally {
			deletingId = null;
		}
	}
</script>

<div class="personas-page">
	<header class="page-header">
		<div class="header-row">
			<div>
				<a href="/settings" class="back-link">&larr; Settings</a>
				<h1>Personas</h1>
				<p class="subtitle">Define agent identities with roles and custom instructions for Claude instances.</p>
			</div>
			{#if !showForm}
				<button class="btn btn-primary" onclick={openCreate}>Create Persona</button>
			{/if}
		</div>
	</header>

	{#if showForm}
		<div class="card form-card">
			<h3>{editingId ? 'Edit Persona' : 'Create Persona'}</h3>
			<form onsubmit={(e) => { e.preventDefault(); handleSave(); }}>
				<div class="form-row">
					<div class="form-group avatar-group">
						<label for="avatar">Avatar</label>
						<input id="avatar" type="text" bind:value={formAvatar} class="avatar-input" maxlength="4" placeholder="🤖" />
					</div>
					<div class="form-group flex-1">
						<label for="name">Name</label>
						<input id="name" type="text" bind:value={formName} placeholder="e.g. Alex or Security Analyst" required />
					</div>
				</div>

				<div class="form-group">
					<label for="role">Role</label>
					<input id="role" type="text" bind:value={formRole} placeholder="e.g. DevOps Engineer" list="role-suggestions" required />
					<datalist id="role-suggestions">
						{#each ROLE_SUGGESTIONS as suggestion}
							<option value={suggestion}></option>
						{/each}
					</datalist>
				</div>

				<div class="form-group">
					<label for="description">Description <span class="optional">(optional)</span></label>
					<textarea id="description" bind:value={formDescription} placeholder="Short blurb shown on persona cards" rows="2"></textarea>
				</div>

				<div class="form-group">
					<label for="instructions">
						Instructions
						<span class="help-tooltip" title="These instructions are injected into CLAUDE.md in the environment. Write them as if you're talking directly to Claude.">?</span>
					</label>
					<textarea
						id="instructions"
						bind:value={formInstructions}
						placeholder="You are a DevOps engineer focused on infrastructure reliability.&#10;&#10;Your priorities:&#10;- Always check system health before making changes&#10;- Use infrastructure-as-code patterns&#10;- Document all changes in commit messages"
						rows="10"
						class="instructions-textarea"
					></textarea>
				</div>

				<div class="form-actions">
					<button type="button" class="btn btn-ghost" onclick={cancelForm}>Cancel</button>
					<button type="submit" class="btn btn-primary" disabled={saving || !formName.trim() || !formRole.trim()}>
						{saving ? 'Saving...' : editingId ? 'Update' : 'Create'}
					</button>
				</div>
			</form>
		</div>
	{/if}

	{#if personas.length === 0 && !showForm}
		<div class="empty-state card">
			<p>No personas defined yet. Create one to give your Claude instances a specific identity and instructions.</p>
			<button class="btn btn-primary" onclick={openCreate}>Create Your First Persona</button>
		</div>
	{:else if personas.length > 0}
		<div class="persona-grid">
			{#each personas as persona (persona.id)}
				<div class="persona-card card">
					<div class="persona-header">
						<span class="persona-avatar">{persona.avatar}</span>
						<div class="persona-meta">
							<h3>{persona.name}</h3>
							<span class="persona-role">{persona.role}</span>
						</div>
						{#if usageCounts[persona.id]}
							<span class="usage-badge" title="Assigned to {usageCounts[persona.id]} environment(s)">
								{usageCounts[persona.id]} env{usageCounts[persona.id] > 1 ? 's' : ''}
							</span>
						{/if}
					</div>

					{#if persona.description}
						<p class="persona-description">{persona.description}</p>
					{/if}

					{#if persona.instructions}
						<div class="persona-instructions">
							<span class="instructions-label">Instructions</span>
							<pre class="instructions-preview">{persona.instructions.slice(0, 200)}{persona.instructions.length > 200 ? '...' : ''}</pre>
						</div>
					{/if}

					<div class="persona-actions">
						<button class="btn btn-ghost btn-sm" onclick={() => openEdit(persona)}>Edit</button>
						<button
							class="btn btn-ghost btn-sm btn-danger"
							onclick={() => handleDelete(persona)}
							disabled={deletingId === persona.id}
						>
							{deletingId === persona.id ? 'Deleting...' : 'Delete'}
						</button>
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>

<style>
	.personas-page { max-width: 900px; }
	.page-header { margin-bottom: 24px; }
	.header-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
	.back-link { color: var(--text-secondary); text-decoration: none; font-size: 0.8125rem; }
	.back-link:hover { color: var(--accent); }
	.page-header h1 { font-size: 1.5rem; font-weight: 600; margin: 4px 0; }
	.subtitle { color: var(--text-secondary); font-size: 0.875rem; }

	.form-card { margin-bottom: 24px; }
	.form-card h3 { font-size: 1.125rem; font-weight: 600; margin-bottom: 16px; }
	.form-row { display: flex; gap: 12px; align-items: flex-end; }
	.form-group { margin-bottom: 12px; }
	.form-group label { display: block; font-size: 0.8125rem; font-weight: 500; margin-bottom: 4px; color: var(--text-secondary); }
	.form-group input, .form-group textarea { width: 100%; }
	.flex-1 { flex: 1; }
	.avatar-group { width: 72px; flex-shrink: 0; }
	.avatar-input { text-align: center; font-size: 1.5rem; padding: 4px; }
	.optional { color: var(--text-tertiary); font-weight: 400; }
	.help-tooltip { display: inline-block; width: 16px; height: 16px; line-height: 16px; text-align: center; border-radius: 50%; background: var(--bg-tertiary); color: var(--text-secondary); font-size: 0.6875rem; cursor: help; vertical-align: middle; margin-left: 4px; }
	.instructions-textarea { font-family: var(--font-mono, 'SF Mono', 'Monaco', 'Inconsolata', monospace); font-size: 0.8125rem; line-height: 1.5; }
	.form-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }

	.empty-state { text-align: center; padding: 48px 24px; }
	.empty-state p { color: var(--text-secondary); margin-bottom: 16px; }

	.persona-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; }

	.persona-card { display: flex; flex-direction: column; gap: 12px; }
	.persona-header { display: flex; align-items: center; gap: 12px; }
	.persona-avatar { font-size: 2rem; line-height: 1; }
	.persona-meta { flex: 1; min-width: 0; }
	.persona-meta h3 { font-size: 1rem; font-weight: 600; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.persona-role { font-size: 0.8125rem; color: var(--text-secondary); }
	.usage-badge { font-size: 0.6875rem; padding: 2px 8px; background: var(--bg-tertiary); border-radius: 10px; color: var(--text-secondary); white-space: nowrap; }

	.persona-description { font-size: 0.8125rem; color: var(--text-secondary); line-height: 1.4; margin: 0; }

	.persona-instructions { border-top: 1px solid var(--border); padding-top: 8px; }
	.instructions-label { font-size: 0.6875rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-tertiary); }
	.instructions-preview { font-size: 0.75rem; line-height: 1.4; color: var(--text-secondary); white-space: pre-wrap; word-break: break-word; margin: 4px 0 0; max-height: 80px; overflow: hidden; }

	.persona-actions { display: flex; gap: 8px; margin-top: auto; padding-top: 4px; border-top: 1px solid var(--border); }
	.btn-sm { padding: 4px 12px; font-size: 0.75rem; }
	.btn-danger { color: var(--error, #e53e3e); }
	.btn-danger:hover { background: rgba(229, 62, 62, 0.1); }
</style>
