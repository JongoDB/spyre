import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveConfig } from '$lib/server/config-store';
import { yamlConfigToTemplateInput, yamlConfigToSoftwarePoolItems } from '$lib/server/config-converter';
import { createTemplate } from '$lib/server/templates';
import { v4 as uuid } from 'uuid';
import { getDb } from '$lib/server/db';

/**
 * Generate a unique name by appending a suffix if the name already exists.
 */
function uniqueName(baseName: string, table: string, column: string): string {
	const db = getDb();
	const exists = (n: string) =>
		!!db.prepare(`SELECT 1 FROM ${table} WHERE ${column} = ?`).get(n);

	if (!exists(baseName)) return baseName;

	for (let i = 2; i <= 100; i++) {
		const candidate = `${baseName} (${i})`;
		if (!exists(candidate)) return candidate;
	}

	// Fallback: append random suffix
	return `${baseName} (${uuid().slice(0, 6)})`;
}

export const POST: RequestHandler = async ({ params }) => {
	try {
		// Resolve inheritance
		const resolved = resolveConfig(params.name);

		// Convert to template input
		const templateInput = yamlConfigToTemplateInput(resolved);

		// Build software pool if there are provision items
		const poolItems = yamlConfigToSoftwarePoolItems(resolved);
		let poolIds: string[] | undefined;

		if (poolItems.length > 0) {
			const db = getDb();
			const poolId = uuid();
			const poolName = uniqueName(
				`${resolved.metadata.name} (from config)`,
				'software_pools',
				'name'
			);

			db.prepare(`
				INSERT INTO software_pools (id, name, description)
				VALUES (?, ?, ?)
			`).run(poolId, poolName, `Auto-created from YAML config '${params.name}'`);

			const insertItem = db.prepare(`
				INSERT INTO software_pool_items (id, pool_id, sort_order, item_type, content, destination, label, post_command)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			`);

			for (const item of poolItems) {
				insertItem.run(
					uuid(), poolId, item.sort_order,
					item.item_type, item.content,
					item.destination ?? null,
					item.label ?? null,
					item.post_command ?? null
				);
			}

			poolIds = [poolId];
		}

		// Ensure template name is unique
		templateInput.name = uniqueName(templateInput.name, 'templates', 'name');

		// Create the template
		const template = createTemplate({
			...templateInput,
			software_pool_ids: poolIds,
		});

		return json(template, { status: 201 });
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		const e = err as { code?: string; message?: string };
		if (e.code === 'NOT_FOUND') throw error(404, e.message ?? 'Config not found');
		if (e.code === 'INVALID_CONFIG') throw error(422, e.message ?? 'Invalid config');
		if (e.code === 'DUPLICATE_NAME') throw error(409, e.message ?? 'Template with this name already exists');
		if (e.code === 'CIRCULAR_REF') throw error(422, e.message ?? 'Circular reference in extends chain');
		throw error(500, e.message ?? 'Failed to import config');
	}
};
