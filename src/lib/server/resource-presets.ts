import { v4 as uuid } from 'uuid';
import { getDb } from './db';
import type { ResourcePreset, ResourcePresetInput } from '$lib/types/template';

export function listPresets(): ResourcePreset[] {
  const db = getDb();
  return db.prepare('SELECT * FROM resource_presets ORDER BY cores ASC, memory ASC').all() as ResourcePreset[];
}

export function getPreset(id: string): ResourcePreset | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM resource_presets WHERE id = ?').get(id) as ResourcePreset | undefined;
}

export function createPreset(input: ResourcePresetInput): ResourcePreset {
  const db = getDb();
  const id = uuid();

  const existing = db.prepare('SELECT id FROM resource_presets WHERE name = ?').get(input.name);
  if (existing) {
    throw { code: 'DUPLICATE_NAME', message: `Resource preset '${input.name}' already exists.` };
  }

  db.prepare(`
    INSERT INTO resource_presets (id, name, description, cores, memory, swap, disk)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, input.name, input.description ?? null, input.cores, input.memory, input.swap ?? 0, input.disk);

  return getPreset(id) as ResourcePreset;
}

export function updatePreset(id: string, input: Partial<ResourcePresetInput>): ResourcePreset {
  const db = getDb();
  const existing = getPreset(id);
  if (!existing) {
    throw { code: 'NOT_FOUND', message: 'Resource preset not found.' };
  }

  if (input.name && input.name !== existing.name) {
    const dupe = db.prepare('SELECT id FROM resource_presets WHERE name = ? AND id != ?').get(input.name, id);
    if (dupe) {
      throw { code: 'DUPLICATE_NAME', message: `Resource preset '${input.name}' already exists.` };
    }
  }

  db.prepare(`
    UPDATE resource_presets
    SET name = ?, description = ?, cores = ?, memory = ?, swap = ?, disk = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    input.name ?? existing.name,
    input.description !== undefined ? input.description ?? null : existing.description,
    input.cores ?? existing.cores,
    input.memory ?? existing.memory,
    input.swap ?? existing.swap,
    input.disk ?? existing.disk,
    id
  );

  return getPreset(id) as ResourcePreset;
}

export function deletePreset(id: string): void {
  const db = getDb();
  const existing = getPreset(id);
  if (!existing) {
    throw { code: 'NOT_FOUND', message: 'Resource preset not found.' };
  }

  // Check if any templates reference this preset
  const usage = db.prepare('SELECT COUNT(*) as count FROM templates WHERE resource_preset_id = ?').get(id) as { count: number };
  if (usage.count > 0) {
    throw { code: 'IN_USE', message: `Cannot delete preset '${existing.name}' — it is used by ${usage.count} template(s).` };
  }

  db.prepare('DELETE FROM resource_presets WHERE id = ?').run(id);
}
