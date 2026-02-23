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
