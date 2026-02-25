import { getSetting } from './settings';
import { getEnvironment } from './environments';
import { getConnection } from './ssh-pool';

/**
 * Propagate GitHub PAT credentials to an environment.
 * Configures both `gh` CLI auth and git credential helper.
 */
export async function propagateGitHubAuth(envId: string, personaName?: string): Promise<void> {
  const token = getSetting('github_pat');
  if (!token) {
    console.log('[spyre] No GitHub PAT configured — skipping propagation');
    return;
  }

  const env = getEnvironment(envId);
  if (!env || !env.ip_address || env.status !== 'running') {
    console.log(`[spyre] Environment ${envId} not ready for GitHub auth propagation`);
    return;
  }

  try {
    const client = await getConnection(envId);

    // Configure git credential helper to use the PAT
    const gitUser = personaName ? personaName.toLowerCase().replace(/\s+/g, '-') : 'spyre-agent';
    const commands = [
      `git config --global user.name "${gitUser}"`,
      `git config --global user.email "${gitUser}@spyre.local"`,
      // Write gh CLI hosts.yml
      'mkdir -p ~/.config/gh',
      `cat > ~/.config/gh/hosts.yml << 'SPYRE_GH_EOF'\ngithub.com:\n  oauth_token: ${token}\n  git_protocol: https\nSPYRE_GH_EOF`,
      'chmod 600 ~/.config/gh/hosts.yml',
      // Configure git to use the token for HTTPS
      `git config --global credential.helper '!f() { echo "username=x-access-token"; echo "password=${token}"; }; f'`,
    ];

    for (const cmd of commands) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), 10000);
        client.exec(cmd, (err, stream) => {
          if (err) { clearTimeout(timer); reject(err); return; }
          stream.on('close', () => { clearTimeout(timer); resolve(); });
          stream.on('data', () => {});
          stream.stderr.on('data', () => {});
        });
      });
    }

    console.log(`[spyre] GitHub auth propagated to environment ${envId}`);
  } catch (err) {
    console.warn(`[spyre] GitHub auth propagation failed for ${envId}:`, err);
  }
}
