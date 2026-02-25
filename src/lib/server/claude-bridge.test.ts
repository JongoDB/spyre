import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// Mocks
// =============================================================================

const mockDb = {
  prepare: vi.fn(),
  exec: vi.fn(),
  pragma: vi.fn(),
  transaction: vi.fn()
};
const mockStmt = {
  get: vi.fn(),
  all: vi.fn(),
  run: vi.fn()
};
mockDb.prepare.mockReturnValue(mockStmt);

vi.mock('./db', () => ({
  getDb: () => mockDb
}));

vi.mock('./env-config', () => ({
  getEnvConfig: () => ({
    controller: { db_path: 'data/spyre.db' },
    proxmox: { node: 'pve', host: '10.0.0.1' },
    claude: { task_timeout: 60000 }
  })
}));

vi.mock('./ssh-pool', () => ({
  getConnection: vi.fn()
}));

vi.mock('./environments', () => ({
  getEnvironment: vi.fn()
}));

import { listTasks, getTask, getActiveTaskForEnv, cancelTask, dispatch } from './claude-bridge';
import { getEnvironment } from './environments';
import { getConnection } from './ssh-pool';

// =============================================================================
// Tests
// =============================================================================

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.prepare.mockReturnValue(mockStmt);
});

describe('listTasks', () => {
  it('returns all tasks when no filters', () => {
    const tasks = [
      { id: 't1', prompt: 'hello', status: 'complete' },
      { id: 't2', prompt: 'world', status: 'error' }
    ];
    mockStmt.all.mockReturnValue(tasks);

    const result = listTasks();
    expect(result).toEqual(tasks);
    expect(mockDb.prepare).toHaveBeenCalledWith(
      expect.stringContaining('SELECT * FROM claude_tasks')
    );
  });

  it('filters by envId', () => {
    mockStmt.all.mockReturnValue([]);
    listTasks({ envId: 'env-1' });
    expect(mockDb.prepare).toHaveBeenCalledWith(
      expect.stringContaining('env_id = ?')
    );
    expect(mockStmt.all).toHaveBeenCalledWith('env-1', 50);
  });

  it('filters by status', () => {
    mockStmt.all.mockReturnValue([]);
    listTasks({ status: 'running' });
    expect(mockDb.prepare).toHaveBeenCalledWith(
      expect.stringContaining('status = ?')
    );
    expect(mockStmt.all).toHaveBeenCalledWith('running', 50);
  });

  it('respects limit', () => {
    mockStmt.all.mockReturnValue([]);
    listTasks({ limit: 10 });
    expect(mockStmt.all).toHaveBeenCalledWith(10);
  });

  it('filters by envId and status together', () => {
    mockStmt.all.mockReturnValue([]);
    listTasks({ envId: 'env-1', status: 'error' });
    expect(mockDb.prepare).toHaveBeenCalledWith(
      expect.stringMatching(/env_id = \?.*AND.*status = \?/)
    );
    expect(mockStmt.all).toHaveBeenCalledWith('env-1', 'error', 50);
  });
});

describe('getTask', () => {
  it('returns task when found', () => {
    const task = { id: 't1', prompt: 'test', status: 'complete' };
    mockStmt.get.mockReturnValue(task);
    expect(getTask('t1')).toEqual(task);
  });

  it('returns null when not found', () => {
    mockStmt.get.mockReturnValue(undefined);
    expect(getTask('nonexistent')).toBeNull();
  });
});

describe('getActiveTaskForEnv', () => {
  it('returns active task when one exists', () => {
    const task = { id: 't1', env_id: 'env-1', status: 'running' };
    mockStmt.get.mockReturnValue(task);
    expect(getActiveTaskForEnv('env-1')).toEqual(task);
  });

  it('returns null when no active tasks', () => {
    mockStmt.get.mockReturnValue(undefined);
    expect(getActiveTaskForEnv('env-1')).toBeNull();
  });
});

describe('cancelTask', () => {
  it('cancels a pending task in DB', () => {
    mockStmt.run.mockReturnValue({ changes: 1 });
    const result = cancelTask('task-1');
    expect(result).toBe(true);
  });

  it('returns false for already completed task', () => {
    mockStmt.run.mockReturnValue({ changes: 0 });
    const result = cancelTask('task-done');
    expect(result).toBe(false);
  });
});

describe('dispatch', () => {
  it('rejects when environment not found', async () => {
    vi.mocked(getEnvironment).mockReturnValue(undefined as never);
    await expect(dispatch({ envId: 'missing', prompt: 'test' }))
      .rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects when environment not running', async () => {
    vi.mocked(getEnvironment).mockReturnValue({
      id: 'env-1', status: 'stopped', ip_address: '10.0.0.5'
    } as never);
    await expect(dispatch({ envId: 'env-1', prompt: 'test' }))
      .rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('rejects when environment has no IP', async () => {
    vi.mocked(getEnvironment).mockReturnValue({
      id: 'env-1', status: 'running', ip_address: null
    } as never);
    await expect(dispatch({ envId: 'env-1', prompt: 'test' }))
      .rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('rejects when already running task exists', async () => {
    vi.mocked(getEnvironment).mockReturnValue({
      id: 'env-1', status: 'running', ip_address: '10.0.0.5'
    } as never);
    // getActiveTaskForEnv returns a running task
    mockStmt.get.mockReturnValue({ id: 'existing', status: 'running' });
    await expect(dispatch({ envId: 'env-1', prompt: 'test' }))
      .rejects.toMatchObject({ code: 'ALREADY_RUNNING' });
  });

  it('rejects when Claude not installed', async () => {
    vi.mocked(getEnvironment).mockReturnValue({
      id: 'env-1', status: 'running', ip_address: '10.0.0.5'
    } as never);
    // getActiveTaskForEnv returns null (no running task)
    mockStmt.get.mockReturnValue(undefined);
    // verifyClaudeInstalled will fail (SSH exec returns non-zero)
    vi.mocked(getConnection).mockResolvedValue({
      exec: (_cmd: string, cb: (err: Error | null, stream: never) => void) => {
        const stream = {
          on: (event: string, handler: (arg?: unknown) => void) => {
            if (event === 'close') setTimeout(() => handler(1), 0);
            return stream;
          },
          stderr: {
            on: () => stream
          }
        };
        cb(null, stream as never);
      }
    } as never);
    await expect(dispatch({ envId: 'env-1', prompt: 'test' }))
      .rejects.toMatchObject({ code: 'NOT_INSTALLED' });
  });
});
