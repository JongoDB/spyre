<script lang="ts">
  import type { PageData } from './$types';
  import type { NetworkProfile } from '$lib/types/template';

  let { data }: { data: PageData } = $props();

  let profiles = $state<NetworkProfile[]>(data.profiles);
  let adding = $state(false);
  let editingId = $state<string | null>(null);
  let error = $state('');
  let deleteConfirmId = $state<string | null>(null);

  interface ProfileForm {
    name: string;
    description: string;
    bridge: string;
    ip_mode: 'dhcp' | 'static';
    ip_address: string;
    gateway: string;
    dns: string;
    vlan: string;
    firewall: boolean;
  }

  function emptyForm(): ProfileForm {
    return {
      name: '',
      description: '',
      bridge: 'vmbr0',
      ip_mode: 'dhcp',
      ip_address: '',
      gateway: '',
      dns: '',
      vlan: '',
      firewall: false
    };
  }

  let addForm = $state<ProfileForm>(emptyForm());
  let editForm = $state<ProfileForm>(emptyForm());

  function startAdd() {
    adding = true;
    editingId = null;
    deleteConfirmId = null;
    addForm = emptyForm();
    error = '';
  }

  function cancelAdd() {
    adding = false;
    addForm = emptyForm();
    error = '';
  }

  function startEdit(profile: NetworkProfile) {
    editingId = profile.id;
    adding = false;
    deleteConfirmId = null;
    editForm = {
      name: profile.name,
      description: profile.description ?? '',
      bridge: profile.bridge,
      ip_mode: profile.ip_mode,
      ip_address: profile.ip_address ?? '',
      gateway: profile.gateway ?? '',
      dns: profile.dns ?? '',
      vlan: profile.vlan != null ? String(profile.vlan) : '',
      firewall: profile.firewall === 1
    };
    error = '';
  }

  function cancelEdit() {
    editingId = null;
    error = '';
  }

  function formToPayload(form: ProfileForm): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      bridge: form.bridge.trim() || 'vmbr0',
      ip_mode: form.ip_mode,
      dns: form.dns.trim() || undefined,
      vlan: form.vlan.trim() ? Number(form.vlan) : undefined,
      firewall: form.firewall
    };
    if (form.ip_mode === 'static') {
      payload.ip_address = form.ip_address.trim() || undefined;
      payload.gateway = form.gateway.trim() || undefined;
    }
    return payload;
  }

  async function submitAdd() {
    error = '';
    try {
      const res = await fetch('/api/network-profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formToPayload(addForm))
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: 'Failed to create profile.' }));
        error = body.message ?? 'Failed to create profile.';
        return;
      }

      const created: NetworkProfile = await res.json();
      profiles = [...profiles, created].sort((a, b) => a.name.localeCompare(b.name));
      cancelAdd();
    } catch {
      error = 'Network error. Please try again.';
    }
  }

  async function submitEdit() {
    if (!editingId) return;
    error = '';
    try {
      const res = await fetch(`/api/network-profiles/${editingId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formToPayload(editForm))
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: 'Failed to update profile.' }));
        error = body.message ?? 'Failed to update profile.';
        return;
      }

      const updated: NetworkProfile = await res.json();
      profiles = profiles.map((p) => (p.id === updated.id ? updated : p));
      cancelEdit();
    } catch {
      error = 'Network error. Please try again.';
    }
  }

  async function confirmDelete(id: string) {
    error = '';
    try {
      const res = await fetch(`/api/network-profiles/${id}`, { method: 'DELETE' });

      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => ({ message: 'Failed to delete profile.' }));
        error = body.message ?? 'Failed to delete profile.';
        deleteConfirmId = null;
        return;
      }

      profiles = profiles.filter((p) => p.id !== id);
      deleteConfirmId = null;
    } catch {
      error = 'Network error. Please try again.';
      deleteConfirmId = null;
    }
  }

  function firewallLabel(val: number): string {
    return val === 1 ? 'Yes' : 'No';
  }
</script>

{#snippet formRow(form: ProfileForm, onSubmit: () => void, onCancel: () => void)}
  <tr class="form-row">
    <td><input class="form-input cell-input" type="text" placeholder="e.g. Default LAN" bind:value={form.name} /></td>
    <td><input class="form-input cell-input" type="text" placeholder="vmbr0" bind:value={form.bridge} /></td>
    <td>
      <select class="form-select cell-input" bind:value={form.ip_mode}>
        <option value="dhcp">DHCP</option>
        <option value="static">Static</option>
      </select>
    </td>
    <td>
      {#if form.ip_mode === 'static'}
        <div class="static-fields">
          <input class="form-input cell-input" type="text" placeholder="10.0.0.100/24" bind:value={form.ip_address} />
          <input class="form-input cell-input" type="text" placeholder="Gateway" bind:value={form.gateway} />
        </div>
      {:else}
        <span class="muted">N/A</span>
      {/if}
    </td>
    <td><input class="form-input cell-input" type="text" placeholder="1.1.1.1" bind:value={form.dns} /></td>
    <td><input class="form-input cell-input num-input" type="text" placeholder="None" bind:value={form.vlan} /></td>
    <td class="center">
      <label class="toggle-label">
        <input type="checkbox" bind:checked={form.firewall} />
      </label>
    </td>
    <td class="actions-col">
      <div class="action-btns">
        <button class="btn btn-primary btn-sm" onclick={onSubmit} disabled={!form.name.trim()}>Save</button>
        <button class="btn btn-secondary btn-sm" onclick={onCancel}>Cancel</button>
      </div>
    </td>
  </tr>
{/snippet}

<div class="profiles-page">
  <header class="page-header">
    <div class="header-left">
      <a href="/settings" class="back-link">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M19 12H5" /><path d="M12 19l-7-7 7-7" />
        </svg>
        Settings
      </a>
      <h1>Network Profiles</h1>
    </div>
    <button class="btn btn-primary" onclick={startAdd} disabled={adding}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
        <path d="M12 5v14M5 12h14" />
      </svg>
      Add Profile
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
          <th>Bridge</th>
          <th>IP Mode</th>
          <th>IP / Gateway</th>
          <th>DNS</th>
          <th>VLAN</th>
          <th class="center">Firewall</th>
          <th class="actions-col">Actions</th>
        </tr>
      </thead>
      <tbody>
        {#if adding}
          {@render formRow(addForm, submitAdd, cancelAdd)}
        {/if}

        {#each profiles as profile (profile.id)}
          {#if editingId === profile.id}
            {@render formRow(editForm, submitEdit, cancelEdit)}
          {:else}
            <tr>
              <td class="name-cell">{profile.name}</td>
              <td><code class="mono">{profile.bridge}</code></td>
              <td>
                <span class="badge-inline badge-{profile.ip_mode}">{profile.ip_mode.toUpperCase()}</span>
              </td>
              <td>
                {#if profile.ip_mode === 'static' && profile.ip_address}
                  <span class="mono">{profile.ip_address}</span>
                  {#if profile.gateway}
                    <br /><span class="muted mono">gw {profile.gateway}</span>
                  {/if}
                {:else}
                  <span class="muted">--</span>
                {/if}
              </td>
              <td>
                {#if profile.dns}
                  <span class="mono">{profile.dns}</span>
                {:else}
                  <span class="muted">--</span>
                {/if}
              </td>
              <td>
                {#if profile.vlan != null}
                  {profile.vlan}
                {:else}
                  <span class="muted">--</span>
                {/if}
              </td>
              <td class="center">{firewallLabel(profile.firewall)}</td>
              <td class="actions-col">
                {#if deleteConfirmId === profile.id}
                  <div class="action-btns">
                    <span class="confirm-label">Delete?</span>
                    <button class="btn btn-danger btn-sm" onclick={() => confirmDelete(profile.id)}>Yes</button>
                    <button class="btn btn-secondary btn-sm" onclick={() => (deleteConfirmId = null)}>No</button>
                  </div>
                {:else}
                  <div class="action-btns">
                    <button class="btn btn-secondary btn-sm" onclick={() => startEdit(profile)}>Edit</button>
                    <button class="btn btn-danger btn-sm" onclick={() => { deleteConfirmId = profile.id; error = ''; }}>Delete</button>
                  </div>
                {/if}
              </td>
            </tr>
          {/if}
        {/each}

        {#if profiles.length === 0 && !adding}
          <tr>
            <td colspan="8" class="empty-cell">No network profiles defined. Click "Add Profile" to create one.</td>
          </tr>
        {/if}
      </tbody>
    </table>
  </div>
</div>

<style>
  .profiles-page {
    max-width: 1200px;
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

  .name-cell {
    font-weight: 500;
    color: var(--text-primary);
  }

  .center {
    text-align: center;
  }

  .mono {
    font-family: 'SF Mono', 'Fira Code', 'Fira Mono', monospace;
    font-size: 0.75rem;
  }

  code.mono {
    background-color: rgba(255, 255, 255, 0.05);
    padding: 2px 6px;
    border-radius: var(--radius-sm);
  }

  .muted {
    color: var(--text-secondary);
    opacity: 0.6;
  }

  .badge-inline {
    display: inline-block;
    padding: 2px 8px;
    font-size: 0.6875rem;
    font-weight: 600;
    border-radius: 9999px;
    letter-spacing: 0.04em;
  }

  .badge-dhcp {
    background-color: rgba(99, 102, 241, 0.12);
    color: var(--accent);
  }

  .badge-static {
    background-color: rgba(245, 158, 11, 0.12);
    color: var(--warning);
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
    width: 70px;
  }

  .static-fields {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .toggle-label input[type="checkbox"] {
    accent-color: var(--accent);
    width: 16px;
    height: 16px;
    cursor: pointer;
  }

  .empty-cell {
    text-align: center;
    color: var(--text-secondary);
    padding: 32px 16px !important;
  }
</style>
