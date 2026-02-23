import { v4 as uuid } from 'uuid';
import { getDb } from './db';
import type { Category, CategoryInput } from '$lib/types/template';

export function listCategories(): Category[] {
  const db = getDb();
  return db.prepare('SELECT * FROM categories ORDER BY sort_order ASC, name ASC').all() as Category[];
}

export function getCategory(id: string): Category | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM categories WHERE id = ?').get(id) as Category | undefined;
}

export function createCategory(input: CategoryInput): Category {
  const db = getDb();
  const id = `cat-${uuid().slice(0, 8)}`;

  const existing = db.prepare('SELECT id FROM categories WHERE name = ?').get(input.name);
  if (existing) {
    throw { code: 'DUPLICATE_NAME', message: `Category '${input.name}' already exists.` };
  }

  db.prepare(`
    INSERT INTO categories (id, name, description, icon, sort_order)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, input.name, input.description ?? null, input.icon ?? null, input.sort_order ?? 0);

  return getCategory(id) as Category;
}

export function updateCategory(id: string, input: Partial<CategoryInput>): Category {
  const db = getDb();
  const existing = getCategory(id);
  if (!existing) {
    throw { code: 'NOT_FOUND', message: 'Category not found.' };
  }

  if (input.name && input.name !== existing.name) {
    const dupe = db.prepare('SELECT id FROM categories WHERE name = ? AND id != ?').get(input.name, id);
    if (dupe) {
      throw { code: 'DUPLICATE_NAME', message: `Category '${input.name}' already exists.` };
    }
  }

  db.prepare(`
    UPDATE categories
    SET name = ?, description = ?, icon = ?, sort_order = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    input.name ?? existing.name,
    input.description !== undefined ? input.description ?? null : existing.description,
    input.icon !== undefined ? input.icon ?? null : existing.icon,
    input.sort_order ?? existing.sort_order,
    id
  );

  return getCategory(id) as Category;
}

export function deleteCategory(id: string): void {
  const db = getDb();
  const existing = getCategory(id);
  if (!existing) {
    throw { code: 'NOT_FOUND', message: 'Category not found.' };
  }

  const usage = db.prepare('SELECT COUNT(*) as count FROM templates WHERE category_id = ?').get(id) as { count: number };
  if (usage.count > 0) {
    throw { code: 'IN_USE', message: `Cannot delete category '${existing.name}' — it is used by ${usage.count} template(s).` };
  }

  db.prepare('DELETE FROM categories WHERE id = ?').run(id);
}

