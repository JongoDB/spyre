import Database from 'better-sqlite3';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { getEnvConfig } from './env-config';

let _db: Database.Database | null = null;

function applyMigrations(db: Database.Database): void {
  // Add template_id column to environments if missing
  const cols = db.pragma('table_info(environments)') as Array<{ name: string }>;
  const hasTemplateId = cols.some(c => c.name === 'template_id');
  if (!hasTemplateId) {
    db.exec('ALTER TABLE environments ADD COLUMN template_id TEXT');
  }

  // Ensure Phase 3 tables exist (safe to re-run due to IF NOT EXISTS)
  const phase3Tables = ['resource_presets', 'network_profiles', 'software_pools',
    'software_pool_items', 'templates', 'template_software_pools', 'community_scripts_cache'];
  for (const table of phase3Tables) {
    const exists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
    ).get(table);
    if (!exists) {
      // Re-apply full schema to pick up new tables
      const schemaPath = resolve(process.cwd(), 'schema.sql');
      if (existsSync(schemaPath)) {
        const schema = readFileSync(schemaPath, 'utf-8');
        db.exec(schema);
      }
      break;
    }
  }
}

function initializeDb(): Database.Database {
  const config = getEnvConfig();
  const dbPath = resolve(process.cwd(), config.controller.db_path);

  // Ensure data directory exists
  const dbDir = dirname(dbPath);
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }

  const db = new Database(dbPath);

  // Enable WAL mode and foreign keys
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Apply schema if tables don't exist
  const tableCheck = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='environments'"
  ).get();

  if (!tableCheck) {
    const schemaPath = resolve(process.cwd(), 'schema.sql');
    if (existsSync(schemaPath)) {
      const schema = readFileSync(schemaPath, 'utf-8');
      db.exec(schema);
    } else {
      throw new Error(`schema.sql not found at ${schemaPath}. Cannot initialize database.`);
    }
  }

  // Run migrations for existing databases
  applyMigrations(db);

  return db;
}

export function getDb(): Database.Database {
  if (!_db) {
    _db = initializeDb();
  }
  return _db;
}
