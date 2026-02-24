<script lang="ts">
	import { onMount } from 'svelte';

	const CANVAS_CSS_SIZE = 34;

	let canvas: HTMLCanvasElement;

	onMount(() => {
		const dpr = window.devicePixelRatio || 1;
		const size = CANVAS_CSS_SIZE * dpr;
		canvas.width = size;
		canvas.height = size;

		const ctx = canvas.getContext('2d');
		if (!ctx) return;

		ctx.scale(dpr, dpr);

		const W = CANVAS_CSS_SIZE, H = CANVAS_CSS_SIZE;
		const cx = W / 2, cy = H / 2;
		const SCALE = 38 * (CANVAS_CSS_SIZE / 160);

		// 4D Tesseract vertices
		const verts: number[][] = [];
		for (let i = 0; i < 16; i++) {
			verts.push([
				(i & 1) ? 1 : -1,
				(i & 2) ? 1 : -1,
				(i & 4) ? 1 : -1,
				(i & 8) ? 1 : -1
			]);
		}

		// Edges: connect vertices differing in exactly one coordinate
		const edges: [number, number][] = [];
		for (let i = 0; i < verts.length; i++) {
			for (let j = i + 1; j < verts.length; j++) {
				let diff = 0;
				for (let k = 0; k < 4; k++) {
					if (verts[i][k] !== verts[j][k]) diff++;
				}
				if (diff === 1) edges.push([i, j]);
			}
		}

		function rotate4D(v: number[], a1: number, a2: number, a3: number): number[] {
			let [x, y, z, w] = v;

			let c1 = Math.cos(a1), s1 = Math.sin(a1);
			let nx = x * c1 - w * s1;
			let nw = x * s1 + w * c1;
			x = nx; w = nw;

			let c2 = Math.cos(a2), s2 = Math.sin(a2);
			let ny = y * c2 - z * s2;
			let nz = y * s2 + z * c2;
			y = ny; z = nz;

			let c3 = Math.cos(a3), s3 = Math.sin(a3);
			nx = x * c3 - z * s3;
			nz = x * s3 + z * c3;
			x = nx; z = nz;

			return [x, y, z, w];
		}

		function project(v: number[]) {
			const [x, y, z, w] = v;
			const dist4D = 3, dist3D = 3;

			const f4 = dist4D / (dist4D - w);
			const x3 = x * f4, y3 = y * f4, z3 = z * f4;

			const f3 = dist3D / (dist3D - z3);
			return {
				x: x3 * f3 * SCALE + cx,
				y: y3 * f3 * SCALE + cy,
				depth: z3 + w,
				factor: f4 * f3
			};
		}

		let time = 0;
		let frame: number;

		function draw() {
			ctx.clearRect(0, 0, W, H);
			time += 0.004;

			const a1 = time * 0.7, a2 = time * 0.5, a3 = time * 0.3;

			const projected = verts.map(v => {
				const rotated = rotate4D(v, a1, a2, a3);
				return project(rotated);
			});

			const sortedEdges = edges.map(([i, j]) => ({
				i, j,
				avgDepth: (projected[i].depth + projected[j].depth) / 2
			})).sort((a, b) => a.avgDepth - b.avgDepth);

			// Draw edges
			for (const { i, j, avgDepth } of sortedEdges) {
				const p1 = projected[i], p2 = projected[j];
				const nd = (avgDepth + 3) / 6;
				const alpha = 0.15 + nd * 0.6;
				const r = Math.round(107 + nd * 32);
				const g = Math.round(92 + nd * 34);
				const b = Math.round(231 + nd * 17);

				ctx.beginPath();
				ctx.moveTo(p1.x, p1.y);
				ctx.lineTo(p2.x, p2.y);
				ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
				ctx.lineWidth = 0.8 + nd * 1.2;
				ctx.stroke();
			}

			// Draw vertices
			for (const p of projected) {
				const nd = (p.depth + 3) / 6;
				const radius = 1 + nd * 2.5;
				const alpha = 0.3 + nd * 0.7;

				// Outer glow
				ctx.beginPath();
				ctx.arc(p.x, p.y, radius * 3, 0, Math.PI * 2);
				ctx.fillStyle = `rgba(139, 126, 248, ${alpha * 0.15})`;
				ctx.fill();

				// Core dot
				ctx.beginPath();
				ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
				ctx.fillStyle = `rgba(200, 190, 255, ${alpha})`;
				ctx.fill();
			}

			// Central glow pulse
			const pulse = 0.5 + 0.5 * Math.sin(time * 3);
			const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 12 + pulse * 4);
			grad.addColorStop(0, `rgba(139, 126, 248, ${0.06 + pulse * 0.04})`);
			grad.addColorStop(1, 'transparent');
			ctx.fillStyle = grad;
			ctx.fillRect(0, 0, W, H);

			frame = requestAnimationFrame(draw);
		}

		draw();

		return () => {
			cancelAnimationFrame(frame);
		};
	});
</script>

<a href="/" class="logo">
	<div class="tesseract-wrap">
		<div class="glow-ring"></div>
		<canvas bind:this={canvas} class="tesseract-canvas"></canvas>
	</div>
	<div class="logo-text">
		<span class="logo-title">SPYRE</span>
		<span class="logo-tagline">Beyond Dimension</span>
	</div>
</a>

<style>
	@import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&display=swap');

	.logo {
		display: flex;
		align-items: center;
		gap: 10px;
		color: var(--text-primary);
		text-decoration: none;
	}

	.tesseract-wrap {
		position: relative;
		width: 34px;
		height: 34px;
		flex-shrink: 0;
	}

	.tesseract-canvas {
		display: block;
		width: 34px;
		height: 34px;
		position: relative;
		z-index: 1;
	}

	.glow-ring {
		position: absolute;
		top: 50%;
		left: 50%;
		transform: translate(-50%, -50%);
		width: 26px;
		height: 26px;
		border-radius: 50%;
		background: radial-gradient(circle, rgba(139, 126, 248, 0.12) 0%, transparent 70%);
		animation: pulseRing 3s ease-in-out infinite;
		pointer-events: none;
		z-index: 0;
	}

	@keyframes pulseRing {
		0%, 100% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
		50% { transform: translate(-50%, -50%) scale(1.4); opacity: 0.5; }
	}

	.logo-text {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.logo-title {
		font-family: 'Orbitron', sans-serif;
		font-weight: 900;
		font-size: 1.25rem;
		letter-spacing: 0.18em;
		line-height: 1;
		background: linear-gradient(135deg, #eeeef0 0%, #c4c0f0 40%, #8B7EF8 70%, #6C5CE7 100%);
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		background-clip: text;
	}

	.logo-tagline {
		font-family: 'Orbitron', sans-serif;
		font-weight: 400;
		font-size: 0.4375rem;
		letter-spacing: 0.3em;
		text-transform: uppercase;
		color: rgba(139, 126, 248, 0.4);
		line-height: 1;
		padding-left: 2px;
	}

	@media (max-width: 768px) {
		.logo-text {
			display: none;
		}
	}
</style>
