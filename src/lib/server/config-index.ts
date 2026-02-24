import { createHash } from 'node:crypto';
import { getDb } from './db';
import { listConfigs, loadRawConfig } from './config-store';
import { parse as parseYaml } from 'yaml';
import { getSoftwareByName } from './software-repo';

export interface ConfigIndexEntry {
	name: string;
	kind: string | null;
	description: string | null;
	extends_name: string | null;
	os_type: string | null;
	os_template: string | null;
	labels: string | null;
	software_ids: string | null;
	has_services: number;
	has_claude: number;
	content_hash: string | null;
	modified_at: string | null;
	indexed_at: string;
}

/**
 * Rebuild the entire config index from the filesystem.
 */
export function rebuildIndex(): void {
	const db = getDb();
	const configs = listConfigs();

	db.prepare('DELETE FROM config_index').run();

	const insert = db.prepare(`
		INSERT OR REPLACE INTO config_index
			(name, kind, description, extends_name, os_type, os_template, labels, software_ids, has_services, has_claude, content_hash, modified_at, indexed_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
	`);

	db.transaction(() => {
		for (const config of configs) {
			try {
				const raw = loadRawConfig(config.name);
				const hash = createHash('sha256').update(raw).digest('hex');
				const parsed = parseYaml(raw) as Record<string, unknown>;
				const spec = (parsed?.spec ?? {}) as Record<string, unknown>;
				const platform = (spec.platform ?? {}) as Record<string, unknown>;
				const metadata = (parsed?.metadata ?? {}) as Record<string, unknown>;

				// Resolve software names to IDs
				const softwareNames = (spec.software ?? []) as string[];
				const softwareIds: string[] = [];
				for (const name of softwareNames) {
					const entry = getSoftwareByName(name);
					if (entry) softwareIds.push(entry.id);
				}

				insert.run(
					config.name,
					config.kind ?? null,
					config.description ?? null,
					config.extends ?? null,
					(platform.type as string) ?? null,
					(platform.template as string) ?? null,
					config.labels ? JSON.stringify(config.labels) : null,
					softwareIds.length > 0 ? JSON.stringify(softwareIds) : null,
					spec.services ? 1 : 0,
					spec.claude ? 1 : 0,
					hash,
					config.modifiedAt ?? null
				);
			} catch {
				// Skip configs that fail to parse
			}
		}
	})();
}

/**
 * Index a single config after save.
 */
export function indexSingleConfig(name: string): void {
	const db = getDb();

	try {
		const raw = loadRawConfig(name);
		const hash = createHash('sha256').update(raw).digest('hex');
		const parsed = parseYaml(raw) as Record<string, unknown>;
		const spec = (parsed?.spec ?? {}) as Record<string, unknown>;
		const platform = (spec.platform ?? {}) as Record<string, unknown>;
		const metadata = (parsed?.metadata ?? {}) as Record<string, unknown>;

		const softwareNames = (spec.software ?? []) as string[];
		const softwareIds: string[] = [];
		for (const swName of softwareNames) {
			const entry = getSoftwareByName(swName);
			if (entry) softwareIds.push(entry.id);
		}

		db.prepare(`
			INSERT OR REPLACE INTO config_index
				(name, kind, description, extends_name, os_type, os_template, labels, software_ids, has_services, has_claude, content_hash, modified_at, indexed_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
		`).run(
			name,
			(parsed.kind as string) ?? null,
			(metadata.description as string) ?? null,
			(parsed.extends as string) ?? null,
			(platform.type as string) ?? null,
			(platform.template as string) ?? null,
			metadata.labels ? JSON.stringify(metadata.labels) : null,
			softwareIds.length > 0 ? JSON.stringify(softwareIds) : null,
			spec.services ? 1 : 0,
			spec.claude ? 1 : 0,
			hash
		);
	} catch {
		// Remove from index if config is invalid
		removeFromIndex(name);
	}
}

/**
 * Remove a config from the index.
 */
export function removeFromIndex(name: string): void {
	const db = getDb();
	db.prepare('DELETE FROM config_index WHERE name = ?').run(name);
}

/**
 * List all indexed configs (fast DB query).
 */
export function listIndexedConfigs(): ConfigIndexEntry[] {
	const db = getDb();
	return db.prepare('SELECT * FROM config_index ORDER BY name ASC').all() as ConfigIndexEntry[];
}

/**
 * Search configs by query and filters.
 */
export function searchConfigs(query?: string, filters?: { kind?: string; osType?: string }): ConfigIndexEntry[] {
	const db = getDb();
	let sql = 'SELECT * FROM config_index WHERE 1=1';
	const params: string[] = [];

	if (query) {
		sql += ' AND (name LIKE ? OR description LIKE ?)';
		const q = `%${query}%`;
		params.push(q, q);
	}

	if (filters?.kind) {
		sql += ' AND kind = ?';
		params.push(filters.kind);
	}

	if (filters?.osType) {
		sql += ' AND os_type = ?';
		params.push(filters.osType);
	}

	sql += ' ORDER BY name ASC';

	return db.prepare(sql).all(...params) as ConfigIndexEntry[];
}
