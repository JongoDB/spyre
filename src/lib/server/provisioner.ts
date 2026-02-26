import { readFileSync, existsSync } from 'node:fs';
import { getDb } from './db';
import { getPool } from './software-pools';
import { resolveInstructionsForOs } from './software-repo';
import { getScript } from './community-scripts';
import { getEnvConfig } from './env-config';
import type { SoftwarePoolItem } from '$lib/types/template';
import type { Persona } from '$lib/types/persona';

// =============================================================================
// Types
// =============================================================================

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface ProvisionerContext {
  envId: string;
  vmid: number;
  ip: string | null;
  rootPassword: string;
  exec: (command: string, timeoutMs?: number) => Promise<ExecResult>;
}

export interface ProvisionerRequest {
  software_pool_ids?: string[];
  software_ids?: string[];
  community_script_slug?: string;
  install_method_type?: string;
  custom_script?: string;
  default_user?: string;
}

export interface PhaseEvent {
  phase: string;
  status: 'running' | 'success' | 'error' | 'skipped';
  message: string;
}

export type OnPhaseEvent = (event: PhaseEvent) => void;

// =============================================================================
// Logging
// =============================================================================

function logProvisioningStep(
  envId: string,
  phase: string,
  status: 'running' | 'success' | 'error' | 'skipped',
  message: string,
  output?: string | null
): number {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO provisioning_log (env_id, phase, step, status, output, started_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `).run(envId, phase, message, status, output ?? null);
  return Number(result.lastInsertRowid);
}

function completeProvisioningStep(
  logId: number,
  status: 'success' | 'error' | 'skipped',
  output?: string | null
): void {
  const db = getDb();
  db.prepare(`
    UPDATE provisioning_log
    SET status = ?, output = COALESCE(?, output), completed_at = datetime('now')
    WHERE id = ?
  `).run(status, output ?? null, logId);
}

// =============================================================================
// Package Manager
// =============================================================================

/**
 * Detect the package manager available inside the container.
 */
export async function detectPackageManager(
  exec: ProvisionerContext['exec']
): Promise<'apt' | 'apk' | 'yum' | 'dnf' | null> {
  for (const pm of ['apt', 'apk', 'dnf', 'yum'] as const) {
    try {
      const result = await exec(`which ${pm} 2>/dev/null`);
      if (result.code === 0 && result.stdout.trim()) return pm;
    } catch {
      // continue
    }
  }
  return null;
}

/**
 * Build the install command string for a given package manager.
 */
export function buildInstallCommand(pm: 'apt' | 'apk' | 'dnf' | 'yum', packages: string): string {
  switch (pm) {
    case 'apt':
      return `DEBIAN_FRONTEND=noninteractive apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ${packages}`;
    case 'apk':
      return `apk add --no-cache ${packages}`;
    case 'dnf':
      return `dnf install -y ${packages}`;
    case 'yum':
      return `yum install -y ${packages}`;
  }
}

/**
 * Install packages using the detected or specified package manager.
 */
async function installPackages(
  exec: ProvisionerContext['exec'],
  packages: string,
  specifiedPm?: 'auto' | 'apt' | 'apk' | 'dnf' | 'yum' | null
): Promise<ExecResult & { skipped?: boolean; skip_reason?: string }> {
  const detected = await detectPackageManager(exec);

  if (specifiedPm && specifiedPm !== 'auto') {
    // User specified a specific PM — check if it matches what's available
    if (detected !== specifiedPm) {
      return {
        code: 0,
        stdout: '',
        stderr: '',
        skipped: true,
        skip_reason: `Package manager '${specifiedPm}' not available (detected: ${detected ?? 'none'})`
      };
    }
    return exec(buildInstallCommand(specifiedPm, packages), 120000);
  }

  // Auto-detect
  if (!detected) {
    return { code: 1, stdout: '', stderr: 'No package manager found (apt/apk/dnf/yum)' };
  }

  return exec(buildInstallCommand(detected, packages), 120000);
}

// =============================================================================
// Software Pool Items
// =============================================================================

/**
 * Execute a single software pool item inside the container.
 * Supports conditional execution, OS-aware packages, interpreter selection,
 * URL sources, file permissions, and emits per-item phase events.
 */
export async function executeSoftwarePoolItem(
  exec: ProvisionerContext['exec'],
  item: SoftwarePoolItem,
  onItemEvent?: OnPhaseEvent
): Promise<void> {
  const label = item.label || item.content.slice(0, 50);

  // Conditional execution — run condition command first
  if (item.condition) {
    try {
      const condResult = await exec(item.condition, 10000);
      if (condResult.code !== 0) {
        console.log(`[spyre] Skipping "${label}": condition failed (exit ${condResult.code})`);
        onItemEvent?.({ phase: 'software_pool', status: 'skipped', message: `Skipped "${label}": condition failed` });
        return;
      }
    } catch {
      console.log(`[spyre] Skipping "${label}": condition check errored`);
      onItemEvent?.({ phase: 'software_pool', status: 'skipped', message: `Skipped "${label}": condition check errored` });
      return;
    }
  }

  onItemEvent?.({ phase: 'software_pool', status: 'running', message: `Running: ${label}` });

  try {
    switch (item.item_type) {
      case 'package': {
        console.log(`[spyre] Installing packages: ${item.content}`);
        const result = await installPackages(exec, item.content, item.package_manager);
        if ('skipped' in result && result.skipped) {
          console.log(`[spyre] Package install skipped: ${result.skip_reason}`);
          onItemEvent?.({ phase: 'software_pool', status: 'skipped', message: `Skipped "${label}": ${result.skip_reason}` });
          return;
        }
        if (result.code !== 0) {
          console.warn(`[spyre] Package install warning: ${result.stderr.slice(0, 200)}`);
          onItemEvent?.({ phase: 'software_pool', status: 'error', message: `Package install "${label}" failed (exit ${result.code})` });
          return;
        }
        break;
      }
      case 'script': {
        console.log(`[spyre] Running script: ${label}`);
        const interpreter = item.interpreter || 'bash';

        let result: ExecResult;
        if (item.source_url) {
          // Fetch from URL and pipe to interpreter
          const cmd = `curl -fsSL '${item.source_url}' | ${interpreter}`;
          result = await exec(cmd, 120000);
        } else {
          // Write to temp file and execute with interpreter
          const tmpFile = `/tmp/spyre-script-${Date.now()}`;
          const writeCmd = `cat > '${tmpFile}' << 'SPYRE_SCRIPT_EOF'\n${item.content}\nSPYRE_SCRIPT_EOF`;
          await exec(writeCmd, 30000);
          result = await exec(`${interpreter} '${tmpFile}' && rm -f '${tmpFile}'`, 120000);
        }

        if (result.code !== 0) {
          console.warn(`[spyre] Script exited with code ${result.code}: ${result.stderr.slice(0, 200)}`);
          onItemEvent?.({ phase: 'software_pool', status: 'error', message: `Script "${label}" failed (exit ${result.code})` });
          return;
        }
        break;
      }
      case 'file': {
        const dest = item.destination || '/tmp/spyre-file';
        console.log(`[spyre] Writing file to ${dest}`);

        if (item.source_url) {
          // Download from URL
          const cmd = `mkdir -p "$(dirname '${dest}')" && curl -fsSL -o '${dest}' '${item.source_url}'`;
          const result = await exec(cmd, 60000);
          if (result.code !== 0) {
            console.warn(`[spyre] File download failed: ${result.stderr.slice(0, 200)}`);
            onItemEvent?.({ phase: 'software_pool', status: 'error', message: `File download "${label}" failed (exit ${result.code})` });
            return;
          }
        } else {
          const writeCmd = `mkdir -p "$(dirname '${dest}')" && cat > '${dest}' << 'SPYRE_EOF'\n${item.content}\nSPYRE_EOF`;
          const result = await exec(writeCmd, 30000);
          if (result.code !== 0) {
            console.warn(`[spyre] File write failed: ${result.stderr.slice(0, 200)}`);
            onItemEvent?.({ phase: 'software_pool', status: 'error', message: `File write "${label}" failed (exit ${result.code})` });
            return;
          }
        }

        // Apply file permissions
        if (item.file_mode) {
          await exec(`chmod ${item.file_mode} '${dest}'`, 10000);
        }
        if (item.file_owner) {
          await exec(`chown ${item.file_owner} '${dest}'`, 10000);
        }
        break;
      }
    }

    // Run post_command if specified
    if (item.post_command) {
      console.log(`[spyre] Running post-command: ${item.post_command.slice(0, 50)}`);
      const result = await exec(item.post_command, 60000);
      if (result.code !== 0) {
        console.warn(`[spyre] Post-command exited with code ${result.code}: ${result.stderr.slice(0, 200)}`);
        onItemEvent?.({ phase: 'software_pool', status: 'error', message: `Post-command for "${label}" failed (exit ${result.code})` });
        return;
      }
    }

    onItemEvent?.({ phase: 'software_pool', status: 'success', message: `Completed: ${label}` });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[spyre] Item "${label}" execution error:`, msg);
    onItemEvent?.({ phase: 'software_pool', status: 'error', message: `Error in "${label}": ${msg}` });
  }
}

// =============================================================================
// Dry-Run Preview
// =============================================================================

export interface PreviewCommand {
  index: number;
  label: string;
  command: string;
  skipped?: boolean;
  skip_reason?: string;
}

/**
 * Generate a preview of the commands that would be run for a set of pool items.
 * Does not execute anything — purely generates the command strings.
 */
export function generatePreview(
  items: SoftwarePoolItem[],
  targetPm?: 'apt' | 'apk' | 'dnf' | 'yum'
): PreviewCommand[] {
  const commands: PreviewCommand[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const label = item.label || item.content.slice(0, 50);
    const conditionNote = item.condition ? `\n# Condition: ${item.condition} must exit 0` : '';

    switch (item.item_type) {
      case 'package': {
        const specifiedPm = item.package_manager && item.package_manager !== 'auto'
          ? item.package_manager
          : null;
        const effectivePm = specifiedPm ?? targetPm ?? 'apt';

        // If user specified a PM that doesn't match the target, mark as skipped
        if (specifiedPm && targetPm && specifiedPm !== targetPm) {
          commands.push({
            index: i,
            label,
            command: buildInstallCommand(specifiedPm, item.content),
            skipped: true,
            skip_reason: `Package manager '${specifiedPm}' not available on target (has '${targetPm}')`
          });
        } else {
          let cmd = conditionNote + buildInstallCommand(effectivePm, item.content);
          if (item.post_command) cmd += `\n${item.post_command}`;
          commands.push({ index: i, label, command: cmd.trimStart() });
        }
        break;
      }
      case 'script': {
        const interpreter = item.interpreter || 'bash';
        let cmd = conditionNote;

        if (item.source_url) {
          cmd += `curl -fsSL '${item.source_url}' | ${interpreter}`;
        } else {
          const tmpFile = `/tmp/spyre-script-<uuid>`;
          cmd += `cat > '${tmpFile}' << 'SPYRE_SCRIPT_EOF'\n${item.content}\nSPYRE_SCRIPT_EOF\n${interpreter} '${tmpFile}' && rm -f '${tmpFile}'`;
        }

        if (item.post_command) cmd += `\n${item.post_command}`;
        commands.push({ index: i, label, command: cmd.trimStart() });
        break;
      }
      case 'file': {
        const dest = item.destination || '/tmp/spyre-file';
        let cmd = conditionNote;

        if (item.source_url) {
          cmd += `mkdir -p "$(dirname '${dest}')" && curl -fsSL -o '${dest}' '${item.source_url}'`;
        } else {
          cmd += `mkdir -p "$(dirname '${dest}')" && cat > '${dest}' << 'SPYRE_EOF'\n${item.content}\nSPYRE_EOF`;
        }

        if (item.file_mode) cmd += `\nchmod ${item.file_mode} '${dest}'`;
        if (item.file_owner) cmd += `\nchown ${item.file_owner} '${dest}'`;
        if (item.post_command) cmd += `\n${item.post_command}`;
        commands.push({ index: i, label, command: cmd.trimStart() });
        break;
      }
    }
  }

  return commands;
}

// =============================================================================
// Default User
// =============================================================================

/**
 * Create a non-root user inside the container with sudo access.
 */
export async function createDefaultUser(
  exec: ProvisionerContext['exec'],
  rootPassword: string,
  username: string
): Promise<void> {
  console.log(`[spyre] Creating default user: ${username}`);

  const commands = [
    `id ${username} 2>/dev/null || useradd -m -s /bin/bash ${username}`,
    `echo '${username}:${rootPassword}' | chpasswd`,
    `which sudo >/dev/null 2>&1 || (apt-get update -qq && apt-get install -y -qq sudo 2>/dev/null) || apk add sudo 2>/dev/null || yum install -y sudo 2>/dev/null || true`,
    `usermod -aG sudo ${username} 2>/dev/null || usermod -aG wheel ${username} 2>/dev/null || true`,
    `echo '${username} ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/${username} && chmod 440 /etc/sudoers.d/${username}`,
    `if [ -f /root/.ssh/authorized_keys ]; then mkdir -p /home/${username}/.ssh && cp /root/.ssh/authorized_keys /home/${username}/.ssh/ && chown -R ${username}:${username} /home/${username}/.ssh && chmod 700 /home/${username}/.ssh && chmod 600 /home/${username}/.ssh/authorized_keys; fi`
  ];

  for (const cmd of commands) {
    try {
      const result = await exec(cmd, 30000);
      if (result.code !== 0 && result.stderr) {
        console.warn(`[spyre] User creation step warning: ${result.stderr.slice(0, 200)}`);
      }
    } catch (err) {
      console.warn(`[spyre] User creation step failed:`, err);
    }
  }

  console.log(`[spyre] Default user '${username}' created with sudo access`);
}

// =============================================================================
// Spyre Tracking Injection
// =============================================================================

const SPYRE_PROGRESS_TRACKING = `## Spyre Progress Tracking

This environment is managed by Spyre. Maintain \`.spyre/progress.json\` to provide
visibility into your work.

### Rules

1. Update \`.spyre/progress.json\` after completing each significant step
2. Keep \`current_task\` updated with what you are actively doing
3. Move phases from \`in_progress\` to \`completed\` when done
4. Add blockers to the \`blockers\` array; clear when resolved
5. Update \`metrics\` with files_changed, tests_passing, tests_failing when applicable
6. Always update \`updated_at\` with current ISO timestamp

### progress.json Schema

\`\`\`json
{
  "plan": "High-level description of the goal",
  "phases": [
    { "name": "Phase name", "status": "pending|in_progress|completed|error", "detail": "Current activity" }
  ],
  "current_task": "What you are doing right now",
  "blockers": [],
  "metrics": { "files_changed": 0, "tests_passing": 0, "tests_failing": 0 },
  "updated_at": "ISO timestamp"
}
\`\`\`

### When to Update

- Starting work: set \`plan\`, add phases as \`pending\`, set first to \`in_progress\`
- Completing a phase: set to \`completed\`, advance next to \`in_progress\`
- Encountering a problem: add to \`blockers\`, set phase to \`error\` with detail
- After running tests: update \`metrics.tests_passing\` and \`metrics.tests_failing\`
`;

/**
 * Build the full CLAUDE.md content for an environment.
 * When a persona is assigned, its instructions come first, followed by the standard
 * progress tracking section. When no persona, just the progress tracking rules.
 */
/**
 * Build the CLAUDE.md content for an environment or devcontainer.
 * Supports optional project context (repo URL, branch, project dir).
 */
function buildClaudeMd(
  persona: Persona | null,
  projectContext?: { repoUrl?: string | null; gitBranch?: string; projectDir?: string } | null
): string {
  const parts: string[] = [];

  if (persona) {
    parts.push(`# ${persona.name} — ${persona.role}`);
    parts.push('');
    if (persona.instructions.trim()) {
      parts.push(persona.instructions);
      parts.push('');
      parts.push('---');
      parts.push('');
    }
  } else {
    parts.push('# Spyre Agent');
    parts.push('');
  }

  if (projectContext?.repoUrl || projectContext?.projectDir) {
    parts.push('## Project');
    parts.push('');
    parts.push(`This environment has a project at \`${projectContext.projectDir ?? '/project'}\`.`);
    parts.push('All work should be done within this directory unless specified otherwise.');
    parts.push('');
    parts.push(`Repository: ${projectContext.repoUrl ?? 'Local repository'}`);
    parts.push(`Branch: ${projectContext.gitBranch ?? 'main'}`);
    parts.push('');
    parts.push('**Important**: Other agents may also be working in this directory.');
    parts.push('Always pull before starting work and commit frequently.');
    parts.push('');
    parts.push('---');
    parts.push('');
  }

  parts.push(SPYRE_PROGRESS_TRACKING);

  return parts.join('\n');
}

const EMPTY_PROGRESS = JSON.stringify({
  plan: null,
  phases: [],
  current_task: null,
  blockers: [],
  metrics: { files_changed: 0, tests_passing: 0, tests_failing: 0 },
  updated_at: null
}, null, 2);

/**
 * Inject .spyre/ tracking directory and CLAUDE.md into an environment.
 * Does NOT install Claude CLI or propagate credentials — use installClaudeInEnvironment() for that.
 *
 * When a persona is provided, CLAUDE.md includes the persona's instructions
 * and a .spyre/persona.json metadata file is written for the poller.
 */
export async function injectSpyreTracking(
  exec: ProvisionerContext['exec'],
  workingDir?: string,
  persona?: Persona | null,
  projectContext?: { repoUrl?: string | null; gitBranch?: string; projectDir?: string } | null
): Promise<void> {
  const baseDir = workingDir ?? '/root';

  // Create .spyre directory
  await exec(`mkdir -p '${baseDir}/.spyre'`, 10000);

  // Seed progress.json with empty schema
  const progressPath = `${baseDir}/.spyre/progress.json`;
  const writeProgress = `cat > '${progressPath}' << 'SPYRE_PROGRESS_EOF'\n${EMPTY_PROGRESS}\nSPYRE_PROGRESS_EOF`;
  await exec(writeProgress, 10000);

  // Write CLAUDE.md with persona instructions + project context + tracking rules
  const claudeMdContent = buildClaudeMd(persona ?? null, projectContext ?? null);
  const claudeMdPath = `${baseDir}/CLAUDE.md`;
  const writeMd = `cat >> '${claudeMdPath}' << 'SPYRE_CLAUDEMD_EOF'\n${claudeMdContent}\nSPYRE_CLAUDEMD_EOF`;
  await exec(writeMd, 10000);

  // Write persona metadata for the poller to read
  if (persona) {
    const personaMeta = JSON.stringify({ name: persona.name, role: persona.role, avatar: persona.avatar }, null, 2);
    const personaPath = `${baseDir}/.spyre/persona.json`;
    const writePersona = `cat > '${personaPath}' << 'SPYRE_PERSONA_EOF'\n${personaMeta}\nSPYRE_PERSONA_EOF`;
    await exec(writePersona, 10000);
  }

  // Write project metadata
  if (projectContext?.repoUrl || projectContext?.projectDir) {
    const projectMeta = JSON.stringify({
      repo_url: projectContext.repoUrl ?? null,
      git_branch: projectContext.gitBranch ?? 'main',
      project_dir: projectContext.projectDir ?? '/project'
    }, null, 2);
    const projectPath = `${baseDir}/.spyre/project.json`;
    const writeProject = `cat > '${projectPath}' << 'SPYRE_PROJECT_EOF'\n${projectMeta}\nSPYRE_PROJECT_EOF`;
    await exec(writeProject, 10000);
  }
}

/**
 * Install Claude CLI and propagate controller credentials into an environment.
 * This is separate from injectSpyreTracking() so it can be called conditionally.
 */
export async function installClaudeInEnvironment(
  exec: ProvisionerContext['exec'],
  workingDir?: string
): Promise<void> {
  const baseDir = workingDir ?? '/root';

  // Install Claude CLI (non-fatal if fails)
  try {
    const checkResult = await exec('which claude 2>/dev/null || command -v claude 2>/dev/null', 5000);
    if (checkResult.code !== 0) {
      console.log('[spyre] Installing Claude CLI in environment...');

      // Ensure curl is available — minimal LXC templates (Debian, Alpine) don't ship it
      const hasCurl = await exec('which curl 2>/dev/null', 3000);
      if (hasCurl.code !== 0) {
        console.log('[spyre] curl not found — installing it first...');
        // Try apt (Debian/Ubuntu), then apk (Alpine), then dnf/yum (RHEL)
        await exec(
          'apt-get update -qq && apt-get install -y -qq curl 2>&1 || ' +
          'apk add --no-cache curl 2>&1 || ' +
          'dnf install -y -q curl 2>&1 || ' +
          'yum install -y -q curl 2>&1',
          120000
        );
      }

      // Try the official installer first (with retry for rate limiting)
      const installResult = await exec('for i in 1 2 3; do curl -fsSL https://claude.ai/install.sh | sh 2>&1 && break; echo "Install attempt $i failed, retrying in 5s..." >&2; sleep 5; done', 300000);
      console.log(`[spyre] Claude install script exit code: ${installResult.code}`);
      if (installResult.stdout) {
        console.log(`[spyre] Claude install output:\n${installResult.stdout.slice(-2000)}`);
      }

      // Check if the installer actually made `claude` available.
      // The installer's `claude install` subcommand often fails in non-interactive
      // SSH/pct-exec contexts (no TTY). Search everywhere for the binary.
      const searchResult = await exec(
        'export PATH="/home/spyre/.local/bin:/home/spyre/.claude/local/bin:/root/.local/bin:/root/.claude/local/bin:$PATH"; ' +
        'which claude 2>/dev/null || ' +
        'command -v claude 2>/dev/null || ' +
        'find / -name claude \\( -type f -o -type l \\) -executable 2>/dev/null | head -1',
        15000
      );
      const foundBinary = searchResult.stdout.trim().split('\n')[0];
      console.log(`[spyre] Binary search result: "${foundBinary}" (exit ${searchResult.code})`);

      if (foundBinary && foundBinary.startsWith('/')) {
        // Found it — ensure it's accessible system-wide via /usr/local/bin
        if (foundBinary !== '/usr/local/bin/claude') {
          await exec(`ln -sf '${foundBinary}' /usr/local/bin/claude`, 5000);
          console.log(`[spyre] Symlinked ${foundBinary} -> /usr/local/bin/claude`);
        }
      } else {
        // Official installer didn't produce a usable binary.
        // Fallback: download the binary directly and place it in /usr/local/bin.
        // Uses retry with exponential backoff to handle 429 rate limiting.
        console.log('[spyre] Official installer did not produce a binary — downloading directly...');
        const directInstall = await exec(
          'set -e; ' +
          'GCS="https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases"; ' +
          'case "$(uname -m)" in x86_64|amd64) arch="x64" ;; arm64|aarch64) arch="arm64" ;; *) echo "Unsupported arch: $(uname -m)" >&2; exit 1 ;; esac; ' +
          'if ldd /bin/ls 2>&1 | grep -q musl; then platform="linux-${arch}-musl"; else platform="linux-${arch}"; fi; ' +
          // Retry wrapper: up to 4 attempts with exponential backoff (5s, 10s, 20s)
          'download_with_retry() { ' +
          '  local url="$1" out="$2" attempt=0 max=4 wait=5; ' +
          '  while [ $attempt -lt $max ]; do ' +
          '    if curl -fsSL -o "$out" "$url" 2>&1; then return 0; fi; ' +
          '    attempt=$((attempt + 1)); ' +
          '    if [ $attempt -lt $max ]; then ' +
          '      echo "Download failed (attempt $attempt/$max), retrying in ${wait}s..." >&2; ' +
          '      sleep $wait; wait=$((wait * 2)); ' +
          '    fi; ' +
          '  done; ' +
          '  return 1; ' +
          '}; ' +
          'version=$(download_with_retry "$GCS/latest" /dev/stdout); ' +
          'download_with_retry "$GCS/$version/$platform/claude" /tmp/claude-dl; ' +
          'chmod +x /tmp/claude-dl; ' +
          'mv /tmp/claude-dl /usr/local/bin/claude; ' +
          'echo "direct-install: /usr/local/bin/claude $version $platform"',
          180000
        );
        console.log(`[spyre] Direct install: ${directInstall.stdout.trim()}`);
        if (directInstall.code !== 0) {
          throw new Error(`Direct binary download failed (exit ${directInstall.code}): ${(directInstall.stdout + directInstall.stderr).slice(-500)}`);
        }
      }

      // Final verification
      const verifyResult = await exec('claude --version 2>&1', 15000);
      const verifyOut = verifyResult.stdout.trim();
      if (verifyResult.code !== 0) {
        throw new Error(`Claude binary not functional after install: ${verifyOut.slice(-300)}`);
      }
      console.log(`[spyre] Claude CLI verified: ${verifyOut}`);
    } else {
      console.log(`[spyre] Claude CLI already installed: ${checkResult.stdout.trim()}`);
    }

    // Seed ~/.claude.json to skip interactive onboarding wizard.
    // Claude Code checks hasCompletedOnboarding and theme on startup — if either
    // is missing it launches the interactive wizard, which blocks headless execution.
    await exec(
      `node -e "` +
        `const fs = require('fs');` +
        `const p = (process.env.CLAUDE_CONFIG_DIR || process.env.HOME) + '/.claude.json';` +
        `let c = {};` +
        `try { c = JSON.parse(fs.readFileSync(p, 'utf8')); } catch(e) {}` +
        `c.hasCompletedOnboarding = true;` +
        `if (!c.theme) c.theme = 'dark';` +
        `fs.writeFileSync(p, JSON.stringify(c, null, 2));` +
      `"`,
      10000
    );
    console.log('[spyre] Claude config seeded (hasCompletedOnboarding + theme)');
  } catch (err) {
    console.warn('[spyre] Claude CLI installation failed (non-fatal):', err);
    // Re-throw so the caller (environments.ts) can log it as a provisioning error step
    throw err;
  }

  // Propagate controller's Claude auth credentials into environment (non-fatal)
  try {
    await propagateClaudeAuth(exec, baseDir);
  } catch (err) {
    console.warn('[spyre] Claude auth propagation failed (non-fatal):', err);
  }
}

/**
 * Copy the controller's Claude credentials into an environment so Claude CLI
 * works immediately without requiring a separate OAuth flow.
 */
async function propagateClaudeAuth(
  exec: ProvisionerContext['exec'],
  baseDir: string
): Promise<void> {
  const config = getEnvConfig();
  const authPath = (config.claude?.auth_json_path ?? '~/.claude/.credentials.json')
    .replace('~', process.env.HOME ?? '/root');

  if (!existsSync(authPath)) {
    console.log('[spyre] No controller Claude credentials to propagate');
    return;
  }

  const credentials = readFileSync(authPath, 'utf-8');

  // Validate it's valid JSON before propagating
  try {
    JSON.parse(credentials);
  } catch {
    console.warn('[spyre] Controller credentials file is not valid JSON, skipping propagation');
    return;
  }

  // Create ~/.claude directory in the environment (using the env user's home)
  const envClaudeDir = `${baseDir}/.claude`;
  await exec(`mkdir -p '${envClaudeDir}'`, 10000);

  // Write credentials via heredoc (safe for JSON content)
  const writeCmd = `cat > '${envClaudeDir}/.credentials.json' << 'SPYRE_CREDS_EOF'\n${credentials}\nSPYRE_CREDS_EOF`;
  await exec(writeCmd, 10000);

  // Secure the file
  await exec(`chmod 600 '${envClaudeDir}/.credentials.json'`, 5000);

  console.log('[spyre] Claude credentials propagated to environment');

  // Write .claude.json (inside ~/.claude/) with full config to skip onboarding
  const claudeJsonData = buildClaudeJson(authPath);
  if (claudeJsonData) {
    // Use the container's actual Claude version for lastOnboardingVersion
    try {
      const versionResult = await exec('claude --version 2>/dev/null', 10000);
      const installedVersion = versionResult.stdout.trim();
      if (installedVersion) {
        claudeJsonData.lastOnboardingVersion = installedVersion;
        claudeJsonData.lastReleaseNotesSeen = installedVersion;
        console.log(`[spyre] Using container Claude version for onboarding: ${installedVersion}`);
      }
    } catch {
      // keep controller's version as fallback
    }

    const claudeJsonContent = JSON.stringify(claudeJsonData, null, 2);
    const writeClaudeJson = `cat > '${envClaudeDir}/.claude.json' << 'SPYRE_CLAUDEJSON_EOF'\n${claudeJsonContent}\nSPYRE_CLAUDEJSON_EOF`;
    await exec(writeClaudeJson, 10000);
    await exec(`chmod 600 '${envClaudeDir}/.claude.json'`, 5000);
    console.log('[spyre] Claude config (~/.claude/.claude.json) propagated');
  }

  // Also write ~/.claude.json at home root — Claude Code checks this location
  // for install/init state separately from ~/.claude/.claude.json
  const homeClaudeJson = buildHomeClaudeJson();
  if (homeClaudeJson) {
    const homeContent = JSON.stringify(homeClaudeJson, null, 2);
    const writeHomeJson = `cat > '${baseDir}/.claude.json' << 'SPYRE_HOMECJ_EOF'\n${homeContent}\nSPYRE_HOMECJ_EOF`;
    await exec(writeHomeJson, 10000);
    await exec(`chmod 600 '${baseDir}/.claude.json'`, 5000);
    console.log('[spyre] Claude home config (~/.claude.json) propagated');
  }

  // Verify auth status in the container
  try {
    const verifyResult = await exec('claude auth status 2>&1', 15000);
    console.log(`[spyre] Claude auth verification: exit=${verifyResult.code} output=${verifyResult.stdout.trim().slice(0, 200)}`);
  } catch (err) {
    console.warn('[spyre] Claude auth verification failed (non-fatal):', err);
  }
}

/**
 * Read the controller's .claude.json and build a copy suitable for containers.
 * Copies the full config (auth, onboarding, initialization state) but strips
 * controller-specific paths. Returns a mutable object so callers can patch
 * version-specific fields.
 */
function buildClaudeJson(credentialsPath: string): Record<string, unknown> | null {
  // .claude.json lives alongside .credentials.json in the same directory
  const claudeJsonPath = credentialsPath.replace(/\.credentials\.json$/, '.claude.json');

  if (!existsSync(claudeJsonPath)) {
    console.log('[spyre] No controller .claude.json found, skipping config propagation');
    return null;
  }

  try {
    const raw = readFileSync(claudeJsonPath, 'utf-8');
    const full = JSON.parse(raw) as Record<string, unknown>;

    // Copy everything, then strip controller-specific fields
    const config = { ...full };
    delete config.projects;
    delete config.githubRepoPaths;

    // Ensure critical auth/init fields are set
    config.hasCompletedOnboarding = true;
    if (!config.theme) config.theme = 'dark';
    if (!config.numStartups || (config.numStartups as number) < 1) {
      config.numStartups = 1;
    }

    return config;
  } catch (err) {
    console.warn('[spyre] Failed to read/parse controller .claude.json:', err);
    return null;
  }
}

/**
 * Build the home-root ~/.claude.json that Claude Code checks for install/init state.
 * This is separate from ~/.claude/.claude.json and contains installation metadata.
 */
function buildHomeClaudeJson(): Record<string, unknown> | null {
  const home = process.env.HOME ?? '/root';
  const homePath = `${home}/.claude.json`;

  let config: Record<string, unknown>;

  if (!existsSync(homePath)) {
    // No home-root config on controller; create a minimal one
    config = {
      installMethod: 'native',
      autoUpdates: false,
      firstStartTime: new Date().toISOString(),
      opusProMigrationComplete: true,
      sonnet1m45MigrationComplete: true,
      autoUpdatesProtectedForNative: true
    };
  } else {
    try {
      const raw = readFileSync(homePath, 'utf-8');
      config = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  // Ensure onboarding bypass fields are always set — Claude Code launches
  // the interactive wizard if either is missing, blocking headless execution
  config.hasCompletedOnboarding = true;
  if (!config.theme) config.theme = 'dark';

  return config;
}

// =============================================================================
// Pipeline
// =============================================================================

/**
 * Run the full provisioner pipeline after container creation.
 * Pipeline order: software pools -> community script -> custom script -> default user
 *
 * Uses injected exec context instead of importing SSH helpers directly,
 * making this testable with mocked exec functions.
 */
export async function runPipeline(
  ctx: ProvisionerContext,
  req: ProvisionerRequest,
  onPhaseEvent?: OnPhaseEvent
): Promise<void> {
  const emit = (event: PhaseEvent, output?: string | null) => {
    const logId = logProvisioningStep(ctx.envId, event.phase, event.status, event.message, output);
    if (event.status !== 'running') {
      completeProvisioningStep(logId, event.status, output);
    }
    onPhaseEvent?.(event);
  };

  // 0. Software Repo entries (new flat catalog)
  if (req.software_ids && req.software_ids.length > 0) {
    emit({ phase: 'software_pool', status: 'running', message: 'Installing software from catalog...' });
    try {
      // Detect OS package manager to resolve correct instructions
      const detectedPm = await detectPackageManager(ctx.exec);
      const osFamily = detectedPm ?? 'apt';
      const items = resolveInstructionsForOs(req.software_ids, osFamily);

      console.log(`[spyre] Resolved ${items.length} instructions for OS family '${osFamily}' from ${req.software_ids.length} software entries`);
      for (const item of items) {
        await executeSoftwarePoolItem(ctx.exec, item, emit);
      }
      emit({ phase: 'software_pool', status: 'success', message: 'Software catalog items installed.' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      emit({ phase: 'software_pool', status: 'error', message: msg });
      console.warn('[spyre] Software repo execution error:', msg);
    }
  }

  // 1. Software Pools (legacy)
  if (req.software_pool_ids && req.software_pool_ids.length > 0) {
    emit({ phase: 'software_pool', status: 'running', message: 'Installing software pools...' });
    try {
      for (const poolId of req.software_pool_ids) {
        const pool = getPool(poolId);
        if (!pool) {
          console.warn(`[spyre] Software pool ${poolId} not found — skipping`);
          continue;
        }

        console.log(`[spyre] Executing software pool: ${pool.name} (${pool.items.length} items)`);
        for (const item of pool.items) {
          await executeSoftwarePoolItem(ctx.exec, item, emit);
        }
      }
      emit({ phase: 'software_pool', status: 'success', message: 'Software pools installed.' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      emit({ phase: 'software_pool', status: 'error', message: msg });
      console.warn('[spyre] Software pool execution error:', msg);
    }
  }

  // 2. Community Script (in-container execution)
  if (req.community_script_slug) {
    emit({ phase: 'community_script', status: 'running', message: `Installing community script: ${req.community_script_slug}` });
    try {
      const script = getScript(req.community_script_slug);
      if (script && script.install_methods.length > 0) {
        const method = script.install_methods[0];
        if (method.script) {
          const scriptUrl = `https://raw.githubusercontent.com/community-scripts/ProxmoxVE/main/${method.script}`;
          console.log(`[spyre] Downloading and executing community script: ${scriptUrl}`);

          const result = await ctx.exec(
            `bash -c "$(curl -fsSL '${scriptUrl}')"`,
            300000
          );

          if (result.code !== 0) {
            console.warn(`[spyre] Community script exited with code ${result.code}: ${result.stderr.slice(0, 500)}`);
            emit({ phase: 'community_script', status: 'error', message: `Script exited with code ${result.code}` });
          } else {
            emit({ phase: 'community_script', status: 'success', message: 'Community script installed.' });
          }
        } else {
          emit({ phase: 'community_script', status: 'error', message: 'No install script URL found in script metadata.' });
        }
      } else {
        emit({ phase: 'community_script', status: 'error', message: `Community script '${req.community_script_slug}' not found in cache.` });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      emit({ phase: 'community_script', status: 'error', message: msg });
      console.warn('[spyre] Community script execution error:', msg);
    }
  }

  // 3. Custom Script
  if (req.custom_script) {
    emit({ phase: 'custom_script', status: 'running', message: 'Running custom provisioning script...' });
    try {
      console.log(`[spyre] Running custom script (${req.custom_script.length} chars)`);
      const result = await ctx.exec(req.custom_script, 300000);
      if (result.code !== 0) {
        console.warn(`[spyre] Custom script exited with code ${result.code}: ${result.stderr.slice(0, 500)}`);
        emit({ phase: 'custom_script', status: 'error', message: `Script exited with code ${result.code}` });
      } else {
        emit({ phase: 'custom_script', status: 'success', message: 'Custom script completed.' });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      emit({ phase: 'custom_script', status: 'error', message: msg });
      console.warn('[spyre] Custom script execution error:', msg);
    }
  }

  // 4. Default User
  if (req.default_user) {
    emit({ phase: 'post_provision', status: 'running', message: `Creating default user: ${req.default_user}` });
    try {
      await createDefaultUser(ctx.exec, ctx.rootPassword, req.default_user);
      emit({ phase: 'post_provision', status: 'success', message: `Default user '${req.default_user}' created.` });

      // Update metadata with default user
      const db = getDb();
      const env = db.prepare('SELECT metadata FROM environments WHERE id = ?').get(ctx.envId) as { metadata: string | null } | undefined;
      if (env?.metadata) {
        const meta = JSON.parse(env.metadata);
        meta.default_user = req.default_user;
        db.prepare("UPDATE environments SET metadata = ?, updated_at = datetime('now') WHERE id = ?")
          .run(JSON.stringify(meta), ctx.envId);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      emit({ phase: 'post_provision', status: 'error', message: msg });
      console.warn('[spyre] Default user creation error:', msg);
    }
  }
}
