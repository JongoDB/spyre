import { parse as parseYaml } from 'yaml';
import type {
  SpyreConfig,
  SpyreConfigScript,
  ConfigValidationResult,
  ConfigValidationError
} from '$lib/types/yaml-config';

const VALID_API_VERSIONS = ['spyre/v1'];
const VALID_KINDS = ['Environment', 'EnvironmentBase'];
const VALID_PLATFORM_TYPES = ['lxc', 'vm'];
const VALID_PROTOCOLS = ['http', 'https', 'tcp'];

const RESOURCE_BOUNDS = {
  cores: { min: 1, max: 64 },
  memory: { min: 128, max: 131072 },
  swap: { min: 0, max: 131072 },
  disk: { min: 1, max: 10000 },
  vlan: { min: 1, max: 4094 },
};

const CIDR_REGEX = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/\d{1,2}$/;
const IP_REGEX = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

/**
 * Validate a parsed YAML config object. Pure function — no filesystem or DB access.
 */
export function validateConfig(raw: unknown): ConfigValidationResult {
  const errors: ConfigValidationError[] = [];
  const warnings: ConfigValidationError[] = [];

  if (!raw || typeof raw !== 'object') {
    errors.push({ path: '', message: 'Config must be a YAML object.' });
    return { valid: false, errors, warnings };
  }

  const obj = raw as Record<string, unknown>;

  // apiVersion
  if (!obj.apiVersion) {
    errors.push({ path: 'apiVersion', message: 'Missing required field: apiVersion' });
  } else if (!VALID_API_VERSIONS.includes(obj.apiVersion as string)) {
    errors.push({ path: 'apiVersion', message: `Invalid apiVersion: '${obj.apiVersion}'. Must be one of: ${VALID_API_VERSIONS.join(', ')}` });
  }

  // kind
  if (!obj.kind) {
    errors.push({ path: 'kind', message: 'Missing required field: kind' });
  } else if (!VALID_KINDS.includes(obj.kind as string)) {
    errors.push({ path: 'kind', message: `Invalid kind: '${obj.kind}'. Must be one of: ${VALID_KINDS.join(', ')}` });
  }

  // metadata
  if (!obj.metadata) {
    errors.push({ path: 'metadata', message: 'Missing required field: metadata' });
  } else if (typeof obj.metadata !== 'object') {
    errors.push({ path: 'metadata', message: 'metadata must be an object.' });
  } else {
    const meta = obj.metadata as Record<string, unknown>;
    if (!meta.name || typeof meta.name !== 'string' || !meta.name.trim()) {
      errors.push({ path: 'metadata.name', message: 'Missing required field: metadata.name' });
    }
    if (meta.labels !== undefined) {
      if (typeof meta.labels !== 'object' || meta.labels === null || Array.isArray(meta.labels)) {
        errors.push({ path: 'metadata.labels', message: 'metadata.labels must be a key-value object.' });
      }
    }
  }

  // extends warning for bases
  if (obj.extends && obj.kind === 'EnvironmentBase') {
    warnings.push({ path: 'extends', message: 'Base configs typically do not use extends. Consider using kind: Environment instead.' });
  }

  // spec
  if (!obj.spec) {
    errors.push({ path: 'spec', message: 'Missing required field: spec' });
  } else if (typeof obj.spec !== 'object') {
    errors.push({ path: 'spec', message: 'spec must be an object.' });
  } else {
    validateSpec(obj.spec as Record<string, unknown>, errors, warnings);
  }

  // If errors found, don't return config
  if (errors.length > 0) {
    return { valid: false, errors, warnings };
  }

  return { valid: true, errors, warnings, config: raw as SpyreConfig };
}

function validateSpec(
  spec: Record<string, unknown>,
  errors: ConfigValidationError[],
  warnings: ConfigValidationError[]
): void {
  // platform is required
  if (!spec.platform) {
    errors.push({ path: 'spec.platform', message: 'Missing required field: spec.platform' });
    return;
  }

  if (typeof spec.platform !== 'object') {
    errors.push({ path: 'spec.platform', message: 'spec.platform must be an object.' });
    return;
  }

  const platform = spec.platform as Record<string, unknown>;

  // platform.type
  if (!platform.type) {
    errors.push({ path: 'spec.platform.type', message: 'Missing required field: spec.platform.type' });
  } else if (!VALID_PLATFORM_TYPES.includes(platform.type as string)) {
    errors.push({ path: 'spec.platform.type', message: `Invalid platform type: '${platform.type}'. Must be one of: ${VALID_PLATFORM_TYPES.join(', ')}` });
  }

  // platform.resources
  if (platform.resources && typeof platform.resources === 'object') {
    const res = platform.resources as Record<string, unknown>;
    validateResourceBound(res, 'cores', 'spec.platform.resources.cores', errors);
    validateResourceBound(res, 'memory', 'spec.platform.resources.memory', errors);
    validateResourceBound(res, 'swap', 'spec.platform.resources.swap', errors);
    validateResourceBound(res, 'disk', 'spec.platform.resources.disk', errors);

    // Low memory warning
    if (typeof res.memory === 'number' && res.memory < 256) {
      warnings.push({ path: 'spec.platform.resources.memory', message: 'Memory below 256 MB may cause issues with many applications.' });
    }
  }

  // platform.network
  if (platform.network && typeof platform.network === 'object') {
    const net = platform.network as Record<string, unknown>;
    if (net.ip && typeof net.ip === 'string' && net.ip !== 'dhcp') {
      if (!CIDR_REGEX.test(net.ip) && !IP_REGEX.test(net.ip)) {
        errors.push({ path: 'spec.platform.network.ip', message: 'Invalid IP address. Use CIDR notation (e.g., 192.168.1.100/24), plain IP, or "dhcp".' });
      }
    }
    if (net.vlan !== undefined) {
      validateResourceBound(net, 'vlan', 'spec.platform.network.vlan', errors);
    }
  }

  // helper_script + template warning
  if (spec.helper_script && platform.template) {
    warnings.push({ path: 'spec', message: 'Both helper_script and platform.template are set. The helper_script may override the template.' });
  }

  // provision
  if (spec.provision && typeof spec.provision === 'object') {
    validateProvision(spec.provision as Record<string, unknown>, errors, warnings);
  }

  // services
  if (spec.services) {
    if (!Array.isArray(spec.services)) {
      errors.push({ path: 'spec.services', message: 'spec.services must be an array.' });
    } else {
      for (let i = 0; i < spec.services.length; i++) {
        const svc = spec.services[i] as Record<string, unknown>;
        if (!svc.name || typeof svc.name !== 'string') {
          errors.push({ path: `spec.services[${i}].name`, message: 'Service must have a name.' });
        }
        if (typeof svc.port !== 'number' || svc.port < 1 || svc.port > 65535) {
          errors.push({ path: `spec.services[${i}].port`, message: 'Service port must be a number between 1 and 65535.' });
        }
        if (svc.protocol && !VALID_PROTOCOLS.includes(svc.protocol as string)) {
          errors.push({ path: `spec.services[${i}].protocol`, message: `Invalid protocol '${svc.protocol}'. Must be one of: ${VALID_PROTOCOLS.join(', ')}` });
        }
      }
    }
  }

  // lxc
  if (spec.lxc && typeof spec.lxc === 'object') {
    const lxc = spec.lxc as Record<string, unknown>;
    if (lxc.startup_order !== undefined && (typeof lxc.startup_order !== 'number' || lxc.startup_order < 0)) {
      errors.push({ path: 'spec.lxc.startup_order', message: 'startup_order must be a non-negative number.' });
    }
  }
}

function validateProvision(
  provision: Record<string, unknown>,
  errors: ConfigValidationError[],
  warnings: ConfigValidationError[]
): void {
  // packages
  if (provision.packages) {
    if (!Array.isArray(provision.packages)) {
      errors.push({ path: 'spec.provision.packages', message: 'provision.packages must be an array of strings.' });
    } else {
      // Duplicate packages warning
      const seen = new Set<string>();
      for (const pkg of provision.packages) {
        if (typeof pkg !== 'string') {
          errors.push({ path: 'spec.provision.packages', message: 'Each package must be a string.' });
          break;
        }
        if (seen.has(pkg)) {
          warnings.push({ path: 'spec.provision.packages', message: `Duplicate package: '${pkg}'` });
        }
        seen.add(pkg);
      }
    }
  }

  // scripts
  if (provision.scripts) {
    if (!Array.isArray(provision.scripts)) {
      errors.push({ path: 'spec.provision.scripts', message: 'provision.scripts must be an array.' });
    } else {
      for (let i = 0; i < provision.scripts.length; i++) {
        const script = provision.scripts[i] as Record<string, unknown>;
        if (script.run && script.copy) {
          errors.push({ path: `spec.provision.scripts[${i}]`, message: 'Script cannot have both "run" and "copy". Use one or the other.' });
        }
        if (!script.run && !script.copy) {
          errors.push({ path: `spec.provision.scripts[${i}]`, message: 'Script must have either "run" or "copy".' });
        }
        if (script.copy && typeof script.copy === 'object') {
          const copy = script.copy as Record<string, unknown>;
          if (!copy.content || typeof copy.content !== 'string') {
            errors.push({ path: `spec.provision.scripts[${i}].copy.content`, message: 'copy.content is required and must be a string.' });
          }
          if (!copy.destination || typeof copy.destination !== 'string') {
            errors.push({ path: `spec.provision.scripts[${i}].copy.destination`, message: 'copy.destination is required and must be a string.' });
          }
        }
      }
    }
  }

  // authorized_keys
  if (provision.authorized_keys) {
    if (!Array.isArray(provision.authorized_keys)) {
      errors.push({ path: 'spec.provision.authorized_keys', message: 'provision.authorized_keys must be an array of strings.' });
    }
  }
}

function validateResourceBound(
  obj: Record<string, unknown>,
  field: string,
  path: string,
  errors: ConfigValidationError[]
): void {
  if (obj[field] === undefined) return;

  const value = obj[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    errors.push({ path, message: `${field} must be a number.` });
    return;
  }

  const bounds = RESOURCE_BOUNDS[field as keyof typeof RESOURCE_BOUNDS];
  if (bounds) {
    if (value < bounds.min || value > bounds.max) {
      errors.push({ path, message: `${field} must be between ${bounds.min} and ${bounds.max}. Got: ${value}` });
    }
  }
}

/**
 * Parse a YAML string and validate it as a Spyre config.
 * Catches YAML syntax errors and adds line/column information.
 */
export function validateYamlString(text: string): ConfigValidationResult {
  let parsed: unknown;
  try {
    parsed = parseYaml(text);
  } catch (err: unknown) {
    const yamlErr = err as { message?: string; linePos?: Array<{ line: number; col: number }> };
    const line = yamlErr.linePos?.[0]?.line;
    const column = yamlErr.linePos?.[0]?.col;
    return {
      valid: false,
      errors: [{
        path: '',
        message: `YAML syntax error: ${yamlErr.message ?? 'Invalid YAML'}`,
        line,
        column
      }],
      warnings: []
    };
  }

  return validateConfig(parsed);
}
