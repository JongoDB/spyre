import { describe, it, expect } from 'vitest';
import { validateConfig, validateYamlString } from './config-validator';

describe('validateConfig', () => {
  it('accepts a valid standalone config', () => {
    const result = validateConfig({
      apiVersion: 'spyre/v1',
      kind: 'Environment',
      metadata: { name: 'test-env' },
      spec: {
        platform: { type: 'lxc' }
      }
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects missing apiVersion', () => {
    const result = validateConfig({
      kind: 'Environment',
      metadata: { name: 'test' },
      spec: { platform: { type: 'lxc' } }
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.path === 'apiVersion')).toBe(true);
  });

  it('rejects missing metadata.name', () => {
    const result = validateConfig({
      apiVersion: 'spyre/v1',
      kind: 'Environment',
      metadata: {},
      spec: { platform: { type: 'lxc' } }
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.path === 'metadata.name')).toBe(true);
  });

  it('rejects missing spec.platform', () => {
    const result = validateConfig({
      apiVersion: 'spyre/v1',
      kind: 'Environment',
      metadata: { name: 'test' },
      spec: {}
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.path === 'spec.platform')).toBe(true);
  });

  it('rejects cores out of bounds', () => {
    const result = validateConfig({
      apiVersion: 'spyre/v1',
      kind: 'Environment',
      metadata: { name: 'test' },
      spec: {
        platform: {
          type: 'lxc',
          resources: { cores: 999 }
        }
      }
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes('cores'))).toBe(true);
  });

  it('warns on duplicate packages', () => {
    const result = validateConfig({
      apiVersion: 'spyre/v1',
      kind: 'Environment',
      metadata: { name: 'test' },
      spec: {
        platform: { type: 'lxc' },
        provision: {
          packages: ['curl', 'git', 'curl']
        }
      }
    });
    expect(result.valid).toBe(true);
    expect(result.warnings.some(w => w.message.includes('Duplicate'))).toBe(true);
  });

  it('rejects script with both run and copy', () => {
    const result = validateConfig({
      apiVersion: 'spyre/v1',
      kind: 'Environment',
      metadata: { name: 'test' },
      spec: {
        platform: { type: 'lxc' },
        provision: {
          scripts: [{ run: 'echo hi', copy: { content: 'x', destination: '/tmp/x' } }]
        }
      }
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.message.includes('both'))).toBe(true);
  });
});

describe('validateYamlString', () => {
  it('catches YAML syntax errors', () => {
    const result = validateYamlString('invalid: yaml: [');
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain('YAML syntax error');
  });

  it('validates a full YAML config', () => {
    const yaml = `
apiVersion: spyre/v1
kind: Environment
metadata:
  name: test-env
spec:
  platform:
    type: lxc
    resources:
      cores: 2
      memory: 2048
`;
    const result = validateYamlString(yaml);
    expect(result.valid).toBe(true);
    expect(result.config).toBeDefined();
    expect(result.config!.metadata.name).toBe('test-env');
  });
});
