import { getDb } from './db';
import { getPool } from './software-pools';
import { getScript } from './community-scripts';
import type { SoftwarePoolItem } from '$lib/types/template';

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
  message: string
): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO provisioning_log (env_id, phase, step, status, output, started_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `).run(envId, phase, message, status, null);
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
  const emit = (event: PhaseEvent) => {
    logProvisioningStep(ctx.envId, event.phase, event.status, event.message);
    onPhaseEvent?.(event);
  };

  // 1. Software Pools
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
