import { describe, it, expect, vi, beforeEach } from 'vitest';

// =============================================================================
// Mocks
// =============================================================================

const mockDb = {
  prepare: vi.fn(),
  exec: vi.fn(),
  pragma: vi.fn()
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
    proxmox: { node: 'pve', host: '10.0.0.1' }
  })
}));

vi.mock('./environments', () => ({
  listEnvironments: vi.fn().mockReturnValue([])
}));

vi.mock('./ssh-pool', () => ({
  getConnection: vi.fn()
}));

vi.mock('./claude-bridge', () => ({
  getActiveTaskForEnv: vi.fn().mockReturnValue(null)
}));

import {
  getProgressForEnv,
  getGitActivityForEnv,
  getLastData,
  subscribe
} from './claude-poller';

// =============================================================================
// Tests
// =============================================================================

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.prepare.mockReturnValue(mockStmt);
});

describe('getProgressForEnv', () => {
  it('returns parsed progress from DB', () => {
    const progressData = {
      env_id: 'env-1',
      plan: 'Build a web app',
      phases: [{ name: 'Setup', status: 'completed' }],
      current_task: 'Writing tests',
      blockers: [],
      metrics: { files_changed: 5 },
      updated_at: '2026-01-01T00:00:00Z',
      fetched_at: '2026-01-01T00:00:01Z'
    };
    mockStmt.get.mockReturnValue({
      env_id: 'env-1',
      progress: JSON.stringify(progressData),
      fetched_at: '2026-01-01T00:00:01Z'
    });

    const result = getProgressForEnv('env-1');
    expect(result).toEqual(progressData);
  });

  it('returns null when no row exists', () => {
    mockStmt.get.mockReturnValue(undefined);
    expect(getProgressForEnv('missing')).toBeNull();
  });

  it('returns null when progress is null', () => {
    mockStmt.get.mockReturnValue({
      env_id: 'env-1',
      progress: null,
      fetched_at: '2026-01-01'
    });
    expect(getProgressForEnv('env-1')).toBeNull();
  });

  it('returns null on invalid JSON', () => {
    mockStmt.get.mockReturnValue({
      env_id: 'env-1',
      progress: 'not-json{{{',
      fetched_at: '2026-01-01'
    });
    expect(getProgressForEnv('env-1')).toBeNull();
  });
});

describe('getGitActivityForEnv', () => {
  it('reconstructs git activity from DB row', () => {
    const commits = [
      { hash: 'abc123', message: 'fix bug', author: 'dev', date: '2026-01-01' }
    ];
    mockStmt.get.mockReturnValue({
      env_id: 'env-1',
      recent_commits: JSON.stringify(commits),
      diff_stat: '2 files changed',
      git_status: 'M src/app.ts',
      branch: 'main',
      fetched_at: '2026-01-01T00:00:00Z'
    });

    const result = getGitActivityForEnv('env-1');
    expect(result).not.toBeNull();
    expect(result!.recent_commits).toEqual(commits);
    expect(result!.diff_stat).toBe('2 files changed');
    expect(result!.branch).toBe('main');
  });

  it('returns null when no row', () => {
    mockStmt.get.mockReturnValue(undefined);
    expect(getGitActivityForEnv('missing')).toBeNull();
  });

  it('handles null recent_commits gracefully', () => {
    mockStmt.get.mockReturnValue({
      env_id: 'env-1',
      recent_commits: null,
      diff_stat: null,
      git_status: null,
      branch: null,
      fetched_at: '2026-01-01'
    });

    const result = getGitActivityForEnv('env-1');
    expect(result).not.toBeNull();
    expect(result!.recent_commits).toEqual([]);
  });

  it('handles invalid JSON in recent_commits', () => {
    mockStmt.get.mockReturnValue({
      env_id: 'env-1',
      recent_commits: 'bad-json',
      diff_stat: null,
      git_status: null,
      branch: 'dev',
      fetched_at: '2026-01-01'
    });

    const result = getGitActivityForEnv('env-1');
    expect(result).not.toBeNull();
    expect(result!.recent_commits).toEqual([]);
    expect(result!.branch).toBe('dev');
  });
});

describe('getLastData', () => {
  it('returns cached data (initially empty)', () => {
    const data = getLastData();
    expect(Array.isArray(data)).toBe(true);
  });
});

describe('subscribe / unsubscribe', () => {
  it('returns an unsubscribe function', () => {
    const cb = vi.fn();
    const unsub = subscribe(cb);
    expect(typeof unsub).toBe('function');
    unsub(); // clean up
  });
});
