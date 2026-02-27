<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>Preview — {data.envName}:{data.port}</title>
</svelte:head>

<div class="preview-page">
	<header class="preview-header">
		<div class="header-left">
			<a href="/environments/{data.envId}" class="back-link">
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>
				Back to Spyre
			</a>
			<span class="preview-info">
				<strong>{data.envName}</strong>
				<code>:{data.port}</code>
			</span>
		</div>
		{#if data.services.length > 1}
			<div class="header-right">
				{#each data.services as svc (svc.port)}
					<a
						href="/preview/{data.envId}/{svc.port}"
						class="port-tab"
						class:active={svc.port === data.port}
					>
						{svc.name} :{svc.port}
					</a>
				{/each}
			</div>
		{/if}
	</header>
	<iframe
		src="/api/preview/{data.envId}/{data.port}/"
		title="Preview of {data.envName} on port {data.port}"
		class="preview-frame"
	></iframe>
</div>

<style>
	.preview-page {
		display: flex;
		flex-direction: column;
		height: 100vh;
		background: var(--bg-primary, #0a0a0f);
	}

	.preview-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 6px 16px;
		background: var(--bg-secondary, #13131a);
		border-bottom: 1px solid var(--border, rgba(255,255,255,0.08));
		flex-shrink: 0;
		gap: 12px;
	}

	.header-left {
		display: flex;
		align-items: center;
		gap: 16px;
	}

	.back-link {
		display: flex;
		align-items: center;
		gap: 4px;
		color: var(--text-secondary, #888);
		font-size: 0.75rem;
		font-weight: 500;
		text-decoration: none;
		transition: color 0.15s;
	}
	.back-link:hover { color: var(--text-primary, #fff); }

	.preview-info {
		font-size: 0.8125rem;
		color: var(--text-primary, #fff);
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.preview-info code {
		font-size: 0.75rem;
		font-family: 'SF Mono', monospace;
		background: rgba(255,255,255,0.06);
		padding: 1px 6px;
		border-radius: 3px;
		color: var(--accent, #6366f1);
	}

	.header-right {
		display: flex;
		gap: 4px;
	}

	.port-tab {
		font-size: 0.6875rem;
		padding: 3px 10px;
		border-radius: 3px;
		text-decoration: none;
		color: var(--text-secondary, #888);
		background: transparent;
		transition: background 0.15s, color 0.15s;
	}
	.port-tab:hover {
		background: rgba(255,255,255,0.06);
		color: var(--text-primary, #fff);
	}
	.port-tab.active {
		background: rgba(99,102,241,0.15);
		color: var(--accent, #6366f1);
		font-weight: 600;
	}

	.preview-frame {
		flex: 1;
		border: none;
		width: 100%;
		background: #fff;
	}
</style>
