<script lang="ts">
	import { addToast } from '$lib/stores/toast.svelte';
	import { goto } from '$app/navigation';

	let name = $state('');
	let description = $state('');
	let osFamilies = $state('apt');
	let tags = $state('');
	let saving = $state(false);

	async function handleSubmit() {
		if (!name.trim()) {
			addToast('Name is required.', 'error');
			return;
		}

		saving = true;
		try {
			const res = await fetch('/api/software-repo', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: name.trim(),
					description: description || null,
					os_families: osFamilies,
					tags: tags || null,
					instructions: []
				})
			});

			if (res.ok) {
				const entry = await res.json();
				addToast(`Created "${name}".`, 'success');
				goto(`/software-repo/${entry.id}`);
			} else {
				const body = await res.json().catch(() => ({}));
				addToast(body.message ?? 'Failed to create.', 'error');
			}
		} catch {
			addToast('Network error.', 'error');
		} finally {
			saving = false;
		}
	}
</script>

<div class="new-page">
	<header class="page-header">
		<div class="header-left">
			<a href="/software-repo" class="back-link">
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>
				Software
			</a>
			<h1>New Software Entry</h1>
		</div>
	</header>

	<div class="form-section card">
		<div class="form-grid">
			<div class="form-group">
				<label class="form-label" for="sw-name">Name</label>
				<input id="sw-name" type="text" class="form-input" bind:value={name} placeholder="e.g. Redis" />
			</div>
			<div class="form-group">
				<label class="form-label" for="sw-desc">Description</label>
				<input id="sw-desc" type="text" class="form-input" bind:value={description} placeholder="In-memory data store" />
			</div>
			<div class="form-group">
				<label class="form-label" for="sw-os">OS Families</label>
				<input id="sw-os" type="text" class="form-input" bind:value={osFamilies} placeholder="apt,apk,dnf,yum" />
			</div>
			<div class="form-group">
				<label class="form-label" for="sw-tags">Tags</label>
				<input id="sw-tags" type="text" class="form-input" bind:value={tags} placeholder="database,cache" />
			</div>
		</div>

		<div class="form-actions">
			<button class="btn btn-primary" onclick={handleSubmit} disabled={saving}>
				{saving ? 'Creating...' : 'Create Software Entry'}
			</button>
			<p class="form-hint">After creating, you'll be able to add per-OS install instructions.</p>
		</div>
	</div>
</div>

<style>
	.new-page {
		max-width: 700px;
	}

	.page-header {
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

	.form-section {
		padding: 24px;
	}

	.form-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
		margin-bottom: 20px;
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

	.form-actions {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.form-hint {
		font-size: 0.75rem;
		color: var(--text-secondary);
	}
</style>
