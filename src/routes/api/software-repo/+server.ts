import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listSoftware, createSoftware } from '$lib/server/software-repo';

export const GET: RequestHandler = () => {
	const entries = listSoftware();
	return json(entries);
};

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json();

	if (!body.name) {
		return json({ code: 'VALIDATION', message: 'Name is required.' }, { status: 400 });
	}

	try {
		const entry = createSoftware(
			{
				name: body.name,
				description: body.description,
				logo_url: body.logo_url,
				os_families: body.os_families,
				tags: body.tags
			},
			body.instructions
		);
		return json(entry, { status: 201 });
	} catch (err) {
		const e = err as { code?: string; message?: string };
		if (e.code === 'DUPLICATE_NAME') {
			return json({ code: e.code, message: e.message }, { status: 409 });
		}
		return json({ code: 'INTERNAL', message: e.message ?? 'Failed to create software entry.' }, { status: 500 });
	}
};
