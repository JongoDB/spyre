<script lang="ts">
	import type { PageData } from './$types';
	import ClaudeTaskHistory from '$lib/components/ClaudeTaskHistory.svelte';

	let { data }: { data: PageData } = $props();
</script>

<div class="tasks-page">
	<header class="page-header">
		<div class="header-left">
			<a href="/claude" class="back-link">
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>
				Dashboard
			</a>
			<h1>Task History</h1>
		</div>
		<p class="subtitle">All Claude Code tasks across environments.</p>
	</header>

	<ClaudeTaskHistory tasks={data.tasks} showEnvId={true} />
</div>

<style>
	.tasks-page {
		max-width: 1000px;
	}

	.page-header {
		margin-bottom: 24px;
	}

	.header-left {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-bottom: 4px;
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
		font-size: 1.5rem;
		font-weight: 600;
	}

	.subtitle {
		color: var(--text-secondary);
		font-size: 0.875rem;
	}
</style>
