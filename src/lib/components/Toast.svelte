<script lang="ts">
	import { getToasts, removeToast } from '$lib/stores/toast.svelte';

	const toasts = $derived(getToasts());
</script>

{#if toasts.length > 0}
	<div class="toast-container">
		{#each toasts as toast (toast.id)}
			<div class="toast toast-{toast.type}">
				<span class="toast-icon">
					{#if toast.type === 'success'}
						<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
							<polyline points="3,7 6,10 11,4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
						</svg>
					{:else if toast.type === 'error'}
						<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
							<circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.3"/>
							<line x1="5" y1="5" x2="9" y2="9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
							<line x1="9" y1="5" x2="5" y2="9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
						</svg>
					{:else if toast.type === 'warning'}
						<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
							<path d="M7 2L1.5 12h11L7 2z" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
							<line x1="7" y1="6" x2="7" y2="8.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
							<circle cx="7" cy="10.25" r="0.5" fill="currentColor"/>
						</svg>
					{:else}
						<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
							<circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.3"/>
							<line x1="7" y1="6" x2="7" y2="10" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
							<circle cx="7" cy="4.25" r="0.5" fill="currentColor"/>
						</svg>
					{/if}
				</span>
				<span class="toast-message">{toast.message}</span>
				<button class="toast-close" onclick={() => removeToast(toast.id)}>
					<svg width="12" height="12" viewBox="0 0 12 12" fill="none">
						<line x1="3" y1="3" x2="9" y2="9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
						<line x1="9" y1="3" x2="3" y2="9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
					</svg>
				</button>
			</div>
		{/each}
	</div>
{/if}

<style>
	.toast-container {
		position: fixed;
		top: 16px;
		right: 16px;
		z-index: 200;
		display: flex;
		flex-direction: column;
		gap: 8px;
		max-width: 380px;
	}

	.toast {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		padding: 10px 12px;
		border-radius: var(--radius);
		border: 1px solid var(--border);
		background-color: var(--bg-card);
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
		animation: slideIn 0.2s ease;
		font-size: 0.8125rem;
		line-height: 1.4;
		color: var(--text-primary);
	}

	.toast-success {
		border-left: 3px solid var(--success);
	}

	.toast-success .toast-icon {
		color: var(--success);
	}

	.toast-error {
		border-left: 3px solid var(--error);
	}

	.toast-error .toast-icon {
		color: var(--error);
	}

	.toast-warning {
		border-left: 3px solid var(--warning);
	}

	.toast-warning .toast-icon {
		color: var(--warning);
	}

	.toast-info {
		border-left: 3px solid var(--accent);
	}

	.toast-info .toast-icon {
		color: var(--accent);
	}

	.toast-icon {
		display: flex;
		align-items: center;
		flex-shrink: 0;
		margin-top: 1px;
	}

	.toast-message {
		flex: 1;
		word-break: break-word;
	}

	.toast-close {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		flex-shrink: 0;
		color: var(--text-secondary);
		background: none;
		border: none;
		border-radius: var(--radius-sm);
		cursor: pointer;
		opacity: 0.5;
		transition: opacity var(--transition), background-color var(--transition);
	}

	.toast-close:hover {
		opacity: 1;
		background-color: rgba(255, 255, 255, 0.06);
	}

	@keyframes slideIn {
		from {
			opacity: 0;
			transform: translateX(20px);
		}
		to {
			opacity: 1;
			transform: translateX(0);
		}
	}
</style>
