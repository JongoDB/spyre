<script lang="ts">
	interface Props {
		oncommand?: (cmd: string) => void;
	}

	let { oncommand }: Props = $props();

	let open = $state(false);
	let popoverEl = $state<HTMLDivElement>(undefined!);
	let buttonEl = $state<HTMLButtonElement>(undefined!);

	const commands = [
		{ id: 'kill', label: 'Kill process', desc: 'Ctrl+C', icon: '\u2717' },
		{ id: 'clear', label: 'Clear screen', desc: 'clear', icon: '\u2312' },
		{ id: 'reset', label: 'Reset terminal', desc: 'reset', icon: '\u21BA' },
		{ id: 'close-pane', label: 'Close pane', desc: 'Ctrl+B x', icon: '\u2716' },
		{ id: 'zoom-pane', label: 'Zoom pane', desc: 'Ctrl+B z', icon: '\u2922' },
		{ id: 'nav-up', label: 'Pane Up', desc: 'Ctrl+B \u2191', icon: '\u2191' },
		{ id: 'nav-down', label: 'Pane Down', desc: 'Ctrl+B \u2193', icon: '\u2193' },
		{ id: 'nav-left', label: 'Pane Left', desc: 'Ctrl+B \u2190', icon: '\u2190' },
		{ id: 'nav-right', label: 'Pane Right', desc: 'Ctrl+B \u2192', icon: '\u2192' }
	];

	function toggle() {
		open = !open;
	}

	function select(id: string) {
		open = false;
		oncommand?.(id);
	}

	function handleClickOutside(e: MouseEvent) {
		if (open && popoverEl && !popoverEl.contains(e.target as Node) && !buttonEl.contains(e.target as Node)) {
			open = false;
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape' && open) {
			open = false;
		}
	}
</script>

<svelte:window onclick={handleClickOutside} onkeydown={handleKeydown} />

<div class="quick-commands-wrapper">
	<button
		bind:this={buttonEl}
		class="toolbar-btn"
		class:active={open}
		onclick={toggle}
		title="Quick commands"
	>
		<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
			<path d="M2 4l4 3-4 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
			<line x1="8" y1="10.5" x2="12" y2="10.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
		</svg>
		<span>Cmds</span>
		<svg width="8" height="8" viewBox="0 0 8 8" fill="none" class="chevron" class:flipped={open}>
			<path d="M2 3l2 2 2-2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
		</svg>
	</button>

	{#if open}
		<div class="popover" bind:this={popoverEl}>
			{#each commands as cmd (cmd.id)}
				<button class="popover-item" onclick={() => select(cmd.id)}>
					<span class="cmd-icon">{cmd.icon}</span>
					<span class="cmd-label">{cmd.label}</span>
					<span class="cmd-desc">{cmd.desc}</span>
				</button>
			{/each}
		</div>
	{/if}
</div>

<style>
	.quick-commands-wrapper {
		position: relative;
	}

	.toolbar-btn {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 3px 8px;
		font-size: 0.6875rem;
		font-weight: 500;
		color: var(--text-secondary);
		background: transparent;
		border: none;
		border-radius: var(--radius-sm);
		cursor: pointer;
		white-space: nowrap;
		transition: color var(--transition), background-color var(--transition);
	}

	.toolbar-btn:hover,
	.toolbar-btn.active {
		color: var(--text-primary);
		background-color: rgba(255, 255, 255, 0.06);
	}

	.chevron {
		transition: transform var(--transition);
	}

	.chevron.flipped {
		transform: rotate(180deg);
	}

	.popover {
		position: absolute;
		top: calc(100% + 4px);
		left: 0;
		z-index: 50;
		min-width: 200px;
		background-color: var(--bg-card);
		border: 1px solid var(--border);
		border-radius: var(--radius);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
		padding: 4px;
		animation: popIn 0.15s ease;
	}

	.popover-item {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 6px 8px;
		font-size: 0.75rem;
		color: var(--text-secondary);
		background: none;
		border: none;
		border-radius: var(--radius-sm);
		cursor: pointer;
		text-align: left;
		transition: color var(--transition), background-color var(--transition);
	}

	.popover-item:hover {
		color: var(--text-primary);
		background-color: rgba(255, 255, 255, 0.06);
	}

	.cmd-icon {
		width: 18px;
		text-align: center;
		font-size: 0.8125rem;
		flex-shrink: 0;
	}

	.cmd-label {
		flex: 1;
	}

	.cmd-desc {
		font-size: 0.625rem;
		color: var(--text-secondary);
		opacity: 0.6;
		font-family: 'SF Mono', 'Fira Code', monospace;
	}

	@keyframes popIn {
		from { opacity: 0; transform: translateY(-4px); }
		to { opacity: 1; transform: translateY(0); }
	}
</style>
