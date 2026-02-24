-- =============================================================================
-- Spyre — SQLite Database Schema
-- =============================================================================
--
-- Source of truth for all Spyre database tables.
-- Applied by setup.sh or on first application boot.
--
-- Referenced by:
--   - CLAUDE.md (coding conventions for database access)
--   - docs/implementation-plan.md (Phase 0 task)
--   - src/lib/server/db.ts (applies this schema on startup)
--   - docs/spyre-architecture.md Section 10
--
-- To apply manually:
--   sqlite3 data/spyre.db < schema.sql
--
-- To reset:
--   rm data/spyre.db && sqlite3 data/spyre.db < schema.sql
-- =============================================================================

-- Enable WAL mode for concurrent reads during web requests
PRAGMA journal_mode=WAL;

-- Enable foreign key enforcement
PRAGMA foreign_keys=ON;

-- =============================================================================
-- Environments — VMs and LXC containers managed by Spyre
-- =============================================================================
CREATE TABLE IF NOT EXISTS environments (
    id              TEXT PRIMARY KEY,                        -- UUID v4
    name            TEXT UNIQUE NOT NULL,                    -- human-readable, unique
    config_path     TEXT,                                    -- path to YAML config (null if created via quick-create)
    vmid            INTEGER,                                 -- Proxmox VMID
    type            TEXT NOT NULL CHECK (type IN ('lxc', 'vm')),
    status          TEXT NOT NULL DEFAULT 'pending'          -- pending | provisioning | running | stopped | error
                    CHECK (status IN ('pending', 'provisioning', 'running', 'stopped', 'error', 'destroying')),
    ip_address      TEXT,                                    -- assigned IP (discovered post-creation)
    node            TEXT NOT NULL,                            -- Proxmox node name
    ssh_user        TEXT NOT NULL DEFAULT 'root',            -- SSH user for this environment
    ssh_port        INTEGER NOT NULL DEFAULT 22,
    error_message   TEXT,                                    -- populated when status = 'error'
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    last_accessed   TEXT,                                     -- last terminal/claude connection
    metadata        TEXT                                      -- JSON blob for extra data
);

CREATE INDEX IF NOT EXISTS idx_environments_status ON environments(status);
CREATE INDEX IF NOT EXISTS idx_environments_node ON environments(node);

-- =============================================================================
-- Services — Ports/protocols exposed by each environment
-- =============================================================================
CREATE TABLE IF NOT EXISTS services (
    id              TEXT PRIMARY KEY,                        -- UUID v4
    env_id          TEXT NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,                            -- human-readable (e.g., "web", "ssh", "api")
    port            INTEGER NOT NULL,
    protocol        TEXT NOT NULL CHECK (protocol IN ('ssh', 'http', 'https', 'vnc', 'rdp', 'tcp')),
    proxy_url       TEXT,                                    -- generated Caddy route (null until proxy is configured)
    status          TEXT NOT NULL DEFAULT 'unknown'           -- up | down | unknown
                    CHECK (status IN ('up', 'down', 'unknown')),
    UNIQUE(env_id, port)
);

CREATE INDEX IF NOT EXISTS idx_services_env ON services(env_id);

-- =============================================================================
-- Claude Tasks — AI operations dispatched through Spyre
-- =============================================================================
CREATE TABLE IF NOT EXISTS claude_tasks (
    id              TEXT PRIMARY KEY,                        -- UUID v4
    env_id          TEXT REFERENCES environments(id) ON DELETE SET NULL,
    user_id         TEXT REFERENCES users(id) ON DELETE SET NULL,
    prompt          TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'running', 'complete', 'error', 'auth_required', 'cancelled')),
    result          TEXT,                                    -- Claude's response (may be large)
    error_message   TEXT,
    cost_usd        REAL,                                    -- from Claude's JSON output
    session_id      TEXT,                                    -- Claude Code session ID (for --resume)
    started_at      TEXT,
    completed_at    TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_claude_tasks_env ON claude_tasks(env_id);
CREATE INDEX IF NOT EXISTS idx_claude_tasks_status ON claude_tasks(status);
CREATE INDEX IF NOT EXISTS idx_claude_tasks_created ON claude_tasks(created_at);

-- =============================================================================
-- Claude Auth Log — OAuth session lifecycle events
-- =============================================================================
CREATE TABLE IF NOT EXISTS claude_auth_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    event           TEXT NOT NULL                             -- initiated | callback_received | authenticated |
                    CHECK (event IN (                        --   expired | error | health_check |
                        'initiated', 'callback_received',    --   cancelled | token_expiring_soon
                        'authenticated', 'expired',
                        'error', 'health_check',
                        'cancelled', 'token_expiring_soon'
                    )),
    details         TEXT,                                    -- JSON blob with event-specific data
    timestamp       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_claude_auth_log_event ON claude_auth_log(event);

-- =============================================================================
-- Users — Spyre web application accounts
-- =============================================================================
CREATE TABLE IF NOT EXISTS users (
    id              TEXT PRIMARY KEY,                        -- UUID v4
    username        TEXT UNIQUE NOT NULL,
    password_hash   TEXT NOT NULL,                           -- bcrypt
    role            TEXT NOT NULL DEFAULT 'operator'
                    CHECK (role IN ('admin', 'operator', 'viewer')),
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    last_login      TEXT
);

-- =============================================================================
-- Sessions — Web app session management
-- =============================================================================
CREATE TABLE IF NOT EXISTS sessions (
    id              TEXT PRIMARY KEY,                        -- session token (crypto random)
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at      TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

-- =============================================================================
-- Audit Log — All significant operations
-- =============================================================================
CREATE TABLE IF NOT EXISTS audit_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         TEXT REFERENCES users(id) ON DELETE SET NULL,
    action          TEXT NOT NULL,                           -- create_env | destroy_env | start_env | stop_env |
                                                            --   claude_dispatch | claude_auth | login | logout |
                                                            --   config_save | config_delete
    target          TEXT,                                    -- environment name, config name, etc.
    details         TEXT,                                    -- JSON blob with action-specific data
    ip_address      TEXT,                                    -- client IP
    timestamp       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id);

-- =============================================================================
-- Provisioning Log — Step-by-step record of environment builds
-- =============================================================================
CREATE TABLE IF NOT EXISTS provisioning_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    env_id          TEXT NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
    phase           TEXT NOT NULL CHECK (phase IN ('proxmox', 'helper_script', 'post_provision', 'community_script', 'software_pool', 'custom_script')),
    step            TEXT NOT NULL,                           -- human-readable step name
    status          TEXT NOT NULL CHECK (status IN ('running', 'success', 'error', 'skipped')),
    output          TEXT,                                    -- command output (stdout + stderr)
    started_at      TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_provisioning_log_env ON provisioning_log(env_id);

-- =============================================================================
-- Resource Presets — Named CPU/RAM/disk configurations
-- =============================================================================
CREATE TABLE IF NOT EXISTS resource_presets (
    id              TEXT PRIMARY KEY,                        -- UUID v4
    name            TEXT UNIQUE NOT NULL,                    -- e.g. "Small", "Medium", "Large"
    description     TEXT,
    cores           INTEGER NOT NULL DEFAULT 1,
    memory          INTEGER NOT NULL DEFAULT 512,            -- MB
    swap            INTEGER NOT NULL DEFAULT 0,              -- MB
    disk            INTEGER NOT NULL DEFAULT 8,              -- GB
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- =============================================================================
-- Network Profiles — Named network configurations
-- =============================================================================
CREATE TABLE IF NOT EXISTS network_profiles (
    id              TEXT PRIMARY KEY,                        -- UUID v4
    name            TEXT UNIQUE NOT NULL,                    -- e.g. "DHCP on vmbr0", "Static LAN"
    description     TEXT,
    bridge          TEXT NOT NULL DEFAULT 'vmbr0',
    ip_mode         TEXT NOT NULL DEFAULT 'dhcp'             -- dhcp | static
                    CHECK (ip_mode IN ('dhcp', 'static')),
    ip_address      TEXT,                                    -- for static mode (CIDR notation)
    gateway         TEXT,                                    -- for static mode
    ip6_mode        TEXT DEFAULT 'auto'                      -- auto | static | disabled
                    CHECK (ip6_mode IN ('auto', 'static', 'disabled')),
    ip6_address     TEXT,                                    -- for static IPv6
    ip6_gateway     TEXT,                                    -- for static IPv6
    dns             TEXT,                                    -- nameserver(s), space-separated
    dns_search      TEXT,                                    -- search domain
    vlan            INTEGER,                                 -- VLAN tag (null = none)
    mtu             INTEGER,                                 -- MTU (null = default)
    firewall        INTEGER NOT NULL DEFAULT 0,              -- 0 = off, 1 = on
    rate_limit       REAL,                                    -- MB/s (null = unlimited)
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- =============================================================================
-- Categories — Organized groupings for templates and community scripts
-- =============================================================================
CREATE TABLE IF NOT EXISTS categories (
    id          TEXT PRIMARY KEY,
    name        TEXT UNIQUE NOT NULL,
    description TEXT,
    icon        TEXT,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- =============================================================================
-- Software Pools — Reusable named software collections
-- =============================================================================
CREATE TABLE IF NOT EXISTS software_pools (
    id              TEXT PRIMARY KEY,                        -- UUID v4
    name            TEXT UNIQUE NOT NULL,                    -- e.g. "Node.js Dev Stack"
    description     TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- =============================================================================
-- Software Pool Items — Individual items within a pool, ordered
-- =============================================================================
CREATE TABLE IF NOT EXISTS software_pool_items (
    id              TEXT PRIMARY KEY,                        -- UUID v4
    pool_id         TEXT NOT NULL REFERENCES software_pools(id) ON DELETE CASCADE,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    item_type       TEXT NOT NULL CHECK (item_type IN ('package', 'script', 'file')),
    content         TEXT NOT NULL,                           -- package name(s), script content, or file content
    destination     TEXT,                                    -- for 'file' type: target path in container
    label           TEXT,                                    -- human-readable label
    post_command    TEXT,                                    -- command to run after this item
    package_manager TEXT CHECK (package_manager IS NULL OR package_manager IN ('auto', 'apt', 'apk', 'dnf', 'yum')),
    interpreter     TEXT CHECK (interpreter IS NULL OR interpreter IN ('bash', 'sh', 'python3', 'node', 'ruby', 'perl')),
    source_url      TEXT,                                    -- remote URL to fetch script/file at provision time
    file_mode       TEXT,                                    -- file permissions e.g. '0755'
    file_owner      TEXT,                                    -- file ownership e.g. 'www-data:www-data'
    condition       TEXT,                                    -- shell command that must exit 0 for item to run
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_software_pool_items_pool ON software_pool_items(pool_id, sort_order);

-- =============================================================================
-- Templates — Full environment definitions with all Proxmox params
-- =============================================================================
CREATE TABLE IF NOT EXISTS templates (
    id                      TEXT PRIMARY KEY,                -- UUID v4
    name                    TEXT UNIQUE NOT NULL,
    description             TEXT,
    type                    TEXT NOT NULL DEFAULT 'lxc'
                            CHECK (type IN ('lxc', 'vm')),

    -- References to building blocks (nullable)
    resource_preset_id      TEXT REFERENCES resource_presets(id) ON DELETE SET NULL,
    network_profile_id      TEXT REFERENCES network_profiles(id) ON DELETE SET NULL,
    category_id             TEXT REFERENCES categories(id) ON DELETE SET NULL,

    -- OS fields
    os_template             TEXT,                            -- Proxmox template volid
    os_type                 TEXT,                            -- e.g. "ubuntu", "debian", "alpine"
    os_version              TEXT,                            -- e.g. "22.04", "12"

    -- Inline resource overrides (null = use preset)
    cores                   INTEGER,
    memory                  INTEGER,                         -- MB
    swap                    INTEGER,                         -- MB
    disk                    INTEGER,                         -- GB
    storage                 TEXT,                            -- Proxmox storage pool

    -- Inline network overrides (null = use profile)
    bridge                  TEXT,
    ip_mode                 TEXT CHECK (ip_mode IS NULL OR ip_mode IN ('dhcp', 'static')),
    ip_address              TEXT,
    gateway                 TEXT,
    dns                     TEXT,
    vlan                    INTEGER,

    -- LXC settings
    unprivileged            INTEGER NOT NULL DEFAULT 1,      -- 0 or 1
    nesting                 INTEGER NOT NULL DEFAULT 1,      -- 0 or 1
    features                TEXT,                            -- JSON: additional features string
    startup_order           INTEGER,
    protection              INTEGER NOT NULL DEFAULT 0,      -- 0 or 1

    -- Access settings
    ssh_enabled             INTEGER NOT NULL DEFAULT 1,      -- 0 or 1
    ssh_keys                TEXT,                            -- SSH public keys to inject
    root_password           TEXT,                            -- default root password (null = auto-generate)
    default_user            TEXT,                            -- create this user during provisioning
    timezone                TEXT DEFAULT 'host',

    -- Community script reference
    community_script_slug   TEXT,                            -- references community_scripts_cache(slug)
    install_method_type     TEXT,                            -- 'default', 'alpine', etc.
    interface_port          INTEGER,                         -- web UI port (e.g. 8123, 3000)
    default_credentials     TEXT,                            -- JSON: {"username":null,"password":null}
    post_install_notes      TEXT,                            -- JSON array of {text,type} objects
    privileged              INTEGER NOT NULL DEFAULT 0,      -- some community scripts need privileged

    -- Display / meta
    installed_software      TEXT,                            -- JSON array of software labels for display
    custom_script           TEXT,                            -- shell script to run during provisioning
    tags                    TEXT,                            -- comma-separated tags for filtering

    created_at              TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_templates_type ON templates(type);
CREATE INDEX IF NOT EXISTS idx_templates_community ON templates(community_script_slug);

-- =============================================================================
-- Template Software Pools — Many-to-many junction table
-- =============================================================================
CREATE TABLE IF NOT EXISTS template_software_pools (
    template_id     TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
    pool_id         TEXT NOT NULL REFERENCES software_pools(id) ON DELETE CASCADE,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (template_id, pool_id)
);

-- =============================================================================
-- Community Scripts Cache — Cached metadata from community-scripts repo
-- =============================================================================
CREATE TABLE IF NOT EXISTS community_scripts_cache (
    slug            TEXT PRIMARY KEY,                        -- unique identifier from repo
    name            TEXT NOT NULL,
    description     TEXT,
    type            TEXT CHECK (type IN ('ct', 'vm')),       -- container or VM
    categories      TEXT,                                    -- JSON array
    website         TEXT,
    logo_url        TEXT,
    documentation   TEXT,
    interface_port  INTEGER,
    default_cpu     INTEGER,
    default_ram     INTEGER,                                 -- MB
    default_disk    INTEGER,                                 -- GB
    default_os      TEXT,
    default_os_version TEXT,
    script_path     TEXT,                                    -- path in repo
    install_methods TEXT,                                    -- JSON array
    default_username TEXT,
    default_password TEXT,
    notes           TEXT,                                    -- JSON array
    privileged      INTEGER NOT NULL DEFAULT 0,              -- 1 if script needs privileged container
    fetched_at      TEXT NOT NULL DEFAULT (datetime('now')),
    source_hash     TEXT                                     -- hash of source JSON for change detection
);

-- =============================================================================
-- Alter environments — Add template reference
-- =============================================================================
-- Note: SQLite doesn't support ALTER TABLE ADD CONSTRAINT, so FK is informational.
-- The application layer enforces the relationship.
-- ALTER TABLE environments ADD COLUMN template_id TEXT REFERENCES templates(id) ON DELETE SET NULL;
-- Using IF NOT EXISTS pattern for safety:
CREATE TABLE IF NOT EXISTS _env_template_migration_check (done INTEGER);
INSERT OR IGNORE INTO _env_template_migration_check VALUES (1);

-- =============================================================================
-- Seed Data — Default resource presets and network profile
-- =============================================================================
INSERT OR IGNORE INTO resource_presets (id, name, description, cores, memory, swap, disk) VALUES
    ('preset-tiny',   'Tiny',   '1 vCPU, 256 MB RAM, 2 GB disk',   1,  256,    0,  2),
    ('preset-small',  'Small',  '1 vCPU, 512 MB RAM, 8 GB disk',   1,  512,  256,  8),
    ('preset-medium', 'Medium', '2 vCPU, 2 GB RAM, 20 GB disk',    2, 2048,  512, 20),
    ('preset-large',  'Large',  '4 vCPU, 8 GB RAM, 50 GB disk',    4, 8192, 1024, 50),
    ('preset-xlarge', 'XLarge', '8 vCPU, 16 GB RAM, 100 GB disk',  8,16384, 2048,100);

INSERT OR IGNORE INTO network_profiles (id, name, description, bridge, ip_mode, dns) VALUES
    ('profile-dhcp', 'DHCP on vmbr0', 'Automatic IP via DHCP on the default bridge', 'vmbr0', 'dhcp', '8.8.8.8');

-- Seed Data — Community-scripts categories (from metadata.json)
-- =============================================================================
-- Migration: Add enhanced fields to software_pool_items
-- =============================================================================
-- These ALTER TABLE statements are safe to re-run; SQLite will error silently
-- if the column already exists. Wrapped in a check pattern for safety.
ALTER TABLE software_pool_items ADD COLUMN package_manager TEXT CHECK (package_manager IS NULL OR package_manager IN ('auto', 'apt', 'apk', 'dnf', 'yum'));
ALTER TABLE software_pool_items ADD COLUMN interpreter TEXT CHECK (interpreter IS NULL OR interpreter IN ('bash', 'sh', 'python3', 'node', 'ruby', 'perl'));
ALTER TABLE software_pool_items ADD COLUMN source_url TEXT;
ALTER TABLE software_pool_items ADD COLUMN file_mode TEXT;
ALTER TABLE software_pool_items ADD COLUMN file_owner TEXT;
ALTER TABLE software_pool_items ADD COLUMN condition TEXT;

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
    ('cat-25', 'Business & ERP',             'Business operations and management tools',              'building',        25);

-- =============================================================================
-- Claude Progress — Cached progress.json from environments
-- =============================================================================
CREATE TABLE IF NOT EXISTS claude_progress (
    env_id       TEXT PRIMARY KEY REFERENCES environments(id) ON DELETE CASCADE,
    progress     TEXT,           -- Full JSON of .spyre/progress.json
    fetched_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- =============================================================================
-- Claude Git Activity — Cached git state from environments
-- =============================================================================
CREATE TABLE IF NOT EXISTS claude_git_activity (
    env_id          TEXT PRIMARY KEY REFERENCES environments(id) ON DELETE CASCADE,
    recent_commits  TEXT,        -- JSON array of {hash, message, author, date}
    diff_stat       TEXT,        -- git diff --stat output
    git_status      TEXT,        -- git status --short
    branch          TEXT,        -- current branch
    fetched_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- =============================================================================
-- Claude Task Queue — Queued prompts waiting to be dispatched
-- =============================================================================
CREATE TABLE IF NOT EXISTS claude_task_queue (
    id         TEXT PRIMARY KEY,
    env_id     TEXT NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
    prompt     TEXT NOT NULL,
    position   INTEGER NOT NULL,
    status     TEXT NOT NULL DEFAULT 'queued'
               CHECK (status IN ('queued', 'dispatched', 'cancelled')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_task_queue_env ON claude_task_queue(env_id, position);
