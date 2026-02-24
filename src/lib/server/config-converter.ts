import { stringify as stringifyYaml } from 'yaml';
import type { SpyreConfig, SpyreConfigScript, SpyreConfigPackage } from '$lib/types/yaml-config';
import type { TemplateInput, TemplateWithRelations, SoftwarePoolItem, SoftwarePoolItemInput } from '$lib/types/template';

/**
 * Convert a validated SpyreConfig into a TemplateInput suitable for DB creation.
 */
export function yamlConfigToTemplateInput(config: SpyreConfig): TemplateInput {
  const { metadata, spec } = config;
  const { platform, provision, lxc, access } = spec;

  // Map labels to tags
  let tags: string | undefined;
  if (metadata.labels && Object.keys(metadata.labels).length > 0) {
    tags = Object.entries(metadata.labels)
      .map(([k, v]) => `${k}:${v}`)
      .join(',');
  }

  // Parse IP mode from network config
  let ipMode: 'dhcp' | 'static' | undefined;
  let ipAddress: string | undefined;
  if (platform.network?.ip) {
    if (platform.network.ip === 'dhcp') {
      ipMode = 'dhcp';
    } else {
      ipMode = 'static';
      ipAddress = platform.network.ip;
    }
  }

  // Build SSH keys from authorized_keys
  let sshKeys: string | undefined;
  if (provision?.authorized_keys && provision.authorized_keys.length > 0) {
    sshKeys = provision.authorized_keys.join('\n');
  }

  const input: TemplateInput = {
    name: metadata.name,
    description: metadata.description,
    type: platform.type,

    os_template: platform.template,

    // Resources
    cores: platform.resources?.cores,
    memory: platform.resources?.memory,
    swap: platform.resources?.swap,
    disk: platform.resources?.disk,
    storage: platform.resources?.storage,

    // Network
    bridge: platform.network?.bridge,
    ip_mode: ipMode,
    ip_address: ipAddress,
    gateway: platform.network?.gateway,
    dns: platform.network?.dns,
    vlan: platform.network?.vlan,

    // LXC settings
    unprivileged: lxc?.unprivileged,
    nesting: lxc?.nesting,
    features: lxc?.features,
    startup_order: lxc?.startup_order,
    protection: lxc?.protection,

    // Access
    ssh_enabled: access?.ssh_enabled,
    ssh_keys: sshKeys,
    root_password: access?.root_password,
    default_user: access?.default_user,
    timezone: access?.timezone,

    // Tags
    tags,

    // Custom script from helper_script
    custom_script: spec.helper_script,
  };

  return input;
}

/**
 * Build software pool items from provision section.
 * Returns items that should be added to a software pool for this config.
 */
export function yamlConfigToSoftwarePoolItems(config: SpyreConfig): Array<SoftwarePoolItemInput & { sort_order: number }> {
  const items: Array<SoftwarePoolItemInput & { sort_order: number }> = [];

  const provision = config.spec.provision;
  if (!provision) return items;

  let order = 0;

  // Packages — support both plain strings and object form
  if (provision.packages && provision.packages.length > 0) {
    // Group plain strings into one item, object-form packages get individual items
    const plainPkgs: string[] = [];

    for (const pkg of provision.packages) {
      if (typeof pkg === 'string') {
        plainPkgs.push(pkg);
      } else {
        // Object form: { name, manager?, condition? }
        items.push({
          item_type: 'package',
          content: pkg.name,
          label: `Package: ${pkg.name}`,
          package_manager: pkg.manager,
          condition: pkg.condition,
          sort_order: order++
        });
      }
    }

    if (plainPkgs.length > 0) {
      items.push({
        item_type: 'package',
        content: plainPkgs.join(' '),
        label: 'Packages from YAML config',
        sort_order: order++
      });
    }
  }

  // Scripts
  if (provision.scripts) {
    for (const script of provision.scripts) {
      if (script.run || script.url) {
        items.push({
          item_type: 'script',
          content: script.run ?? '',
          label: script.name,
          post_command: script.post_command,
          interpreter: script.interpreter,
          source_url: script.url,
          condition: script.condition,
          sort_order: order++
        });
      } else if (script.copy) {
        items.push({
          item_type: 'file',
          content: script.copy.content,
          destination: script.copy.destination,
          label: script.name,
          post_command: script.post_command,
          file_mode: script.mode,
          file_owner: script.owner,
          condition: script.condition,
          sort_order: order++
        });
      }
    }
  }

  return items;
}

/**
 * Convert a DB template (with relations) to a SpyreConfig YAML object.
 */
export function templateToYamlConfig(template: TemplateWithRelations): SpyreConfig {
  // Parse tags into labels
  let labels: Record<string, string> | undefined;
  if (template.tags) {
    const entries = template.tags.split(',').map(s => s.trim()).filter(Boolean);
    const parsed: Record<string, string> = {};
    for (const entry of entries) {
      const colonIdx = entry.indexOf(':');
      if (colonIdx > 0) {
        parsed[entry.slice(0, colonIdx)] = entry.slice(colonIdx + 1);
      } else {
        parsed[entry] = 'true';
      }
    }
    if (Object.keys(parsed).length > 0) {
      labels = parsed;
    }
  }

  // Build network config
  let ip: string | undefined;
  if (template.ip_mode === 'static' && template.ip_address) {
    ip = template.ip_address;
  } else if (template.ip_mode === 'dhcp') {
    ip = 'dhcp';
  }

  const network = omitEmpty({
    bridge: template.bridge,
    ip,
    gateway: template.gateway,
    dns: template.dns,
    vlan: template.vlan,
  });

  const resources = omitEmpty({
    cores: template.cores,
    memory: template.memory,
    swap: template.swap,
    disk: template.disk,
    storage: template.storage,
  });

  // Build provision from software pools
  const packages: Array<string | SpyreConfigPackage> = [];
  const scripts: SpyreConfigScript[] = [];

  for (const pool of template.software_pools) {
    for (const item of pool.items) {
      switch (item.item_type) {
        case 'package': {
          const pkgNames = item.content.split(/\s+/).filter(Boolean);
          const hasExtras = item.package_manager || item.condition;
          if (hasExtras) {
            // Emit as object form for each package
            for (const name of pkgNames) {
              const pkg: SpyreConfigPackage = { name };
              if (item.package_manager && item.package_manager !== 'auto') pkg.manager = item.package_manager;
              if (item.condition) pkg.condition = item.condition;
              packages.push(pkg);
            }
          } else {
            packages.push(...pkgNames);
          }
          break;
        }
        case 'script':
          scripts.push(omitEmpty({
            name: item.label,
            run: item.source_url ? undefined : item.content || undefined,
            url: item.source_url,
            interpreter: item.interpreter,
            post_command: item.post_command,
            condition: item.condition,
          }) as SpyreConfigScript);
          break;
        case 'file':
          scripts.push(omitEmpty({
            name: item.label,
            copy: item.source_url ? undefined : {
              content: item.content,
              destination: item.destination ?? '/tmp/spyre-file',
            },
            url: item.source_url,
            mode: item.file_mode,
            owner: item.file_owner,
            post_command: item.post_command,
            condition: item.condition,
          }) as SpyreConfigScript);
          break;
      }
    }
  }

  // Build authorized_keys from ssh_keys
  let authorizedKeys: string[] | undefined;
  if (template.ssh_keys) {
    authorizedKeys = template.ssh_keys.split('\n').filter(Boolean);
  }

  const provision = omitEmpty({
    packages: packages.length > 0 ? packages : undefined,
    scripts: scripts.length > 0 ? scripts : undefined,
    authorized_keys: authorizedKeys,
  });

  const lxcSettings = omitEmpty({
    unprivileged: template.unprivileged === 0 ? false : undefined,
    nesting: template.nesting === 1 ? true : undefined,
    features: template.features,
    startup_order: template.startup_order,
    protection: template.protection === 1 ? true : undefined,
  });

  const access = omitEmpty({
    ssh_enabled: template.ssh_enabled === 0 ? false : undefined,
    root_password: template.root_password,
    default_user: template.default_user,
    timezone: template.timezone !== 'host' ? template.timezone : undefined,
  });

  const config: SpyreConfig = {
    apiVersion: 'spyre/v1',
    kind: 'Environment',
    metadata: {
      name: template.name,
      ...(template.description ? { description: template.description } : {}),
      ...(labels ? { labels } : {}),
    },
    spec: {
      platform: {
        type: template.type,
        ...(template.os_template ? { template: template.os_template } : {}),
        ...(resources && Object.keys(resources).length > 0 ? { resources } : {}),
        ...(network && Object.keys(network).length > 0 ? { network } : {}),
      },
      ...(template.custom_script ? { helper_script: template.custom_script } : {}),
      ...(provision && Object.keys(provision).length > 0 ? { provision } : {}),
      ...(lxcSettings && Object.keys(lxcSettings).length > 0 ? { lxc: lxcSettings } : {}),
      ...(access && Object.keys(access).length > 0 ? { access } : {}),
    },
  };

  return config;
}

/**
 * Convert a SpyreConfig to a YAML string.
 */
export function yamlConfigToString(config: SpyreConfig): string {
  return stringifyYaml(config, { indent: 2, lineWidth: 120 });
}

/**
 * Remove keys with undefined/null values from an object.
 */
function omitEmpty<T extends Record<string, unknown>>(obj: T): Partial<T> | undefined {
  const result: Record<string, unknown> = {};
  let hasKeys = false;
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined && value !== null) {
      result[key] = value;
      hasKeys = true;
    }
  }
  return hasKeys ? result as Partial<T> : undefined;
}
