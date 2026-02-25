import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// =============================================================================
// Mocks — must be set up before importing the module under test
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
    claude: {
      auth_json_path: '/tmp/test-claude-creds.json',
      health_check_interval: 999999999 // effectively disable auto health check in tests
    }
  })
}));

// Mock child_process — the module imports spawn/execFile at the top level
const mockExecFile = vi.fn();
const mockSpawn = vi.fn();
vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
  execFile: (...args: unknown[]) => mockExecFile(...args),
  execSync: vi.fn()
}));

// Mock fs
vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(false)
}));

import {
  getState,
  subscribe,
  cancelAuth,
  getClaudeCliStatus,
  getAuthLog
} from './claude-auth';

// =============================================================================
// Tests
// =============================================================================

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.prepare.mockReturnValue(mockStmt);
});

describe('getState', () => {
  it('returns a copy of current state', () => {
    const s1 = getState();
    const s2 = getState();
    expect(s1).toEqual(s2);
    expect(s1).not.toBe(s2); // should be a different object (deep copy)
  });

  it('has expected default fields', () => {
    const state = getState();
    expect(state).toHaveProperty('status');
    expect(state).toHaveProperty('oauthUrl');
    expect(state).toHaveProperty('error');
    expect(state).toHaveProperty('cliInstalled');
  });
});

describe('subscribe / unsubscribe', () => {
  it('returns an unsubscribe function', () => {
    const cb = vi.fn();
    const unsub = subscribe(cb);
    expect(typeof unsub).toBe('function');
    unsub();
  });
});

describe('cancelAuth', () => {
  it('resets state to idle', () => {
    cancelAuth();
    const state = getState();
    expect(state.status).toBe('idle');
    expect(state.oauthUrl).toBeNull();
    expect(state.error).toBeNull();
  });

  it('logs cancelled event to DB', () => {
    cancelAuth();
    expect(mockDb.prepare).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO claude_auth_log')
    );
    expect(mockStmt.run).toHaveBeenCalledWith('cancelled', null);
  });
});

describe('getClaudeCliStatus', () => {
  it('returns installed:true when claude exists', async () => {
    mockExecFile.mockImplementation(
      (cmd: string, _args: string[], _opts: unknown, cb: (err: null, stdout: string) => void) => {
        if (cmd === 'claude') cb(null, '1.0.0');
        else cb(null, '/usr/local/bin/claude');
      }
    );

    const status = await getClaudeCliStatus();
    expect(status.installed).toBe(true);
    expect(status.version).toBe('1.0.0');
  });

  it('returns installed:false when claude not found', async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: (err: Error) => void) => {
        cb(new Error('not found'));
      }
    );

    const status = await getClaudeCliStatus();
    expect(status.installed).toBe(false);
    expect(status.version).toBeNull();
  });
});

describe('getAuthLog', () => {
  it('queries DB with limit', () => {
    const rows = [
      { id: 1, event: 'initiated', details: null, timestamp: '2026-01-01' }
    ];
    mockStmt.all.mockReturnValue(rows);

    const result = getAuthLog(10);
    expect(result).toEqual(rows);
    expect(mockStmt.all).toHaveBeenCalledWith(10);
  });

  it('uses default limit of 50', () => {
    mockStmt.all.mockReturnValue([]);
    getAuthLog();
    expect(mockStmt.all).toHaveBeenCalledWith(50);
  });
});
