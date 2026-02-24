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
    'software_pool_items', 'templates', 'template_software_pools', 'community_scripts_cache',
    'categories'];
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

  // Add category_id column to templates if missing
  const templateCols = db.pragma('table_info(templates)') as Array<{ name: string }>;
  if (templateCols.length > 0 && !templateCols.some(c => c.name === 'category_id')) {
    db.exec('ALTER TABLE templates ADD COLUMN category_id TEXT');
  }

  // Phase 4: Claude Code integration tables
  const phase4Tables = ['claude_progress', 'claude_git_activity', 'claude_task_queue'];
  for (const table of phase4Tables) {
    const exists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
    ).get(table);
    if (!exists) {
      const schemaPath = resolve(process.cwd(), 'schema.sql');
      if (existsSync(schemaPath)) {
        const schema = readFileSync(schemaPath, 'utf-8');
        db.exec(schema);
      }
      break;
    }
  }

  // Add output column to claude_tasks if missing
  const taskCols = db.pragma('table_info(claude_tasks)') as Array<{ name: string }>;
  if (taskCols.length > 0 && !taskCols.some(c => c.name === 'output')) {
    db.exec('ALTER TABLE claude_tasks ADD COLUMN output TEXT');
  }

  // v0.9.0: Software repo, config index, template_software tables
  // Create individually to avoid re-running full schema.sql (which can cause ALTER TABLE conflicts)
  const v09Exists = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='software_repo'"
  ).get();
  if (!v09Exists) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS software_repo (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL UNIQUE,
        description TEXT,
        logo_url    TEXT,
        os_families TEXT NOT NULL DEFAULT 'apt',
        tags        TEXT,
        is_builtin  INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS software_repo_instructions (
        id              TEXT PRIMARY KEY,
        software_id     TEXT NOT NULL REFERENCES software_repo(id) ON DELETE CASCADE,
        os_family       TEXT NOT NULL DEFAULT 'any' CHECK (os_family IN ('apt','apk','dnf','yum','any')),
        sort_order      INTEGER NOT NULL DEFAULT 0,
        item_type       TEXT NOT NULL CHECK (item_type IN ('package','script','file')),
        content         TEXT NOT NULL,
        destination     TEXT,
        label           TEXT,
        post_command    TEXT,
        package_manager TEXT,
        interpreter     TEXT,
        source_url      TEXT,
        file_mode       TEXT,
        file_owner      TEXT,
        condition       TEXT,
        created_at      TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_sri_software ON software_repo_instructions(software_id, os_family, sort_order);

      CREATE TABLE IF NOT EXISTS template_software (
        template_id TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
        software_id TEXT NOT NULL REFERENCES software_repo(id) ON DELETE CASCADE,
        sort_order  INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (template_id, software_id)
      );

      CREATE TABLE IF NOT EXISTS config_index (
        name          TEXT PRIMARY KEY,
        kind          TEXT,
        description   TEXT,
        extends_name  TEXT,
        os_type       TEXT,
        os_template   TEXT,
        labels        TEXT,
        software_ids  TEXT,
        has_services  INTEGER NOT NULL DEFAULT 0,
        has_claude    INTEGER NOT NULL DEFAULT 0,
        content_hash  TEXT,
        modified_at   TEXT,
        indexed_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }

  // v0.9.0: Update provisioning_log.phase CHECK constraint to allow 'complete' and 'error'
  // SQLite doesn't support ALTER TABLE to change CHECK constraints, so we recreate the table.
  const provLogCheck = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='provisioning_log'"
  ).get() as { sql: string } | undefined;
  if (provLogCheck && !provLogCheck.sql.includes("'complete'")) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS provisioning_log_new (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        env_id      TEXT NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
        phase       TEXT NOT NULL CHECK (phase IN ('proxmox', 'helper_script', 'post_provision', 'community_script', 'software_pool', 'custom_script', 'complete', 'error')),
        step        TEXT NOT NULL,
        status      TEXT NOT NULL CHECK (status IN ('running', 'success', 'error', 'skipped')),
        output      TEXT,
        started_at  TEXT NOT NULL DEFAULT (datetime('now')),
        completed_at TEXT
      );
      INSERT OR IGNORE INTO provisioning_log_new SELECT * FROM provisioning_log;
      DROP TABLE provisioning_log;
      ALTER TABLE provisioning_log_new RENAME TO provisioning_log;
      CREATE INDEX IF NOT EXISTS idx_provisioning_log_env ON provisioning_log(env_id);
    `);
  }

  // Ensure categories are seeded (INSERT OR IGNORE is safe to re-run)
  const catCount = db.prepare('SELECT COUNT(*) as count FROM categories').get() as { count: number } | undefined;
  if (catCount && catCount.count === 0) {
    db.exec(`
      INSERT OR IGNORE INTO categories (id, name, description, icon, sort_order) VALUES
        ('cat-0',  'Miscellaneous',              'General scripts and tools',                              'more-horizontal', 99),
        ('cat-1',  'Proxmox & Virtualization',   'Manage Proxmox VE and virtualization platforms',         'server',           1),
        ('cat-2',  'Operating Systems',          'Deploy and manage various operating systems',            'monitor',          2),
        ('cat-3',  'Containers & Docker',        'Container runtimes and orchestration tools',             'box',              3),
        ('cat-4',  'Network & Firewall',         'Networking, VPN, and firewall solutions',                'shield',           4),
        ('cat-5',  'Adblock & DNS',              'DNS servers and ad-blocking solutions',                  'filter',           5),
        ('cat-6',  'Authentication & Security',  'Identity management and security tools',                 'lock',             6),
        ('cat-7',  'Backup & Recovery',          'Backup solutions and disaster recovery',                 'save',             7),
        ('cat-8',  'Databases',                  'Database engines and management tools',                  'database',         8),
        ('cat-9',  'Monitoring & Analytics',     'System monitoring and analytics platforms',              'activity',         9),
        ('cat-10', 'Dashboards & Frontends',     'Web dashboards and frontend applications',              'layout',          10),
        ('cat-11', 'Files & Downloads',          'File sharing and download management',                  'folder',          11),
        ('cat-12', 'Documents & Notes',          'Document management and note-taking',                   'file-text',       12),
        ('cat-13', 'Media & Streaming',          'Media servers and streaming platforms',                  'film',            13),
        ('cat-14', '*Arr Suite',                 'Radarr, Sonarr, and related media automation',          'star',            14),
        ('cat-15', 'NVR & Cameras',              'Network video recorders and camera systems',            'camera',          15),
        ('cat-16', 'IoT & Smart Home',           'Internet of Things and home automation',                'home',            16),
        ('cat-17', 'ZigBee, Z-Wave & Matter',    'Smart home wireless protocols and bridges',             'radio',           17),
        ('cat-18', 'MQTT & Messaging',           'Message brokers and messaging protocols',               'message-square',  18),
        ('cat-19', 'Automation & Scheduling',    'Task automation and job scheduling',                    'clock',           19),
        ('cat-20', 'AI / Coding & Dev-Tools',    'AI tools, coding environments, and developer utilities','code',            20),
        ('cat-21', 'Webservers & Proxies',       'Web servers and reverse proxy solutions',               'globe',           21),
        ('cat-22', 'Bots & ChatOps',             'Chat bots and ChatOps automation',                      'message-circle',  22),
        ('cat-23', 'Finance & Budgeting',        'Financial management and budgeting tools',              'dollar-sign',     23),
        ('cat-24', 'Gaming & Leisure',           'Game servers and entertainment platforms',              'gamepad-2',       24),
        ('cat-25', 'Business & ERP',             'Business operations and management tools',              'building',        25)
    `);
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
