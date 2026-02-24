import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getEnvironment } from '$lib/server/environments';
import { getProvisioningProgress } from '$lib/server/provisioning-log';

export const GET: RequestHandler = ({ params }) => {
	const env = getEnvironment(params.id);
	if (!env) {
		throw error(404, 'Environment not found');
	}

	const progress = getProvisioningProgress(params.id);
	return json(progress);
};
