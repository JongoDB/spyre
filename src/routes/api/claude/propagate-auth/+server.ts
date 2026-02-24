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
  const results: Array<{ envId: string; name: string; success: boolean; error?: string }> = [];

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

      results.push({ envId: env.id, name: env.name, success: true });
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
