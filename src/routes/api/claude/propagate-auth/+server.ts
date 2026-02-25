import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readFileSync, existsSync } from 'node:fs';
import { getDb } from '$lib/server/db';
import { getEnvConfig } from '$lib/server/env-config';
import { getConnection } from '$lib/server/ssh-pool';
import type { Environment } from '$lib/types/environment';

/**
 * POST /api/claude/propagate-auth
 *
 * Propagate the controller's Claude credentials to running environments.
 * Body: { envId?: string } — if omitted, propagates to all running environments.
 */
export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => ({}));
  const targetEnvId = body.envId as string | undefined;

  // Read controller credentials
  const config = getEnvConfig();
  const authPath = (config.claude?.auth_json_path ?? '~/.claude/.credentials.json')
    .replace('~', process.env.HOME ?? '/root');

  if (!existsSync(authPath)) {
    return json(
      { error: 'No Claude credentials found on controller. Authenticate first.' },
      { status: 400 }
    );
  }

  let credentials: string;
  try {
    credentials = readFileSync(authPath, 'utf-8');
    JSON.parse(credentials); // validate
  } catch {
    return json(
      { error: 'Controller credentials file is invalid.' },
      { status: 500 }
    );
  }

  // Build minimal .claude.json from controller's config (for onboarding bypass)
  const claudeJsonContent = buildClaudeJson(authPath);

  // Get target environments
  const db = getDb();
  let environments: Environment[];

  if (targetEnvId) {
    const env = db.prepare('SELECT * FROM environments WHERE id = ?').get(targetEnvId) as Environment | undefined;
    if (!env) return json({ error: 'Environment not found' }, { status: 404 });
    if (env.status !== 'running') return json({ error: 'Environment is not running' }, { status: 400 });
    environments = [env];
  } else {
    environments = db.prepare(
      "SELECT * FROM environments WHERE status = 'running' AND ip_address IS NOT NULL"
    ).all() as Environment[];
  }

  if (environments.length === 0) {
    return json({ message: 'No running environments to propagate to.', results: [] });
  }

  // Propagate to each environment
  const results: Array<{ envId: string; name: string; success: boolean; loggedIn?: boolean; error?: string }> = [];

  for (const env of environments) {
    try {
      const client = await getConnection(env.id);

      // Check if Claude CLI is installed in this environment
      const checkResult = await sshExec(client, 'which claude 2>/dev/null || command -v claude 2>/dev/null', 5000);
      if (checkResult.code !== 0) {
        results.push({
          envId: env.id,
          name: env.name,
          success: false,
          error: 'Claude CLI not installed in this environment'
        });
        continue;
      }

      // Create ~/.claude directory
      await sshExec(client, 'mkdir -p /root/.claude', 10000);

      // Write credentials
      const writeCmd = `cat > /root/.claude/.credentials.json << 'SPYRE_CREDS_EOF'\n${credentials}\nSPYRE_CREDS_EOF`;
      await sshExec(client, writeCmd, 10000);

      // Secure the file
      await sshExec(client, 'chmod 600 /root/.claude/.credentials.json', 5000);

      // Write ~/.claude/.claude.json to skip onboarding
      if (claudeJsonContent) {
        const claudeJsonCopy = { ...claudeJsonContent };
        try {
          const versionResult = await sshExec(client, 'claude --version 2>/dev/null', 10000);
          const installedVersion = versionResult.stdout.trim();
          if (installedVersion) {
            claudeJsonCopy.lastOnboardingVersion = installedVersion;
            claudeJsonCopy.lastReleaseNotesSeen = installedVersion;
          }
        } catch {
          // keep controller's version as fallback
        }

        const claudeJsonStr = JSON.stringify(claudeJsonCopy, null, 2);
        const writeClaudeJson = `cat > /root/.claude/.claude.json << 'SPYRE_CLAUDEJSON_EOF'\n${claudeJsonStr}\nSPYRE_CLAUDEJSON_EOF`;
        await sshExec(client, writeClaudeJson, 10000);
        await sshExec(client, 'chmod 600 /root/.claude/.claude.json', 5000);
      }

      // Also write ~/.claude.json at home root — Claude Code checks this
      // location for install/init state separately
      const homeJson = buildHomeClaudeJson();
      if (homeJson) {
        const homeStr = JSON.stringify(homeJson, null, 2);
        const writeHomeJson = `cat > /root/.claude.json << 'SPYRE_HOMECJ_EOF'\n${homeStr}\nSPYRE_HOMECJ_EOF`;
        await sshExec(client, writeHomeJson, 10000);
        await sshExec(client, 'chmod 600 /root/.claude.json', 5000);
      }

      // Verify auth status
      const verifyResult = await sshExec(client, 'claude auth status 2>&1', 15000);
      const loggedIn = verifyResult.code === 0;

      results.push({ envId: env.id, name: env.name, success: true, loggedIn });
    } catch (err) {
      results.push({
        envId: env.id,
        name: env.name,
        success: false,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }

  const successCount = results.filter(r => r.success).length;
  return json({
    message: `Credentials propagated to ${successCount}/${results.length} environment(s).`,
    results
  });
};

function buildClaudeJson(credentialsPath: string): Record<string, unknown> | null {
  const claudeJsonPath = credentialsPath.replace(/\.credentials\.json$/, '.claude.json');

  if (!existsSync(claudeJsonPath)) {
    return null;
  }

  try {
    const raw = readFileSync(claudeJsonPath, 'utf-8');
    const full = JSON.parse(raw) as Record<string, unknown>;

    // Copy everything, strip controller-specific fields
    const config = { ...full };
    delete config.projects;
    delete config.githubRepoPaths;

    config.hasCompletedOnboarding = true;
    if (!config.theme) config.theme = 'dark';
    if (!config.numStartups || (config.numStartups as number) < 1) {
      config.numStartups = 1;
    }

    return config;
  } catch {
    return null;
  }
}

function buildHomeClaudeJson(): Record<string, unknown> | null {
  const home = process.env.HOME ?? '/root';
  const homePath = `${home}/.claude.json`;

  let config: Record<string, unknown>;

  if (!existsSync(homePath)) {
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

function sshExec(
  client: import('ssh2').Client,
  command: string,
  timeout: number
): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('SSH command timed out')), timeout);

    client.exec(command, (err, stream) => {
      if (err) { clearTimeout(timer); reject(err); return; }

      let stdout = '';
      stream.on('data', (d: Buffer) => { stdout += d.toString(); });
      stream.stderr.on('data', () => { /* consume */ });
      stream.on('close', (code: number) => {
        clearTimeout(timer);
        resolve({ code: code ?? 0, stdout });
      });
    });
  });
}
