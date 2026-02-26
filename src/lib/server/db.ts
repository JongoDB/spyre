import Database from 'better-sqlite3';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { getEnvConfig } from './env-config';
import { seedDefaultPersonas } from './personas';

let _db: Database.Database | null = null;
let _needsSeed = false;

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

  // Add updated_at column to claude_tasks if missing
  const taskCols2 = db.pragma('table_info(claude_tasks)') as Array<{ name: string }>;
  if (taskCols2.length > 0 && !taskCols2.some(c => c.name === 'updated_at')) {
    db.exec('ALTER TABLE claude_tasks ADD COLUMN updated_at TEXT');
  }

  // Remove CHECK constraint from claude_auth_log.event (code writes many event types beyond original 8)
  const authLogCheck = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='claude_auth_log'"
  ).get() as { sql: string } | undefined;
  if (authLogCheck && authLogCheck.sql.includes('CHECK')) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS claude_auth_log_new (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        event     TEXT NOT NULL,
        details   TEXT,
        timestamp TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT OR IGNORE INTO claude_auth_log_new SELECT * FROM claude_auth_log;
      DROP TABLE claude_auth_log;
      ALTER TABLE claude_auth_log_new RENAME TO claude_auth_log;
      CREATE INDEX IF NOT EXISTS idx_claude_auth_log_event ON claude_auth_log(event);
    `);
  }

  // Add 'error' status to claude_task_queue CHECK constraint
  const queueCheck = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='claude_task_queue'"
  ).get() as { sql: string } | undefined;
  if (queueCheck && !queueCheck.sql.includes("'error'")) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS claude_task_queue_new (
        id         TEXT PRIMARY KEY,
        env_id     TEXT NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
        prompt     TEXT NOT NULL,
        position   INTEGER NOT NULL,
        status     TEXT NOT NULL DEFAULT 'queued'
                   CHECK (status IN ('queued', 'dispatched', 'cancelled', 'error')),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT OR IGNORE INTO claude_task_queue_new SELECT * FROM claude_task_queue;
      DROP TABLE claude_task_queue;
      ALTER TABLE claude_task_queue_new RENAME TO claude_task_queue;
      CREATE INDEX IF NOT EXISTS idx_task_queue_env ON claude_task_queue(env_id, position);
    `);
  }

  // Claude task events table + new columns on claude_tasks
  const hasEventsTable = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='claude_task_events'"
  ).get();
  if (!hasEventsTable) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS claude_task_events (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id     TEXT NOT NULL REFERENCES claude_tasks(id) ON DELETE CASCADE,
        seq         INTEGER NOT NULL,
        event_type  TEXT NOT NULL,
        summary     TEXT NOT NULL,
        data        TEXT,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(task_id, seq)
      );
      CREATE INDEX IF NOT EXISTS idx_claude_task_events_task ON claude_task_events(task_id, seq);
    `);
  }

  // Add retry/error columns to claude_tasks if missing
  const taskColsRetry = db.pragma('table_info(claude_tasks)') as Array<{ name: string }>;
  if (taskColsRetry.length > 0 && !taskColsRetry.some(c => c.name === 'retry_count')) {
    db.exec('ALTER TABLE claude_tasks ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0');
  }
  if (taskColsRetry.length > 0 && !taskColsRetry.some(c => c.name === 'max_retries')) {
    db.exec('ALTER TABLE claude_tasks ADD COLUMN max_retries INTEGER NOT NULL DEFAULT 0');
  }
  if (taskColsRetry.length > 0 && !taskColsRetry.some(c => c.name === 'error_code')) {
    db.exec('ALTER TABLE claude_tasks ADD COLUMN error_code TEXT');
  }
  if (taskColsRetry.length > 0 && !taskColsRetry.some(c => c.name === 'parent_task_id')) {
    db.exec('ALTER TABLE claude_tasks ADD COLUMN parent_task_id TEXT');
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

  // Add 'claude_install' phase to provisioning_log CHECK constraint
  const provLogCheck2 = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='provisioning_log'"
  ).get() as { sql: string } | undefined;
  if (provLogCheck2 && !provLogCheck2.sql.includes("'claude_install'")) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS provisioning_log_new (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        env_id      TEXT NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
        phase       TEXT NOT NULL CHECK (phase IN ('proxmox', 'helper_script', 'post_provision', 'community_script', 'software_pool', 'custom_script', 'claude_install', 'complete', 'error')),
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

  // Add 'docker_install' and 'project_setup' phases to provisioning_log CHECK constraint
  const provLogCheck3 = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='provisioning_log'"
  ).get() as { sql: string } | undefined;
  if (provLogCheck3 && !provLogCheck3.sql.includes("'docker_install'")) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS provisioning_log_new (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        env_id      TEXT NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
        phase       TEXT NOT NULL CHECK (phase IN ('proxmox', 'helper_script', 'post_provision', 'community_script', 'software_pool', 'custom_script', 'claude_install', 'docker_install', 'project_setup', 'complete', 'error')),
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

  // Personas table + persona_id on environments
  const hasPersonasTable = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='personas'"
  ).get();
  if (!hasPersonasTable) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS personas (
        id          TEXT PRIMARY KEY,
        name        TEXT UNIQUE NOT NULL,
        role        TEXT NOT NULL,
        avatar      TEXT DEFAULT '🤖',
        description TEXT,
        instructions TEXT NOT NULL DEFAULT '',
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }

  const envCols = db.pragma('table_info(environments)') as Array<{ name: string }>;
  if (envCols.length > 0 && !envCols.some(c => c.name === 'persona_id')) {
    db.exec('ALTER TABLE environments ADD COLUMN persona_id TEXT');
  }

  // Settings table
  const hasSettingsTable = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='settings'"
  ).get();
  if (!hasSettingsTable) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }

  // Devcontainers tables
  const hasDevcontainersTable = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='devcontainers'"
  ).get();
  if (!hasDevcontainersTable) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS devcontainers (
        id              TEXT PRIMARY KEY,
        env_id          TEXT NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
        persona_id      TEXT REFERENCES personas(id) ON DELETE SET NULL,
        container_name  TEXT NOT NULL,
        service_name    TEXT NOT NULL,
        status          TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','creating','running','stopped','error','removing')),
        image           TEXT,
        working_dir     TEXT NOT NULL DEFAULT '/workspace',
        error_message   TEXT,
        created_at      TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(env_id, service_name)
      );
      CREATE INDEX IF NOT EXISTS idx_devcontainers_env ON devcontainers(env_id);

      CREATE TABLE IF NOT EXISTS devcontainer_progress (
        devcontainer_id TEXT PRIMARY KEY REFERENCES devcontainers(id) ON DELETE CASCADE,
        progress        TEXT,
        fetched_at      TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS devcontainer_git_activity (
        devcontainer_id TEXT PRIMARY KEY REFERENCES devcontainers(id) ON DELETE CASCADE,
        recent_commits  TEXT,
        diff_stat       TEXT,
        git_status      TEXT,
        branch          TEXT,
        fetched_at      TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }

  // Docker/repo columns on environments
  const envColsDocker = db.pragma('table_info(environments)') as Array<{ name: string }>;
  if (envColsDocker.length > 0 && !envColsDocker.some(c => c.name === 'docker_enabled')) {
    db.exec('ALTER TABLE environments ADD COLUMN docker_enabled INTEGER NOT NULL DEFAULT 0');
  }
  if (envColsDocker.length > 0 && !envColsDocker.some(c => c.name === 'repo_url')) {
    db.exec('ALTER TABLE environments ADD COLUMN repo_url TEXT');
  }
  if (envColsDocker.length > 0 && !envColsDocker.some(c => c.name === 'git_branch')) {
    db.exec("ALTER TABLE environments ADD COLUMN git_branch TEXT DEFAULT 'main'");
  }
  if (envColsDocker.length > 0 && !envColsDocker.some(c => c.name === 'project_dir')) {
    db.exec("ALTER TABLE environments ADD COLUMN project_dir TEXT DEFAULT '/project'");
  }

  // devcontainer_id on claude_tasks
  const taskColsDc = db.pragma('table_info(claude_tasks)') as Array<{ name: string }>;
  if (taskColsDc.length > 0 && !taskColsDc.some(c => c.name === 'devcontainer_id')) {
    db.exec('ALTER TABLE claude_tasks ADD COLUMN devcontainer_id TEXT');
  }

  // devcontainer_id on claude_task_queue
  const queueColsDc = db.pragma('table_info(claude_task_queue)') as Array<{ name: string }>;
  if (queueColsDc.length > 0 && !queueColsDc.some(c => c.name === 'devcontainer_id')) {
    db.exec('ALTER TABLE claude_task_queue ADD COLUMN devcontainer_id TEXT');
  }

  // Pipeline tables (v0.11.0)
  const hasPipelinesTable = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='pipelines'"
  ).get();
  if (!hasPipelinesTable) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS pipeline_templates (
        id          TEXT PRIMARY KEY,
        name        TEXT UNIQUE NOT NULL,
        description TEXT,
        env_id      TEXT REFERENCES environments(id) ON DELETE SET NULL,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS pipeline_template_steps (
        id                TEXT PRIMARY KEY,
        template_id       TEXT NOT NULL REFERENCES pipeline_templates(id) ON DELETE CASCADE,
        position          INTEGER NOT NULL,
        type              TEXT NOT NULL CHECK (type IN ('agent','gate')),
        label             TEXT NOT NULL,
        devcontainer_id   TEXT REFERENCES devcontainers(id) ON DELETE SET NULL,
        persona_id        TEXT REFERENCES personas(id) ON DELETE SET NULL,
        prompt_template   TEXT,
        gate_instructions TEXT,
        max_retries       INTEGER NOT NULL DEFAULT 0,
        timeout_ms        INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_tmpl_steps ON pipeline_template_steps(template_id, position);

      CREATE TABLE IF NOT EXISTS pipelines (
        id               TEXT PRIMARY KEY,
        env_id           TEXT NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
        template_id      TEXT REFERENCES pipeline_templates(id) ON DELETE SET NULL,
        name             TEXT NOT NULL,
        description      TEXT,
        status           TEXT NOT NULL DEFAULT 'draft'
                         CHECK (status IN ('draft','running','paused','completed','failed','cancelled')),
        current_position INTEGER,
        total_cost_usd   REAL NOT NULL DEFAULT 0.0,
        error_message    TEXT,
        started_at       TEXT,
        completed_at     TEXT,
        created_at       TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_pipelines_env ON pipelines(env_id);
      CREATE INDEX IF NOT EXISTS idx_pipelines_status ON pipelines(status);

      CREATE TABLE IF NOT EXISTS pipeline_steps (
        id                TEXT PRIMARY KEY,
        pipeline_id       TEXT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
        position          INTEGER NOT NULL,
        type              TEXT NOT NULL CHECK (type IN ('agent','gate')),
        label             TEXT NOT NULL,
        devcontainer_id   TEXT REFERENCES devcontainers(id) ON DELETE SET NULL,
        persona_id        TEXT REFERENCES personas(id) ON DELETE SET NULL,
        prompt_template   TEXT,
        gate_instructions TEXT,
        status            TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','running','completed','skipped','error','waiting','cancelled')),
        task_id           TEXT REFERENCES claude_tasks(id) ON DELETE SET NULL,
        result_summary    TEXT,
        gate_result       TEXT CHECK (gate_result IS NULL OR gate_result IN ('approved','rejected','revised')),
        gate_feedback     TEXT,
        gate_decided_at   TEXT,
        iteration         INTEGER NOT NULL DEFAULT 0,
        max_retries       INTEGER NOT NULL DEFAULT 0,
        retry_count       INTEGER NOT NULL DEFAULT 0,
        timeout_ms        INTEGER,
        cost_usd          REAL,
        started_at        TEXT,
        completed_at      TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_psteps_pipeline ON pipeline_steps(pipeline_id, position);
      CREATE INDEX IF NOT EXISTS idx_psteps_task ON pipeline_steps(task_id);

      CREATE TABLE IF NOT EXISTS pipeline_context_snapshots (
        id            TEXT PRIMARY KEY,
        pipeline_id   TEXT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
        step_id       TEXT REFERENCES pipeline_steps(id) ON DELETE CASCADE,
        snapshot_type TEXT NOT NULL CHECK (snapshot_type IN ('start','step_complete','gate_decision')),
        git_diff      TEXT,
        git_status    TEXT,
        commit_hash   TEXT,
        created_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_snapshots_pipeline ON pipeline_context_snapshots(pipeline_id);
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

  // Seed default personas on first run — must happen after _db is set
  // so we defer it via a flag and call it in getDb() instead.
  _needsSeed = true;

  return db;
}

export function getDb(): Database.Database {
  if (!_db) {
    _db = initializeDb();
  }
  if (_needsSeed) {
    _needsSeed = false;
    seedDefaultPersonas();
  }
  return _db;
}
