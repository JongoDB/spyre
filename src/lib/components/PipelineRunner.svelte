<script lang="ts">
	import { onMount, onDestroy, untrack } from 'svelte';
	import type { PipelineWithSteps, PipelineStepWithContext } from '$lib/types/pipeline';
	import PipelineGateReview from './PipelineGateReview.svelte';
	import PipelineStepActivity from './PipelineStepActivity.svelte';
	import { addToast } from '$lib/stores/toast.svelte';

	interface Props {
		pipelineId: string;
		onBack: () => void;
		onRefresh: () => void;
		onClone?: (pipelineId: string) => void;
	}

	let { pipelineId, onBack, onRefresh, onClone }: Props = $props();

	let pipeline = $state<PipelineWithSteps | null>(null);
	let loading = $state(true);
	let cancelling = $state(false);
	let expandedSteps = $state<Set<string>>(new Set());
	let savingTemplate = $state(false);
	let templateName = $state('');
	let showSaveTemplate = $state(false);

	// Detected services after pipeline completion
	let detectedServices = $state<Array<{ port: number; name: string; status: string }>>([]);
	let scanningServices = $state(false);

	// Pipeline-level elapsed timer
	let pipelineElapsed = $state(0);
	let pipelineTimerInterval: ReturnType<typeof setInterval> | null = null;

	// Event log for pipeline-level observability
	let eventLog = $state<Array<{ time: string; message: string; type: string }>>([]);
	let showEventLog = $state(false);

	let eventSource: EventSource | null = null;

	const groupedSteps = $derived(() => {
		if (!pipeline?.steps) return [];
		const groups: Array<{ position: number; steps: PipelineStepWithContext[] }> = [];
		for (const s of pipeline.steps) {
			const existing = groups.find(g => g.position === s.position);
			if (existing) { existing.steps.push(s); }
			else { groups.push({ position: s.position, steps: [s] }); }
		}
		groups.sort((a, b) => a.position - b.position);
		return groups;
	});

	// Progress stats
	const progressStats = $derived(() => {
		if (!pipeline?.steps) return { completed: 0, total: 0, running: 0, waiting: 0, failed: 0 };
		const steps = pipeline.steps;
		return {
			completed: steps.filter(s => s.status === 'completed' || s.status === 'skipped').length,
			total: steps.length,
			running: steps.filter(s => s.status === 'running').length,
			waiting: steps.filter(s => s.status === 'waiting').length,
			failed: steps.filter(s => s.status === 'error').length
		};
	});

	const progressPercent = $derived(() => {
		const stats = progressStats();
		if (stats.total === 0) return 0;
		return Math.round((stats.completed / stats.total) * 100);
	});

	// Auto-expand running and waiting steps
	// Use untrack() on expandedSteps to avoid read+write infinite loop
	$effect(() => {
		if (!pipeline?.steps) return;
		const activeIds = pipeline.steps
			.filter(s => s.status === 'running' || s.status === 'waiting')
			.map(s => s.id);
		if (activeIds.length > 0) {
			const current = untrack(() => expandedSteps);
			expandedSteps = new Set([...current, ...activeIds]);
		}
	});

	async function loadPipeline() {
		try {
			const res = await fetch(`/api/pipelines/${pipelineId}`);
			if (res.ok) pipeline = await res.json();
		} catch { /* ignore */ }
		loading = false;

		// Fetch services when pipeline is completed
		if (pipeline?.status === 'completed' && detectedServices.length === 0) {
			await fetchServices();
		}
	}

	async function fetchServices() {
		if (!pipeline?.env_id) return;
		try {
			const res = await fetch(`/api/environments/${pipeline.env_id}/services`);
			if (res.ok) {
				const services = await res.json();
				detectedServices = services.filter((s: { status: string }) => s.status === 'up');
			}
		} catch { /* ignore */ }
	}

	async function scanServices() {
		if (!pipeline?.env_id || scanningServices) return;
		scanningServices = true;
		try {
			const res = await fetch(`/api/environments/${pipeline.env_id}/services`, { method: 'POST' });
			if (res.ok) {
				const services = await res.json();
				detectedServices = services.filter((s: { status: string }) => s.status === 'up');
			}
		} catch { /* ignore */ }
		finally { scanningServices = false; }
	}

	function connectSSE() {
		eventSource = new EventSource(`/api/pipelines/${pipelineId}/stream`);
		eventSource.onmessage = (msgEvent) => {
			// Parse event data and add to log
			try {
				const data = JSON.parse(msgEvent.data);
				const event = data.event ?? 'update';
				let message = event;
				const type = event;

				// Build human-readable messages
				switch (event) {
					case 'started': message = 'Pipeline started'; break;
					case 'completed': message = 'Pipeline completed'; break;
					case 'failed': message = `Pipeline failed${data.error ? ': ' + data.error : ''}`; break;
					case 'cancelled': message = 'Pipeline cancelled'; break;
					case 'paused': message = 'Pipeline paused — waiting for review'; break;
					case 'step_started': message = `Step "${data.label}" started`; break;
					case 'step_completed': message = `Step "${data.label}" completed${data.cost ? ' ($' + Number(data.cost).toFixed(4) + ')' : ''}`; break;
					case 'step_error': message = `Step "${data.label}" failed${data.error ? ': ' + data.error : ''}`; break;
					case 'step_skipped': message = `Step "${data.label}" skipped`; break;
					case 'step_retried': message = `Step "${data.label}" retrying`; break;
					case 'gate_waiting': message = `Gate "${data.label}" waiting for review`; break;
					case 'gate_decided': message = `Gate decided: ${data.action}${data.feedback ? ' — "' + data.feedback + '"' : ''}`; break;
				}

				eventLog = [...eventLog, { time: new Date().toLocaleTimeString(), message, type }];
			} catch { /* ignore parse errors */ }

			// Reload pipeline data on any event
			loadPipeline();
		};
		eventSource.onerror = () => {
			// Will auto-reconnect
		};
	}

	function startPipelineTimer() {
		if (pipelineTimerInterval) return;
		pipelineTimerInterval = setInterval(() => {
			if (pipeline?.started_at) {
				pipelineElapsed = Math.floor((Date.now() - parseUtc(pipeline.started_at).getTime()) / 1000);
			}
		}, 1000);
	}

	function stopPipelineTimer() {
		if (pipelineTimerInterval) {
			clearInterval(pipelineTimerInterval);
			pipelineTimerInterval = null;
		}
	}

	// Start/stop pipeline timer based on status
	$effect(() => {
		if (pipeline?.status === 'running' || pipeline?.status === 'paused') {
			startPipelineTimer();
		} else {
			stopPipelineTimer();
			if (pipeline?.started_at && pipeline?.completed_at) {
				pipelineElapsed = Math.floor(
					(parseUtc(pipeline.completed_at).getTime() - parseUtc(pipeline.started_at).getTime()) / 1000
				);
			}
		}
	});

	// Polling fallback: refresh every 5s while pipeline is active (SSE may lag or disconnect)
	let pollTimer: ReturnType<typeof setInterval> | null = null;

	$effect(() => {
		if (pipeline?.status === 'running' || pipeline?.status === 'paused') {
			if (!pollTimer) {
				pollTimer = setInterval(() => loadPipeline(), 5000);
			}
		} else {
			if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
		}
	});

	onMount(() => {
		loadPipeline();
		connectSSE();
	});

	onDestroy(() => {
		eventSource?.close();
		eventSource = null;
		stopPipelineTimer();
		if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
		if (stepTimerInterval) { clearInterval(stepTimerInterval); stepTimerInterval = null; }
	});

	function toggleStep(stepId: string) {
		const next = new Set(expandedSteps);
		if (next.has(stepId)) next.delete(stepId);
		else next.add(stepId);
		expandedSteps = next;
	}

	async function startPipeline() {
		try {
			const res = await fetch(`/api/pipelines/${pipelineId}/start`, { method: 'POST' });
			if (res.ok) {
				addToast('Pipeline started', 'success');
				await loadPipeline();
			} else {
				const body = await res.json().catch(() => ({}));
				addToast(body.message ?? 'Failed to start', 'error');
			}
		} catch { addToast('Network error', 'error'); }
	}

	async function cancelPipeline() {
		cancelling = true;
		try {
			const res = await fetch(`/api/pipelines/${pipelineId}/cancel`, { method: 'POST' });
			if (res.ok) {
				addToast('Pipeline cancelled', 'success');
				await loadPipeline();
				onRefresh();
			} else {
				const body = await res.json().catch(() => ({}));
				addToast(body.message ?? 'Failed to cancel', 'error');
			}
		} catch { addToast('Network error', 'error'); }
		finally { cancelling = false; }
	}

	async function deletePipeline() {
		try {
			const res = await fetch(`/api/pipelines/${pipelineId}`, { method: 'DELETE' });
			if (res.ok) {
				addToast('Pipeline deleted', 'success');
				onRefresh();
				onBack();
			} else {
				const body = await res.json().catch(() => ({}));
				addToast(body.message ?? 'Failed to delete', 'error');
			}
		} catch { addToast('Network error', 'error'); }
	}

	async function runAgain() {
		if (!pipeline) return;
		try {
			const res = await fetch('/api/pipelines', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					env_id: pipeline.env_id,
					name: `${pipeline.name} (retry)`,
					description: pipeline.description,
					auto_approve: pipeline.auto_approve || undefined,
					steps: pipeline.steps.map(s => ({
						position: s.position, type: s.type, label: s.label,
						devcontainer_id: s.devcontainer_id, persona_id: s.persona_id,
						prompt_template: s.prompt_template, gate_instructions: s.gate_instructions,
						max_retries: s.max_retries,
						timeout_ms: s.timeout_ms || undefined
					}))
				})
			});
			if (res.ok) {
				const newPipeline = await res.json();
				// Immediately start
				await fetch(`/api/pipelines/${newPipeline.id}/start`, { method: 'POST' });
				addToast('Pipeline cloned and started', 'success');
				onRefresh();
				if (onClone) onClone(newPipeline.id);
			} else {
				const body = await res.json().catch(() => ({}));
				addToast(body.message ?? 'Failed to run again', 'error');
			}
		} catch { addToast('Network error', 'error'); }
	}

	async function clonePipeline() {
		if (!pipeline) return;
		try {
			const res = await fetch('/api/pipelines', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					env_id: pipeline.env_id,
					name: `${pipeline.name} (copy)`,
					description: pipeline.description,
					auto_approve: pipeline.auto_approve || undefined,
					steps: pipeline.steps.map(s => ({
						position: s.position, type: s.type, label: s.label,
						devcontainer_id: s.devcontainer_id, persona_id: s.persona_id,
						prompt_template: s.prompt_template, gate_instructions: s.gate_instructions,
						max_retries: s.max_retries,
						timeout_ms: s.timeout_ms || undefined
					}))
				})
			});
			if (res.ok) {
				const newPipeline = await res.json();
				addToast('Pipeline cloned', 'success');
				onRefresh();
				if (onClone) onClone(newPipeline.id);
			} else {
				const body = await res.json().catch(() => ({}));
				addToast(body.message ?? 'Failed to clone', 'error');
			}
		} catch { addToast('Network error', 'error'); }
	}

	async function skipStep(stepId: string) {
		try {
			const res = await fetch(`/api/pipelines/${pipelineId}/steps/${stepId}/skip`, { method: 'POST' });
			if (res.ok) { addToast('Step skipped', 'success'); await loadPipeline(); }
			else { const body = await res.json().catch(() => ({})); addToast(body.message ?? 'Failed to skip', 'error'); }
		} catch { addToast('Network error', 'error'); }
	}

	async function retryStep(stepId: string) {
		try {
			const res = await fetch(`/api/pipelines/${pipelineId}/steps/${stepId}/retry`, { method: 'POST' });
			if (res.ok) { addToast('Step retrying', 'success'); await loadPipeline(); }
			else { const body = await res.json().catch(() => ({})); addToast(body.message ?? 'Failed to retry', 'error'); }
		} catch { addToast('Network error', 'error'); }
	}

	async function saveAsTemplate() {
		if (!templateName.trim()) return;
		savingTemplate = true;
		try {
			const res = await fetch('/api/pipeline-templates', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					name: templateName.trim(),
					description: pipeline?.description ?? null,
					env_id: pipeline?.env_id ?? null,
					steps: (pipeline?.steps ?? []).map(s => ({
						position: s.position, type: s.type, label: s.label,
						devcontainer_id: s.devcontainer_id, persona_id: s.persona_id,
						prompt_template: s.prompt_template, gate_instructions: s.gate_instructions,
						max_retries: s.max_retries
					}))
				})
			});
			if (res.ok) { addToast('Template saved', 'success'); showSaveTemplate = false; }
			else { const body = await res.json().catch(() => ({})); addToast(body.message ?? 'Failed to save', 'error'); }
		} catch { addToast('Network error', 'error'); }
		finally { savingTemplate = false; }
	}

	function statusColor(status: string): string {
		switch (status) {
			case 'completed': return 'var(--success)';
			case 'running': return 'var(--accent)';
			case 'error': return 'var(--error)';
			case 'waiting': return 'var(--warning)';
			case 'skipped': case 'cancelled': return 'var(--text-secondary)';
			default: return 'var(--border)';
		}
	}

	function formatElapsed(secs: number): string {
		if (secs < 60) return `${secs}s`;
		const min = Math.floor(secs / 60);
		if (min < 60) return `${min}m ${secs % 60}s`;
		const hr = Math.floor(min / 60);
		return `${hr}h ${min % 60}m`;
	}

	/** Ensure SQLite UTC datetimes (no Z suffix) are parsed correctly */
	function parseUtc(d: string): Date {
		return new Date(d.endsWith('Z') ? d : d + 'Z');
	}

	function formatDuration(start: string | null, end: string | null): string {
		if (!start) return '';
		const s = parseUtc(start);
		const e = end ? parseUtc(end) : new Date();
		const ms = e.getTime() - s.getTime();
		const sec = Math.floor(ms / 1000);
		if (sec < 60) return `${sec}s`;
		const min = Math.floor(sec / 60);
		return `${min}m ${sec % 60}s`;
	}

	function eventTypeColor(type: string): string {
		if (type.includes('error') || type.includes('failed')) return 'var(--error)';
		if (type.includes('completed') || type === 'completed') return 'var(--success)';
		if (type.includes('started') || type === 'started') return 'var(--accent)';
		if (type.includes('gate') || type.includes('paused')) return 'var(--warning)';
		return 'var(--text-secondary)';
	}

	// === Active step banner ===
	const activeSteps = $derived(() => {
		if (!pipeline?.steps) return [];
		return pipeline.steps.filter(s => s.status === 'running' || s.status === 'waiting');
	});

	// Live-ticking elapsed time for running steps
	let stepElapsedMap = $state<Record<string, number>>({});
	let stepTimerInterval: ReturnType<typeof setInterval> | null = null;

	$effect(() => {
		const active = activeSteps();
		const hasRunning = active.some(s => s.status === 'running');
		if (hasRunning && !stepTimerInterval) {
			stepTimerInterval = setInterval(() => {
				const map: Record<string, number> = {};
				for (const s of activeSteps()) {
					if (s.started_at) {
						map[s.id] = Math.floor((Date.now() - parseUtc(s.started_at).getTime()) / 1000);
					}
				}
				stepElapsedMap = map;
			}, 1000);
		} else if (!hasRunning && stepTimerInterval) {
			clearInterval(stepTimerInterval);
			stepTimerInterval = null;
		}
	});

	// Auto-show event log when pipeline is active
	$effect(() => {
		if ((pipeline?.status === 'running' || pipeline?.status === 'paused') && eventLog.length > 0) {
			showEventLog = true;
		}
	});
</script>

{#if loading}
	<div class="loading">Loading pipeline...</div>
{:else if !pipeline}
	<div class="loading">Pipeline not found.</div>
{:else}
	<div class="runner">
		<!-- Header -->
		<div class="runner-header">
			<div class="header-left">
				<button class="back-btn" onclick={onBack} title="Back to list">
					<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>
				</button>
				<div class="header-info">
					<div class="header-title-row">
						<h3>{pipeline.name}</h3>
						<span class="pipeline-status" style="color: {statusColor(pipeline.status)}">{pipeline.status}</span>
						{#if pipeline.auto_approve}
							<span class="mode-badge auto">Hands-off</span>
						{/if}
					</div>
					{#if pipeline.description}
						<span class="header-desc">{pipeline.description}</span>
					{/if}
				</div>
			</div>
			<div class="header-actions">
				{#if pipelineElapsed > 0}
					<span class="stat-badge elapsed-badge">{formatElapsed(pipelineElapsed)}</span>
				{/if}
				{#if pipeline.total_cost_usd > 0}
					<span class="stat-badge cost-badge">${pipeline.total_cost_usd.toFixed(4)}</span>
				{/if}
				{#if pipeline.status === 'draft' || pipeline.status === 'failed'}
					<button class="btn btn-sm btn-primary" onclick={startPipeline}>
						{pipeline.status === 'failed' ? 'Restart' : 'Start'}
					</button>
				{/if}
				{#if pipeline.status === 'completed' || pipeline.status === 'failed' || pipeline.status === 'cancelled'}
					<button class="btn btn-sm btn-primary" onclick={runAgain}>Run Again</button>
				{/if}
				{#if pipeline.status === 'running' || pipeline.status === 'paused'}
					<button class="btn btn-sm btn-danger" disabled={cancelling} onclick={cancelPipeline}>
						{cancelling ? 'Cancelling...' : 'Cancel'}
					</button>
				{/if}
				<button class="btn btn-sm btn-secondary" onclick={clonePipeline} title="Clone as new draft">Clone</button>
				{#if pipeline.status === 'draft' || pipeline.status === 'completed' || pipeline.status === 'failed' || pipeline.status === 'cancelled'}
					<button class="btn btn-sm btn-secondary" onclick={deletePipeline}>Delete</button>
				{/if}
				<button class="btn btn-sm btn-secondary" onclick={() => { templateName = pipeline?.name ?? ''; showSaveTemplate = !showSaveTemplate; }}>
					Save Template
				</button>
			</div>
		</div>

		<!-- Progress bar -->
		{#if pipeline.status !== 'draft'}
			<div class="progress-section">
				<div class="progress-bar-track">
					<div class="progress-bar-fill" style="width: {progressPercent()}%"></div>
				</div>
				<div class="progress-stats">
					<span class="progress-label">{progressStats().completed}/{progressStats().total} steps</span>
					{#if progressStats().running > 0}
						<span class="progress-tag running">{progressStats().running} running</span>
					{/if}
					{#if progressStats().waiting > 0}
						<span class="progress-tag waiting">{progressStats().waiting} awaiting review</span>
					{/if}
					{#if progressStats().failed > 0}
						<span class="progress-tag failed">{progressStats().failed} failed</span>
					{/if}
				</div>
			</div>
		{/if}

		<!-- Completion summary — visible when pipeline finishes -->
		{#if pipeline.status === 'completed' || pipeline.status === 'failed' || pipeline.status === 'cancelled'}
			<div class="completion-summary" class:success={pipeline.status === 'completed'} class:failure={pipeline.status === 'failed'}>
				<div class="completion-header">
					<span class="completion-icon">
						{#if pipeline.status === 'completed'}
							<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
						{:else if pipeline.status === 'failed'}
							<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
						{:else}
							<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
						{/if}
					</span>
					<div class="completion-title">
						<strong>Pipeline {pipeline.status}</strong>
						<span class="completion-stats">
							{formatElapsed(pipelineElapsed)}
							{#if pipeline.total_cost_usd > 0}
								&middot; ${pipeline.total_cost_usd.toFixed(4)}
							{/if}
							&middot; {progressStats().completed}/{progressStats().total} steps
						</span>
					</div>
				</div>
				{#each pipeline.steps.filter(s => s.result_summary && s.status === 'completed') as step (step.id)}
					<div class="completion-step">
						<div class="completion-step-header">
							<span class="completion-step-badge" class:gate={step.type === 'gate'}>{step.type}</span>
							<span class="completion-step-label">{step.label}</span>
							{#if step.cost_usd}
								<span class="completion-step-cost">${step.cost_usd.toFixed(4)}</span>
							{/if}
						</div>
						<pre class="completion-step-result">{step.result_summary}</pre>
					</div>
				{/each}
				{#if detectedServices.length > 0}
					<div class="completion-services">
						<span class="completion-services-title">Detected Services</span>
						<div class="completion-services-list">
							{#each detectedServices as svc (svc.port)}
								<a
									href="/preview/{pipeline.env_id}/{svc.port}"
									target="_blank"
									rel="noopener noreferrer"
									class="service-link"
								>
									<span class="service-name">{svc.name}</span>
									<code>:{svc.port}</code>
									<span class="service-open">Open Preview</span>
								</a>
							{/each}
						</div>
					</div>
				{:else if pipeline.status === 'completed'}
					<div class="completion-services">
						<button class="btn btn-sm btn-secondary" onclick={scanServices} disabled={scanningServices}>
							{scanningServices ? 'Scanning...' : 'Scan for Services'}
						</button>
					</div>
				{/if}
				<div class="completion-hint">
					Check the environment terminal for file changes, or review git log for commits made during the pipeline.
				</div>
			</div>
		{/if}

		<!-- Active step banner — prominent "what's happening now" -->
		{#if activeSteps().length > 0}
			<div class="active-banner">
				{#each activeSteps() as astep (astep.id)}
					<div class="active-banner-item" class:gate={astep.status === 'waiting'}>
						<div class="active-banner-indicator">
							{#if astep.status === 'running'}
								<div class="active-spinner"></div>
							{:else}
								<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
							{/if}
						</div>
						<div class="active-banner-text">
							<span class="active-banner-label">
								{#if astep.status === 'running'}
									Running: <strong>{astep.label}</strong>
								{:else}
									Waiting for review: <strong>{astep.label}</strong>
								{/if}
							</span>
							<span class="active-banner-meta">
								{#if astep.persona_name}
									{astep.persona_avatar ?? ''} {astep.persona_name}
								{/if}
								{#if astep.status === 'running' && stepElapsedMap[astep.id] != null}
									<span class="active-elapsed">{formatElapsed(stepElapsedMap[astep.id])}</span>
								{/if}
							</span>
						</div>
					</div>
				{/each}
			</div>
		{/if}

		{#if pipeline.error_message}
			<div class="error-bar">{pipeline.error_message}</div>
		{/if}

		{#if showSaveTemplate}
			<div class="save-template-bar">
				<input class="form-input" bind:value={templateName} placeholder="Template name" />
				<button class="btn btn-sm btn-primary" onclick={saveAsTemplate} disabled={savingTemplate || !templateName.trim()}>
					{savingTemplate ? 'Saving...' : 'Save'}
				</button>
				<button class="btn btn-sm btn-secondary" onclick={() => showSaveTemplate = false}>Cancel</button>
			</div>
		{/if}

		<!-- Timeline -->
		<div class="timeline">
			{#each groupedSteps() as group (group.position)}
				<div class="timeline-group" class:parallel={group.steps.length > 1}>
					<div class="timeline-position">
						<div class="position-line"></div>
						<div class="position-dot" style="border-color: {statusColor(group.steps[0].status)}"></div>
						<span class="position-num">{group.position}</span>
					</div>
					<div class="timeline-steps">
						{#each group.steps as step (step.id)}
							<div class="step-card" class:expanded={expandedSteps.has(step.id)} class:step-running={step.status === 'running'} class:step-waiting={step.status === 'waiting'}>
								<button class="step-header" onclick={() => toggleStep(step.id)}>
									<div class="step-status-indicator" style="background: {statusColor(step.status)}">
										{#if step.status === 'running'}
											<div class="pulse"></div>
										{/if}
									</div>
									<div class="step-info">
										<div class="step-top">
											<span class="step-type-badge" class:gate={step.type === 'gate'}>{step.type}</span>
											<span class="step-label">{step.label}</span>
										</div>
										<div class="step-meta">
											{#if step.persona_name}
												<span class="step-persona">{step.persona_avatar ?? ''} {step.persona_name}</span>
											{/if}
											{#if step.devcontainer_service}
												<span class="step-dc">{step.devcontainer_service}</span>
											{/if}
											<span class="step-status-text" style="color: {statusColor(step.status)}">
												{step.type === 'gate' && step.gate_feedback === 'Auto-approved (hands-off mode)' ? 'auto-approved' : step.status}
											</span>
											{#if step.cost_usd}
												<span class="step-cost">${step.cost_usd.toFixed(4)}</span>
											{/if}
											{#if step.status === 'running' && stepElapsedMap[step.id] != null}
												<span class="step-duration live">{formatElapsed(stepElapsedMap[step.id])}</span>
											{:else if step.started_at}
												<span class="step-duration">{formatDuration(step.started_at, step.completed_at)}</span>
											{/if}
											{#if step.iteration > 0}
												<span class="step-iteration">rev #{step.iteration}</span>
											{/if}
										</div>
									</div>
									<svg class="expand-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
								</button>

								<!-- Live activity feed for running agent steps; expandable for completed/error -->
								{#if step.task_id && step.type === 'agent' && (step.status === 'running' || (expandedSteps.has(step.id) && (step.status === 'completed' || step.status === 'error')))}
									<PipelineStepActivity taskId={step.task_id} compact={step.status === 'running'} />
								{/if}

								{#if expandedSteps.has(step.id)}
									<div class="step-detail">
										{#if step.prompt_template}
											<div class="detail-section">
												<span class="detail-label">Prompt</span>
												<pre class="detail-content">{step.prompt_template}</pre>
											</div>
										{/if}
										{#if step.result_summary}
											<div class="detail-section">
												<span class="detail-label">Result</span>
												<pre class="detail-content">{step.result_summary}</pre>
											</div>
										{/if}
										{#if step.gate_instructions}
											<div class="detail-section">
												<span class="detail-label">Gate Instructions</span>
												<pre class="detail-content">{step.gate_instructions}</pre>
											</div>
										{/if}
										{#if step.gate_feedback}
											<div class="detail-section">
												<span class="detail-label">
													{step.gate_feedback === 'Auto-approved (hands-off mode)' ? 'Auto-Approved' : 'Reviewer Feedback'}
												</span>
												<pre class="detail-content">{step.gate_feedback}</pre>
											</div>
										{/if}

										<!-- Step actions -->
										<div class="step-actions">
											{#if step.status === 'error' && pipeline.status === 'failed'}
												<button class="btn btn-sm btn-primary" onclick={() => retryStep(step.id)}>Retry Step</button>
											{/if}
											{#if step.status === 'pending' || step.status === 'waiting' || step.status === 'error'}
												<button class="btn btn-sm btn-secondary" onclick={() => skipStep(step.id)}>Skip</button>
											{/if}
										</div>
									</div>
								{/if}

								<!-- Gate review (inline, always visible for waiting gates) -->
								{#if step.type === 'gate' && step.status === 'waiting'}
									<PipelineGateReview
										{pipelineId}
										step={step}
										allSteps={pipeline.steps}
										onDecision={() => loadPipeline()}
									/>
								{/if}
							</div>
						{/each}
					</div>
				</div>
			{/each}
		</div>

		<!-- Event log -->
		{#if eventLog.length > 0}
			<div class="event-log-section">
				<button class="event-log-toggle" onclick={() => showEventLog = !showEventLog}>
					<span class="event-log-title">Event Log</span>
					<span class="event-log-count">{eventLog.length}</span>
					<svg class="event-log-chevron" class:open={showEventLog} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg>
				</button>
				{#if showEventLog}
					<div class="event-log-entries">
						{#each eventLog as entry, i (i)}
							<div class="event-log-entry">
								<span class="event-log-time">{entry.time}</span>
								<span class="event-log-dot" style="background: {eventTypeColor(entry.type)}"></span>
								<span class="event-log-msg">{entry.message}</span>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	</div>
{/if}

<style>
	.loading { text-align: center; padding: 32px; color: var(--text-secondary); }

	.runner { display: flex; flex-direction: column; gap: 12px; }
	.runner-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
	.header-left { display: flex; align-items: center; gap: 10px; }
	.back-btn {
		background: none; border: none; color: var(--text-secondary); cursor: pointer;
		padding: 4px; border-radius: var(--radius-sm); transition: color var(--transition);
	}
	.back-btn:hover { color: var(--text-primary); }
	.header-info { display: flex; flex-direction: column; gap: 2px; }
	.header-title-row { display: flex; align-items: center; gap: 10px; }
	.header-info h3 { font-size: 0.9375rem; font-weight: 600; margin: 0; }
	.header-desc { font-size: 0.75rem; color: var(--text-secondary); }
	.pipeline-status { font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; }
	.mode-badge {
		font-size: 0.625rem; font-weight: 700; text-transform: uppercase;
		padding: 2px 8px; border-radius: 8px; letter-spacing: 0.04em;
	}
	.mode-badge.auto {
		background: rgba(99,102,241,0.12); color: var(--accent);
	}
	.header-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
	.stat-badge {
		font-size: 0.75rem; color: var(--text-secondary);
		font-family: 'SF Mono', monospace; padding: 2px 8px;
		background: var(--bg-tertiary); border-radius: var(--radius-sm);
	}

	/* Progress bar */
	.progress-section { display: flex; flex-direction: column; gap: 6px; }
	.progress-bar-track {
		height: 4px; background: var(--bg-tertiary); border-radius: 2px; overflow: hidden;
	}
	.progress-bar-fill {
		height: 100%; background: var(--accent); border-radius: 2px;
		transition: width 0.4s ease;
	}
	.progress-stats { display: flex; align-items: center; gap: 10px; }
	.progress-label { font-size: 0.75rem; font-weight: 600; color: var(--text-secondary); }
	.progress-tag {
		font-size: 0.6875rem; padding: 1px 8px; border-radius: 10px;
		font-weight: 500;
	}
	.progress-tag.running { background: rgba(99,102,241,0.1); color: var(--accent); }
	.progress-tag.waiting { background: rgba(245,158,11,0.1); color: var(--warning); }
	.progress-tag.failed { background: rgba(239,68,68,0.1); color: var(--error); }

	/* Completion summary */
	.completion-summary {
		display: flex; flex-direction: column; gap: 10px;
		padding: 16px; border-radius: var(--radius-sm);
		border: 1px solid var(--border); background: var(--bg-secondary);
	}
	.completion-summary.success { border-color: rgba(34,197,94,0.3); background: rgba(34,197,94,0.04); }
	.completion-summary.failure { border-color: rgba(239,68,68,0.3); background: rgba(239,68,68,0.04); }
	.completion-header {
		display: flex; align-items: center; gap: 10px;
	}
	.completion-icon { flex-shrink: 0; display: flex; align-items: center; }
	.completion-summary.success .completion-icon { color: var(--success); }
	.completion-summary.failure .completion-icon { color: var(--error); }
	.completion-title { display: flex; flex-direction: column; gap: 2px; }
	.completion-title strong { font-size: 0.875rem; }
	.completion-stats { font-size: 0.75rem; color: var(--text-secondary); font-family: 'SF Mono', monospace; }
	.completion-step {
		display: flex; flex-direction: column; gap: 4px;
		padding: 10px 12px; background: rgba(0,0,0,0.15); border-radius: var(--radius-sm);
	}
	.completion-step-header {
		display: flex; align-items: center; gap: 8px;
	}
	.completion-step-badge {
		font-size: 0.5625rem; font-weight: 700; text-transform: uppercase;
		padding: 1px 5px; border-radius: 3px; letter-spacing: 0.04em;
		background: rgba(99,102,241,0.12); color: var(--accent);
	}
	.completion-step-badge.gate { background: rgba(245,158,11,0.12); color: var(--warning); }
	.completion-step-label { font-size: 0.8125rem; font-weight: 500; }
	.completion-step-cost { margin-left: auto; font-size: 0.6875rem; font-family: 'SF Mono', monospace; color: var(--text-secondary); }
	.completion-step-result {
		font-size: 0.75rem; font-family: 'SF Mono', monospace;
		white-space: pre-wrap; word-break: break-word;
		color: var(--text-secondary); margin: 0; line-height: 1.5;
		max-height: 150px; overflow-y: auto;
	}
	.completion-hint {
		font-size: 0.75rem; color: var(--text-secondary); font-style: italic;
		padding-top: 4px; border-top: 1px solid rgba(255,255,255,0.05);
	}
	.completion-services {
		display: flex; flex-direction: column; gap: 8px;
		padding: 10px 12px; background: rgba(99,102,241,0.04);
		border-radius: var(--radius-sm); border: 1px solid rgba(99,102,241,0.15);
	}
	.completion-services-title {
		font-size: 0.6875rem; font-weight: 600; text-transform: uppercase;
		letter-spacing: 0.04em; color: var(--accent);
	}
	.completion-services-list {
		display: flex; flex-wrap: wrap; gap: 6px;
	}
	.service-link {
		display: flex; align-items: center; gap: 6px;
		padding: 6px 12px; border-radius: var(--radius-sm);
		background: rgba(99,102,241,0.08); border: 1px solid rgba(99,102,241,0.2);
		text-decoration: none; color: var(--text-primary);
		font-size: 0.8125rem; transition: background 0.15s, border-color 0.15s;
	}
	.service-link:hover {
		background: rgba(99,102,241,0.15); border-color: rgba(99,102,241,0.35);
	}
	.service-link .service-name { font-weight: 500; }
	.service-link code {
		font-size: 0.75rem; font-family: 'SF Mono', monospace;
		color: var(--text-secondary);
	}
	.service-link .service-open {
		font-size: 0.6875rem; color: var(--accent); font-weight: 600;
		margin-left: 4px;
	}

	/* Active step banner */
	.active-banner {
		display: flex; flex-direction: column; gap: 6px;
	}
	.active-banner-item {
		display: flex; align-items: center; gap: 12px;
		padding: 12px 16px; border-radius: var(--radius-sm);
		background: rgba(99,102,241,0.06); border: 1px solid rgba(99,102,241,0.2);
	}
	.active-banner-item.gate {
		background: rgba(245,158,11,0.06); border-color: rgba(245,158,11,0.2);
	}
	.active-banner-indicator {
		flex-shrink: 0; width: 20px; height: 20px;
		display: flex; align-items: center; justify-content: center;
		color: var(--warning);
	}
	.active-banner-item:not(.gate) .active-banner-indicator { color: var(--accent); }
	.active-spinner {
		width: 16px; height: 16px; border-radius: 50%;
		border: 2px solid rgba(99,102,241,0.2); border-top-color: var(--accent);
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin { to { transform: rotate(360deg); } }
	.active-banner-text {
		display: flex; flex-direction: column; gap: 2px;
	}
	.active-banner-label {
		font-size: 0.8125rem; color: var(--text-primary);
	}
	.active-banner-label strong { font-weight: 600; }
	.active-banner-meta {
		font-size: 0.75rem; color: var(--text-secondary);
		display: flex; align-items: center; gap: 10px;
	}
	.active-elapsed {
		font-family: 'SF Mono', monospace; font-size: 0.6875rem;
		background: rgba(99,102,241,0.1); padding: 1px 6px;
		border-radius: 3px; color: var(--accent);
	}

	.step-duration.live {
		color: var(--accent); font-weight: 600;
		font-family: 'SF Mono', monospace;
	}

	.error-bar {
		padding: 10px 16px; background: rgba(239,68,68,0.08); border: 1px solid rgba(239,68,68,0.2);
		border-radius: var(--radius-sm); color: var(--error); font-size: 0.8125rem;
	}

	.save-template-bar {
		display: flex; gap: 8px; align-items: center;
		padding: 10px 16px; background: var(--bg-secondary); border: 1px solid var(--border);
		border-radius: var(--radius-sm);
	}
	.save-template-bar .form-input { flex: 1; }

	/* Timeline */
	.timeline { display: flex; flex-direction: column; gap: 0; }
	.timeline-group { display: flex; gap: 16px; padding: 8px 0; }
	.timeline-position { display: flex; flex-direction: column; align-items: center; width: 32px; flex-shrink: 0; position: relative; }
	.position-line { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--border); z-index: 0; }
	.position-dot { width: 12px; height: 12px; border-radius: 50%; border: 2px solid var(--border); background: var(--bg-primary); z-index: 1; margin-top: 14px; }
	.position-num { font-size: 0.625rem; color: var(--text-secondary); font-weight: 700; margin-top: 4px; z-index: 1; }
	.timeline-steps { flex: 1; display: flex; flex-direction: column; gap: 6px; }

	.step-card {
		background: var(--bg-secondary); border: 1px solid var(--border);
		border-radius: var(--radius-sm); overflow: hidden;
	}
	.step-card.step-running {
		border-color: rgba(99,102,241,0.3);
		box-shadow: 0 0 0 1px rgba(99,102,241,0.1);
	}
	.step-card.step-waiting {
		border-color: rgba(245,158,11,0.3);
		box-shadow: 0 0 0 1px rgba(245,158,11,0.1);
	}
	.step-header {
		display: flex; align-items: center; gap: 10px; padding: 10px 14px;
		width: 100%; text-align: left; background: none; border: none;
		cursor: pointer; color: var(--text-primary); transition: background-color var(--transition);
	}
	.step-header:hover { background: rgba(255,255,255,0.02); }

	.step-status-indicator {
		width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; position: relative;
	}
	.pulse {
		position: absolute; inset: -3px; border-radius: 50%;
		border: 2px solid var(--accent); opacity: 0.5;
		animation: pulse-anim 1.5s ease-in-out infinite;
	}
	@keyframes pulse-anim { 0%, 100% { transform: scale(1); opacity: 0.5; } 50% { transform: scale(1.5); opacity: 0; } }

	.step-info { flex: 1; min-width: 0; }
	.step-top { display: flex; align-items: center; gap: 8px; }
	.step-type-badge {
		font-size: 0.625rem; font-weight: 700; text-transform: uppercase;
		padding: 1px 6px; border-radius: 3px; letter-spacing: 0.04em;
		background: rgba(99,102,241,0.1); color: var(--accent);
	}
	.step-type-badge.gate { background: rgba(245,158,11,0.1); color: var(--warning); }
	.step-label { font-size: 0.8125rem; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.step-meta { display: flex; flex-wrap: wrap; gap: 6px 12px; margin-top: 4px; }
	.step-meta > :global(*) { font-size: 0.6875rem; color: var(--text-secondary); }
	.step-persona { font-weight: 500; }
	.step-dc { font-family: 'SF Mono', monospace; font-size: 0.625rem; }
	.step-cost { font-family: 'SF Mono', monospace; }
	.step-iteration { font-weight: 600; color: var(--warning); }

	.expand-icon { flex-shrink: 0; color: var(--text-secondary); transition: transform var(--transition); }
	.step-card.expanded .expand-icon { transform: rotate(180deg); }

	.step-detail { padding: 0 14px 14px; display: flex; flex-direction: column; gap: 10px; }
	.detail-section { display: flex; flex-direction: column; gap: 4px; }
	.detail-label { font-size: 0.6875rem; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.04em; }
	.detail-content {
		font-size: 0.75rem; font-family: 'SF Mono', monospace;
		background: var(--bg-primary); padding: 8px 12px; border-radius: var(--radius-sm);
		white-space: pre-wrap; word-break: break-word; max-height: 200px; overflow-y: auto;
		margin: 0;
	}
	.step-actions { display: flex; gap: 8px; }

	/* Event log */
	.event-log-section {
		border: 1px solid var(--border); border-radius: var(--radius-sm);
		overflow: hidden;
	}
	.event-log-toggle {
		display: flex; align-items: center; gap: 8px; width: 100%;
		padding: 8px 14px; background: var(--bg-secondary);
		border: none; cursor: pointer; color: var(--text-primary);
		transition: background-color var(--transition);
	}
	.event-log-toggle:hover { background: rgba(255,255,255,0.03); }
	.event-log-title { font-size: 0.75rem; font-weight: 600; color: var(--text-secondary); text-transform: uppercase; letter-spacing: 0.04em; }
	.event-log-count {
		font-size: 0.625rem; font-weight: 700; background: var(--bg-tertiary);
		padding: 1px 6px; border-radius: 8px; color: var(--text-secondary);
	}
	.event-log-chevron { margin-left: auto; color: var(--text-secondary); transition: transform var(--transition); }
	.event-log-chevron.open { transform: rotate(180deg); }

	.event-log-entries {
		max-height: 200px; overflow-y: auto;
		border-top: 1px solid var(--border);
	}
	.event-log-entry {
		display: flex; align-items: center; gap: 8px;
		padding: 4px 14px; font-size: 0.6875rem;
		border-bottom: 1px solid rgba(255,255,255,0.02);
	}
	.event-log-entry:last-child { border-bottom: none; }
	.event-log-time { font-family: 'SF Mono', monospace; color: var(--text-secondary); flex-shrink: 0; width: 70px; }
	.event-log-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
	.event-log-msg { color: var(--text-primary); }
</style>
