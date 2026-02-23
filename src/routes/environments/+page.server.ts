import type { PageServerLoad } from './$types';
import { listEnvironments, syncEnvironmentStatuses } from '$lib/server/environments';
import { authenticate } from '$lib/server/proxmox';

export const load: PageServerLoad = async () => {
	let proxmoxConnected = false;

	try {
		await authenticate();
		proxmoxConnected = true;

		// Sync live statuses from Proxmox when reachable
		await syncEnvironmentStatuses();
	} catch {
		// Proxmox unreachable — serve stale statuses from DB
		proxmoxConnected = false;
	}

	const environments = await listEnvironments();

	return {
		environments,
		proxmoxConnected
	};
};
