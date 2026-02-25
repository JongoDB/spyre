<script lang="ts">
	let { percentComplete = 0, currentPhase = null, hasError = false }: {
		percentComplete: number;
		currentPhase: string | null;
		hasError: boolean;
	} = $props();

	function formatPhase(phase: string | null): string {
		if (!phase) return 'Provisioning...';
		const map: Record<string, string> = {
			proxmox: 'Setting up...',
			helper_script: 'Running helper...',
			post_provision: 'Configuring...',
			community_script: 'Installing app...',
			software_pool: 'Installing packages...',
			custom_script: 'Running script...',
			claude_install: 'Installing Claude...'
		};
		return map[phase] ?? phase;
	}
</script>

<div class="compact-progress">
	<div class="compact-bar">
		<div
			class="compact-fill"
			class:error={hasError}
			style="width: {percentComplete}%"
		></div>
	</div>
	<span class="compact-label">
		{percentComplete}% — {formatPhase(currentPhase)}
	</span>
</div>

<style>
	.compact-progress {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.compact-bar {
		height: 4px;
		background-color: rgba(255, 255, 255, 0.06);
		border-radius: 2px;
		overflow: hidden;
	}

	.compact-fill {
		height: 100%;
		background-color: var(--accent);
		border-radius: 2px;
		transition: width 0.3s ease;
	}

	.compact-fill.error {
		background-color: var(--error);
	}

	.compact-label {
		font-size: 0.6875rem;
		color: var(--text-secondary);
		font-variant-numeric: tabular-nums;
	}
</style>
