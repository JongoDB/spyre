<script lang="ts">
	interface Props {
		label: string;
		value: number;
		max: number;
		warnAt?: number;
		critAt?: number;
	}

	let { label, value, max, warnAt = 80, critAt = 90 }: Props = $props();

	let percent = $derived(max > 0 ? Math.min(100, (value / max) * 100) : 0);
	let level = $derived(
		percent >= critAt ? 'critical' : percent >= warnAt ? 'warning' : 'normal'
	);
</script>

<div class="resource-bar">
	<div class="resource-label">
		<span class="resource-name">{label}</span>
		<span class="resource-pct">{percent.toFixed(0)}%</span>
	</div>
	<div class="bar-track">
		<div
			class="bar-fill bar-{level}"
			style="width: {percent}%"
		></div>
	</div>
</div>

<style>
	.resource-bar {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.resource-label {
		display: flex;
		justify-content: space-between;
		font-size: 0.625rem;
		color: var(--text-secondary);
	}

	.resource-name {
		font-weight: 500;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.resource-pct {
		font-family: 'SF Mono', 'Fira Code', monospace;
	}

	.bar-track {
		width: 100%;
		height: 4px;
		background-color: rgba(255, 255, 255, 0.06);
		border-radius: 2px;
		overflow: hidden;
	}

	.bar-fill {
		height: 100%;
		border-radius: 2px;
		transition: width 0.5s ease;
	}

	.bar-normal {
		background-color: var(--accent);
	}

	.bar-warning {
		background-color: var(--warning);
	}

	.bar-critical {
		background-color: var(--error);
	}
</style>
