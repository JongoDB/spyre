import { v4 as uuid } from 'uuid';
import { getDb } from './db';
import { getEnvironment } from './environments';
import { getConnection } from './ssh-pool';
import { getPersona } from './personas';
import { getSetting } from './settings';
import type { Devcontainer, DevcontainerCreateInput, DevcontainerWithPersona } from '$lib/types/devcontainer';
import type { Environment } from '$lib/types/environment';
import type { Persona } from '$lib/types/persona';
import type { ExecResult } from './provisioner';

// =============================================================================
// CRUD
// =============================================================================

export function listDevcontainers(envId: string): DevcontainerWithPersona[] {
  const db = getDb();
  return db.prepare(`
    SELECT d.*, p.name AS persona_name, p.role AS persona_role, p.avatar AS persona_avatar
    FROM devcontainers d
    LEFT JOIN personas p ON d.persona_id = p.id
    WHERE d.env_id = ?
    ORDER BY d.created_at ASC
  `).all(envId) as DevcontainerWithPersona[];
}

export function getDevcontainer(id: string): Devcontainer | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM devcontainers WHERE id = ?').get(id) as Devcontainer | undefined;
}

export function getDevcontainerWithPersona(id: string): DevcontainerWithPersona | undefined {
  const db = getDb();
  return db.prepare(`
    SELECT d.*, p.name AS persona_name, p.role AS persona_role, p.avatar AS persona_avatar
    FROM devcontainers d
    LEFT JOIN personas p ON d.persona_id = p.id
    WHERE d.id = ?
  `).get(id) as DevcontainerWithPersona | undefined;
}

// =============================================================================
// SSH Exec Helpers
// =============================================================================

/**
 * Execute a command inside the LXC/VM via SSH pool.
 * Returns { code, stdout, stderr }.
 */
async function envExec(envId: string, command: string, timeoutMs = 30000): Promise<ExecResult> {
  const client = await getConnection(envId);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Command timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    client.exec(command, (err, stream) => {
      if (err) { clearTimeout(timer); reject(err); return; }
      let stdout = '';
      let stderr = '';
      stream.on('data', (data: Buffer) => { stdout += data.toString(); });
      stream.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
      stream.on('close', (code: number) => {
        clearTimeout(timer);
        resolve({ code, stdout, stderr });
      });
    });
  });
}

/**
 * Execute a command inside a devcontainer (SSH to LXC → docker exec).
 */
export async function devcontainerExec(
  dcId: string,
  command: string,
  timeoutMs = 30000
): Promise<ExecResult> {
  const dc = getDevcontainer(dcId);
  if (!dc) throw new Error(`Devcontainer ${dcId} not found`);
  if (dc.status !== 'running') throw new Error(`Devcontainer ${dcId} is not running (status: ${dc.status})`);

  const escaped = command.replace(/'/g, "'\\''");
  const dockerCmd = `docker exec -u spyre ${dc.container_name} bash -c '${escaped}'`;
  return envExec(dc.env_id, dockerCmd, timeoutMs);
}

// =============================================================================
// Docker Infrastructure
// =============================================================================

/**
 * Check if Docker is installed in the environment. Install if missing.
 */
export async function ensureDockerInstalled(envId: string): Promise<void> {
  const check = await envExec(envId, 'docker --version 2>/dev/null', 10000);
  if (check.code === 0) {
    console.log(`[spyre] Docker already installed in env ${envId}`);
    return;
  }

  console.log(`[spyre] Installing Docker in env ${envId}...`);

  // Install Docker from official Docker repo, detecting distro (ubuntu vs debian)
  const install = await envExec(envId, [
    '. /etc/os-release',
    'apt-get update -qq',
    'DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ca-certificates curl gnupg',
    'install -m 0755 -d /etc/apt/keyrings',
    'curl -fsSL "https://download.docker.com/linux/${ID}/gpg" -o /etc/apt/keyrings/docker.asc',
    'chmod a+r /etc/apt/keyrings/docker.asc',
    'echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/${ID} ${VERSION_CODENAME} stable" > /etc/apt/sources.list.d/docker.list',
    'apt-get update -qq',
    'DEBIAN_FRONTEND=noninteractive apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin',
    'systemctl start docker',
    'systemctl enable docker'
  ].join(' && '), 300000);

  if (install.code !== 0) {
    throw new Error(`Docker installation failed: ${install.stderr.slice(-500)}`);
  }

  // Verify
  const verify = await envExec(envId, 'docker info >/dev/null 2>&1', 10000);
  if (verify.code !== 0) {
    throw new Error('Docker installed but daemon not responding');
  }

  console.log(`[spyre] Docker installed successfully in env ${envId}`);
}

/**
 * Generate a Dockerfile for devcontainers (Trail of Bits pattern).
 * Ubuntu 24.04 base with Claude Code, Node.js 22, Python 3, dev tools.
 */
export function generateDockerfile(): string {
  return `FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
ENV DISABLE_AUTOUPDATER=1
ENV DISABLE_TELEMETRY=1

# System packages
RUN apt-get update && apt-get install -y --no-install-recommends \\
    ca-certificates \\
    curl \\
    git \\
    gnupg \\
    build-essential \\
    python3 \\
    python3-pip \\
    ripgrep \\
    fd-find \\
    bubblewrap \\
    tmux \\
    zsh \\
    jq \\
    sudo \\
    openssh-client \\
    && rm -rf /var/lib/apt/lists/*

# Node.js 22
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \\
    && apt-get install -y nodejs \\
    && rm -rf /var/lib/apt/lists/*

# Claude Code CLI
RUN npm install -g @anthropic-ai/claude-code

# Non-root user for Claude Code (--dangerously-skip-permissions requires non-root)
RUN useradd -m -s /bin/bash spyre \\
    && echo 'spyre ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/spyre \\
    && chmod 440 /etc/sudoers.d/spyre

USER spyre

# Working directory
WORKDIR /workspace

# Keep container running
CMD ["sleep", "infinity"]
`;
}

/**
 * Generate docker-compose.yml for an environment's devcontainers.
 */
export function generateComposeFile(
  env: Environment,
  devcontainers: Devcontainer[]
): string {
  const services: Record<string, unknown> = {};
  const volumes: Record<string, unknown> = {};

  for (const dc of devcontainers) {
    const svc = dc.service_name;

    services[svc] = {
      build: `./devcontainers/${svc}`,
      container_name: dc.container_name,
      volumes: [
        `${env.project_dir}:/workspace`,
        `claude-auth-${svc}:/home/spyre/.claude`,
        `gh-config-${svc}:/home/spyre/.config/gh`,
        `shell-history-${svc}:/home/spyre/.shell-history`,
      ],
      environment: [
        'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1',
        'DISABLE_AUTOUPDATER=1',
        'DISABLE_TELEMETRY=1',
      ],
      restart: 'unless-stopped',
    };

    volumes[`claude-auth-${svc}`] = {};
    volumes[`gh-config-${svc}`] = {};
    volumes[`shell-history-${svc}`] = {};
  }

  // Generate YAML manually (simple structure, no need for yaml library on server)
  let yaml = 'services:\n';
  for (const [name, config] of Object.entries(services)) {
    const svc = config as Record<string, unknown>;
    yaml += `  ${name}:\n`;
    yaml += `    build: ${svc.build}\n`;
    yaml += `    container_name: ${svc.container_name}\n`;
    yaml += `    network_mode: host\n`;
    yaml += `    volumes:\n`;
    for (const vol of svc.volumes as string[]) {
      yaml += `      - ${vol}\n`;
    }
    yaml += `    environment:\n`;
    for (const envVar of svc.environment as string[]) {
      yaml += `      - ${envVar}\n`;
    }
    yaml += `    restart: ${svc.restart}\n`;
  }

  yaml += '\nvolumes:\n';
  for (const name of Object.keys(volumes)) {
    yaml += `  ${name}:\n`;
  }

  return yaml;
}

/**
 * Write Dockerfile + docker-compose.yml to the LXC at /opt/spyre/docker/.
 */
async function writeDevcontainerFiles(
  envId: string,
  env: Environment,
  devcontainers: Devcontainer[]
): Promise<void> {
  const baseDir = '/opt/spyre/docker';

  // Create directories
  const dirs = devcontainers.map(dc => `${baseDir}/devcontainers/${dc.service_name}`);
  await envExec(envId, `mkdir -p ${dirs.join(' ')}`, 10000);

  // Write Dockerfile for each devcontainer
  const dockerfile = generateDockerfile();
  for (const dc of devcontainers) {
    const path = `${baseDir}/devcontainers/${dc.service_name}/Dockerfile`;
    const writeCmd = `cat > '${path}' << 'SPYRE_DOCKERFILE_EOF'\n${dockerfile}\nSPYRE_DOCKERFILE_EOF`;
    await envExec(envId, writeCmd, 10000);
  }

  // Write docker-compose.yml
  const composeContent = generateComposeFile(env, devcontainers);
  const composePath = `${baseDir}/docker-compose.yml`;
  const writeCompose = `cat > '${composePath}' << 'SPYRE_COMPOSE_EOF'\n${composeContent}\nSPYRE_COMPOSE_EOF`;
  await envExec(envId, writeCompose, 10000);
}

// =============================================================================
// Auth Propagation
// =============================================================================

/**
 * Copy controller's Claude credentials into a devcontainer.
 */
export async function propagateClaudeAuthToDevcontainer(
  envId: string,
  containerName: string
): Promise<void> {
  const { readFileSync, existsSync } = await import('node:fs');
  const { getEnvConfig } = await import('./env-config');
  const config = getEnvConfig();
  const authPath = (config.claude?.auth_json_path ?? '~/.claude/.credentials.json')
    .replace('~', process.env.HOME ?? '/root');

  if (!existsSync(authPath)) {
    console.log('[spyre] No controller Claude credentials to propagate to devcontainer');
    return;
  }

  const credentials = readFileSync(authPath, 'utf-8');
  try { JSON.parse(credentials); } catch { return; }

  // Create .claude dir and write credentials inside the devcontainer.
  // Use -u root because Docker named volumes mount as root-owned;
  // spyre user can't write until we chown.
  const cmds = [
    `docker exec -u root ${containerName} mkdir -p /home/spyre/.claude`,
    `docker exec -u root ${containerName} bash -c 'cat > /home/spyre/.claude/.credentials.json << CREDS_EOF\n${credentials}\nCREDS_EOF'`,
    `docker exec -u root ${containerName} chmod 600 /home/spyre/.claude/.credentials.json`,
    `docker exec -u root ${containerName} chown -R spyre:spyre /home/spyre/.claude`,
  ];

  for (const cmd of cmds) {
    await envExec(envId, cmd, 10000);
  }

  // Seed .claude.json to skip onboarding (run as root, then chown)
  await envExec(envId,
    `docker exec -u root ${containerName} bash -c 'node -e "` +
    `const fs = require(\\\"fs\\\");` +
    `const p = \\\"/home/spyre/.claude.json\\\";` +
    `let c = {};` +
    `try { c = JSON.parse(fs.readFileSync(p, \\\"utf8\\\")); } catch(e) {}` +
    `c.hasCompletedOnboarding = true;` +
    `if (!c.theme) c.theme = \\\"dark\\\";` +
    `fs.writeFileSync(p, JSON.stringify(c, null, 2));` +
    `"'`,
    10000
  );
  await envExec(envId,
    `docker exec -u root ${containerName} chown spyre:spyre /home/spyre/.claude.json`,
    10000
  );

  console.log(`[spyre] Claude auth propagated to devcontainer ${containerName}`);
}

/**
 * Write GitHub auth (PAT) into a devcontainer.
 */
async function propagateGitHubAuthToDevcontainer(
  envId: string,
  containerName: string,
  personaName?: string
): Promise<void> {
  const token = getSetting('github_pat');
  if (!token) return;

  const gitUser = personaName ? personaName.toLowerCase().replace(/\s+/g, '-') : 'spyre-agent';
  const cmds = [
    // git config runs as spyre (writes to ~spyre/.gitconfig)
    `docker exec -u spyre ${containerName} git config --global user.name "${gitUser}"`,
    `docker exec -u spyre ${containerName} git config --global user.email "${gitUser}@spyre.local"`,
    // Volume mount is root-owned — use root for file writes, then chown
    `docker exec -u root ${containerName} mkdir -p /home/spyre/.config/gh`,
    `docker exec -u root ${containerName} bash -c 'cat > /home/spyre/.config/gh/hosts.yml << GH_EOF\ngithub.com:\n  oauth_token: ${token}\n  git_protocol: https\nGH_EOF'`,
    `docker exec -u root ${containerName} chmod 600 /home/spyre/.config/gh/hosts.yml`,
    `docker exec -u root ${containerName} chown -R spyre:spyre /home/spyre/.config`,
    `docker exec -u spyre ${containerName} git config --global credential.helper '!f() { echo "username=x-access-token"; echo "password=${token}"; }; f'`,
  ];

  for (const cmd of cmds) {
    await envExec(envId, cmd, 10000);
  }

  console.log(`[spyre] GitHub auth propagated to devcontainer ${containerName}`);
}

// =============================================================================
// Persona CLAUDE.md for Devcontainers
// =============================================================================

/**
 * Write persona-level CLAUDE.md inside a devcontainer at ~/.claude/CLAUDE.md.
 * This is the "global user-level" instructions that Claude Code reads alongside
 * the project-level /workspace/CLAUDE.md.
 */
async function writePersonaClaudeMd(
  envId: string,
  containerName: string,
  persona: Persona,
  siblingAgents: DevcontainerWithPersona[]
): Promise<void> {
  const parts: string[] = [];
  parts.push(`# ${persona.name} — ${persona.role}`);
  parts.push('');

  if (persona.instructions.trim()) {
    parts.push(persona.instructions);
    parts.push('');
  }

  // Add awareness of sibling agents
  if (siblingAgents.length > 0) {
    parts.push('## Other Active Agents');
    parts.push('');
    parts.push('You are one of several agents working on this project:');
    parts.push('');
    for (const sibling of siblingAgents) {
      const name = sibling.persona_name ?? sibling.service_name;
      const role = sibling.persona_role ?? 'general';
      parts.push(`- **${name}** (${role}) — service: ${sibling.service_name}`);
    }
    parts.push('');
    parts.push('Coordinate via git commits. Pull before starting work.');
    parts.push('');
  }

  parts.push('## Progress Tracking');
  parts.push('');
  parts.push('Maintain `/workspace/.spyre/progress.json` to report your status.');
  parts.push('Update `current_task` and phase statuses as you work.');
  parts.push('');
  parts.push('## Spyre MCP Tools');
  parts.push('');
  parts.push('You have access to the following Spyre-specific tools via MCP:');
  parts.push('');
  parts.push('- **spyre_get_env_status** — Query this environment\'s state, IP, and resources');
  parts.push('- **spyre_list_agents** — See all active agents and their current tasks');
  parts.push('- **spyre_get_pipeline_context** — Read pipeline state, steps, and gate feedback');
  parts.push('- **spyre_report_progress** — Report your progress (preferred over editing progress.json)');
  parts.push('- **spyre_get_services** — Query detected web services and ports');
  parts.push('- **spyre_get_git_activity** — Current branch, recent commits, diff stats');
  parts.push('- **spyre_get_task_history** — Recent task history for this environment');
  parts.push('- **spyre_send_message** — Send a message to another agent');
  parts.push('');
  parts.push('Use `spyre_report_progress` to keep the team updated on your work.');
  parts.push('Use `spyre_get_pipeline_context` to understand what prior steps have done.');

  const content = parts.join('\n');
  const cmd = `docker exec -u root ${containerName} bash -c 'mkdir -p /home/spyre/.claude && cat > /home/spyre/.claude/CLAUDE.md << PERSONA_EOF\n${content}\nPERSONA_EOF && chown -R spyre:spyre /home/spyre/.claude'`;
  await envExec(envId, cmd, 10000);
}

// =============================================================================
// Lifecycle
// =============================================================================

/**
 * Create a new devcontainer for a docker-enabled environment.
 * Inserts DB row, writes Docker files, builds + starts the container.
 */
export async function createDevcontainer(input: DevcontainerCreateInput): Promise<Devcontainer> {
  const db = getDb();
  const env = getEnvironment(input.env_id);
  if (!env) throw new Error(`Environment ${input.env_id} not found`);
  if (!env.docker_enabled) throw new Error(`Environment ${input.env_id} does not have Docker enabled`);
  if (env.status !== 'running') throw new Error(`Environment ${input.env_id} is not running`);

  const persona = input.persona_id ? getPersona(input.persona_id) ?? null : null;

  // Generate service name from persona or input
  const serviceName = input.service_name
    ?? (persona ? `agent-${persona.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}` : `agent-${Date.now()}`);

  // Check uniqueness within this environment
  const existing = db.prepare(
    'SELECT id FROM devcontainers WHERE env_id = ? AND service_name = ?'
  ).get(input.env_id, serviceName);
  if (existing) {
    throw new Error(`Devcontainer with service name '${serviceName}' already exists in this environment`);
  }

  const id = uuid();
  const containerName = `spyre-${env.name}-${serviceName}`.replace(/[^a-z0-9-]/g, '-').slice(0, 63);

  // Insert DB row
  db.prepare(`
    INSERT INTO devcontainers (id, env_id, persona_id, container_name, service_name, status, working_dir)
    VALUES (?, ?, ?, ?, ?, 'creating', '/workspace')
  `).run(id, input.env_id, input.persona_id ?? null, containerName, serviceName);

  // Build and start in background
  const buildPromise = (async () => {
    try {
      // Ensure Docker is installed
      await ensureDockerInstalled(input.env_id);

      // Get all devcontainers for this environment (including the new one)
      const allDcs = listDevcontainers(input.env_id).map(d => getDevcontainer(d.id)!);

      // Write Dockerfile + compose
      await writeDevcontainerFiles(input.env_id, env, allDcs);

      // Build and start via docker compose
      const buildResult = await envExec(
        input.env_id,
        `cd /opt/spyre/docker && docker compose build ${serviceName} 2>&1`,
        300000
      );
      if (buildResult.code !== 0) {
        throw new Error(`Docker build failed: ${buildResult.stderr.slice(-500)}`);
      }

      const upResult = await envExec(
        input.env_id,
        `cd /opt/spyre/docker && docker compose up -d ${serviceName} 2>&1`,
        60000
      );
      if (upResult.code !== 0) {
        throw new Error(`Docker compose up failed: ${upResult.stderr.slice(-500)}`);
      }

      // Fix /workspace ownership — bind mount from host is root-owned,
      // but spyre user needs to write to it (project files, .spyre/, etc.)
      await envExec(input.env_id,
        `docker exec -u root ${containerName} chown -R spyre:spyre /workspace`,
        30000
      );

      // Propagate auth
      try {
        await propagateClaudeAuthToDevcontainer(input.env_id, containerName);
      } catch (err) {
        console.warn(`[spyre] Claude auth propagation to devcontainer failed (non-fatal):`, err);
      }

      try {
        await propagateGitHubAuthToDevcontainer(input.env_id, containerName, persona?.name);
      } catch (err) {
        console.warn(`[spyre] GitHub auth propagation to devcontainer failed (non-fatal):`, err);
      }

      // Write persona CLAUDE.md
      if (persona) {
        const siblings = listDevcontainers(input.env_id).filter(d => d.id !== id);
        await writePersonaClaudeMd(input.env_id, containerName, persona, siblings);
      }

      // Inject MCP server config (.mcp.json) so Claude Code discovers Spyre tools
      try {
        const { generateMcpToken } = await import('./mcp-auth');
        const { getEnvConfig } = await import('./env-config');
        const mcpToken = generateMcpToken(input.env_id, id);
        const controllerIp = getEnvConfig().controller.ip ?? 'localhost';
        const mcpConfig = JSON.stringify({
          mcpServers: {
            spyre: {
              type: 'http',
              url: `http://${controllerIp}:3000/mcp`,
              headers: { Authorization: `Bearer ${mcpToken}` }
            }
          }
        }, null, 2);

        const mcpCmds = [
          `docker exec -u root ${containerName} mkdir -p /home/spyre/.claude`,
          `docker exec -u root ${containerName} bash -c 'cat > /home/spyre/.claude/.mcp.json << MCP_EOF\n${mcpConfig}\nMCP_EOF'`,
          `docker exec -u root ${containerName} chmod 600 /home/spyre/.claude/.mcp.json`,
          `docker exec -u root ${containerName} chown spyre:spyre /home/spyre/.claude/.mcp.json`,
        ];
        for (const cmd of mcpCmds) {
          await envExec(input.env_id, cmd, 10000);
        }
        console.log(`[spyre] MCP config injected into devcontainer ${containerName}`);
      } catch (err) {
        console.warn(`[spyre] MCP config injection to devcontainer failed (non-fatal):`, err);
      }

      // Update status to running
      db.prepare(`
        UPDATE devcontainers SET status = 'running', updated_at = datetime('now') WHERE id = ?
      `).run(id);

      console.log(`[spyre] Devcontainer ${serviceName} created and running in env ${input.env_id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      db.prepare(`
        UPDATE devcontainers SET status = 'error', error_message = ?, updated_at = datetime('now') WHERE id = ?
      `).run(msg, id);
      console.error(`[spyre] Devcontainer ${serviceName} creation failed:`, msg);
    }
  })();

  // Prevent unhandled rejection
  buildPromise.catch(() => {});

  return getDevcontainer(id)!;
}

/**
 * Start a stopped devcontainer.
 */
export async function startDevcontainer(id: string): Promise<void> {
  const db = getDb();
  const dc = getDevcontainer(id);
  if (!dc) throw new Error(`Devcontainer ${id} not found`);
  if (dc.status === 'running') return;

  const result = await envExec(dc.env_id, `docker start ${dc.container_name}`, 30000);
  if (result.code !== 0) {
    throw new Error(`Failed to start devcontainer: ${result.stderr.slice(-300)}`);
  }

  db.prepare(`
    UPDATE devcontainers SET status = 'running', error_message = NULL, updated_at = datetime('now') WHERE id = ?
  `).run(id);
}

/**
 * Stop a running devcontainer.
 */
export async function stopDevcontainer(id: string): Promise<void> {
  const db = getDb();
  const dc = getDevcontainer(id);
  if (!dc) throw new Error(`Devcontainer ${id} not found`);
  if (dc.status === 'stopped') return;

  const result = await envExec(dc.env_id, `docker stop ${dc.container_name}`, 30000);
  if (result.code !== 0) {
    throw new Error(`Failed to stop devcontainer: ${result.stderr.slice(-300)}`);
  }

  db.prepare(`
    UPDATE devcontainers SET status = 'stopped', updated_at = datetime('now') WHERE id = ?
  `).run(id);
}

/**
 * Delete a devcontainer — stop, remove container, clean up DB.
 */
export async function deleteDevcontainer(id: string): Promise<void> {
  const db = getDb();
  const dc = getDevcontainer(id);
  if (!dc) throw new Error(`Devcontainer ${id} not found`);

  db.prepare(`
    UPDATE devcontainers SET status = 'removing', updated_at = datetime('now') WHERE id = ?
  `).run(id);

  try {
    // Stop and remove
    await envExec(dc.env_id, `docker rm -f ${dc.container_name} 2>/dev/null || true`, 30000);

    // Remove from DB
    db.prepare('DELETE FROM devcontainers WHERE id = ?').run(id);

    // Regenerate compose file without this container
    const env = getEnvironment(dc.env_id);
    if (env) {
      const remaining = listDevcontainers(dc.env_id).map(d => getDevcontainer(d.id)!);
      if (remaining.length > 0) {
        await writeDevcontainerFiles(dc.env_id, env, remaining);
      }
    }

    console.log(`[spyre] Devcontainer ${dc.service_name} deleted from env ${dc.env_id}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    db.prepare(`
      UPDATE devcontainers SET status = 'error', error_message = ?, updated_at = datetime('now') WHERE id = ?
    `).run(msg, id);
    throw err;
  }
}

/**
 * Rebuild a devcontainer — rebuild image and recreate container.
 */
export async function rebuildDevcontainer(id: string): Promise<void> {
  const db = getDb();
  const dc = getDevcontainer(id);
  if (!dc) throw new Error(`Devcontainer ${id} not found`);

  db.prepare(`
    UPDATE devcontainers SET status = 'creating', updated_at = datetime('now') WHERE id = ?
  `).run(id);

  try {
    const env = getEnvironment(dc.env_id);
    if (!env) throw new Error(`Environment ${dc.env_id} not found`);

    const allDcs = listDevcontainers(dc.env_id).map(d => getDevcontainer(d.id)!);
    await writeDevcontainerFiles(dc.env_id, env, allDcs);

    // Rebuild and recreate
    const result = await envExec(
      dc.env_id,
      `cd /opt/spyre/docker && docker compose build --no-cache ${dc.service_name} && docker compose up -d ${dc.service_name} 2>&1`,
      300000
    );

    if (result.code !== 0) {
      throw new Error(`Rebuild failed: ${result.stderr.slice(-500)}`);
    }

    // Re-propagate auth
    const persona = dc.persona_id ? getPersona(dc.persona_id) ?? null : null;
    try {
      await propagateClaudeAuthToDevcontainer(dc.env_id, dc.container_name);
    } catch { /* non-fatal */ }
    try {
      await propagateGitHubAuthToDevcontainer(dc.env_id, dc.container_name, persona?.name);
    } catch { /* non-fatal */ }

    if (persona) {
      const siblings = listDevcontainers(dc.env_id).filter(d => d.id !== id);
      await writePersonaClaudeMd(dc.env_id, dc.container_name, persona, siblings);
    }

    db.prepare(`
      UPDATE devcontainers SET status = 'running', error_message = NULL, updated_at = datetime('now') WHERE id = ?
    `).run(id);

    console.log(`[spyre] Devcontainer ${dc.service_name} rebuilt in env ${dc.env_id}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    db.prepare(`
      UPDATE devcontainers SET status = 'error', error_message = ?, updated_at = datetime('now') WHERE id = ?
    `).run(msg, id);
    throw err;
  }
}

/**
 * Sync devcontainer statuses by checking Docker state in the environment.
 */
export async function syncDevcontainerStatuses(envId: string): Promise<void> {
  const db = getDb();
  const devcontainers = listDevcontainers(envId);
  if (devcontainers.length === 0) return;

  try {
    const result = await envExec(envId, 'docker ps -a --format "{{.Names}}|{{.Status}}"', 10000);
    if (result.code !== 0) return;

    const containerStatuses = new Map<string, string>();
    for (const line of result.stdout.split('\n')) {
      const [name, status] = line.trim().split('|');
      if (name && status) {
        containerStatuses.set(name, status.startsWith('Up') ? 'running' : 'stopped');
      }
    }

    for (const dc of devcontainers) {
      if (dc.status === 'creating' || dc.status === 'removing' || dc.status === 'pending') continue;
      const dockerStatus = containerStatuses.get(dc.container_name);
      if (dockerStatus && dockerStatus !== dc.status) {
        db.prepare(`
          UPDATE devcontainers SET status = ?, updated_at = datetime('now') WHERE id = ?
        `).run(dockerStatus, dc.id);
      }
    }
  } catch {
    // Non-fatal — env might be offline
  }
}
