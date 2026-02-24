import { getEnvConfig } from './env-config';
import { listEnvironments, syncEnvironmentStatuses } from './environments';
import * as proxmox from './proxmox';
import { getConnection } from './ssh-pool';
import { getProvisioningProgress } from './provisioning-log';
import type { Environment } from '$lib/types/environment';
import type { ProxmoxLxc } from '$lib/types/proxmox';

export interface ResourceMetrics {
	cpuPercent: number;
	memUsed: number;
	memTotal: number;
	diskUsed: number;
	diskTotal: number;
	netIn: number;
	netOut: number;
	uptime: number;
}

export interface HealthStatus {
	state: 'healthy' | 'degraded' | 'unreachable';
	responseMs: number | null;
	lastChecked: string;
}

export interface ProvisioningLiveData {
	currentPhase: string | null;
	percentComplete: number;
	hasError: boolean;
}

export interface EnvironmentLiveData {
	id: string;
	status: string;
	ipAddress: string | null;
	resources: ResourceMetrics | null;
	health: HealthStatus | null;
	provisioning: ProvisioningLiveData | null;
}

type Subscriber = (data: EnvironmentLiveData[]) => void;

const subscribers = new Set<Subscriber>();
let pollTimer: ReturnType<typeof setInterval> | null = null;
let lastData: EnvironmentLiveData[] = [];

const POLL_INTERVAL = 30_000;
const SSH_CHECK_TIMEOUT = 3000;
const MAX_CONCURRENT_CHECKS = 5;

function lxcToMetrics(lxc: ProxmoxLxc): ResourceMetrics {
	return {
		cpuPercent: Math.round((lxc.cpu ?? 0) * 100 * 100) / 100,
		memUsed: lxc.mem,
		memTotal: lxc.maxmem,
		diskUsed: lxc.disk,
		diskTotal: lxc.maxdisk,
		netIn: lxc.netin,
		netOut: lxc.netout,
		uptime: lxc.uptime
	};
}

async function checkSshHealth(envId: string): Promise<HealthStatus> {
	const start = performance.now();
	try {
		const client = await getConnection(envId);
		const result = await new Promise<{ code: number }>((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error('timeout')), SSH_CHECK_TIMEOUT);
			client.exec('echo ok', (err, stream) => {
				if (err) {
					clearTimeout(timer);
					reject(err);
					return;
				}
				stream.on('close', (code: number) => {
					clearTimeout(timer);
					resolve({ code });
				});
				stream.on('data', () => { /* consume */ });
				stream.stderr.on('data', () => { /* consume */ });
			});
		});
		const elapsed = performance.now() - start;
		return {
			state: elapsed < 1000 ? 'healthy' : 'degraded',
			responseMs: Math.round(elapsed),
			lastChecked: new Date().toISOString()
		};
	} catch {
		return {
			state: 'unreachable',
			responseMs: null,
			lastChecked: new Date().toISOString()
		};
	}
}

async function poll(): Promise<void> {
	try {
		const config = getEnvConfig();
		const node = config.proxmox.node_name;

		// Sync statuses from Proxmox
		await syncEnvironmentStatuses();

		// Get current LXC list with resource data
		let lxcList: ProxmoxLxc[] = [];
		try {
			lxcList = await proxmox.listLxc(node);
		} catch {
			// Proxmox unreachable — return environments with no metrics
		}

		const lxcByVmid = new Map<number, ProxmoxLxc>();
		for (const lxc of lxcList) {
			lxcByVmid.set(lxc.vmid, lxc);
		}

		const environments = listEnvironments();

		// SSH health checks for running environments (throttled)
		const runningEnvs = environments.filter(
			(e) => e.status === 'running' && e.ip_address
		);

		const healthMap = new Map<string, HealthStatus>();

		// Process in batches of MAX_CONCURRENT_CHECKS
		for (let i = 0; i < runningEnvs.length; i += MAX_CONCURRENT_CHECKS) {
			const batch = runningEnvs.slice(i, i + MAX_CONCURRENT_CHECKS);
			const results = await Promise.allSettled(
				batch.map(async (env) => {
					const health = await checkSshHealth(env.id);
					return { envId: env.id, health };
				})
			);
			for (const result of results) {
				if (result.status === 'fulfilled') {
					healthMap.set(result.value.envId, result.value.health);
				}
			}
		}

		// Build live data
		lastData = environments.map((env: Environment): EnvironmentLiveData => {
			const lxc = env.vmid ? lxcByVmid.get(env.vmid) : undefined;
			const isRunning = env.status === 'running';
			const isProvisioning = env.status === 'provisioning';

			let provisioning: ProvisioningLiveData | null = null;
			if (isProvisioning) {
				const progress = getProvisioningProgress(env.id);
				provisioning = {
					currentPhase: progress.currentPhase,
					percentComplete: progress.percentComplete,
					hasError: progress.hasError
				};
			}

			return {
				id: env.id,
				status: env.status,
				ipAddress: env.ip_address,
				resources: isRunning && lxc ? lxcToMetrics(lxc) : null,
				health: isRunning ? (healthMap.get(env.id) ?? null) : null,
				provisioning
			};
		});

		// Notify all subscribers
		for (const sub of subscribers) {
			try {
				sub(lastData);
			} catch {
				// Remove broken subscribers
				subscribers.delete(sub);
			}
		}
	} catch (err) {
		console.error('[spyre] Status poller error:', err);
	}
}

function startPolling(): void {
	if (pollTimer) return;
	// Initial poll immediately
	poll();
	pollTimer = setInterval(poll, POLL_INTERVAL);
}

function stopPolling(): void {
	if (pollTimer) {
		clearInterval(pollTimer);
		pollTimer = null;
	}
}

export function subscribe(callback: Subscriber): () => void {
	subscribers.add(callback);

	// Start polling on first subscriber
	if (subscribers.size === 1) {
		startPolling();
	}

	// Send last known data immediately
	if (lastData.length > 0) {
		try {
			callback(lastData);
		} catch {
			// ignore
		}
	}

	// Return unsubscribe function
	return () => {
		subscribers.delete(callback);
		if (subscribers.size === 0) {
			stopPolling();
		}
	};
}

export function getLastData(): EnvironmentLiveData[] {
	return lastData;
}
