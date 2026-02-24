import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadRawConfig, saveConfigFromForm } from '$lib/server/config-store';
import { yamlToFormData, formDataToYaml } from '$lib/server/config-form';
import type { ConfigFormData } from '$lib/server/config-form';

/**
 * GET /api/configs/[...name]/form — Get a config as structured form data.
 */
export const GET: RequestHandler = async ({ params }) => {
	const name = params.name;
	if (!name) {
		return json({ code: 'BAD_REQUEST', message: 'Config name is required.' }, { status: 400 });
	}

	try {
		const raw = loadRawConfig(name);
		const formData = yamlToFormData(raw);
		return json(formData);
	} catch (err: unknown) {
		const e = err as { code?: string; message?: string };
		if (e.code === 'NOT_FOUND') {
			return json({ code: 'NOT_FOUND', message: e.message }, { status: 404 });
		}
		return json({ code: 'PARSE_ERROR', message: e.message ?? 'Failed to parse config.' }, { status: 400 });
	}
};

/**
 * POST /api/configs/[...name]/form — Save a config from form data.
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const name = params.name;
	if (!name) {
		return json({ code: 'BAD_REQUEST', message: 'Config name is required.' }, { status: 400 });
	}

	try {
		const formData = await request.json() as ConfigFormData;
		const result = saveConfigFromForm(name, formData);

		if (!result.valid) {
			return json({
				code: 'VALIDATION_ERROR',
				message: result.errors.map(e => e.message).join('; '),
				errors: result.errors,
				warnings: result.warnings
			}, { status: 400 });
		}

		return json({ ok: true, warnings: result.warnings });
	} catch (err: unknown) {
		const e = err as { code?: string; message?: string };
		return json({ code: e.code ?? 'SAVE_ERROR', message: e.message ?? 'Failed to save config.' }, { status: 500 });
	}
};
