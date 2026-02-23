import Database from 'better-sqlite3';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { getEnvConfig } from './env-config';

let _db: Database.Database | null = null;

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

  return db;
}

export function getDb(): Database.Database {
  if (!_db) {
    _db = initializeDb();
  }
  return _db;
}
