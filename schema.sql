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
    phase           TEXT NOT NULL CHECK (phase IN ('proxmox', 'helper_script', 'post_provision')),
    step            TEXT NOT NULL,                           -- human-readable step name
    status          TEXT NOT NULL CHECK (status IN ('running', 'success', 'error', 'skipped')),
    output          TEXT,                                    -- command output (stdout + stderr)
    started_at      TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_provisioning_log_env ON provisioning_log(env_id);
