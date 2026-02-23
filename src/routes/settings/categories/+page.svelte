<script lang="ts">
  import type { PageData } from './$types';
  import type { Category } from '$lib/types/template';

  let { data }: { data: PageData } = $props();

  let categories = $state<Category[]>(data.categories);
  let adding = $state(false);
  let editingId = $state<string | null>(null);
  let error = $state('');
  let deleteConfirmId = $state<string | null>(null);

  let addForm = $state({
    name: '',
    description: '',
    icon: '',
    sort_order: 0
  });

  let editForm = $state({
    name: '',
    description: '',
    icon: '',
    sort_order: 0
  });

  function resetAddForm() {
    addForm = { name: '', description: '', icon: '', sort_order: 0 };
  }

  function startAdd() {
    adding = true;
    editingId = null;
    deleteConfirmId = null;
    resetAddForm();
    error = '';
  }

  function cancelAdd() {
    adding = false;
    resetAddForm();
    error = '';
  }

  function startEdit(cat: Category) {
    editingId = cat.id;
    adding = false;
    deleteConfirmId = null;
    editForm = {
      name: cat.name,
      description: cat.description ?? '',
      icon: cat.icon ?? '',
      sort_order: cat.sort_order
    };
    error = '';
  }

  function cancelEdit() {
    editingId = null;
    error = '';
  }

  async function submitAdd() {
    error = '';
    try {
      const res = await fetch('/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: addForm.name.trim(),
          description: addForm.description.trim() || undefined,
          icon: addForm.icon.trim() || undefined,
          sort_order: addForm.sort_order
        })
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: 'Failed to create category.' }));
        error = body.message ?? 'Failed to create category.';
        return;
      }

      const created: Category = await res.json();
      categories = [...categories, created].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
      cancelAdd();
    } catch {
      error = 'Network error. Please try again.';
    }
  }

  async function submitEdit() {
    if (!editingId) return;
    error = '';
    try {
      const res = await fetch(`/api/categories/${editingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editForm.name.trim(),
          description: editForm.description.trim() || undefined,
          icon: editForm.icon.trim() || undefined,
          sort_order: editForm.sort_order
        })
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: 'Failed to update category.' }));
        error = body.message ?? 'Failed to update category.';
        return;
      }

      const updated: Category = await res.json();
      categories = categories.map((c) => (c.id === updated.id ? updated : c));
      cancelEdit();
    } catch {
      error = 'Network error. Please try again.';
    }
  }

  async function confirmDelete(id: string) {
    error = '';
    try {
      const res = await fetch(`/api/categories/${id}`, { method: 'DELETE' });

      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => ({ message: 'Failed to delete category.' }));
        error = body.message ?? 'Failed to delete category.';
        deleteConfirmId = null;
        return;
      }

      categories = categories.filter((c) => c.id !== id);
      deleteConfirmId = null;
    } catch {
      error = 'Network error. Please try again.';
      deleteConfirmId = null;
    }
  }
</script>

<div class="categories-page">
  <header class="page-header">
    <div class="header-left">
      <a href="/settings" class="back-link">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M19 12H5" /><path d="M12 19l-7-7 7-7" />
        </svg>
        Settings
      </a>
      <h1>Categories</h1>
    </div>
    <button class="btn btn-primary" onclick={startAdd} disabled={adding}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
        <path d="M12 5v14M5 12h14" />
      </svg>
      Add Category
    </button>
  </header>

  {#if error}
    <div class="error-banner">{error}</div>
  {/if}

  <div class="table-wrapper card">
    <table class="data-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Description</th>
          <th>Icon</th>
          <th class="num">Order</th>
          <th class="actions-col">Actions</th>
        </tr>
      </thead>
      <tbody>
        {#if adding}
          <tr class="form-row">
            <td><input class="form-input cell-input" type="text" placeholder="e.g. Databases" bind:value={addForm.name} /></td>
            <td><input class="form-input cell-input" type="text" placeholder="Optional description" bind:value={addForm.description} /></td>
            <td><input class="form-input cell-input" type="text" placeholder="e.g. database" bind:value={addForm.icon} /></td>
            <td class="num"><input class="form-input cell-input num-input" type="number" min="0" bind:value={addForm.sort_order} /></td>
            <td class="actions-col">
              <div class="action-btns">
                <button class="btn btn-primary btn-sm" onclick={submitAdd} disabled={!addForm.name.trim()}>Save</button>
                <button class="btn btn-secondary btn-sm" onclick={cancelAdd}>Cancel</button>
              </div>
            </td>
          </tr>
        {/if}

        {#each categories as cat (cat.id)}
          {#if editingId === cat.id}
            <tr class="form-row">
              <td><input class="form-input cell-input" type="text" bind:value={editForm.name} /></td>
              <td><input class="form-input cell-input" type="text" bind:value={editForm.description} /></td>
              <td><input class="form-input cell-input" type="text" bind:value={editForm.icon} /></td>
              <td class="num"><input class="form-input cell-input num-input" type="number" min="0" bind:value={editForm.sort_order} /></td>
              <td class="actions-col">
                <div class="action-btns">
                  <button class="btn btn-primary btn-sm" onclick={submitEdit} disabled={!editForm.name.trim()}>Save</button>
                  <button class="btn btn-secondary btn-sm" onclick={cancelEdit}>Cancel</button>
                </div>
              </td>
            </tr>
          {:else}
            <tr>
              <td class="name-cell">{cat.name}</td>
              <td class="desc-cell">{cat.description ?? ''}</td>
              <td class="icon-cell">{cat.icon ?? ''}</td>
              <td class="num">{cat.sort_order}</td>
              <td class="actions-col">
                {#if deleteConfirmId === cat.id}
                  <div class="action-btns">
                    <span class="confirm-label">Delete?</span>
                    <button class="btn btn-danger btn-sm" onclick={() => confirmDelete(cat.id)}>Yes</button>
                    <button class="btn btn-secondary btn-sm" onclick={() => (deleteConfirmId = null)}>No</button>
                  </div>
                {:else}
                  <div class="action-btns">
                    <button class="btn btn-secondary btn-sm" onclick={() => startEdit(cat)}>Edit</button>
                    <button class="btn btn-danger btn-sm" onclick={() => { deleteConfirmId = cat.id; error = ''; }}>Delete</button>
                  </div>
                {/if}
              </td>
            </tr>
          {/if}
        {/each}

        {#if categories.length === 0 && !adding}
          <tr>
            <td colspan="5" class="empty-cell">No categories defined. Click "Add Category" to create one.</td>
          </tr>
        {/if}
      </tbody>
    </table>
  </div>
</div>

<style>
  .categories-page {
    max-width: 1000px;
  }

  .page-header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    margin-bottom: 20px;
    gap: 16px;
  }

  .header-left {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .back-link {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 0.8125rem;
    color: var(--text-secondary);
    text-decoration: none;
    transition: color var(--transition);
  }

  .back-link:hover {
    color: var(--accent);
  }

  .page-header h1 {
    font-size: 1.5rem;
    font-weight: 600;
  }

  .error-banner {
    background-color: rgba(239, 68, 68, 0.1);
    border: 1px solid var(--error);
    border-radius: var(--radius-sm);
    color: var(--error);
    padding: 10px 14px;
    font-size: 0.8125rem;
    margin-bottom: 16px;
  }

  .table-wrapper {
    padding: 0;
    overflow-x: auto;
  }

  .data-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.8125rem;
  }

  .data-table th {
    text-align: left;
    padding: 12px 16px;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
  }

  .data-table td {
    padding: 10px 16px;
    border-bottom: 1px solid var(--border);
    vertical-align: middle;
  }

  .data-table tbody tr:last-child td {
    border-bottom: none;
  }

  .data-table tbody tr:not(.form-row):hover {
    background-color: rgba(255, 255, 255, 0.02);
  }

  .form-row {
    background-color: rgba(99, 102, 241, 0.04);
  }

  .num {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .name-cell {
    font-weight: 500;
    color: var(--text-primary);
  }

  .desc-cell {
    color: var(--text-secondary);
    max-width: 260px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .icon-cell {
    color: var(--text-secondary);
    font-family: 'SF Mono', 'Fira Code', 'Fira Mono', monospace;
    font-size: 0.75rem;
  }

  .actions-col {
    text-align: right;
    white-space: nowrap;
    min-width: 140px;
  }

  .action-btns {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .confirm-label {
    font-size: 0.75rem;
    color: var(--error);
    font-weight: 500;
  }

  .cell-input {
    width: 100%;
    padding: 6px 8px;
    font-size: 0.8125rem;
  }

  .num-input {
    width: 80px;
    text-align: right;
  }

  .empty-cell {
    text-align: center;
    color: var(--text-secondary);
    padding: 32px 16px !important;
  }
</style>
