import { v4 as uuid } from 'uuid';
import { getDb } from './db';
import type { Persona, PersonaInput } from '$lib/types/persona';

export function listPersonas(): Persona[] {
  const db = getDb();
  return db.prepare('SELECT * FROM personas ORDER BY name ASC').all() as Persona[];
}

export function getPersona(id: string): Persona | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM personas WHERE id = ?').get(id) as Persona | undefined;
}

export function createPersona(input: PersonaInput): Persona {
  const db = getDb();
  const id = uuid();

  const existing = db.prepare('SELECT id FROM personas WHERE name = ?').get(input.name);
  if (existing) {
    throw { code: 'DUPLICATE_NAME', message: `Persona '${input.name}' already exists.` };
  }

  if (!input.name || !input.name.trim()) {
    throw { code: 'VALIDATION_ERROR', message: 'Persona name is required.' };
  }
  if (!input.role || !input.role.trim()) {
    throw { code: 'VALIDATION_ERROR', message: 'Persona role is required.' };
  }

  db.prepare(`
    INSERT INTO personas (id, name, role, avatar, description, instructions)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.name.trim(),
    input.role.trim(),
    input.avatar ?? '🤖',
    input.description ?? null,
    input.instructions ?? ''
  );

  return getPersona(id) as Persona;
}

export function updatePersona(id: string, input: Partial<PersonaInput>): Persona {
  const db = getDb();
  const existing = getPersona(id);
  if (!existing) {
    throw { code: 'NOT_FOUND', message: 'Persona not found.' };
  }

  if (input.name && input.name !== existing.name) {
    const dupe = db.prepare('SELECT id FROM personas WHERE name = ? AND id != ?').get(input.name, id);
    if (dupe) {
      throw { code: 'DUPLICATE_NAME', message: `Persona '${input.name}' already exists.` };
    }
  }

  db.prepare(`
    UPDATE personas
    SET name = ?, role = ?, avatar = ?, description = ?, instructions = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    input.name?.trim() ?? existing.name,
    input.role?.trim() ?? existing.role,
    input.avatar ?? existing.avatar,
    input.description !== undefined ? (input.description ?? null) : existing.description,
    input.instructions ?? existing.instructions,
    id
  );

  return getPersona(id) as Persona;
}

export function deletePersona(id: string): void {
  const db = getDb();
  const existing = getPersona(id);
  if (!existing) {
    throw { code: 'NOT_FOUND', message: 'Persona not found.' };
  }

  // Check if any environments reference this persona
  const usage = db.prepare('SELECT COUNT(*) as count FROM environments WHERE persona_id = ?').get(id) as { count: number };
  if (usage.count > 0) {
    throw { code: 'IN_USE', message: `Cannot delete persona '${existing.name}' — it is assigned to ${usage.count} environment(s).` };
  }

  db.prepare('DELETE FROM personas WHERE id = ?').run(id);
}

export function getPersonaUsageCounts(): Record<string, number> {
  const db = getDb();
  const rows = db.prepare(
    'SELECT persona_id, COUNT(*) as count FROM environments WHERE persona_id IS NOT NULL GROUP BY persona_id'
  ).all() as Array<{ persona_id: string; count: number }>;

  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.persona_id] = row.count;
  }
  return counts;
}
