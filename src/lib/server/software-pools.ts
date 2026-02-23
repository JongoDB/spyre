import { v4 as uuid } from 'uuid';
import { getDb } from './db';
import type {
  SoftwarePool,
  SoftwarePoolWithItems,
  SoftwarePoolItem,
  SoftwarePoolInput,
  SoftwarePoolItemInput
} from '$lib/types/template';

export function listPools(): SoftwarePool[] {
  const db = getDb();
  return db.prepare('SELECT * FROM software_pools ORDER BY name ASC').all() as SoftwarePool[];
}

export function listPoolsWithItemCounts(): Array<SoftwarePool & { item_count: number; usage_count: number }> {
  const db = getDb();
  return db.prepare(`
    SELECT sp.*,
      (SELECT COUNT(*) FROM software_pool_items WHERE pool_id = sp.id) as item_count,
      (SELECT COUNT(*) FROM template_software_pools WHERE pool_id = sp.id) as usage_count
    FROM software_pools sp
    ORDER BY sp.name ASC
  `).all() as Array<SoftwarePool & { item_count: number; usage_count: number }>;
}

export function getPool(id: string): SoftwarePoolWithItems | undefined {
  const db = getDb();
  const pool = db.prepare('SELECT * FROM software_pools WHERE id = ?').get(id) as SoftwarePool | undefined;
  if (!pool) return undefined;

  const items = db.prepare(
    'SELECT * FROM software_pool_items WHERE pool_id = ? ORDER BY sort_order ASC'
  ).all(id) as SoftwarePoolItem[];

  return { ...pool, items };
}

export function createPool(input: SoftwarePoolInput): SoftwarePoolWithItems {
  const db = getDb();
  const id = uuid();

  const existing = db.prepare('SELECT id FROM software_pools WHERE name = ?').get(input.name);
  if (existing) {
    throw { code: 'DUPLICATE_NAME', message: `Software pool '${input.name}' already exists.` };
  }

  const insertPool = db.prepare(`
    INSERT INTO software_pools (id, name, description)
    VALUES (?, ?, ?)
  `);

  const insertItem = db.prepare(`
    INSERT INTO software_pool_items (id, pool_id, sort_order, item_type, content, destination, label, post_command)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  db.transaction(() => {
    insertPool.run(id, input.name, input.description ?? null);

    if (input.items) {
      for (let i = 0; i < input.items.length; i++) {
        const item = input.items[i];
        insertItem.run(
          uuid(),
          id,
          item.sort_order ?? i,
          item.item_type,
          item.content,
          item.destination ?? null,
          item.label ?? null,
          item.post_command ?? null
        );
      }
    }
  })();

  return getPool(id) as SoftwarePoolWithItems;
}

export function updatePool(id: string, input: Partial<SoftwarePoolInput>): SoftwarePoolWithItems {
  const db = getDb();
  const existing = getPool(id);
  if (!existing) {
    throw { code: 'NOT_FOUND', message: 'Software pool not found.' };
  }

  if (input.name && input.name !== existing.name) {
    const dupe = db.prepare('SELECT id FROM software_pools WHERE name = ? AND id != ?').get(input.name, id);
    if (dupe) {
      throw { code: 'DUPLICATE_NAME', message: `Software pool '${input.name}' already exists.` };
    }
  }

  db.prepare(`
    UPDATE software_pools
    SET name = ?, description = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    input.name ?? existing.name,
    input.description !== undefined ? input.description ?? null : existing.description,
    id
  );

  // If items are provided, replace all items
  if (input.items !== undefined) {
    const deleteItems = db.prepare('DELETE FROM software_pool_items WHERE pool_id = ?');
    const insertItem = db.prepare(`
      INSERT INTO software_pool_items (id, pool_id, sort_order, item_type, content, destination, label, post_command)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    db.transaction(() => {
      deleteItems.run(id);
      for (let i = 0; i < input.items!.length; i++) {
        const item = input.items![i];
        insertItem.run(
          uuid(),
          id,
          item.sort_order ?? i,
          item.item_type,
          item.content,
          item.destination ?? null,
          item.label ?? null,
          item.post_command ?? null
        );
      }
    })();
  }

  return getPool(id) as SoftwarePoolWithItems;
}

export function deletePool(id: string): void {
  const db = getDb();
  const existing = getPool(id);
  if (!existing) {
    throw { code: 'NOT_FOUND', message: 'Software pool not found.' };
  }

  const usage = db.prepare('SELECT COUNT(*) as count FROM template_software_pools WHERE pool_id = ?').get(id) as { count: number };
  if (usage.count > 0) {
    throw { code: 'IN_USE', message: `Cannot delete pool '${existing.name}' — it is used by ${usage.count} template(s).` };
  }

  db.transaction(() => {
    db.prepare('DELETE FROM software_pool_items WHERE pool_id = ?').run(id);
    db.prepare('DELETE FROM software_pools WHERE id = ?').run(id);
  })();
}

export function addItem(poolId: string, input: SoftwarePoolItemInput): SoftwarePoolItem {
  const db = getDb();
  const pool = getPool(poolId);
  if (!pool) {
    throw { code: 'NOT_FOUND', message: 'Software pool not found.' };
  }

  const id = uuid();
  const maxOrder = db.prepare(
    'SELECT MAX(sort_order) as max_order FROM software_pool_items WHERE pool_id = ?'
  ).get(poolId) as { max_order: number | null };

  const sortOrder = input.sort_order ?? (maxOrder.max_order != null ? maxOrder.max_order + 1 : 0);

  db.prepare(`
    INSERT INTO software_pool_items (id, pool_id, sort_order, item_type, content, destination, label, post_command)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, poolId, sortOrder, input.item_type, input.content, input.destination ?? null, input.label ?? null, input.post_command ?? null);

  // Update pool timestamp
  db.prepare("UPDATE software_pools SET updated_at = datetime('now') WHERE id = ?").run(poolId);

  return db.prepare('SELECT * FROM software_pool_items WHERE id = ?').get(id) as SoftwarePoolItem;
}

export function removeItem(itemId: string): void {
  const db = getDb();
  const item = db.prepare('SELECT * FROM software_pool_items WHERE id = ?').get(itemId) as SoftwarePoolItem | undefined;
  if (!item) {
    throw { code: 'NOT_FOUND', message: 'Software pool item not found.' };
  }

  db.prepare('DELETE FROM software_pool_items WHERE id = ?').run(itemId);
  db.prepare("UPDATE software_pools SET updated_at = datetime('now') WHERE id = ?").run(item.pool_id);
}

export function reorderItems(poolId: string, itemIds: string[]): void {
  const db = getDb();
  const pool = getPool(poolId);
  if (!pool) {
    throw { code: 'NOT_FOUND', message: 'Software pool not found.' };
  }

  const update = db.prepare('UPDATE software_pool_items SET sort_order = ? WHERE id = ? AND pool_id = ?');

  db.transaction(() => {
    for (let i = 0; i < itemIds.length; i++) {
      update.run(i, itemIds[i], poolId);
    }
    db.prepare("UPDATE software_pools SET updated_at = datetime('now') WHERE id = ?").run(poolId);
  })();
}
