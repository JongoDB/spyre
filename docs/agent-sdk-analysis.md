# Agent SDK & Architecture Analysis

> **Date**: 2026-02-26
> **Source**: [Nader Dabit — The Complete Guide to Building Agents with the Claude Agent SDK](https://x.com/dabit3/article/2009131298250428923)
> **Status**: Active roadmap — decisions captured, implementation phased

---

## Context

Spyre currently orchestrates Claude agents by shelling out to the **Claude Code CLI** over SSH, parsing `--output-format stream-json` output, and coordinating multi-agent work through Docker containers, git commits, and progress files. There is zero MCP usage and no programmatic SDK integration.

This analysis compares Spyre's approach against the Claude Agent SDK's capabilities and identifies improvements across 8 dimensions.

---

## 1. CLI Shelling vs Programmatic SDK

### Current State
Every agent task spawns a CLI process via SSH:
```
claude -p '<prompt>' --output-format stream-json --verbose --dangerously-skip-permissions
```
Output is parsed by a hand-rolled `StreamJsonParser` in `claude-bridge.ts`. A PTY hack (`script -qc`) is needed because the CLI stalls without a terminal.

### What the SDK Offers
A native `query()` async generator that manages the agent loop in-process — no subprocess spawning, no stream parsing, no SSH pipe. Direct access to structured messages, session objects, and in-process error handling.

### Trade-offs
- **SDK advantage**: Eliminates process spawn overhead (~2-5s per task), PTY hacks, and fragile JSON parsing
- **CLI advantage**: Runs *inside* the target environment where it has direct filesystem/shell access — the SDK would need SSH-proxied tool execution for remote environments
- **Hybrid approach**: SDK for controller-side agents (orchestration, analysis), CLI for in-environment execution

### Decision
**Keep CLI shelling for now.** Write a separate plan for SDK/API expansion later to hit both sides of the market — CLI for in-environment agents, SDK for controller-side orchestration and analysis agents.

### Future Plan (deferred)
- `docs/sdk-expansion-plan.md` — phased adoption of `@anthropic-ai/claude-agent-sdk` for:
  - Controller-side code review agents
  - Pipeline orchestration agents
  - Analysis/reporting agents that don't need remote filesystem access
  - Structured output enforcement
  - Subagent delegation for read-only tasks

---

## 2. MCP — Custom Tool Integration

### Current State
Agents have Claude Code's built-in tools only (Read, Write, Edit, Bash, Glob, Grep, WebFetch, WebSearch). No custom tools. No way for agents to query Spyre state, talk to each other, or access domain-specific capabilities.

### What MCP Enables
Custom tools via MCP servers that extend what agents can do. Claude Code CLI supports MCP natively via `~/.claude/mcp.json` configuration — no SDK required.

### Proposed Spyre MCP Tools (Built-in)

| Tool | Purpose | Read/Write |
|------|---------|------------|
| `spyre_get_env_status` | Query environment state, IP, resources, health | Read |
| `spyre_list_agents` | See all active agents + their current tasks | Read |
| `spyre_send_message` | Post a message to another agent's task queue | Write |
| `spyre_get_pipeline_context` | Read pipeline state, prior steps, gate feedback | Read |
| `spyre_report_progress` | Write structured progress updates (replace polling) | Write |
| `spyre_get_services` | Query detected web services and ports | Read |
| `spyre_query_db` | Read-only access to Spyre's SQLite (tasks, history, costs) | Read |
| `spyre_get_git_activity` | Current branch, recent commits, diff stats | Read |

### Architecture

```
┌─────────────────────────────────────┐
│  Spyre Controller (Node.js)         │
│  ┌────────────────────────────┐     │
│  │  Spyre MCP Server          │     │  ← Runs on controller
│  │  (HTTP/SSE or stdio)       │     │     Exposes Spyre tools
│  └────────────────────────────┘     │
└───────────┬─────────────────────────┘
            │ MCP protocol
            ▼
┌─────────────────────────────────────┐
│  Environment / Devcontainer         │
│  ┌────────────────────────────┐     │
│  │  Claude Code CLI           │     │  ← Connects to MCP server
│  │  (~/.claude/mcp.json)      │     │     via config injected by Spyre
│  └────────────────────────────┘     │
│                                     │
│  + User-selected MCP servers        │  ← Additional servers chosen
│    (from UI settings)               │     from a library/marketplace
└─────────────────────────────────────┘
```

### Implementation Plan
1. Build a Spyre MCP server that exposes the tools above (runs on controller, listens on controller IP)
2. Programmatically inject `~/.claude/mcp.json` into each environment and devcontainer during provisioning
3. Wire the MCP server URL to the controller's accessible address
4. Add UI for users to browse/select additional MCP servers from a library
5. Each selected MCP server gets added to the environment's `mcp.json` config
6. Devcontainers inherit the environment's MCP config plus any per-persona overrides

### Benefits
- Agents become context-aware about the platform
- Inter-agent communication becomes real-time (not git-based)
- Progress reporting becomes push-based (not polled)
- Reduces prompt bloat — agents pull context on-demand
- Users can extend agent capabilities via MCP server marketplace

### Risks
- Security: exposing Spyre internals needs careful sandboxing (read-only defaults, explicit write opt-in)
- Network: MCP server must be reachable from inside containers (controller IP + port forwarding)
- Maintenance: MCP tool schemas must stay in sync with Spyre's data model

### Decision
**Implement this.** Built-in Spyre MCP tools wired by default into every environment and devcontainer. User-selectable additional MCP servers via UI. Use `~/.claude/mcp.json` injection during provisioning.

**Priority: HIGH** — This is the single highest-value improvement and doesn't require SDK adoption.

---

## 3. Subagents — Lighter-Weight Multi-Agent

### Current State
Each "agent" is a full Docker devcontainer with its own Claude CLI instance, filesystem, and auth tokens. Heavy to create (Docker build + compose up), slow to start (~30-60s).

### What the SDK Offers
Inline subagent definitions — a parent agent spins up specialized sub-agents in the same process, with their own model/prompt/tools. Parent delegates via the `Task` tool.

### Trade-offs
- **Benefit**: No Docker overhead, different models per sub-agent (cost savings), parent maintains context
- **Limitation**: Sub-agents share the controller's filesystem, not the remote environment's — still need SSH/Docker for actual code changes in environments

### Decision
**Defer to SDK expansion plan.** No clear benefit for current CLI/SSH methods. When SDK is adopted, use subagents for read-only analysis within pipelines (code review, security scan, test analysis). Keep containers for code-writing agents.

---

## 4. Structured Output — Eliminate Regex Parsing

### Current State
`output-extractor.ts` uses regex to parse file paths from agent result summaries. Pipeline step results are free-text `result_summary` strings. No output format enforcement.

### What the SDK Offers
`outputFormat: { type: "json_schema", schema: ... }` forces valid JSON conforming to a schema.

### CLI Equivalent
The CLI does not have a direct `--output-format json_schema` option. However, there are potential approaches:
- **Prompt engineering**: Include JSON schema in the prompt and instruct the agent to output structured JSON as its final message. Parse the result from the stream-json output.
- **Post-processing**: After a task completes, run a lightweight Haiku call to extract structured data from the raw output.
- **Custom build**: Build a wrapper that intercepts the final `result` event from stream-json and validates/re-prompts if not valid JSON.

### Decision
**Defer structured output to SDK plan, but investigate CLI-compatible approaches.** Interested in knowing if there's an equivalent for CLI or something we can build custom. This is worth a spike to test prompt-engineered structured output via CLI.

### Investigation TODO
- [ ] Test whether Claude Code CLI respects structured output instructions in prompts reliably enough
- [ ] Prototype a post-processing step that extracts structured data from step results
- [ ] Evaluate building a custom wrapper around the stream-json parser that enforces schema

---

## 5. Hooks — Safety and Observability

### Current State
Agents run with `--dangerously-skip-permissions` — zero guardrails. No audit trail of tool calls. No way to block dangerous operations. The only safety net is running as non-root `spyre` user.

### What the SDK Offers
`PreToolUse` / `PostToolUse` hooks that can audit, modify, or block every tool call programmatically.

### CLI Equivalent
Claude Code supports file-based hooks via `~/.claude/hooks.json` (shell commands triggered before/after tool use). Also supports project-level hooks via `.claude/hooks.json` in the working directory.

### Proposed Hook Implementation

#### Audit Logging
Every tool call logged with timestamp, tool name, input summary, and result status:
```
[2026-02-26T14:23:01Z] [agent-backend] Bash: npm test → exit 0
[2026-02-26T14:23:05Z] [agent-backend] Edit: src/api/users.ts:45-52 → success
[2026-02-26T14:23:08Z] [agent-backend] Bash: rm -rf node_modules → BLOCKED
```

#### Danger Blocking (User-Configurable)
Default blocked patterns (human can validate/enable/disable each):
- `rm -rf /` and variants
- `git push --force` to main/master
- `DROP TABLE`, `TRUNCATE`
- Reading/writing `.env`, credentials files
- `chmod 777`
- `curl | bash` (pipe-to-shell)

**Critical**: Anything that inhibits agent work must be something the human can explicitly validate and enable. The UI should show a "Safety Rules" panel where users toggle individual rules on/off per environment or globally.

#### Persona-Based Permissions
See section 6 below — integrated into the same hook system.

### Architecture
```
Spyre Controller
  │
  ├── Generates hooks.json per environment/devcontainer
  │   based on: global safety rules + persona permissions + user overrides
  │
  ├── Injects into ~/.claude/hooks.json during provisioning
  │
  └── Hook scripts call back to Spyre's audit API
      POST /api/hooks/audit { envId, agentId, tool, input, timestamp }
```

### Implementation Approach
Whether to use `.claude/hooks.json` or a custom build is an implementation decision. Options:
1. **`.claude/hooks.json`** — native CLI support, shell-based hooks, lightweight
2. **Custom MCP wrapper** — intercept tool calls at the MCP level (more control, more complex)
3. **Hybrid** — use `.claude/hooks.json` for blocking + audit, MCP for richer integrations

### Decision
**Implement this.** Use whatever approach makes most sense for CLI — likely `.claude/hooks.json` for audit logging and danger blocking, with a Spyre UI for human validation/configuration of safety rules. Danger blocking and anything that inhibits agent work must be user-configurable.

**Priority: HIGH** — Safety and observability are critical for production use.

---

## 6. Per-Persona Permission Profiles

### Current State
All agents get `--dangerously-skip-permissions` regardless of persona role.

### Proposed Permission Model

| Persona | Read | Write/Edit | Bash | Web | Notes |
|---------|------|-----------|------|-----|-------|
| Architect | Full | Docs/configs only | Limited | Full | Design focus, minimal code changes |
| Backend | Full | Full | Full | Full | Full access for implementation |
| Frontend | Full | Full | Full | Full | Full access for implementation |
| Tester | Full | Test files only | Test commands | Full | Can't modify source code |
| Reviewer | Full | None | Read-only commands | Full | Pure analysis, no modifications |
| DevOps | Full | Full | Full | Full | Full access for infrastructure |

### Implementation
- Add a `permissions` JSON field to the `personas` table
- UI: Settings page where users configure permissions per persona
- Generate appropriate `.claude/hooks.json` per devcontainer based on persona's permission profile
- Hooks enforce the permission model at tool-call time

### Decision
**Implement this.** Enable users to configure permissions per persona in the settings UI. Permissions flow into the hook system (section 5) for enforcement.

**Priority: MEDIUM** — Depends on hook system (section 5) being built first.

---

## 7. Session Resumption — Lossless Pipeline Continuity

### Current State
Each pipeline step starts a fresh Claude session. Prior context is re-injected via `buildStepPrompt()` (summaries of prior work, git diffs, gate feedback). This is **lossy** — the agent doesn't remember its actual reasoning, just summaries of results.

### What's Available
CLI supports `--resume <session_id>` to continue a session with full conversation history. Spyre already stores `session_id` on `ClaudeTask` records and has a `resumeSession()` function in `claude-bridge.ts`.

### Key Insight: Single-Agent Context-Switching
Instead of multiple agents handing off between pipeline steps, a **single Claude session** could:
1. Start as Persona A (e.g., Architect) → design the solution
2. Context-switch to Persona B (e.g., Backend) → implement it
3. Context-switch to Persona C (e.g., Reviewer) → review the implementation
4. All within the same `--resume` chain — **zero context loss**

The persona switch would be injected as a new prompt:
```
You are now operating as [Backend Engineer]. Your previous work as [Architect]
is in this conversation. Implement the design you created. Your new instructions:
[persona.instructions]
```

### Trade-offs

**Benefits**:
- **Lossless context**: Agent remembers every decision, every file it read, every reasoning step
- **No re-injection overhead**: No need to summarize prior work or paste git diffs
- **Faster**: No process restart between steps
- **Cheaper**: No repeated context-window fill-up

**Risks**:
- **Context window limits**: Long pipelines will eventually hit the context ceiling
- **Single point of failure**: If the session crashes, all context is lost (vs. independent steps that can be retried)
- **Less parallelism**: Can't run steps concurrently if they share a session
- **Persona bleed**: Agent may not fully "switch" personas — earlier persona's reasoning style may persist
- **Debugging harder**: One long session vs. discrete step outputs

### Decision
**Investigate this as an additional pipeline mode — not a replacement for multi-agent.** If `--resume` with persona context-switching works reliably, offer it as a user-selectable option alongside the existing approach:

- **Multi-agent mode** (existing, unchanged): Separate containers, independent sessions, git-based coordination. Better for parallel work, isolation, and long-running pipelines. Remains the default.
- **Single-agent mode** (new, additive): One session with `--resume`, persona context-switching between steps. Better for sequential pipelines where context continuity matters. Lighter weight, cheaper, lossless context. User opts in per pipeline.

### Investigation TODO
- [ ] Prototype a 3-step pipeline using `--resume` with persona switching
- [ ] Measure context window usage across steps to estimate how many steps fit
- [ ] Test persona switching fidelity — does the agent actually change behavior?
- [ ] Compare output quality: lossless resume vs. lossy re-injection
- [ ] Define fallback: what happens when context window fills up mid-pipeline?

---

## 8. Cost Optimization via Model Routing

### Current State
All agents use whatever model Claude Code defaults to. No model selection per task type or persona.

### Proposed Model Routing

| Task Type | Model | Rationale |
|-----------|-------|-----------|
| Architecture/design | Opus | Complex reasoning, system thinking |
| Code writing | Sonnet | Good capability/cost balance |
| Code review | Sonnet | Pattern matching, sufficient quality |
| Test generation | Sonnet | Template-driven, moderate complexity |
| Linting/formatting | Haiku | Simple rule application |
| Progress summarization | Haiku | Low complexity extraction |
| Gate review preparation | Opus | Nuanced judgment needed |

### CLI Implementation
Claude Code CLI supports `--model <model>` flag. Spyre can inject this per-task:
```
claude --model sonnet -p '<prompt>' --output-format stream-json ...
```

### Decision
**Implement this at the persona level for CLI.** Add a `default_model` field to personas. Pipeline steps can override. Users configure per persona in settings.

**Priority: MEDIUM** — Easy to implement, meaningful cost savings for heavy pipeline users.

---

## Implementation Priority Summary

### Phase 1 — CLI-Compatible, No SDK Required

| # | Item | Effort | Impact | Section |
|---|------|--------|--------|---------|
| 1 | Spyre MCP server + tool injection | High | Very High | 2 |
| 2 | Hook system (audit + safety + permissions) | Medium | High | 5 |
| 3 | Per-persona permission profiles in UI | Medium | Medium | 6 |
| 4 | Model routing per persona/step | Low | Medium | 8 |
| 5 | Session resumption pipeline mode (spike) | Low | High (if it works) | 7 |

### Phase 2 — SDK Expansion (Future Plan)

| # | Item | Effort | Impact | Section |
|---|------|--------|--------|---------|
| 6 | Adopt SDK for controller-side agents | High | High | 1 |
| 7 | Structured output for pipeline steps | Medium | Medium | 4 |
| 8 | Subagents for analysis tasks | Medium | Medium | 3 |

---

## Files Referenced

| File | Role |
|------|------|
| `src/lib/server/claude-bridge.ts` | Agent dispatch, CLI invocation, stream parsing, context injection |
| `src/lib/server/devcontainers.ts` | Docker multi-agent lifecycle, auth propagation, persona CLAUDE.md |
| `src/lib/server/pipeline-engine.ts` | Pipeline state machine, step dispatch, context building |
| `src/lib/server/personas.ts` | Persona CRUD, defaults, usage tracking |
| `src/lib/server/claude-poller.ts` | Progress/git polling from environments |
| `src/lib/server/output-extractor.ts` | Regex-based file path extraction from results |
| `src/lib/server/claude-auth.ts` | OAuth token management, credential propagation |
| `src/lib/types/persona.ts` | Persona interface |
| `src/lib/types/claude.ts` | Task/event types |
| `src/lib/types/pipeline.ts` | Pipeline/step types |
| `src/lib/types/devcontainer.ts` | Devcontainer types |
