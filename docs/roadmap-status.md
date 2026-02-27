# Spyre — Full Roadmap & Status

> **Last updated**: 2026-02-27
> **Sources**: `docs/implementation-plan.md` (core platform), `docs/agent-sdk-analysis.md` (agent infrastructure)
> **Architecture**: `docs/spyre-architecture.md`

---

## Overview

This tracks all work across the entire Spyre project. There are three groups of phases:

- **Phases 0–5** — Core platform build (from `docs/implementation-plan.md`)
- **Phase 6** — Agent infrastructure improvements, CLI-compatible (from `docs/agent-sdk-analysis.md`)
- **Phase 7** — Agent SDK expansion, future (from `docs/agent-sdk-analysis.md`)

---

## Phase 0: Project Scaffold

**Status: DONE**

SvelteKit app with TypeScript strict mode, SQLite via `better-sqlite3`, `environment.yaml` config loading, `schema.sql` as DB source of truth, systemd service file, Caddyfile.

---

## Phase 1: Proxmox Connectivity

**Status: DONE**

Full Proxmox API client (`src/lib/server/proxmox.ts`). List, create, start, stop, destroy LXC containers from the web UI. Task polling for async Proxmox operations. Environment cards with status indicators.

---

## Phase 2: SSH + Terminal

**Status: DONE**

SSH connection pool (`ssh2` library, not `child_process`). tmux-backed terminal sessions that persist across browser disconnects. WebSocket-based xterm.js terminal in the browser. Tabbed terminal UI. SSH key injection during LXC creation.

---

## Phase 3: Config System

**Status: DONE**

YAML-based environment configs with inheritance (`extends`). CodeMirror 6 editor with live validation. 3-phase provisioner pipeline (Proxmox create → helper script → provision commands). Config-based and quick-create provisioning paths.

---

## Phase 4: Claude Code Integration

**Status: DONE**

OAuth relay for Claude Code authentication. Task dispatch via CLI (`claude -p` with `--output-format stream-json`). Real-time output streaming over WebSocket. Task history, session resume, cost tracking. Multi-agent support via Docker devcontainers with persona-based CLAUDE.md instructions. Pipeline engine with step sequencing, gate reviews, and iteration loops.

---

## Phase 5: Polish & Hardening

**Status: PARTIALLY DONE**

What's done:
- Dashboard landing page with environment/task summaries
- Environment status polling (Proxmox live status sync)
- Error handling and user-facing error messages
- Caddy reverse proxy for environment services
- Service detection and preview proxying
- Git activity polling and display
- Project download (tar.gz archives)

What's remaining:
- [ ] Single-user auth (bcrypt password, session middleware, login page, first-boot setup)
- [ ] Audit logging for all mutating operations (create, destroy, start, stop, dispatch)
- [ ] Audit log viewer UI (`/settings/audit`)
- [ ] E2E tests with Playwright (full flow: login → create → terminal → destroy)
- [ ] Security audit (no secret leaks, SQL injection prevention, WebSocket auth, proxy isolation)
- [ ] README.md

---

## Phase 6: Agent Infrastructure — CLI-Compatible

These improvements enhance agent capabilities without requiring SDK adoption. All work with the existing Claude Code CLI approach.

**Source**: `docs/agent-sdk-analysis.md` — Phase 1 priorities

### 6.1 Spyre MCP Server + Tool Injection

**Status: DONE** — Committed `67e391a` on 2026-02-27

Gives every Claude Code agent real-time access to Spyre platform state via 8 custom MCP tools over Streamable HTTP.

**Tools implemented**:
| Tool | Purpose | Read/Write |
|------|---------|------------|
| `spyre_get_env_status` | Environment state, IP, resources | Read |
| `spyre_list_agents` | All devcontainers + current tasks | Read |
| `spyre_get_pipeline_context` | Active pipeline, steps, gate feedback | Read |
| `spyre_report_progress` | Push structured progress updates | Write |
| `spyre_get_services` | Detected web services and ports | Read |
| `spyre_get_git_activity` | Branch, recent commits, diff stats | Read |
| `spyre_get_task_history` | Recent Claude tasks for this env | Read |
| `spyre_send_message` | Post message to another agent | Write |

**Key implementation details**:
- Transport: Streamable HTTP on `/mcp` (same port 3000)
- Auth: HMAC-SHA256 stateless bearer tokens (secret stored in `settings` table)
- `.mcp.json` auto-injected into devcontainers and bare environments during provisioning
- CLAUDE.md updated for all agents to document available tools
- `agent_messages` table added for inter-agent messaging

**Files created**:
- `src/lib/server/mcp-auth.ts` — Token generation/validation, server secret management
- `src/lib/server/mcp-server.ts` — McpServer setup, Streamable HTTP transport, session management, AsyncLocalStorage auth context
- `src/lib/server/mcp-tools.ts` — 8 tool handler implementations
- `src/routes/api/mcp/+server.ts` — SvelteKit bridge route (forces bundling into build output)

**Files modified**:
- `server.js` — Production `/mcp` intercept with dynamic chunk loading
- `vite-ws-plugin.ts` — Dev server `/mcp` middleware via `ssrLoadModule`
- `src/lib/server/devcontainers.ts` — MCP config injection + CLAUDE.md tool docs
- `src/lib/server/provisioner.ts` — `injectMcpConfig()` + MCP tools in CLAUDE.md
- `src/lib/server/environments.ts` — MCP config injection during provisioning
- `src/lib/server/db.ts` — Migration for `agent_messages` table
- `schema.sql` — `agent_messages` table definition

**Testing** (not yet verified — needs a running environment):
- POST to `/mcp` with valid bearer token → MCP handshake
- `tools/list` → returns all 8 tools
- `tools/call` with `spyre_get_env_status` → environment data
- Invalid token → 401
- Create devcontainer → `.mcp.json` exists with correct URL and token
- Agent prompt to use MCP tools → agent discovers and calls them

---

### 6.2 Hook System — Audit Logging + Safety Rules

**Status: NOT STARTED**
**Effort: Medium | Impact: High**
**Ref**: `docs/agent-sdk-analysis.md` section 5

**Goal**: Every tool call gets logged. Dangerous operations get blocked by configurable rules. Users control what's allowed via UI.

**What to build**:
- Generate `.claude/hooks.json` per environment/devcontainer during provisioning
- Hook scripts call back to a Spyre audit API: `POST /api/hooks/audit`
- Audit log: timestamp, agent ID, tool name, input summary, result status
- Default blocked patterns (user can toggle each on/off):
  - `rm -rf /` and variants
  - `git push --force` to main/master
  - `DROP TABLE`, `TRUNCATE`
  - Reading/writing `.env`, credentials files
  - `chmod 777`
  - `curl | bash` (pipe-to-shell)
- UI: "Safety Rules" panel where users toggle rules on/off per environment or globally
- Any rule that inhibits agent work MUST be user-configurable

**Architecture**:
```
Spyre Controller
  ├── Generates hooks.json per environment/devcontainer
  │   based on: global safety rules + persona permissions + user overrides
  ├── Injects into ~/.claude/hooks.json during provisioning
  └── Hook scripts call back to Spyre's audit API
      POST /api/hooks/audit { envId, agentId, tool, input, timestamp }
```

**Implementation approach options**:
1. `.claude/hooks.json` — native CLI support, shell-based hooks, lightweight
2. Custom MCP wrapper — intercept at MCP level (more control, more complex)
3. Hybrid — hooks for blocking + audit, MCP for richer integrations

**Key files to modify**:
- `src/lib/server/devcontainers.ts` — hooks.json injection
- `src/lib/server/provisioner.ts` — hooks.json injection for bare envs
- New: `src/routes/api/hooks/` — audit endpoint
- New: `src/lib/server/hooks.ts` — hook generation logic
- New: UI components for safety rules configuration
- `schema.sql` — audit log table, safety rules table

---

### 6.3 Per-Persona Permission Profiles

**Status: NOT STARTED** (depends on 6.2)
**Effort: Medium | Impact: Medium**
**Ref**: `docs/agent-sdk-analysis.md` section 6

**Goal**: Different personas get different tool permissions. A Reviewer can't edit files. A Tester can only write test files.

**Proposed permission model**:
| Persona | Read | Write/Edit | Bash | Web | Notes |
|---------|------|-----------|------|-----|-------|
| Architect | Full | Docs/configs only | Limited | Full | Design focus |
| Backend | Full | Full | Full | Full | Full access |
| Frontend | Full | Full | Full | Full | Full access |
| Tester | Full | Test files only | Test commands | Full | Can't modify source |
| Reviewer | Full | None | Read-only commands | Full | Pure analysis |
| DevOps | Full | Full | Full | Full | Infrastructure access |

**What to build**:
- Add `permissions` JSON field to `personas` table
- UI: Settings page to configure permissions per persona
- Permission profiles feed into hook generation (6.2) per devcontainer
- Hooks enforce the permission model at tool-call time

**Key files to modify**:
- `src/lib/types/persona.ts` — add permissions to interface
- `src/lib/server/personas.ts` — CRUD for permissions field
- `src/lib/server/hooks.ts` (from 6.2) — permission-aware hook generation
- `schema.sql` — `permissions` column on personas table
- New: UI settings page for persona permissions

---

### 6.4 Model Routing Per Persona/Step

**Status: NOT STARTED**
**Effort: Low | Impact: Medium**
**Ref**: `docs/agent-sdk-analysis.md` section 8

**Goal**: Different agents use different Claude models based on their task type. Save cost on simple tasks, use Opus for complex reasoning.

**Proposed model routing**:
| Task Type | Model | Rationale |
|-----------|-------|-----------|
| Architecture/design | Opus | Complex reasoning |
| Code writing | Sonnet | Good capability/cost balance |
| Code review | Sonnet | Pattern matching |
| Test generation | Sonnet | Template-driven |
| Linting/formatting | Haiku | Simple rule application |
| Progress summarization | Haiku | Low complexity |
| Gate review preparation | Opus | Nuanced judgment |

**What to build**:
- Add `default_model` field to `personas` table
- Pipeline steps can override model per step
- Inject `--model <model>` flag into CLI invocation in `claude-bridge.ts`
- UI: Model selector in persona settings

**Key files to modify**:
- `src/lib/types/persona.ts` — add `default_model` to interface
- `src/lib/server/personas.ts` — CRUD for model field
- `src/lib/server/claude-bridge.ts` — inject `--model` flag into CLI command
- `src/lib/server/pipeline-engine.ts` — step-level model override
- `schema.sql` — `default_model` column on personas table
- UI: persona settings, pipeline step editor

---

### 6.5 Session Resumption Pipeline Mode (Spike)

**Status: NOT STARTED**
**Effort: Low | Impact: High (if it works)**
**Ref**: `docs/agent-sdk-analysis.md` section 7

**Goal**: Offer an alternative pipeline mode where a single Claude session persists across steps via `--resume`, with persona context-switching instead of separate agents.

**Concept**: Instead of separate agents handing off via git:
1. Start as Persona A (Architect) → design
2. `--resume` as Persona B (Backend) → implement
3. `--resume` as Persona C (Reviewer) → review
4. Zero context loss — agent remembers everything

**Trade-offs**:
- Pro: Lossless context, no re-injection, faster, cheaper
- Con: Context window limits, single point of failure, less parallelism, persona bleed

**What to investigate**:
- [ ] Prototype a 3-step pipeline using `--resume` with persona switching
- [ ] Measure context window usage across steps
- [ ] Test persona switching fidelity
- [ ] Compare output quality: lossless resume vs. lossy re-injection
- [ ] Define fallback when context window fills up mid-pipeline

**What to build (if spike succeeds)**:
- New pipeline mode: `single-agent` (vs existing `multi-agent`)
- User selects mode when creating/editing a pipeline
- Pipeline engine handles `--resume` chaining and persona switch prompts
- Fallback: start fresh session when context window is near limit

**Key files to modify**:
- `src/lib/server/pipeline-engine.ts` — new execution mode
- `src/lib/server/claude-bridge.ts` — `--resume` support in dispatch
- `src/lib/types/pipeline.ts` — mode field on pipeline type
- UI: pipeline creation/edit — mode selector

---

## Phase 7: Agent SDK Expansion (Future)

These require adopting the `@anthropic-ai/claude-agent-sdk` for controller-side agents. CLI stays for in-environment agents.

**Source**: `docs/agent-sdk-analysis.md` — Phase 2 priorities

### 7.1 Adopt SDK for Controller-Side Agents

**Status: NOT STARTED**
**Effort: High | Impact: High**
**Ref**: `docs/agent-sdk-analysis.md` section 1

**Goal**: Use `@anthropic-ai/claude-agent-sdk` for agents that run on the controller (not inside environments). Eliminates process spawn overhead, PTY hacks, and fragile JSON parsing.

**Use cases for SDK agents**:
- Controller-side code review agents
- Pipeline orchestration agents
- Analysis/reporting agents that don't need remote filesystem access
- Structured output enforcement
- Subagent delegation for read-only tasks

**Key insight**: CLI stays for in-environment agents (need direct filesystem/shell). SDK for controller-side agents (orchestration, analysis).

**What to build**:
- New agent dispatch path in `claude-bridge.ts` for SDK-based execution
- SDK agent wrapper with structured message handling
- Session management for SDK agents
- Cost tracking integration

**Dependencies**: None — can be built independently. But benefits compound with structured output (7.2) and subagents (7.3).

---

### 7.2 Structured Output for Pipeline Steps

**Status: NOT STARTED**
**Effort: Medium | Impact: Medium**
**Ref**: `docs/agent-sdk-analysis.md` section 4

**Goal**: Eliminate regex-based output parsing (`output-extractor.ts`). Get structured JSON from agents conforming to a schema.

**Current problem**: `output-extractor.ts` uses regex to parse file paths from agent result summaries. Pipeline step results are free-text strings. No format enforcement.

**SDK approach**: `outputFormat: { type: "json_schema", schema: ... }` forces valid JSON.

**CLI-compatible approaches** (investigate first):
- Prompt engineering: Include JSON schema in prompt, instruct structured output
- Post-processing: Lightweight Haiku call to extract structured data from raw output
- Custom wrapper: Intercept final `result` event from stream-json, validate/re-prompt

**Investigation TODOs**:
- [ ] Test whether Claude Code CLI respects structured output instructions reliably
- [ ] Prototype a post-processing extraction step
- [ ] Evaluate custom stream-json wrapper that enforces schema

**Key files to modify**:
- `src/lib/server/output-extractor.ts` — replace regex parsing
- `src/lib/server/claude-bridge.ts` — structured output support
- `src/lib/server/pipeline-engine.ts` — schema definitions per step type

---

### 7.3 Subagents for Analysis Tasks

**Status: NOT STARTED**
**Effort: Medium | Impact: Medium**
**Ref**: `docs/agent-sdk-analysis.md` section 3

**Goal**: Use SDK inline subagents for lightweight analysis tasks instead of full Docker containers. Parent agent spins up specialized sub-agents in-process.

**Use cases**:
- Code review sub-agent (read-only, Sonnet/Haiku)
- Security scan sub-agent (read-only, pattern matching)
- Test analysis sub-agent (parse test output, suggest fixes)
- Documentation generator (read code, write docs)

**Trade-offs**:
- Pro: No Docker overhead, different models per sub-agent, parent maintains context
- Con: Sub-agents share controller filesystem, not the remote environment — still need SSH/Docker for code changes

**Key insight**: Use subagents for read-only analysis within pipelines. Keep containers for code-writing agents.

**Dependencies**: Requires SDK adoption (7.1) first.

---

## Recommended Next Steps

Current focus should be finishing Phase 5 remainders and working through Phase 6:

1. **6.4 Model routing** — Lowest effort, quick win. Add `default_model` to personas, inject `--model` into CLI.
2. **6.2 Hook system** — Highest remaining impact. Audit logging + safety rules. Also covers the Phase 5 audit logging gap.
3. **6.5 Session resumption spike** — Low effort investigation. High payoff if it works.
4. **6.3 Persona permissions** — Build after 6.2 (hooks), since permissions are enforced via hooks.
5. **Phase 5 remainders** — Single-user auth, E2E tests, security audit. Can be interleaved.

---

## Key Files Reference

| File | Role |
|------|------|
| `src/lib/server/mcp-auth.ts` | MCP token generation/validation |
| `src/lib/server/mcp-server.ts` | MCP server setup, transport, request handler |
| `src/lib/server/mcp-tools.ts` | MCP tool handler implementations |
| `src/routes/api/mcp/+server.ts` | SvelteKit bridge for MCP bundling |
| `src/lib/server/claude-bridge.ts` | Agent dispatch, CLI invocation, stream parsing |
| `src/lib/server/devcontainers.ts` | Docker multi-agent lifecycle, config injection |
| `src/lib/server/pipeline-engine.ts` | Pipeline state machine, step dispatch |
| `src/lib/server/provisioner.ts` | Environment provisioning, CLAUDE.md generation |
| `src/lib/server/environments.ts` | Environment CRUD, provisioning orchestration |
| `src/lib/server/personas.ts` | Persona CRUD, defaults, usage tracking |
| `src/lib/server/claude-poller.ts` | Progress/git polling from environments |
| `src/lib/server/output-extractor.ts` | Regex-based file path extraction from results |
| `src/lib/server/claude-auth.ts` | OAuth token management, credential propagation |
| `src/lib/server/proxmox.ts` | Proxmox API client |
| `src/lib/server/ssh-pool.ts` | SSH connection pool |
| `src/lib/server/config-store.ts` | YAML config loader with inheritance |
| `docs/implementation-plan.md` | Original core platform build plan (Phases 0–5) |
| `docs/agent-sdk-analysis.md` | Agent infrastructure analysis and decisions |
| `docs/spyre-architecture.md` | Full system architecture |
