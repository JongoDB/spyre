<script lang="ts">
	import '../app.css';
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();

	interface NavItem {
		href: string;
		label: string;
		icon: string;
	}

	const navItems: NavItem[] = [
		{ href: '/', label: 'Dashboard', icon: 'dashboard' },
		{ href: '/environments', label: 'Environments', icon: 'environments' },
		{ href: '/settings', label: 'Settings', icon: 'settings' }
	];

	let currentPath = $state('');

	$effect(() => {
		currentPath = window.location.pathname;

		const handleNav = () => {
			currentPath = window.location.pathname;
		};

		window.addEventListener('popstate', handleNav);
		return () => window.removeEventListener('popstate', handleNav);
	});

	function isActive(href: string): boolean {
		if (href === '/') return currentPath === '/';
		return currentPath.startsWith(href);
	}
</script>

<div class="app-shell">
	<aside class="sidebar">
		<div class="sidebar-header">
			<a href="/" class="logo">
				<span class="logo-icon">&#9670;</span>
				<span class="logo-text">SPYRE</span>
			</a>
		</div>

		<nav class="sidebar-nav">
			{#each navItems as item (item.href)}
				<a
					href={item.href}
					class="nav-link"
					class:active={isActive(item.href)}
					onclick={() => (currentPath = item.href)}
				>
					<span class="nav-icon">
						{#if item.icon === 'dashboard'}
							<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<rect x="3" y="3" width="7" height="7" rx="1" />
								<rect x="14" y="3" width="7" height="7" rx="1" />
								<rect x="3" y="14" width="7" height="7" rx="1" />
								<rect x="14" y="14" width="7" height="7" rx="1" />
							</svg>
						{:else if item.icon === 'environments'}
							<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<rect x="2" y="6" width="20" height="12" rx="2" />
								<path d="M6 10h.01" />
								<path d="M10 10h.01" />
								<path d="M14 10h.01" />
							</svg>
						{:else if item.icon === 'settings'}
							<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
								<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
								<circle cx="12" cy="12" r="3" />
							</svg>
						{/if}
					</span>
					<span class="nav-label">{item.label}</span>
				</a>
			{/each}
		</nav>

		<div class="sidebar-footer">
			<span class="version-tag">v0.1.0</span>
		</div>
	</aside>

	<main class="main-content">
		{@render children()}
	</main>
</div>

<style>
	.app-shell {
		display: flex;
		min-height: 100vh;
	}

	/* ---- Sidebar ---- */

	.sidebar {
		width: var(--sidebar-width);
		min-width: var(--sidebar-width);
		background-color: var(--bg-secondary);
		border-right: 1px solid var(--border);
		display: flex;
		flex-direction: column;
		position: fixed;
		top: 0;
		left: 0;
		bottom: 0;
		z-index: 100;
	}

	.sidebar-header {
		padding: 20px 20px 16px;
		border-bottom: 1px solid var(--border);
	}

	.logo {
		display: flex;
		align-items: center;
		gap: 10px;
		color: var(--text-primary);
		text-decoration: none;
	}

	.logo-icon {
		font-size: 1.25rem;
		color: var(--accent);
	}

	.logo-text {
		font-size: 1rem;
		font-weight: 700;
		letter-spacing: 0.15em;
	}

	.sidebar-nav {
		flex: 1;
		padding: 12px 10px;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.nav-link {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 9px 12px;
		border-radius: var(--radius-sm);
		color: var(--text-secondary);
		font-size: 0.875rem;
		font-weight: 500;
		transition:
			background-color var(--transition),
			color var(--transition);
		text-decoration: none;
	}

	.nav-link:hover {
		background-color: rgba(255, 255, 255, 0.04);
		color: var(--text-primary);
	}

	.nav-link.active {
		background-color: rgba(99, 102, 241, 0.1);
		color: var(--accent);
	}

	.nav-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
	}

	.nav-label {
		line-height: 1;
	}

	.sidebar-footer {
		padding: 14px 20px;
		border-top: 1px solid var(--border);
	}

	.version-tag {
		font-size: 0.6875rem;
		color: var(--text-secondary);
		opacity: 0.5;
		font-family: 'SF Mono', 'Fira Code', 'Fira Mono', monospace;
	}

	/* ---- Main content ---- */

	.main-content {
		flex: 1;
		margin-left: var(--sidebar-width);
		padding: 32px 40px;
		min-height: 100vh;
	}

	/* ---- Responsive ---- */

	@media (max-width: 768px) {
		.sidebar {
			width: 60px;
			min-width: 60px;
		}

		.logo-text,
		.nav-label,
		.version-tag {
			display: none;
		}

		.sidebar-header {
			padding: 20px 14px 16px;
			display: flex;
			justify-content: center;
		}

		.sidebar-nav {
			padding: 12px 6px;
		}

		.nav-link {
			justify-content: center;
			padding: 10px;
		}

		.main-content {
			margin-left: 60px;
			padding: 24px 20px;
		}
	}
</style>
