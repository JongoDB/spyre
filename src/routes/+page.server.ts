import type { PageServerLoad } from './$types';
import { listEnvironments } from '$lib/server/environments';
import { authenticate } from '$lib/server/proxmox';
import { getEnvConfig } from '$lib/server/env-config';

export const load: PageServerLoad = async () => {
	const environments = listEnvironments();

	const counts = {
		total: environments.length,
		running: environments.filter((e) => e.status === 'running').length,
		stopped: environments.filter((e) => e.status === 'stopped').length,
		error: environments.filter((e) => e.status === 'error').length,
		provisioning: environments.filter((e) => e.status === 'provisioning').length
	};

	let proxmoxConnected = false;
	let proxmoxHost = '';

	try {
		const config = getEnvConfig();
		proxmoxHost = config.proxmox.host;
		await authenticate();
		proxmoxConnected = true;
	} catch {
		proxmoxConnected = false;
	}

	return {
		counts,
		proxmoxConnected,
		proxmoxHost,
		recentEnvironments: environments.slice(0, 5)
	};
};
