<script lang="ts">
	import type { PageData } from './$types';
	import ClaudeDashboardSummary from '$lib/components/ClaudeDashboardSummary.svelte';
	import ClaudeActiveWorkGrid from '$lib/components/ClaudeActiveWorkGrid.svelte';
	import ClaudeRecentActivity from '$lib/components/ClaudeRecentActivity.svelte';
	import ClaudeEnvHealthCards from '$lib/components/ClaudeEnvHealthCards.svelte';

	let { data }: { data: PageData } = $props();
</script>

<div class="claude-dashboard">
	<header class="page-header">
		<h1>Claude Dashboard</h1>
		<a href="/claude/tasks" class="btn btn-secondary">Task History</a>
	</header>

	<!-- Summary Stats -->
	<section class="section">
		<ClaudeDashboardSummary summary={data.summary} />
	</section>

	<!-- Active Work -->
	<section class="section">
		<h2 class="section-title">Active Work</h2>
		<ClaudeActiveWorkGrid items={data.activeWork} />
	</section>

	<div class="two-col">
		<!-- Recent Activity -->
		<section class="section card">
			<h2 class="section-title">Recent Activity</h2>
			<ClaudeRecentActivity items={data.recentActivity} />
		</section>

		<!-- Environment Health -->
		<section class="section">
			<h2 class="section-title">Environment Health</h2>
			<ClaudeEnvHealthCards cards={data.environmentHealth} />
		</section>
	</div>
</div>

<style>
	.claude-dashboard {
		max-width: 1200px;
	}

	.page-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 24px;
	}

	.page-header h1 {
		font-size: 1.5rem;
		font-weight: 600;
	}

	.section {
		margin-bottom: 24px;
	}

	.section-title {
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--text-secondary);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		margin-bottom: 12px;
	}

	.section.card {
		padding: 16px 20px;
	}

	.section.card .section-title {
		margin-bottom: 8px;
	}

	.two-col {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 20px;
	}

	@media (max-width: 900px) {
		.two-col {
			grid-template-columns: 1fr;
		}
	}
</style>
