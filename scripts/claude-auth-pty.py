#!/usr/bin/env python3
"""
PTY wrapper for `claude auth login`.

The Claude CLI requires a TTY to read the auth code from stdin.
This script creates a real PTY, runs the CLI in it, and relays
I/O via the parent process's stdio (which Node.js can pipe to).

Protocol:
  - stdout: all output from the CLI
  - stdin:  lines written here are fed to the CLI's PTY stdin
  - exit:   same exit code as the CLI
"""

import pty, os, sys, select, signal, time

def main():
    master_fd, slave_fd = pty.openpty()
    pid = os.fork()

    if pid == 0:
        # Child: run claude auth login with the PTY as its terminal
        os.setsid()
        os.dup2(slave_fd, 0)
        os.dup2(slave_fd, 1)
        os.dup2(slave_fd, 2)
        os.close(master_fd)
        os.close(slave_fd)
        env = dict(os.environ)
        env.pop('CLAUDECODE', None)
        env['TERM'] = 'dumb'
        try:
            os.execvpe('claude', ['claude', 'auth', 'login'], env)
        except Exception as e:
            sys.stderr.write(f'Failed to exec claude: {e}\n')
            os._exit(1)
    else:
        # Parent: relay I/O between Node.js pipes and the PTY master
        os.close(slave_fd)
        child_alive = True

        def sigterm_handler(sig, frame):
            nonlocal child_alive
            try:
                os.kill(pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            child_alive = False

        signal.signal(signal.SIGTERM, sigterm_handler)

        try:
            while child_alive:
                fds = [master_fd, sys.stdin.fileno()]
                try:
                    readable, _, _ = select.select(fds, [], [], 1.0)
                except (ValueError, OSError):
                    break

                for fd in readable:
                    if fd == master_fd:
                        # Data from CLI -> stdout
                        try:
                            data = os.read(master_fd, 4096)
                            if not data:
                                child_alive = False
                                break
                            os.write(sys.stdout.fileno(), data)
                        except OSError:
                            child_alive = False
                            break
                    elif fd == sys.stdin.fileno():
                        # Data from Node.js -> PTY stdin
                        try:
                            data = os.read(sys.stdin.fileno(), 4096)
                            if not data:
                                # stdin closed — don't close PTY master,
                                # just stop reading stdin
                                fds.remove(sys.stdin.fileno())
                                continue
                            os.write(master_fd, data)
                        except OSError:
                            break

                # Check if child exited
                try:
                    wpid, status = os.waitpid(pid, os.WNOHANG)
                    if wpid != 0:
                        child_alive = False
                        if os.WIFEXITED(status):
                            sys.exit(os.WEXITSTATUS(status))
                        else:
                            sys.exit(1)
                except ChildProcessError:
                    child_alive = False
                    break

        finally:
            try:
                os.close(master_fd)
            except OSError:
                pass
            try:
                os.kill(pid, signal.SIGTERM)
            except (ProcessLookupError, PermissionError):
                pass
            try:
                _, status = os.waitpid(pid, 0)
                if os.WIFEXITED(status):
                    sys.exit(os.WEXITSTATUS(status))
            except ChildProcessError:
                pass

if __name__ == '__main__':
    main()
