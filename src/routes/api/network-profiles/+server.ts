import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listProfiles, createProfile } from '$lib/server/network-profiles';

export const GET: RequestHandler = async () => {
	try {
		const profiles = listProfiles();
		return json(profiles);
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		const e = err as { code?: string; message?: string };
		throw error(500, e.message ?? 'Unknown error');
	}
};

export const POST: RequestHandler = async ({ request }) => {
	let body: Record<string, unknown>;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON in request body.');
	}

	if (!body.name || typeof body.name !== 'string') {
		throw error(400, 'A valid profile name is required.');
	}

	try {
		const profile = createProfile(body as unknown as Parameters<typeof createProfile>[0]);
		return json(profile, { status: 201 });
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		const e = err as { code?: string; message?: string };
		if (e.code === 'DUPLICATE_NAME') throw error(409, e.message ?? 'A profile with that name already exists.');
		if (e.code === 'NOT_FOUND') throw error(404, e.message ?? 'Network profile not found.');
		if (e.code === 'IN_USE') throw error(409, e.message ?? 'Network profile is in use.');
		throw error(500, e.message ?? 'Unknown error');
	}
};
