import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getSoftware, resolveInstructionsForOs } from '$lib/server/software-repo';
import { generatePreview } from '$lib/server/provisioner';

export const POST: RequestHandler = async ({ params, request }) => {
	const entry = getSoftware(params.id);
	if (!entry) {
		throw error(404, 'Software entry not found');
	}

	const body = await request.json();
	const targetOs = body.os_family ?? 'apt';

	const items = resolveInstructionsForOs([params.id], targetOs);
	const preview = generatePreview(items, targetOs);

	return json({ software: entry.name, os_family: targetOs, commands: preview });
};
