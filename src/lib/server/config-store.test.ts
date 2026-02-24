import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// These tests use the real filesystem with configs/ directory.
// We create temp configs for testing and clean up after.

const CONFIGS_DIR = join(process.cwd(), 'configs');
const TEST_BASE = join(CONFIGS_DIR, 'test-bases');
const TEST_BASE_FILE = join(TEST_BASE, 'test-base.yaml');
const TEST_CHILD_FILE = join(CONFIGS_DIR, 'test-child.yaml');

const BASE_YAML = `
apiVersion: spyre/v1
kind: EnvironmentBase
metadata:
  name: test-base
  description: Test base config
  labels:
    env: test
spec:
  platform:
    type: lxc
    template: local:vztmpl/test.tar.zst
    resources:
      cores: 1
      memory: 512
      disk: 8
    network:
      ip: dhcp
  provision:
    packages:
      - curl
      - git
  lxc:
    unprivileged: true
    nesting: true
  access:
    ssh_enabled: true
`;

const CHILD_YAML = `
apiVersion: spyre/v1
kind: Environment
extends: test-bases/test-base
metadata:
  name: test-child
  description: Test child config
  labels:
    stack: node
spec:
  platform:
    resources:
      cores: 4
      memory: 4096
  provision:
    packages:
      - nginx
    scripts:
      - name: Install Node
        run: echo "installing node"
`;

beforeAll(() => {
  mkdirSync(TEST_BASE, { recursive: true });
  writeFileSync(TEST_BASE_FILE, BASE_YAML, 'utf-8');
  writeFileSync(TEST_CHILD_FILE, CHILD_YAML, 'utf-8');
});

afterAll(() => {
  if (existsSync(TEST_CHILD_FILE)) rmSync(TEST_CHILD_FILE);
  if (existsSync(TEST_BASE_FILE)) rmSync(TEST_BASE_FILE);
  if (existsSync(TEST_BASE)) rmSync(TEST_BASE, { recursive: true });
});

describe('config-store', () => {
  it('lists configs including test files', async () => {
    const { listConfigs } = await import('./config-store');
    const configs = listConfigs();
    expect(configs.some(c => c.name === 'test-bases/test-base')).toBe(true);
    expect(configs.some(c => c.name === 'test-child')).toBe(true);
  });

  it('loads raw config text', async () => {
    const { loadRawConfig } = await import('./config-store');
    const text = loadRawConfig('test-bases/test-base');
    expect(text).toContain('apiVersion: spyre/v1');
    expect(text).toContain('test-base');
  });

  it('throws NOT_FOUND for missing config', async () => {
    const { loadRawConfig } = await import('./config-store');
    expect(() => loadRawConfig('nonexistent')).toThrow();
  });

  it('resolves a standalone config (no extends)', async () => {
    const { resolveConfig } = await import('./config-store');
    const resolved = resolveConfig('test-bases/test-base');
    expect(resolved.metadata.name).toBe('test-base');
    expect(resolved.spec.platform.type).toBe('lxc');
    expect(resolved.spec.platform.resources?.cores).toBe(1);
  });

  it('resolves a child config with inheritance', async () => {
    const { resolveConfig } = await import('./config-store');
    const resolved = resolveConfig('test-child');

    // Child metadata
    expect(resolved.metadata.name).toBe('test-child');
    expect(resolved.metadata.description).toBe('Test child config');

    // Type inherited from base
    expect(resolved.spec.platform.type).toBe('lxc');

    // Template inherited from base
    expect(resolved.spec.platform.template).toBe('local:vztmpl/test.tar.zst');

    // Resources: child overrides base
    expect(resolved.spec.platform.resources?.cores).toBe(4);
    expect(resolved.spec.platform.resources?.memory).toBe(4096);
    // Disk inherited from base
    expect(resolved.spec.platform.resources?.disk).toBe(8);

    // Packages: concatenated + deduped
    expect(resolved.spec.provision?.packages).toContain('curl');
    expect(resolved.spec.provision?.packages).toContain('git');
    expect(resolved.spec.provision?.packages).toContain('nginx');

    // Scripts from child only
    expect(resolved.spec.provision?.scripts).toHaveLength(1);
    expect(resolved.spec.provision?.scripts?.[0].name).toBe('Install Node');

    // Labels merged
    expect(resolved.metadata.labels?.env).toBe('test');
    expect(resolved.metadata.labels?.stack).toBe('node');

    // LXC from base
    expect(resolved.spec.lxc?.unprivileged).toBe(true);

    // No extends in resolved output
    expect(resolved.extends).toBeUndefined();
  });

  it('rejects circular references', async () => {
    const { writeFileSync } = await import('node:fs');
    const { resolveConfig } = await import('./config-store');

    // Create a circular reference
    const circA = join(CONFIGS_DIR, 'circ-a.yaml');
    const circB = join(CONFIGS_DIR, 'circ-b.yaml');

    writeFileSync(circA, `
apiVersion: spyre/v1
kind: Environment
extends: circ-b
metadata:
  name: circ-a
spec:
  platform:
    type: lxc
`, 'utf-8');

    writeFileSync(circB, `
apiVersion: spyre/v1
kind: Environment
extends: circ-a
metadata:
  name: circ-b
spec:
  platform:
    type: lxc
`, 'utf-8');

    try {
      expect(() => resolveConfig('circ-a')).toThrow();
    } finally {
      rmSync(circA);
      rmSync(circB);
    }
  });
});
