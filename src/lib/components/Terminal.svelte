<script lang="ts">
	import { onMount, onDestroy } from 'svelte';

	interface Props {
		envId: string;
		windowIndex?: number;
		active?: boolean;
		onconnected?: (windowIndex: number) => void;
		ondisconnected?: (reason: string) => void;
		onerror?: (message: string) => void;
	}

	let {
		envId,
		windowIndex = 0,
		active = true,
		onconnected,
		ondisconnected,
		onerror
	}: Props = $props();

	let containerEl: HTMLDivElement;
	let term: import('@xterm/xterm').Terminal | null = null;
	let fitAddon: import('@xterm/addon-fit').FitAddon | null = null;
	let ws: WebSocket | null = null;
	let resizeObserver: ResizeObserver | null = null;
	let reconnectAttempts = 0;
	const maxReconnectAttempts = 3;
	let disconnected = $state(false);
	let connecting = $state(true);
	let errorMsg = $state('');

	async function initTerminal() {
		const { Terminal } = await import('@xterm/xterm');
		const { FitAddon } = await import('@xterm/addon-fit');
		await import('@xterm/xterm/css/xterm.css');

		term = new Terminal({
			cursorBlink: true,
			fontSize: 14,
			fontFamily: "'SF Mono', 'Fira Code', 'Fira Mono', 'Cascadia Code', Menlo, monospace",
			theme: {
				background: '#0f1117',
				foreground: '#e4e4e7',
				cursor: '#6366f1',
				selectionBackground: '#6366f140',
				black: '#1a1d27',
				red: '#ef4444',
				green: '#22c55e',
				yellow: '#f59e0b',
				blue: '#6366f1',
				magenta: '#a855f7',
				cyan: '#06b6d4',
				white: '#e4e4e7',
				brightBlack: '#71717a',
				brightRed: '#f87171',
				brightGreen: '#4ade80',
				brightYellow: '#fbbf24',
				brightBlue: '#818cf8',
				brightMagenta: '#c084fc',
				brightCyan: '#22d3ee',
				brightWhite: '#fafafa'
			},
			allowProposedApi: true
		});

		fitAddon = new FitAddon();
		term.loadAddon(fitAddon);

		// Try WebGL renderer, fall back silently
		try {
			const { WebglAddon } = await import('@xterm/addon-webgl');
			const webgl = new WebglAddon();
			webgl.onContextLoss(() => webgl.dispose());
			term.loadAddon(webgl);
		} catch {
			// WebGL not available — canvas renderer is fine
		}

		term.open(containerEl);
		fitAddon.fit();

		// Handle terminal input → WebSocket
		term.onData((data: string) => {
			if (ws?.readyState === WebSocket.OPEN) {
				ws.send(data);
			}
		});

		// Watch for container resizes
		resizeObserver = new ResizeObserver(() => {
			if (active && fitAddon && term) {
				fitAddon.fit();
				if (ws?.readyState === WebSocket.OPEN) {
					ws.send(JSON.stringify({
						type: 'resize',
						cols: term.cols,
						rows: term.rows
					}));
				}
			}
		});
		resizeObserver.observe(containerEl);

		connect();
	}

	function connect() {
		if (ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) {
			return;
		}

		connecting = true;
		disconnected = false;
		errorMsg = '';

		const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
		const cols = term?.cols ?? 80;
		const rows = term?.rows ?? 24;
		const url = `${protocol}//${window.location.host}/api/terminal/${envId}?windowIndex=${windowIndex}&cols=${cols}&rows=${rows}`;

		ws = new WebSocket(url);
		ws.binaryType = 'arraybuffer';

		ws.onopen = () => {
			reconnectAttempts = 0;
		};

		ws.onmessage = (event: MessageEvent) => {
			if (event.data instanceof ArrayBuffer) {
				// Binary terminal output
				term?.write(new Uint8Array(event.data));
			} else if (typeof event.data === 'string') {
				// JSON control message
				try {
					const msg = JSON.parse(event.data);
					switch (msg.type) {
						case 'connected':
							connecting = false;
							disconnected = false;
							onconnected?.(msg.windowIndex ?? windowIndex);
							break;
						case 'disconnected':
							disconnected = true;
							connecting = false;
							ondisconnected?.(msg.reason ?? 'Connection closed');
							break;
						case 'error':
							errorMsg = msg.message ?? 'Unknown error';
							connecting = false;
							onerror?.(errorMsg);
							break;
					}
				} catch {
					// Plain text data from server
					term?.write(event.data);
				}
			}
		};

		ws.onclose = () => {
			if (!disconnected && reconnectAttempts < maxReconnectAttempts) {
				reconnectAttempts++;
				const delay = Math.min(1000 * Math.pow(2, reconnectAttempts - 1), 5000);
				disconnected = true;
				connecting = false;
				setTimeout(() => connect(), delay);
			} else {
				disconnected = true;
				connecting = false;
			}
		};

		ws.onerror = () => {
			// onclose will fire after this
		};
	}

	function cleanup() {
		resizeObserver?.disconnect();
		if (ws) {
			ws.onclose = null;
			ws.onerror = null;
			ws.onmessage = null;
			ws.close();
			ws = null;
		}
		term?.dispose();
		term = null;
		fitAddon = null;
	}

	onMount(() => {
		initTerminal();
	});

	onDestroy(() => {
		cleanup();
	});

	// Re-fit when active state changes
	$effect(() => {
		if (active && fitAddon && term) {
			// Small delay to ensure container is visible
			setTimeout(() => fitAddon?.fit(), 50);
		}
	});
</script>

<div class="terminal-wrapper" class:inactive={!active}>
	<div class="terminal-container" bind:this={containerEl}></div>

	{#if connecting}
		<div class="terminal-overlay">
			<div class="overlay-content">
				<div class="spinner"></div>
				<span>Connecting...</span>
			</div>
		</div>
	{/if}

	{#if disconnected && !connecting}
		<div class="terminal-overlay">
			<div class="overlay-content">
				<span class="overlay-icon">&#9888;</span>
				<span>Disconnected</span>
				{#if reconnectAttempts < maxReconnectAttempts}
					<span class="overlay-sub">Reconnecting...</span>
				{:else}
					<button class="btn btn-secondary btn-sm" onclick={() => { reconnectAttempts = 0; connect(); }}>
						Reconnect
					</button>
				{/if}
			</div>
		</div>
	{/if}

	{#if errorMsg}
		<div class="terminal-overlay error">
			<div class="overlay-content">
				<span class="overlay-icon">&#10060;</span>
				<span>{errorMsg}</span>
			</div>
		</div>
	{/if}
</div>

<style>
	.terminal-wrapper {
		position: relative;
		width: 100%;
		height: 100%;
		min-height: 200px;
		background-color: #0f1117;
		border-radius: var(--radius-sm);
		overflow: hidden;
	}

	.terminal-wrapper.inactive {
		display: none;
	}

	.terminal-container {
		width: 100%;
		height: 100%;
	}

	.terminal-container :global(.xterm) {
		padding: 8px;
		height: 100%;
	}

	.terminal-overlay {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		background-color: rgba(15, 17, 23, 0.85);
		z-index: 10;
	}

	.terminal-overlay.error {
		background-color: rgba(15, 17, 23, 0.9);
	}

	.overlay-content {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		color: var(--text-secondary);
		font-size: 0.875rem;
	}

	.overlay-icon {
		font-size: 1.5rem;
	}

	.overlay-sub {
		font-size: 0.75rem;
		opacity: 0.7;
	}

	.spinner {
		width: 24px;
		height: 24px;
		border: 2px solid var(--border);
		border-top-color: var(--accent);
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}
</style>
