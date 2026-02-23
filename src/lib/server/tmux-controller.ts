import type { Client as SshClient, ClientChannel } from 'ssh2';

export interface TmuxWindow {
  index: number;
  name: string;
  active: boolean;
}

export function sshExec(
  client: SshClient,
  command: string,
  timeoutMs = 10_000
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`SSH exec timed out after ${timeoutMs}ms: ${command.slice(0, 80)}`));
    }, timeoutMs);

    client.exec(command, (err, stream) => {
      if (err) {
        clearTimeout(timer);
        reject(err);
        return;
      }

      let stdout = '';
      let stderr = '';

      stream.on('data', (data: Buffer) => {
        stdout += data.toString();
      });
      stream.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });
      stream.on('close', (code: number) => {
        clearTimeout(timer);
        resolve({ code: code ?? 0, stdout, stderr });
      });
    });
  });
}

export async function ensureSession(
  client: SshClient,
  sessionName = 'spyre'
): Promise<void> {
  // Install tmux if missing
  await sshExec(
    client,
    'which tmux >/dev/null 2>&1 || (apt-get update -qq && apt-get install -y -qq tmux 2>/dev/null) || (apk add tmux 2>/dev/null) || true',
    30_000
  );

  // Check if session exists, create if not
  const check = await sshExec(client, `tmux has-session -t ${sessionName} 2>/dev/null`);
  if (check.code !== 0) {
    await sshExec(client, `tmux new-session -d -s ${sessionName}`);
  }
}

export async function listWindows(
  client: SshClient,
  sessionName = 'spyre'
): Promise<TmuxWindow[]> {
  const result = await sshExec(
    client,
    `tmux list-windows -t ${sessionName} -F '#{window_index}|#{window_name}|#{window_active}' 2>/dev/null`
  );

  if (result.code !== 0 || !result.stdout.trim()) {
    return [];
  }

  return result.stdout
    .trim()
    .split('\n')
    .map((line) => {
      const [index, name, active] = line.split('|');
      return {
        index: parseInt(index, 10),
        name: name || `window-${index}`,
        active: active === '1',
      };
    });
}

export async function createWindow(
  client: SshClient,
  sessionName = 'spyre',
  windowName?: string
): Promise<number> {
  const nameFlag = windowName ? ` -n '${windowName}'` : '';
  await sshExec(client, `tmux new-window -t ${sessionName}${nameFlag}`);

  // Get the index of the newly created window (it becomes the active one)
  const result = await sshExec(
    client,
    `tmux display-message -t ${sessionName} -p '#{window_index}'`
  );

  return parseInt(result.stdout.trim(), 10) || 0;
}

export function attachToWindow(
  client: SshClient,
  sessionName = 'spyre',
  windowIndex?: number
): Promise<ClientChannel> {
  return new Promise((resolve, reject) => {
    client.shell(
      { rows: 24, cols: 80, term: 'xterm-256color' },
      (err, stream) => {
        if (err) {
          reject(err);
          return;
        }

        // Build the tmux attach command
        const target = windowIndex !== undefined
          ? `${sessionName}:${windowIndex}`
          : sessionName;

        // Use control mode-style attach that works well with terminal multiplexing
        stream.write(`tmux attach-session -t ${target}\n`);
        resolve(stream);
      }
    );
  });
}

export async function killWindow(
  client: SshClient,
  sessionName: string,
  windowIndex: number
): Promise<void> {
  await sshExec(client, `tmux kill-window -t ${sessionName}:${windowIndex}`);
}
