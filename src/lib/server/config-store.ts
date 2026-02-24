import { readFileSync, writeFileSync, readdirSync, statSync, unlinkSync, mkdirSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { validateConfig, validateYamlString } from './config-validator';
import type { SpyreConfig, SpyreConfigSpec, ConfigListEntry, ConfigValidationResult } from '$lib/types/yaml-config';

const CONFIGS_DIR = join(process.cwd(), 'configs');
const MAX_INHERITANCE_DEPTH = 5;

/**
 * Ensure the configs directory exists.
 */
function ensureConfigsDir(): void {
  if (!existsSync(CONFIGS_DIR)) {
    mkdirSync(CONFIGS_DIR, { recursive: true });
  }
}

/**
 * Get the filesystem path for a config name.
 * Config name is the path relative to configs/ without the .yaml extension.
 * e.g., "bases/ubuntu-dev" -> "configs/bases/ubuntu-dev.yaml"
 */
function configPath(name: string): string {
  // Prevent path traversal
  const normalized = name.replace(/\\/g, '/').replace(/\.\./g, '');
  return join(CONFIGS_DIR, `${normalized}.yaml`);
}

/**
 * List all configs in the configs/ directory recursively.
 */
export function listConfigs(): ConfigListEntry[] {
  ensureConfigsDir();
  const entries: ConfigListEntry[] = [];
  scanDir(CONFIGS_DIR, entries);
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

function scanDir(dir: string, entries: ConfigListEntry[]): void {
  if (!existsSync(dir)) return;

  const items = readdirSync(dir);
  for (const item of items) {
    const fullPath = join(dir, item);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      scanDir(fullPath, entries);
    } else if (item.endsWith('.yaml') || item.endsWith('.yml')) {
      try {
        const content = readFileSync(fullPath, 'utf-8');
        const parsed = parseYaml(content);
        if (parsed && typeof parsed === 'object') {
          const name = relative(CONFIGS_DIR, fullPath).replace(/\.(yaml|yml)$/, '');
          entries.push({
            name,
            kind: parsed.kind ?? 'Environment',
            description: parsed.metadata?.description,
            extends: parsed.extends,
            labels: parsed.metadata?.labels,
            modifiedAt: stat.mtime.toISOString(),
          });
        }
      } catch {
        // Skip invalid YAML files
      }
    }
  }
}

/**
 * Load raw YAML text for a config by name.
 */
export function loadRawConfig(name: string): string {
  const path = configPath(name);
  if (!existsSync(path)) {
    throw { code: 'NOT_FOUND', message: `Config '${name}' not found.` };
  }
  return readFileSync(path, 'utf-8');
}

/**
 * Parse a YAML string into a SpyreConfig with full validation.
 * Use for standalone configs (no extends) or final merged results.
 */
export function parseConfig(yamlText: string): SpyreConfig {
  const result = validateYamlString(yamlText);
  if (!result.valid || !result.config) {
    throw {
      code: 'INVALID_CONFIG',
      message: `Config validation failed: ${result.errors.map(e => e.message).join('; ')}`
    };
  }
  return result.config;
}

/**
 * Parse YAML loosely — only checks it's valid YAML with apiVersion/kind/metadata.name.
 * Used for child configs with `extends` where required fields come from the base.
 */
function parseConfigLoose(yamlText: string): SpyreConfig {
  let parsed: unknown;
  try {
    parsed = parseYaml(yamlText);
  } catch (err: unknown) {
    const yamlErr = err as { message?: string };
    throw { code: 'INVALID_CONFIG', message: `YAML syntax error: ${yamlErr.message ?? 'Invalid YAML'}` };
  }

  if (!parsed || typeof parsed !== 'object') {
    throw { code: 'INVALID_CONFIG', message: 'Config must be a YAML object.' };
  }

  const obj = parsed as Record<string, unknown>;
  if (!obj.apiVersion) throw { code: 'INVALID_CONFIG', message: 'Missing required field: apiVersion' };
  if (!obj.kind) throw { code: 'INVALID_CONFIG', message: 'Missing required field: kind' };
  if (!obj.metadata || typeof obj.metadata !== 'object') throw { code: 'INVALID_CONFIG', message: 'Missing required field: metadata' };
  const meta = obj.metadata as Record<string, unknown>;
  if (!meta.name) throw { code: 'INVALID_CONFIG', message: 'Missing required field: metadata.name' };

  // Ensure spec.platform exists as at least an empty object for merging
  if (!obj.spec || typeof obj.spec !== 'object') {
    (obj as Record<string, unknown>).spec = { platform: {} };
  }
  const spec = obj.spec as Record<string, unknown>;
  if (!spec.platform || typeof spec.platform !== 'object') {
    spec.platform = {};
  }

  return parsed as SpyreConfig;
}

/**
 * Resolve a config by name, following extends chains and deep merging.
 * Validates the final merged result, not intermediate child configs.
 */
export function resolveConfig(name: string): SpyreConfig {
  const merged = resolveConfigInternal(name, new Set());

  // Validate the final merged result
  const result = validateConfig(merged);
  if (!result.valid) {
    throw {
      code: 'INVALID_CONFIG',
      message: `Resolved config validation failed: ${result.errors.map(e => e.message).join('; ')}`
    };
  }

  return merged;
}

function resolveConfigInternal(name: string, visited: Set<string>): SpyreConfig {
  if (visited.has(name)) {
    throw { code: 'CIRCULAR_REF', message: `Circular extends reference detected: ${[...visited, name].join(' -> ')}` };
  }
  if (visited.size >= MAX_INHERITANCE_DEPTH) {
    throw { code: 'MAX_DEPTH', message: `Extends chain exceeds maximum depth of ${MAX_INHERITANCE_DEPTH}.` };
  }

  visited.add(name);

  const yamlText = loadRawConfig(name);

  // For configs with extends, parse loosely — missing fields come from the base.
  // For standalone configs, parse strictly.
  const raw = parseYaml(yamlText) as Record<string, unknown>;
  const hasExtends = !!raw?.extends;

  const child = hasExtends ? parseConfigLoose(yamlText) : parseConfig(yamlText);

  if (!child.extends) {
    return child;
  }

  const base = resolveConfigInternal(child.extends, visited);
  return deepMergeConfigs(base, child);
}

/**
 * Deep merge a base config with a child config.
 * Child values override base values. Special handling for provision.packages (concatenate + deduplicate).
 */
function deepMergeConfigs(base: SpyreConfig, child: SpyreConfig): SpyreConfig {
  const merged: SpyreConfig = {
    apiVersion: child.apiVersion,
    kind: child.kind,
    metadata: {
      name: child.metadata.name,
      description: child.metadata.description ?? base.metadata.description,
      labels: {
        ...(base.metadata.labels ?? {}),
        ...(child.metadata.labels ?? {}),
      },
    },
    spec: mergeSpecs(base.spec, child.spec),
  };

  // Remove empty labels
  if (merged.metadata.labels && Object.keys(merged.metadata.labels).length === 0) {
    delete merged.metadata.labels;
  }

  // Don't carry extends into resolved output
  return merged;
}

function mergeSpecs(
  base: SpyreConfig['spec'],
  child: SpyreConfig['spec']
): SpyreConfig['spec'] {
  return {
    platform: {
      type: child.platform.type ?? base.platform.type,
      template: child.platform.template ?? base.platform.template,
      resources: {
        ...(base.platform.resources ?? {}),
        ...(child.platform.resources ?? {}),
      },
      network: {
        ...(base.platform.network ?? {}),
        ...(child.platform.network ?? {}),
      },
    },
    helper_script: child.helper_script ?? base.helper_script,
    provision: mergeProvision(base.provision, child.provision),
    services: child.services ?? base.services,
    claude: child.claude ?? base.claude
      ? { ...(base.claude ?? {}), ...(child.claude ?? {}) }
      : undefined,
    lxc: child.lxc ?? base.lxc
      ? { ...(base.lxc ?? {}), ...(child.lxc ?? {}) }
      : undefined,
    access: child.access ?? base.access
      ? { ...(base.access ?? {}), ...(child.access ?? {}) }
      : undefined,
  };
}

function mergeProvision(
  base: SpyreConfig['spec']['provision'],
  child: SpyreConfig['spec']['provision']
): SpyreConfig['spec']['provision'] {
  if (!base && !child) return undefined;
  if (!base) return child;
  if (!child) return base;

  // Packages: concatenate + deduplicate
  let packages: string[] | undefined;
  if (base.packages || child.packages) {
    const combined = [...(base.packages ?? []), ...(child.packages ?? [])];
    packages = [...new Set(combined)];
  }

  return {
    packages,
    // Scripts and authorized_keys: child replaces base entirely
    scripts: child.scripts ?? base.scripts,
    authorized_keys: child.authorized_keys ?? base.authorized_keys,
  };
}

/**
 * Save a config to disk. Validates before writing.
 */
export function saveConfig(name: string, yamlText: string): ConfigValidationResult {
  const result = validateYamlString(yamlText);
  if (!result.valid) {
    return result;
  }

  const path = configPath(name);
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(path, yamlText, 'utf-8');
  return result;
}

/**
 * Delete a config from disk. Errors if other configs extend it.
 */
export function deleteConfig(name: string): void {
  const path = configPath(name);
  if (!existsSync(path)) {
    throw { code: 'NOT_FOUND', message: `Config '${name}' not found.` };
  }

  // Check if any other configs extend this one
  const allConfigs = listConfigs();
  const dependents = allConfigs.filter(c => c.extends === name);
  if (dependents.length > 0) {
    throw {
      code: 'HAS_DEPENDENTS',
      message: `Cannot delete '${name}': it is extended by ${dependents.map(d => d.name).join(', ')}.`
    };
  }

  unlinkSync(path);
}

/**
 * Check if a config exists by name.
 */
export function configExists(name: string): boolean {
  return existsSync(configPath(name));
}
