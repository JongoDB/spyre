<script lang="ts">
</script>

<div class="settings-page">
  <header class="page-header">
    <h1>Settings</h1>
    <p class="subtitle">Configure resource presets and network profiles used by templates.</p>
  </header>

  <div class="settings-grid">
    <a href="/settings/resource-presets" class="settings-card card">
      <h3>Resource Presets</h3>
      <p>Named CPU, memory, swap, and disk configurations (e.g. Small, Medium, Large).</p>
    </a>
    <a href="/settings/network-profiles" class="settings-card card">
      <h3>Network Profiles</h3>
      <p>Named network configurations with bridge, IP mode, DNS, and VLAN settings.</p>
    </a>
    <a href="/settings/categories" class="settings-card card">
      <h3>Categories</h3>
      <p>Organize templates and community scripts into named categories.</p>
    </a>
    <a href="/settings/claude" class="settings-card card">
      <h3>Claude Code</h3>
      <p>Manage Claude Code authentication, view auth logs, and configure AI settings.</p>
    </a>
  </div>
</div>

<style>
  .settings-page { max-width: 800px; }
  .page-header { margin-bottom: 24px; }
  .page-header h1 { font-size: 1.5rem; font-weight: 600; margin-bottom: 4px; }
  .subtitle { color: var(--text-secondary); font-size: 0.875rem; }
  .settings-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; }
  .settings-card { text-decoration: none; color: var(--text-primary); transition: border-color var(--transition); }
  .settings-card:hover { border-color: var(--accent); }
  .settings-card h3 { font-size: 1rem; font-weight: 600; margin-bottom: 8px; }
  .settings-card p { font-size: 0.8125rem; color: var(--text-secondary); line-height: 1.5; }
</style>
