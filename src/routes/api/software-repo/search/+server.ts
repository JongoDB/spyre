import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { searchSoftware } from '$lib/server/software-repo';

export const GET: RequestHandler = ({ url }) => {
	const q = url.searchParams.get('q') ?? '';
	const os = url.searchParams.get('os') ?? undefined;
	const results = searchSoftware(q, os);
	return json(results);
};
