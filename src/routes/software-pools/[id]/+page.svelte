<script lang="ts">
	import { goto } from '$app/navigation';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	interface FormItem {
		id: string;
		item_type: 'package' | 'script' | 'file';
		content: string;
		label: string;
		destination: string;
		post_command: string;
	}

	let name = $state(data.pool.name);
	let description = $state(data.pool.description ?? '');
	let items = $state<FormItem[]>(
		data.pool.items.map((item) => ({
			id: item.id,
			item_type: item.item_type,
			content: item.content,
			label: item.label ?? '',
			destination: item.destination ?? '',
			post_command: item.post_command ?? ''
		}))
	);

	let submitting = $state(false);
	let errorMessage = $state('');

	let itemCounter = $state(0);

	function newItemId(): string {
		itemCounter++;
		return `new-${itemCounter}`;
	}

	function addItem() {
		items.push({
			id: newItemId(),
			item_type: 'package',
			content: '',
			label: '',
			destination: '',
			post_command: ''
		});
	}

	function removeItem(index: number) {
		items.splice(index, 1);
	}

	function moveItem(index: number, direction: -1 | 1) {
		const target = index + direction;
		if (target < 0 || target >= items.length) return;
		const temp = items[index];
		items[index] = items[target];
		items[target] = temp;
	}

	let isValid = $derived(name.trim().length > 0);

	async function handleSubmit(e: SubmitEvent) {
		e.preventDefault();
		if (!isValid || submitting) return;

		submitting = true;
		errorMessage = '';

		const payload = {
			name: name.trim(),
			description: description.trim() || undefined,
			items: items.map((item, i) => ({
				item_type: item.item_type,
				content: item.content,
				label: item.label.trim() || undefined,
				destination: item.item_type === 'file' && item.destination.trim() ? item.destination.trim() : undefined,
				post_command: item.post_command.trim() || undefined,
				sort_order: i
			}))
		};

		try {
			const res = await fetch(`/api/software-pools/${data.pool.id}`, {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
			});

			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				errorMessage = body.message ?? `Failed to update pool (HTTP ${res.status}).`;
				return;
			}

			await goto('/software-pools');
		} catch {
			errorMessage = 'Network error. Please check your connection and try again.';
		} finally {
			submitting = false;
		}
	}
</script>

<div class="form-page">
	<header class="page-header">
		<a href="/software-pools" class="back-link">
			<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
				<path d="M19 12H5" />
				<polyline points="12 19 5 12 12 5" />
			</svg>
			Back to Software Pools
		</a>
		<h1>Edit Software Pool</h1>
		<p class="subtitle">Update the pool definition and its items.</p>
	</header>

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

	<form class="pool-form card" onsubmit={handleSubmit}>
		<!-- Name -->
		<div class="form-group">
			<label for="pool-name" class="form-label">Name</label>
			<input
				id="pool-name"
				type="text"
				class="form-input"
				placeholder="e.g. Node.js Development Tools"
				autocomplete="off"
				bind:value={name}
				required
			/>
		</div>

		<!-- Description -->
		<div class="form-group">
			<label for="pool-description" class="form-label">Description</label>
			<textarea
				id="pool-description"
				class="form-input form-textarea"
				placeholder="Optional description of what this pool provides..."
				rows="3"
				bind:value={description}
			></textarea>
		</div>

		<!-- Items section -->
		<div class="items-section">
			<div class="items-header">
				<h2 class="items-title">Items</h2>
				<button type="button" class="btn btn-secondary btn-sm" onclick={addItem}>
					<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
						<path d="M12 5v14M5 12h14" />
					</svg>
					Add Item
				</button>
			</div>

			{#if items.length === 0}
				<div class="items-empty">
					<p>No items added yet. Click "Add Item" to define packages, scripts, or files.</p>
				</div>
			{:else}
				<div class="items-list">
					{#each items as item, index (item.id)}
						<div class="item-card">
							<div class="item-card-header">
								<span class="item-index">#{index + 1}</span>
								<div class="item-card-controls">
									<button
										type="button"
										class="icon-btn"
										title="Move up"
										disabled={index === 0}
										onclick={() => moveItem(index, -1)}
									>
										<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
											<polyline points="18 15 12 9 6 15" />
										</svg>
									</button>
									<button
										type="button"
										class="icon-btn"
										title="Move down"
										disabled={index === items.length - 1}
										onclick={() => moveItem(index, 1)}
									>
										<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
											<polyline points="6 9 12 15 18 9" />
										</svg>
									</button>
									<button
										type="button"
										class="icon-btn icon-btn-danger"
										title="Remove item"
										onclick={() => removeItem(index)}
									>
										<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
											<line x1="18" y1="6" x2="6" y2="18" />
											<line x1="6" y1="6" x2="18" y2="18" />
										</svg>
									</button>
								</div>
							</div>

							<div class="item-card-body">
								<div class="item-row-top">
									<div class="form-group item-type-group">
										<label for="item-type-{item.id}" class="form-label">Type</label>
										<select
											id="item-type-{item.id}"
											class="form-select"
											bind:value={item.item_type}
										>
											<option value="package">Package</option>
											<option value="script">Script</option>
											<option value="file">File</option>
										</select>
									</div>

									<div class="form-group item-label-group">
										<label for="item-label-{item.id}" class="form-label">Label</label>
										<input
											id="item-label-{item.id}"
											type="text"
											class="form-input"
											placeholder="e.g. Install Node.js"
											bind:value={item.label}
										/>
									</div>
								</div>

								<div class="form-group">
									<label for="item-content-{item.id}" class="form-label">
										{#if item.item_type === 'package'}
											Package name(s)
										{:else if item.item_type === 'script'}
											Script content
										{:else}
											File content
										{/if}
									</label>
									<textarea
										id="item-content-{item.id}"
										class="form-input form-textarea form-textarea-code"
										placeholder={item.item_type === 'package'
											? 'e.g. nodejs npm git'
											: item.item_type === 'script'
												? '#!/bin/bash\n# Script to run on the target...'
												: 'File content to write...'}
										rows={item.item_type === 'package' ? 2 : 4}
										bind:value={item.content}
									></textarea>
								</div>

								{#if item.item_type === 'file'}
									<div class="form-group">
										<label for="item-dest-{item.id}" class="form-label">Destination path</label>
										<input
											id="item-dest-{item.id}"
											type="text"
											class="form-input"
											placeholder="/etc/myapp/config.conf"
											bind:value={item.destination}
										/>
									</div>
								{/if}

								<div class="form-group">
									<label for="item-postcmd-{item.id}" class="form-label">Post command <span class="optional-label">(optional)</span></label>
									<input
										id="item-postcmd-{item.id}"
										type="text"
										class="form-input"
										placeholder="e.g. systemctl restart myapp"
										bind:value={item.post_command}
									/>
								</div>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Actions -->
		<div class="form-actions">
			<a href="/software-pools" class="btn btn-secondary">Cancel</a>
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

	/* ---- Form ---- */

	.pool-form {
		display: flex;
		flex-direction: column;
		gap: 20px;
	}

	.form-textarea {
		resize: vertical;
		min-height: 60px;
	}

	.form-textarea-code {
		font-family: 'SF Mono', 'Fira Code', 'Fira Mono', monospace;
		font-size: 0.8125rem;
		tab-size: 2;
	}

	/* ---- Items section ---- */

	.items-section {
		border-top: 1px solid var(--border);
		padding-top: 20px;
	}

	.items-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 16px;
	}

	.items-title {
		font-size: 1rem;
		font-weight: 600;
	}

	.items-empty {
		padding: 24px;
		text-align: center;
		color: var(--text-secondary);
		font-size: 0.8125rem;
		border: 1px dashed var(--border);
		border-radius: var(--radius);
	}

	.items-list {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	/* ---- Item card ---- */

	.item-card {
		border: 1px solid var(--border);
		border-radius: var(--radius);
		background-color: rgba(255, 255, 255, 0.015);
		overflow: hidden;
	}

	.item-card-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px 12px;
		background-color: rgba(255, 255, 255, 0.02);
		border-bottom: 1px solid var(--border);
	}

	.item-index {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--text-secondary);
		font-family: 'SF Mono', 'Fira Code', 'Fira Mono', monospace;
	}

	.item-card-controls {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.icon-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border: none;
		background: none;
		color: var(--text-secondary);
		border-radius: var(--radius-sm);
		transition: background-color var(--transition), color var(--transition);
	}

	.icon-btn:hover:not(:disabled) {
		background-color: rgba(255, 255, 255, 0.06);
		color: var(--text-primary);
	}

	.icon-btn:disabled {
		opacity: 0.3;
		cursor: not-allowed;
	}

	.icon-btn-danger:hover:not(:disabled) {
		background-color: rgba(239, 68, 68, 0.1);
		color: var(--error);
	}

	.item-card-body {
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	.item-row-top {
		display: grid;
		grid-template-columns: 140px 1fr;
		gap: 12px;
	}

	@media (max-width: 540px) {
		.item-row-top {
			grid-template-columns: 1fr;
		}
	}

	.optional-label {
		font-weight: 400;
		color: var(--text-secondary);
		opacity: 0.6;
	}

	/* ---- Actions ---- */

	.form-actions {
		display: flex;
		justify-content: flex-end;
		gap: 10px;
		padding-top: 8px;
		border-top: 1px solid var(--border);
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
