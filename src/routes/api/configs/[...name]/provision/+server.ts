import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveConfig } from '$lib/server/config-store';
import { yamlConfigToTemplateInput, yamlConfigToSoftwarePoolItems } from '$lib/server/config-converter';
import { createEnvironment } from '$lib/server/environments';
import { v4 as uuid } from 'uuid';
import { getDb } from '$lib/server/db';
import type { CreateEnvironmentRequest } from '$lib/types/environment';

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

	return `${baseName} (${uuid().slice(0, 6)})`;
}

/**
 * POST /api/configs/:name/provision
 *
 * Directly provision an environment from a YAML config.
 * Resolves inheritance, creates a transient software pool + template in DB,
 * then calls createEnvironment.
 *
 * Body: { name?: string } — optional environment name override
 */
export const POST: RequestHandler = async ({ params, request }) => {
	try {
		const body = await request.json().catch(() => ({}));
		const envName = (body as { name?: string }).name?.trim();

		// 1. Resolve config with inheritance
		const resolved = resolveConfig(params.name);

		// 2. Convert to template input
		const templateInput = yamlConfigToTemplateInput(resolved);

		// 3. Build software pool if there are provision items
		const poolItems = yamlConfigToSoftwarePoolItems(resolved);
		let poolIds: string[] | undefined;

		if (poolItems.length > 0) {
			const db = getDb();
			const poolId = uuid();
			const poolName = uniqueName(
				`${resolved.metadata.name} (provisioned)`,
				'software_pools',
				'name'
			);

			db.prepare(`
				INSERT INTO software_pools (id, name, description)
				VALUES (?, ?, ?)
			`).run(poolId, poolName, `Auto-created from YAML config '${params.name}' for provisioning`);

			const insertItem = db.prepare(`
				INSERT INTO software_pool_items (id, pool_id, sort_order, item_type, content, destination, label, post_command, package_manager, interpreter, source_url, file_mode, file_owner, condition)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			`);

			for (const item of poolItems) {
				insertItem.run(
					uuid(), poolId, item.sort_order,
					item.item_type, item.content,
					item.destination ?? null,
					item.label ?? null,
					item.post_command ?? null,
					item.package_manager ?? null,
					item.interpreter ?? null,
					item.source_url ?? null,
					item.file_mode ?? null,
					item.file_owner ?? null,
					item.condition ?? null
				);
			}

			poolIds = [poolId];
		}

		// 4. Build CreateEnvironmentRequest from template input fields
		const createReq: CreateEnvironmentRequest = {
			name: envName || resolved.metadata.name,
			type: templateInput.type ?? 'lxc',
			template: templateInput.os_template ?? '',
			cores: templateInput.cores ?? 2,
			memory: templateInput.memory ?? 2048,
			disk: templateInput.disk ?? 8,
			bridge: templateInput.bridge,
			storage: templateInput.storage,
			ip: templateInput.ip_mode === 'static' ? templateInput.ip_address : undefined,
			swap: templateInput.swap,
			nameserver: templateInput.dns,
			unprivileged: templateInput.unprivileged,
			nesting: templateInput.nesting,
			ssh_enabled: templateInput.ssh_enabled,
			default_user: templateInput.default_user,
			custom_script: templateInput.custom_script,
			software_pool_ids: poolIds,
			password: templateInput.root_password ?? undefined,
		};

		// 6. Create the environment (async — returns immediately with provisioning status)
		const environment = await createEnvironment(createReq);

		return json(environment, { status: 201 });
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		const e = err as { code?: string; message?: string };
		if (e.code === 'NOT_FOUND') throw error(404, e.message ?? 'Config not found');
		if (e.code === 'INVALID_CONFIG') throw error(422, e.message ?? 'Invalid config');
		if (e.code === 'DUPLICATE_NAME') throw error(409, e.message ?? 'Environment with this name already exists');
		if (e.code === 'CIRCULAR_REF') throw error(422, e.message ?? 'Circular reference in extends chain');
		throw error(500, e.message ?? 'Failed to provision environment from config');
	}
};
