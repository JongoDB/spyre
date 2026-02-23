<script lang="ts">
	interface Props {
		sessionRestored?: boolean;
		broadcastActive?: boolean;
		onsplith?: () => void;
		onsplitv?: () => void;
		onzoom?: () => void;
		onsearch?: () => void;
		onsnapshot?: () => void;
		onbroadcast?: () => void;
		oncommand?: (cmd: string) => void;
	}

	let {
		sessionRestored = false,
		broadcastActive = false,
		onsplith,
		onsplitv,
		onzoom,
		onsearch,
		onsnapshot,
		onbroadcast,
		oncommand
	}: Props = $props();

	import QuickCommands from './QuickCommands.svelte';

	let showRestoredBadge = $state(false);

	$effect(() => {
		if (sessionRestored) {
			showRestoredBadge = true;
			const timer = setTimeout(() => {
				showRestoredBadge = false;
			}, 5000);
			return () => clearTimeout(timer);
		}
	});
</script>

<div class="toolbar">
	<div class="toolbar-group">
		<button class="toolbar-btn" onclick={onsplith} title="Split Horizontal (Ctrl+B %)">
			<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
				<rect x="1" y="1" width="12" height="12" rx="1" stroke="currentColor" stroke-width="1.5"/>
				<line x1="7" y1="1" x2="7" y2="13" stroke="currentColor" stroke-width="1.5"/>
			</svg>
			<span>Split H</span>
		</button>
		<button class="toolbar-btn" onclick={onsplitv} title="Split Vertical (Ctrl+B &quot;)">
			<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
				<rect x="1" y="1" width="12" height="12" rx="1" stroke="currentColor" stroke-width="1.5"/>
				<line x1="1" y1="7" x2="13" y2="7" stroke="currentColor" stroke-width="1.5"/>
			</svg>
			<span>Split V</span>
		</button>
		<button class="toolbar-btn" onclick={onzoom} title="Zoom Pane (Ctrl+B z)">
			<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
				<rect x="1" y="1" width="12" height="12" rx="1" stroke="currentColor" stroke-width="1.5"/>
				<polyline points="5,3 3,3 3,5" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
				<polyline points="9,11 11,11 11,9" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
			</svg>
			<span>Zoom</span>
		</button>
	</div>

	<div class="toolbar-group">
		<button class="toolbar-btn" onclick={onsearch} title="Search scrollback (Ctrl+Shift+F)">
			<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
				<circle cx="6" cy="6" r="4" stroke="currentColor" stroke-width="1.5"/>
				<line x1="9" y1="9" x2="12.5" y2="12.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
			</svg>
			<span>Search</span>
		</button>
		<QuickCommands {oncommand} />
		<button class="toolbar-btn" onclick={onsnapshot} title="Capture terminal snapshot">
			<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
				<rect x="2" y="3" width="10" height="9" rx="1" stroke="currentColor" stroke-width="1.5"/>
				<path d="M4 3V2a1 1 0 011-1h4a1 1 0 011 1v1" stroke="currentColor" stroke-width="1.5"/>
				<line x1="5" y1="6.5" x2="9" y2="6.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
				<line x1="5" y1="9" x2="8" y2="9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
			</svg>
			<span>Snap</span>
		</button>
	</div>

	<div class="toolbar-end">
		{#if showRestoredBadge}
			<span class="restored-badge" class:fading={!sessionRestored}>Session restored</span>
		{/if}
	</div>
</div>

<style>
	.toolbar {
		display: flex;
		align-items: center;
		gap: 2px;
		padding: 3px 8px;
		background-color: var(--bg-secondary);
		border: 1px solid var(--border);
		border-top: none;
		flex-shrink: 0;
		min-height: 32px;
	}

	.toolbar-group {
		display: flex;
		align-items: center;
		gap: 1px;
	}

	.toolbar-group + .toolbar-group {
		margin-left: 6px;
		padding-left: 6px;
		border-left: 1px solid var(--border);
	}

	.toolbar-end {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 8px;
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

	.toolbar-btn:hover {
		color: var(--text-primary);
		background-color: rgba(255, 255, 255, 0.06);
	}

	.toolbar-btn:active {
		background-color: rgba(255, 255, 255, 0.1);
	}

	.restored-badge {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 2px 8px;
		font-size: 0.625rem;
		font-weight: 600;
		color: var(--success);
		background-color: rgba(34, 197, 94, 0.1);
		border: 1px solid rgba(34, 197, 94, 0.2);
		border-radius: 9999px;
		animation: fadeIn 0.3s ease;
	}

	.restored-badge::before {
		content: '';
		display: inline-block;
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background-color: var(--success);
	}

	.restored-badge.fading {
		animation: fadeOut 1s ease forwards;
		animation-delay: 4s;
	}

	@keyframes fadeIn {
		from { opacity: 0; transform: translateY(-4px); }
		to { opacity: 1; transform: translateY(0); }
	}

	@keyframes fadeOut {
		from { opacity: 1; }
		to { opacity: 0; }
	}
</style>
