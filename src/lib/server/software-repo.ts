import { v4 as uuid } from 'uuid';
import { getDb } from './db';
import type {
	SoftwareEntry,
	SoftwareEntryWithInstructions,
	SoftwareEntryWithCounts,
	SoftwareInstruction,
	SoftwareEntryInput,
	SoftwareInstructionInput
} from '$lib/types/software-repo';
import type { SoftwarePoolItem } from '$lib/types/template';

export function listSoftware(): SoftwareEntryWithCounts[] {
	const db = getDb();
	return db.prepare(`
		SELECT sr.*,
			(SELECT COUNT(*) FROM software_repo_instructions WHERE software_id = sr.id) as instruction_count,
			(SELECT COUNT(*) FROM template_software WHERE software_id = sr.id) as usage_count
		FROM software_repo sr
		ORDER BY sr.name ASC
	`).all() as SoftwareEntryWithCounts[];
}

export function getSoftware(id: string): SoftwareEntryWithInstructions | undefined {
	const db = getDb();
	const entry = db.prepare('SELECT * FROM software_repo WHERE id = ?').get(id) as SoftwareEntry | undefined;
	if (!entry) return undefined;

	const instructions = db.prepare(
		'SELECT * FROM software_repo_instructions WHERE software_id = ? ORDER BY os_family, sort_order ASC'
	).all(id) as SoftwareInstruction[];

	return { ...entry, instructions };
}

export function getSoftwareByName(name: string): SoftwareEntryWithInstructions | undefined {
	const db = getDb();
	const entry = db.prepare('SELECT * FROM software_repo WHERE name = ?').get(name) as SoftwareEntry | undefined;
	if (!entry) return undefined;

	const instructions = db.prepare(
		'SELECT * FROM software_repo_instructions WHERE software_id = ? ORDER BY os_family, sort_order ASC'
	).all(entry.id) as SoftwareInstruction[];

	return { ...entry, instructions };
}

export function createSoftware(input: SoftwareEntryInput, instructions?: SoftwareInstructionInput[]): SoftwareEntryWithInstructions {
	const db = getDb();
	const id = uuid();

	const existing = db.prepare('SELECT id FROM software_repo WHERE name = ?').get(input.name);
	if (existing) {
		throw { code: 'DUPLICATE_NAME', message: `Software entry '${input.name}' already exists.` };
	}

	const insertEntry = db.prepare(`
		INSERT INTO software_repo (id, name, description, logo_url, os_families, tags, is_builtin)
		VALUES (?, ?, ?, ?, ?, ?, 0)
	`);

	const insertInstruction = db.prepare(`
		INSERT INTO software_repo_instructions (id, software_id, os_family, sort_order, item_type, content, destination, label, post_command, package_manager, interpreter, source_url, file_mode, file_owner, condition)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`);

	db.transaction(() => {
		insertEntry.run(
			id,
			input.name,
			input.description ?? null,
			input.logo_url ?? null,
			input.os_families ?? 'apt',
			input.tags ?? null
		);

		if (instructions) {
			for (let i = 0; i < instructions.length; i++) {
				const inst = instructions[i];
				insertInstruction.run(
					uuid(), id, inst.os_family, inst.sort_order ?? i,
					inst.item_type, inst.content, inst.destination ?? null,
					inst.label ?? null, inst.post_command ?? null,
					inst.package_manager ?? null, inst.interpreter ?? null,
					inst.source_url ?? null, inst.file_mode ?? null,
					inst.file_owner ?? null, inst.condition ?? null
				);
			}
		}
	})();

	return getSoftware(id) as SoftwareEntryWithInstructions;
}

export function updateSoftware(id: string, input: Partial<SoftwareEntryInput>, instructions?: SoftwareInstructionInput[]): SoftwareEntryWithInstructions {
	const db = getDb();
	const existing = getSoftware(id);
	if (!existing) {
		throw { code: 'NOT_FOUND', message: 'Software entry not found.' };
	}

	if (input.name && input.name !== existing.name) {
		const dupe = db.prepare('SELECT id FROM software_repo WHERE name = ? AND id != ?').get(input.name, id);
		if (dupe) {
			throw { code: 'DUPLICATE_NAME', message: `Software entry '${input.name}' already exists.` };
		}
	}

	db.prepare(`
		UPDATE software_repo
		SET name = ?, description = ?, logo_url = ?, os_families = ?, tags = ?, updated_at = datetime('now')
		WHERE id = ?
	`).run(
		input.name ?? existing.name,
		input.description !== undefined ? input.description ?? null : existing.description,
		input.logo_url !== undefined ? input.logo_url ?? null : existing.logo_url,
		input.os_families ?? existing.os_families,
		input.tags !== undefined ? input.tags ?? null : existing.tags,
		id
	);

	if (instructions !== undefined) {
		const deleteInstructions = db.prepare('DELETE FROM software_repo_instructions WHERE software_id = ?');
		const insertInstruction = db.prepare(`
			INSERT INTO software_repo_instructions (id, software_id, os_family, sort_order, item_type, content, destination, label, post_command, package_manager, interpreter, source_url, file_mode, file_owner, condition)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`);

		db.transaction(() => {
			deleteInstructions.run(id);
			for (let i = 0; i < instructions.length; i++) {
				const inst = instructions[i];
				insertInstruction.run(
					uuid(), id, inst.os_family, inst.sort_order ?? i,
					inst.item_type, inst.content, inst.destination ?? null,
					inst.label ?? null, inst.post_command ?? null,
					inst.package_manager ?? null, inst.interpreter ?? null,
					inst.source_url ?? null, inst.file_mode ?? null,
					inst.file_owner ?? null, inst.condition ?? null
				);
			}
		})();
	}

	return getSoftware(id) as SoftwareEntryWithInstructions;
}

export function deleteSoftware(id: string): void {
	const db = getDb();
	const existing = getSoftware(id);
	if (!existing) {
		throw { code: 'NOT_FOUND', message: 'Software entry not found.' };
	}

	if (existing.is_builtin) {
		throw { code: 'BUILTIN', message: `Cannot delete built-in software '${existing.name}'.` };
	}

	const usage = db.prepare('SELECT COUNT(*) as count FROM template_software WHERE software_id = ?').get(id) as { count: number };
	if (usage.count > 0) {
		throw { code: 'IN_USE', message: `Cannot delete '${existing.name}' — it is used by ${usage.count} config(s).` };
	}

	db.transaction(() => {
		db.prepare('DELETE FROM software_repo_instructions WHERE software_id = ?').run(id);
		db.prepare('DELETE FROM software_repo WHERE id = ?').run(id);
	})();
}

export function searchSoftware(query: string, osFamily?: string): SoftwareEntryWithCounts[] {
	const db = getDb();
	let sql = `
		SELECT sr.*,
			(SELECT COUNT(*) FROM software_repo_instructions WHERE software_id = sr.id) as instruction_count,
			(SELECT COUNT(*) FROM template_software WHERE software_id = sr.id) as usage_count
		FROM software_repo sr
		WHERE 1=1
	`;
	const params: string[] = [];

	if (query) {
		sql += ' AND (sr.name LIKE ? OR sr.description LIKE ? OR sr.tags LIKE ?)';
		const q = `%${query}%`;
		params.push(q, q, q);
	}

	if (osFamily) {
		sql += ' AND (sr.os_families LIKE ? OR sr.os_families LIKE ?)';
		params.push(`%${osFamily}%`, '%any%');
	}

	sql += ' ORDER BY sr.name ASC LIMIT 50';

	return db.prepare(sql).all(...params) as SoftwareEntryWithCounts[];
}

/**
 * At provision time, resolve the install instructions for a set of software IDs
 * filtered to the target OS family. Returns instructions in SoftwarePoolItem shape
 * for compatibility with the existing executeSoftwarePoolItem() function.
 */
export function resolveInstructionsForOs(
	softwareIds: string[],
	osFamily: 'apt' | 'apk' | 'dnf' | 'yum'
): SoftwarePoolItem[] {
	if (softwareIds.length === 0) return [];

	const db = getDb();
	const placeholders = softwareIds.map(() => '?').join(',');
	const instructions = db.prepare(`
		SELECT * FROM software_repo_instructions
		WHERE software_id IN (${placeholders})
		AND (os_family = ? OR os_family = 'any')
		ORDER BY software_id, sort_order ASC
	`).all(...softwareIds, osFamily) as SoftwareInstruction[];

	// Map to SoftwarePoolItem shape for provisioner compatibility
	return instructions.map((inst): SoftwarePoolItem => ({
		id: inst.id,
		pool_id: inst.software_id,
		sort_order: inst.sort_order,
		item_type: inst.item_type,
		content: inst.content,
		destination: inst.destination,
		label: inst.label,
		post_command: inst.post_command,
		package_manager: inst.package_manager as SoftwarePoolItem['package_manager'],
		interpreter: inst.interpreter as SoftwarePoolItem['interpreter'],
		source_url: inst.source_url,
		file_mode: inst.file_mode,
		file_owner: inst.file_owner,
		condition: inst.condition,
		created_at: inst.created_at
	}));
}
