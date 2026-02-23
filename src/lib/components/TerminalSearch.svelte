<script lang="ts">
	import { onMount } from 'svelte';

	interface Props {
		envId: string;
		windowIndex: number;
		onclose: () => void;
	}

	let { envId, windowIndex, onclose }: Props = $props();

	interface Match {
		lineNum: number;
		line: string;
		before: string;
		after: string;
	}

	let inputEl: HTMLInputElement;
	let resultsEl: HTMLDivElement;
	let query = $state('');
	let matches = $state<Match[]>([]);
	let currentIndex = $state(-1);
	let loading = $state(false);
	let searched = $state(false);
	let totalLines = $state(0);

	onMount(() => {
		inputEl?.focus();
	});

	async function search() {
		const q = query.trim();
		if (!q) return;

		loading = true;
		searched = false;
		matches = [];
		currentIndex = -1;

		try {
			const res = await fetch(`/api/terminal/${envId}/windows/${windowIndex}/snapshot`);
			if (!res.ok) return;
			const data = await res.json();
			const content: string = data.content ?? '';
			const lines = content.split('\n');
			totalLines = lines.length;

			const lowerQuery = q.toLowerCase();
			const found: Match[] = [];

			for (let i = 0; i < lines.length; i++) {
				if (lines[i].toLowerCase().includes(lowerQuery)) {
					found.push({
						lineNum: i + 1,
						line: lines[i],
						before: i > 0 ? lines[i - 1] : '',
						after: i < lines.length - 1 ? lines[i + 1] : ''
					});
				}
			}

			matches = found;
			searched = true;
			if (found.length > 0) {
				currentIndex = 0;
				scrollToMatch(0);
			}
		} catch (err) {
			console.error('Search failed:', err);
		} finally {
			loading = false;
		}
	}

	function next() {
		if (matches.length === 0) return;
		currentIndex = (currentIndex + 1) % matches.length;
		scrollToMatch(currentIndex);
	}

	function prev() {
		if (matches.length === 0) return;
		currentIndex = (currentIndex - 1 + matches.length) % matches.length;
		scrollToMatch(currentIndex);
	}

	function scrollToMatch(index: number) {
		requestAnimationFrame(() => {
			const el = resultsEl?.querySelector(`[data-match="${index}"]`);
			el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
		});
	}

	function close() {
		onclose();
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			if (searched && matches.length > 0) {
				if (e.shiftKey) prev();
				else if (query === (matches[0]?.line !== undefined ? query : '')) next();
				else search();
			} else {
				search();
			}
		} else if (e.key === 'Escape') {
			e.preventDefault();
			close();
		}
	}

	function highlightMatch(text: string, q: string): string {
		if (!q) return escapeHtml(text);
		const escaped = escapeHtml(text);
		const escapedQuery = escapeHtml(q);
		const regex = new RegExp(`(${escapeRegex(escapedQuery)})`, 'gi');
		return escaped.replace(regex, '<mark>$1</mark>');
	}

	function escapeHtml(s: string): string {
		return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	}

	function escapeRegex(s: string): string {
		return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	}
</script>

<div class="search-panel">
	<div class="search-bar">
		<div class="search-inner">
			<svg class="search-icon" width="14" height="14" viewBox="0 0 14 14" fill="none">
				<circle cx="6" cy="6" r="4" stroke="currentColor" stroke-width="1.5"/>
				<line x1="9" y1="9" x2="12.5" y2="12.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
			</svg>
			<input
				bind:this={inputEl}
				bind:value={query}
				onkeydown={handleKeydown}
				type="text"
				placeholder="Search terminal scrollback..."
				class="search-input"
				spellcheck="false"
			/>
			{#if searched}
				<span class="match-count" class:none={matches.length === 0}>
					{matches.length === 0 ? 'No matches' : `${currentIndex + 1}/${matches.length}`}
				</span>
			{/if}
			{#if matches.length > 0}
				<button class="nav-btn" onclick={prev} title="Previous (Shift+Enter)">
					<svg width="12" height="12" viewBox="0 0 12 12" fill="none">
						<path d="M3 7.5l3-3 3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
					</svg>
				</button>
				<button class="nav-btn" onclick={next} title="Next (Enter)">
					<svg width="12" height="12" viewBox="0 0 12 12" fill="none">
						<path d="M3 4.5l3 3 3-3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
					</svg>
				</button>
			{/if}
			{#if loading}
				<div class="search-spinner"></div>
			{/if}
			<button class="close-btn" onclick={close} title="Close (Escape)">
				<svg width="12" height="12" viewBox="0 0 12 12" fill="none">
					<line x1="3" y1="3" x2="9" y2="9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
					<line x1="9" y1="3" x2="3" y2="9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
				</svg>
			</button>
		</div>
	</div>

	{#if searched}
		<div class="search-results" bind:this={resultsEl}>
			{#if matches.length === 0}
				<div class="no-results">No matches found in {totalLines} lines of scrollback</div>
			{:else}
				{#each matches as match, i (match.lineNum)}
					<button
						class="result"
						class:active={i === currentIndex}
						data-match={i}
						onclick={() => { currentIndex = i; }}
					>
						<span class="line-num">L{match.lineNum}</span>
						<div class="result-lines">
							{#if match.before}
								<div class="context-line">{match.before}</div>
							{/if}
							<div class="match-line">{@html highlightMatch(match.line, query)}</div>
							{#if match.after}
								<div class="context-line">{match.after}</div>
							{/if}
						</div>
					</button>
				{/each}
			{/if}
		</div>
	{/if}
</div>

<style>
	.search-panel {
		position: absolute;
		bottom: 0;
		left: 0;
		right: 0;
		z-index: 20;
		display: flex;
		flex-direction: column;
		max-height: 50%;
		animation: slideUp 0.15s ease;
	}

	.search-bar {
		padding: 6px 8px;
		background-color: rgba(15, 17, 23, 0.97);
		border-top: 1px solid var(--border);
		flex-shrink: 0;
	}

	.search-inner {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 4px 8px;
		background-color: var(--bg-secondary);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
	}

	.search-inner:focus-within {
		border-color: var(--accent);
	}

	.search-icon {
		color: var(--text-secondary);
		flex-shrink: 0;
	}

	.search-input {
		flex: 1;
		background: none;
		border: none;
		outline: none;
		color: var(--text-primary);
		font-size: 0.8125rem;
		font-family: 'SF Mono', 'Fira Code', monospace;
		min-width: 0;
	}

	.search-input::placeholder {
		color: var(--text-secondary);
		opacity: 0.5;
	}

	.match-count {
		font-size: 0.6875rem;
		color: var(--text-secondary);
		white-space: nowrap;
		font-family: 'SF Mono', 'Fira Code', monospace;
	}

	.match-count.none {
		color: var(--error);
	}

	.nav-btn,
	.close-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		background: none;
		border: none;
		border-radius: var(--radius-sm);
		color: var(--text-secondary);
		cursor: pointer;
		flex-shrink: 0;
		transition: color var(--transition), background-color var(--transition);
	}

	.nav-btn:hover,
	.close-btn:hover {
		color: var(--text-primary);
		background-color: rgba(255, 255, 255, 0.08);
	}

	.search-spinner {
		width: 14px;
		height: 14px;
		border: 2px solid var(--border);
		border-top-color: var(--accent);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
		flex-shrink: 0;
	}

	.search-results {
		overflow-y: auto;
		background-color: rgba(15, 17, 23, 0.97);
		border-top: 1px solid var(--border);
		padding: 4px;
		flex: 1;
		min-height: 0;
	}

	.no-results {
		padding: 12px 8px;
		text-align: center;
		color: var(--text-secondary);
		font-size: 0.75rem;
	}

	.result {
		display: flex;
		gap: 8px;
		width: 100%;
		padding: 4px 6px;
		margin-bottom: 2px;
		background: none;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		cursor: pointer;
		text-align: left;
		transition: background-color var(--transition), border-color var(--transition);
	}

	.result:hover {
		background-color: rgba(255, 255, 255, 0.03);
	}

	.result.active {
		background-color: rgba(99, 102, 241, 0.08);
		border-color: rgba(99, 102, 241, 0.2);
	}

	.line-num {
		font-size: 0.625rem;
		color: var(--text-secondary);
		opacity: 0.6;
		font-family: 'SF Mono', 'Fira Code', monospace;
		white-space: nowrap;
		padding-top: 2px;
		min-width: 36px;
	}

	.result-lines {
		flex: 1;
		min-width: 0;
		overflow: hidden;
	}

	.context-line {
		font-size: 0.6875rem;
		font-family: 'SF Mono', 'Fira Code', monospace;
		color: var(--text-secondary);
		opacity: 0.4;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.match-line {
		font-size: 0.6875rem;
		font-family: 'SF Mono', 'Fira Code', monospace;
		color: var(--text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.match-line :global(mark) {
		background-color: rgba(250, 204, 21, 0.3);
		color: #fbbf24;
		border-radius: 2px;
		padding: 0 1px;
	}

	@keyframes slideUp {
		from { opacity: 0; transform: translateY(100%); }
		to { opacity: 1; transform: translateY(0); }
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}
</style>
