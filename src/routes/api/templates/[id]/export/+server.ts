import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getTemplateWithRelations } from '$lib/server/templates';
import { templateToYamlConfig, yamlConfigToString } from '$lib/server/config-converter';

export const GET: RequestHandler = async ({ params }) => {
	try {
		const template = getTemplateWithRelations(params.id);
		if (!template) {
			throw error(404, 'Template not found');
		}

		const config = templateToYamlConfig(template);
		const yamlText = yamlConfigToString(config);

		return new Response(yamlText, {
			headers: {
				'Content-Type': 'text/yaml; charset=utf-8',
				'Content-Disposition': `inline; filename="${template.name.replace(/[^a-zA-Z0-9_-]/g, '-')}.yaml"`
			}
		});
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		const e = err as { code?: string; message?: string };
		if (e.code === 'NOT_FOUND') throw error(404, e.message ?? 'Template not found');
		throw error(500, e.message ?? 'Failed to export template');
	}
};
