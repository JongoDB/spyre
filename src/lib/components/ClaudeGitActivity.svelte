<script lang="ts">
	import type { ClaudeGitActivity } from '$lib/types/claude';

	interface Props {
		activity: ClaudeGitActivity | null;
	}

	let { activity }: Props = $props();
</script>

{#if activity}
	<div class="git-panel">
		{#if activity.branch}
			<div class="git-branch">
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<line x1="6" y1="3" x2="6" y2="15" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" />
				</svg>
				<code>{activity.branch}</code>
			</div>
		{/if}

		{#if activity.git_status}
			<div class="git-section">
				<span class="label">Working Tree</span>
				<pre class="git-output">{activity.git_status}</pre>
			</div>
		{/if}

		{#if activity.diff_stat}
			<div class="git-section">
				<span class="label">Diff Stat</span>
				<pre class="git-output">{activity.diff_stat}</pre>
			</div>
		{/if}

		{#if activity.recent_commits.length > 0}
			<div class="git-section">
				<span class="label">Recent Commits</span>
				<div class="commit-list">
					{#each activity.recent_commits as commit}
						<div class="commit-item">
							<code class="commit-hash">{commit.hash.slice(0, 7)}</code>
							<span class="commit-message">{commit.message}</span>
							<span class="commit-meta">{commit.author}</span>
						</div>
					{/each}
				</div>
			</div>
		{/if}

		<div class="git-fetched">
			Updated: {new Date(activity.fetched_at).toLocaleString()}
		</div>
	</div>
{:else}
	<div class="git-empty">
		<p>No git activity detected.</p>
		<p class="hint">Git data will appear when a git repository exists in the environment.</p>
	</div>
{/if}

<style>
	.git-panel {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.git-branch {
		display: flex;
		align-items: center;
		gap: 8px;
		color: var(--accent);
	}

	.git-branch code {
		font-size: 0.875rem;
		font-weight: 600;
	}

	.label {
		font-size: 0.6875rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-secondary);
		display: block;
		margin-bottom: 4px;
	}

	.git-output {
		font-size: 0.75rem;
		font-family: 'SF Mono', 'Fira Code', monospace;
		background-color: var(--bg-secondary);
		padding: 8px 12px;
		border-radius: var(--radius-sm);
		margin: 0;
		white-space: pre-wrap;
		word-break: break-word;
		max-height: 200px;
		overflow-y: auto;
		color: var(--text-secondary);
	}

	.commit-list {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.commit-item {
		display: flex;
		align-items: baseline;
		gap: 10px;
		font-size: 0.8125rem;
		padding: 3px 0;
	}

	.commit-hash {
		font-size: 0.75rem;
		color: var(--accent);
		background-color: rgba(99, 102, 241, 0.08);
		padding: 1px 6px;
		border-radius: 3px;
		flex-shrink: 0;
	}

	.commit-message {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.commit-meta {
		font-size: 0.6875rem;
		color: var(--text-secondary);
		flex-shrink: 0;
	}

	.git-fetched {
		font-size: 0.6875rem;
		color: var(--text-secondary);
		opacity: 0.6;
	}

	.git-empty {
		text-align: center;
		padding: 24px;
		color: var(--text-secondary);
	}

	.git-empty p { margin: 0; }
	.git-empty .hint {
		font-size: 0.8125rem;
		opacity: 0.7;
		margin-top: 4px;
	}
</style>
