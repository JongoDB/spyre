# Spyre — Claude Code Infrastructure Orchestrator

> Read `docs/spyre-architecture.md` for the full system design.
> Read `docs/implementation-plan.md` for the phased build sequence.
> Read `docs/verified-examples.md` for tested integration snippets from this specific environment.
> Environment-specific values (IPs, storage pools, bridges) are in `environment.yaml` — always reference this instead of hardcoding.

---

## What This Project Is

Spyre is a self-hosted web application that orchestrates Proxmox VMs/LXCs as development environments, with Claude Code as the AI operations engine. One controller VM, many worker nodes, everything accessible through the browser. See the architecture doc for full details.

---

## Tech Stack (Non-Negotiable)

| Layer | Technology | Notes |
|-------|-----------|-------|
| Framework | SvelteKit 2 | TypeScript, strict mode, SSR enabled |
| Runtime | Node.js 22 | Use `node:` prefixed built-in imports always |
| Database | SQLite via `better-sqlite3` | No ORMs. Raw SQL. Parameterized queries only. |
| SSH | `ssh2` npm package | All SSH goes through `src/lib/server/ssh-pool.ts` |
| Terminal | `xterm.js` + `@xterm/addon-fit` + `@xterm/addon-webgl` | Browser terminal rendering |
| Terminal backend | `node-pty` for local, `ssh2` channels for remote | Pipe through WebSocket |
| YAML | `yaml` npm package (not `js-yaml`) | Config parsing and validation |
| Editor | CodeMirror 6 | For the in-browser YAML config editor |
| Process manager | systemd | No PM2, no forever |
| Reverse proxy | Caddy | Auto-HTTPS, dynamic config reload |
| VNC | noVNC | Phase 2 — don't build yet |
| RDP | Apache Guacamole (`guacd`) | Phase 2 — don't build yet |

---

## Coding Conventions

### TypeScript
- Strict mode. No `any` unless wrapping an untyped library boundary, and add a `// eslint-disable-next-line` comment explaining why.
- Prefer `interface` over `type` for object shapes. Use `type` for unions and intersections.
- Use `node:` prefix for all Node.js built-ins: `import { readFile } from 'node:fs/promises'`
- Prefer `async/await` over `.then()` chains.
- Prefer plain functions and modules over classes. Use classes only when they genuinely manage mutable state across method calls (e.g., `SshPool`, `ClaudeAuthRelay`, `TmuxController`).
- Named exports only. No default exports except for SvelteKit route conventions.

### Error Handling
- All errors surfaced to users must be human-readable. Never expose stack traces, raw SQL errors, or SSH protocol messages to the frontend.
- Use structured error objects: `{ code: string, message: string, details?: unknown }`
- All Proxmox API calls must handle: network timeout, 401 (token expired), 403 (insufficient privileges), 500 (Proxmox internal), and connection refused.
- All SSH operations must handle: connection refused, auth failure, timeout, channel closed unexpectedly, and host key mismatch.
- Claude Code dispatch must handle: auth expired mid-task, process crash, timeout, and malformed output.

### File Organization
- Server-only code: `src/lib/server/` — never import from these in client-side code
- Shared types: `src/lib/types/` — plain TypeScript interfaces, no runtime dependencies
- Components: `src/lib/components/` — `.svelte` files, one component per file
- Routes follow SvelteKit conventions: `src/routes/[path]/+page.svelte`, `+server.ts`, `+page.server.ts`

### Database
- Schema lives in `schema.sql` at project root. Claude Code should update this file when adding/modifying tables.
- Migrations: we don't use a migration framework yet. For now, schema changes are applied manually or via `setup.sh`. Keep `schema.sql` as the source of truth.
- All queries use parameterized placeholders (`?`). Never interpolate values into SQL strings.
- Use transactions for multi-statement operations: `db.transaction(() => { ... })()`

### SSH
- **Never** use `child_process.spawn('ssh', ...)` directly. All SSH goes through the `ssh2` library via `src/lib/server/ssh-pool.ts`.
- The only exception is spawning `claude` CLI processes, which run locally on the controller and may themselves use SSH internally.
- SSH connection config (key path, timeouts, keepalive) is centralized in `ssh-pool.ts` and reads from `environment.yaml`.

### Configuration
- All environment-specific values come from `environment.yaml` at the project root. Never hardcode IPs, hostnames, storage pool names, bridge names, or paths.
- User-defined environment configs (the YAML files that define what VMs/LXCs to create) live in `configs/` and `configs/bases/`.
- Load `environment.yaml` once at startup via a singleton in `src/lib/server/env-config.ts`. Other modules import from there.

### Testing
- Use Vitest for unit tests. Files: `*.test.ts` colocated next to source.
- Use Playwright for E2E tests. Files: `tests/e2e/*.test.ts`.
- Every Proxmox API function and SSH operation should have at minimum a test with mocked responses.
- Don't write tests for trivial SvelteKit route handlers or simple database reads. Focus test effort on: provisioner pipeline, SSH pool management, Claude auth relay, and config parsing/inheritance.

### Commit Messages
- Format: `feat(module): short description` / `fix(module): short description`
- Modules: `proxmox`, `ssh`, `claude`, `config`, `web`, `provisioner`, `db`, `setup`

---

## What NOT to Build (Yet)

These are Phase 2+ features per the implementation plan. Do not build, scaffold, or stub these unless explicitly asked:

- VNC / noVNC integration
- RDP / Guacamole integration  
- Multi-user auth (OIDC, LDAP)
- Config version history / git integration
- Environment snapshots / cloning
- Multi-Proxmox-node support
- Windows VM support
- Cost tracking / budgeting
- CI/CD integration

---

## Key File Locations

| File | Purpose |
|------|---------|
| `environment.yaml` | Auto-generated during setup. All infra-specific values. |
| `schema.sql` | SQLite schema. Source of truth for DB structure. |
| `configs/` | User-defined environment YAML configs |
| `configs/bases/` | Base configs for inheritance |
| `setup.sh` | One-shot controller setup script |
| `Caddyfile` | Reverse proxy config (partially auto-generated) |
| `spyre.service` | systemd unit file |
| `docs/spyre-architecture.md` | Full architecture and design rationale |
| `docs/implementation-plan.md` | Phased build sequence |
| `docs/verified-examples.md` | Tested curl/CLI snippets from this environment |

---

## Version Bumps

When bumping the version (minor or major), update **only** `package.json`. The UI version tag in the sidebar reads from `package.json` automatically at build time via Vite's `define` (`__APP_VERSION__`).

**Checklist:**
1. Update `"version"` in `package.json`
2. `git tag -a vX.Y.Z -m "release notes"`
3. `git push && git push origin vX.Y.Z`

No other files need manual version edits.
