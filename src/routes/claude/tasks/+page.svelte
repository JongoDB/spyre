<script lang="ts">
	import type { PageData } from './$types';
	import ClaudeTaskHistory from '$lib/components/ClaudeTaskHistory.svelte';

	let { data }: { data: PageData } = $props();
</script>

<div class="tasks-page">
	<header class="page-header">
		<h1>Claude Tasks</h1>
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

	.page-header h1 {
		font-size: 1.5rem;
		font-weight: 600;
		margin-bottom: 4px;
	}

	.subtitle {
		color: var(--text-secondary);
		font-size: 0.875rem;
	}
</style>
