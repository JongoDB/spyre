import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getProfile, updateProfile, deleteProfile } from '$lib/server/network-profiles';

export const GET: RequestHandler = async ({ params }) => {
	try {
		const profile = getProfile(params.id);
		if (!profile) {
			throw error(404, 'Network profile not found.');
		}
		return json(profile);
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		const e = err as { code?: string; message?: string };
		if (e.code === 'NOT_FOUND') throw error(404, e.message ?? 'Network profile not found.');
		throw error(500, e.message ?? 'Unknown error');
	}
};

export const PUT: RequestHandler = async ({ params, request }) => {
	let body: Record<string, unknown>;
	try {
		body = await request.json();
	} catch {
		throw error(400, 'Invalid JSON in request body.');
	}

	try {
		const profile = updateProfile(params.id, body as Parameters<typeof updateProfile>[1]);
		return json(profile);
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		const e = err as { code?: string; message?: string };
		if (e.code === 'DUPLICATE_NAME') throw error(409, e.message ?? 'A profile with that name already exists.');
		if (e.code === 'NOT_FOUND') throw error(404, e.message ?? 'Network profile not found.');
		if (e.code === 'IN_USE') throw error(409, e.message ?? 'Network profile is in use.');
		throw error(500, e.message ?? 'Unknown error');
	}
};

export const DELETE: RequestHandler = async ({ params }) => {
	try {
		deleteProfile(params.id);
		return new Response(null, { status: 204 });
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		const e = err as { code?: string; message?: string };
		if (e.code === 'DUPLICATE_NAME') throw error(409, e.message ?? 'A profile with that name already exists.');
		if (e.code === 'NOT_FOUND') throw error(404, e.message ?? 'Network profile not found.');
		if (e.code === 'IN_USE') throw error(409, e.message ?? 'Network profile is in use.');
		throw error(500, e.message ?? 'Unknown error');
	}
};
