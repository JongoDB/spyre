import { v4 as uuid } from 'uuid';
import { getDb } from './db';
import { getEnvConfig } from './env-config';
import { getPreset } from './resource-presets';
import { getProfile } from './network-profiles';
import type {
  Template,
  TemplateWithRelations,
  TemplateInput,
  ResolvedTemplate,
  SoftwarePoolWithItems,
  SoftwarePoolItem
} from '$lib/types/template';

export function listTemplates(): Template[] {
  const db = getDb();
  return db.prepare('SELECT * FROM templates ORDER BY name ASC').all() as Template[];
}

export function getTemplate(id: string): Template | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM templates WHERE id = ?').get(id) as Template | undefined;
}

export function getTemplateWithRelations(id: string): TemplateWithRelations | undefined {
  const db = getDb();
  const template = getTemplate(id);
  if (!template) return undefined;

  const resourcePreset = template.resource_preset_id
    ? getPreset(template.resource_preset_id) ?? null
    : null;

  const networkProfile = template.network_profile_id
    ? getProfile(template.network_profile_id) ?? null
    : null;

  // Get attached software pools with items
  const poolJoins = db.prepare(`
    SELECT sp.*, tsp.sort_order as join_sort_order
    FROM template_software_pools tsp
    JOIN software_pools sp ON sp.id = tsp.pool_id
    WHERE tsp.template_id = ?
    ORDER BY tsp.sort_order ASC
  `).all(id) as Array<{ id: string; name: string; description: string | null; created_at: string; updated_at: string; join_sort_order: number }>;

  const softwarePools: SoftwarePoolWithItems[] = poolJoins.map(pool => {
    const items = db.prepare(
      'SELECT * FROM software_pool_items WHERE pool_id = ? ORDER BY sort_order ASC'
    ).all(pool.id) as SoftwarePoolItem[];

    return {
      id: pool.id,
      name: pool.name,
      description: pool.description,
      created_at: pool.created_at,
      updated_at: pool.updated_at,
      items
    };
  });

  return {
    ...template,
    resource_preset: resourcePreset,
    network_profile: networkProfile,
    software_pools: softwarePools
  };
}

export function resolveTemplate(id: string): ResolvedTemplate {
  const templateWithRelations = getTemplateWithRelations(id);
  if (!templateWithRelations) {
    throw { code: 'NOT_FOUND', message: 'Template not found.' };
  }

  const config = getEnvConfig();
  const t = templateWithRelations;
  const preset = t.resource_preset;
  const profile = t.network_profile;

  // Resolution order: environment.yaml defaults -> preset/profile -> template inline
  // Last non-null wins (template inline overrides preset/profile, which overrides env defaults)

  const resolved: ResolvedTemplate = {
    id: t.id,
    name: t.name,
    description: t.description,
    type: t.type,

    // OS
    os_template: t.os_template ?? '',
    os_type: t.os_type,
    os_version: t.os_version,

    // Resources: env defaults -> preset -> template inline
    cores: t.cores ?? preset?.cores ?? 1,
    memory: t.memory ?? preset?.memory ?? 512,
    swap: t.swap ?? preset?.swap ?? 0,
    disk: t.disk ?? preset?.disk ?? 8,
    storage: t.storage ?? config.defaults.storage,

    // Network: env defaults -> profile -> template inline
    bridge: t.bridge ?? profile?.bridge ?? config.defaults.bridge,
    ip_mode: t.ip_mode ?? profile?.ip_mode ?? 'dhcp',
    ip_address: t.ip_address ?? profile?.ip_address ?? null,
    gateway: t.gateway ?? profile?.gateway ?? (config.defaults.gateway || null),
    dns: t.dns ?? profile?.dns ?? config.defaults.dns ?? '8.8.8.8',
    vlan: t.vlan ?? profile?.vlan ?? null,

    // LXC settings
    unprivileged: !!t.unprivileged,
    nesting: !!t.nesting,
    features: t.features,
    startup_order: t.startup_order,
    protection: !!t.protection,

    // Access
    ssh_enabled: !!t.ssh_enabled,
    ssh_keys: t.ssh_keys,
    root_password: t.root_password,
    default_user: t.default_user,
    timezone: t.timezone ?? 'host',

    // Community
    community_script_slug: t.community_script_slug,

    // Software pools
    software_pools: t.software_pools,
    custom_script: t.custom_script,

    // Display
    installed_software: t.installed_software ? JSON.parse(t.installed_software) : [],
    tags: t.tags ? t.tags.split(',').map(s => s.trim()).filter(Boolean) : []
  };

  return resolved;
}

export function createTemplate(input: TemplateInput): Template {
  const db = getDb();
  const id = uuid();

  const existing = db.prepare('SELECT id FROM templates WHERE name = ?').get(input.name);
  if (existing) {
    throw { code: 'DUPLICATE_NAME', message: `Template '${input.name}' already exists.` };
  }

  const insertTemplate = db.prepare(`
    INSERT INTO templates (
      id, name, description, type,
      resource_preset_id, network_profile_id,
      os_template, os_type, os_version,
      cores, memory, swap, disk, storage,
      bridge, ip_mode, ip_address, gateway, dns, vlan,
      unprivileged, nesting, features, startup_order, protection,
      ssh_enabled, ssh_keys, root_password, default_user, timezone,
      community_script_slug, installed_software, custom_script, tags
    ) VALUES (
      ?, ?, ?, ?,
      ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?
    )
  `);

  const insertPoolJoin = db.prepare(`
    INSERT INTO template_software_pools (template_id, pool_id, sort_order)
    VALUES (?, ?, ?)
  `);

  db.transaction(() => {
    insertTemplate.run(
      id, input.name, input.description ?? null, input.type ?? 'lxc',
      input.resource_preset_id ?? null, input.network_profile_id ?? null,
      input.os_template ?? null, input.os_type ?? null, input.os_version ?? null,
      input.cores ?? null, input.memory ?? null, input.swap ?? null, input.disk ?? null, input.storage ?? null,
      input.bridge ?? null, input.ip_mode ?? null, input.ip_address ?? null, input.gateway ?? null, input.dns ?? null, input.vlan ?? null,
      input.unprivileged !== false ? 1 : 0,
      input.nesting !== false ? 1 : 0,
      input.features ?? null, input.startup_order ?? null, input.protection ? 1 : 0,
      input.ssh_enabled !== false ? 1 : 0,
      input.ssh_keys ?? null, input.root_password ?? null, input.default_user ?? null, input.timezone ?? 'host',
      input.community_script_slug ?? null,
      input.installed_software ? JSON.stringify(input.installed_software) : null,
      input.custom_script ?? null, input.tags ?? null
    );

    if (input.software_pool_ids) {
      for (let i = 0; i < input.software_pool_ids.length; i++) {
        insertPoolJoin.run(id, input.software_pool_ids[i], i);
      }
    }
  })();

  return getTemplate(id) as Template;
}

export function updateTemplate(id: string, input: Partial<TemplateInput>): Template {
  const db = getDb();
  const existing = getTemplate(id);
  if (!existing) {
    throw { code: 'NOT_FOUND', message: 'Template not found.' };
  }

  if (input.name && input.name !== existing.name) {
    const dupe = db.prepare('SELECT id FROM templates WHERE name = ? AND id != ?').get(input.name, id);
    if (dupe) {
      throw { code: 'DUPLICATE_NAME', message: `Template '${input.name}' already exists.` };
    }
  }

  db.prepare(`
    UPDATE templates SET
      name = ?, description = ?, type = ?,
      resource_preset_id = ?, network_profile_id = ?,
      os_template = ?, os_type = ?, os_version = ?,
      cores = ?, memory = ?, swap = ?, disk = ?, storage = ?,
      bridge = ?, ip_mode = ?, ip_address = ?, gateway = ?, dns = ?, vlan = ?,
      unprivileged = ?, nesting = ?, features = ?, startup_order = ?, protection = ?,
      ssh_enabled = ?, ssh_keys = ?, root_password = ?, default_user = ?, timezone = ?,
      community_script_slug = ?, installed_software = ?, custom_script = ?, tags = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    input.name ?? existing.name,
    input.description !== undefined ? input.description ?? null : existing.description,
    input.type ?? existing.type,
    input.resource_preset_id !== undefined ? input.resource_preset_id ?? null : existing.resource_preset_id,
    input.network_profile_id !== undefined ? input.network_profile_id ?? null : existing.network_profile_id,
    input.os_template !== undefined ? input.os_template ?? null : existing.os_template,
    input.os_type !== undefined ? input.os_type ?? null : existing.os_type,
    input.os_version !== undefined ? input.os_version ?? null : existing.os_version,
    input.cores !== undefined ? input.cores ?? null : existing.cores,
    input.memory !== undefined ? input.memory ?? null : existing.memory,
    input.swap !== undefined ? input.swap ?? null : existing.swap,
    input.disk !== undefined ? input.disk ?? null : existing.disk,
    input.storage !== undefined ? input.storage ?? null : existing.storage,
    input.bridge !== undefined ? input.bridge ?? null : existing.bridge,
    input.ip_mode !== undefined ? input.ip_mode ?? null : existing.ip_mode,
    input.ip_address !== undefined ? input.ip_address ?? null : existing.ip_address,
    input.gateway !== undefined ? input.gateway ?? null : existing.gateway,
    input.dns !== undefined ? input.dns ?? null : existing.dns,
    input.vlan !== undefined ? input.vlan ?? null : existing.vlan,
    input.unprivileged !== undefined ? (input.unprivileged ? 1 : 0) : existing.unprivileged,
    input.nesting !== undefined ? (input.nesting ? 1 : 0) : existing.nesting,
    input.features !== undefined ? input.features ?? null : existing.features,
    input.startup_order !== undefined ? input.startup_order ?? null : existing.startup_order,
    input.protection !== undefined ? (input.protection ? 1 : 0) : existing.protection,
    input.ssh_enabled !== undefined ? (input.ssh_enabled ? 1 : 0) : existing.ssh_enabled,
    input.ssh_keys !== undefined ? input.ssh_keys ?? null : existing.ssh_keys,
    input.root_password !== undefined ? input.root_password ?? null : existing.root_password,
    input.default_user !== undefined ? input.default_user ?? null : existing.default_user,
    input.timezone !== undefined ? input.timezone ?? null : existing.timezone,
    input.community_script_slug !== undefined ? input.community_script_slug ?? null : existing.community_script_slug,
    input.installed_software !== undefined
      ? (input.installed_software ? JSON.stringify(input.installed_software) : null)
      : existing.installed_software,
    input.custom_script !== undefined ? input.custom_script ?? null : existing.custom_script,
    input.tags !== undefined ? input.tags ?? null : existing.tags,
    id
  );

  // Update software pool associations if provided
  if (input.software_pool_ids !== undefined) {
    const deleteJoins = db.prepare('DELETE FROM template_software_pools WHERE template_id = ?');
    const insertJoin = db.prepare(
      'INSERT INTO template_software_pools (template_id, pool_id, sort_order) VALUES (?, ?, ?)'
    );

    db.transaction(() => {
      deleteJoins.run(id);
      for (let i = 0; i < input.software_pool_ids!.length; i++) {
        insertJoin.run(id, input.software_pool_ids![i], i);
      }
    })();
  }

  return getTemplate(id) as Template;
}

export function deleteTemplate(id: string): void {
  const db = getDb();
  const existing = getTemplate(id);
  if (!existing) {
    throw { code: 'NOT_FOUND', message: 'Template not found.' };
  }

  db.transaction(() => {
    db.prepare('DELETE FROM template_software_pools WHERE template_id = ?').run(id);
    db.prepare('DELETE FROM templates WHERE id = ?').run(id);
  })();
}

export function duplicateTemplate(id: string, newName?: string): Template {
  const db = getDb();
  const existing = getTemplateWithRelations(id);
  if (!existing) {
    throw { code: 'NOT_FOUND', message: 'Template not found.' };
  }

  const name = newName ?? `${existing.name} (copy)`;

  // Check name doesn't exist
  const dupe = db.prepare('SELECT id FROM templates WHERE name = ?').get(name);
  if (dupe) {
    throw { code: 'DUPLICATE_NAME', message: `Template '${name}' already exists.` };
  }

  const poolIds = existing.software_pools.map(p => p.id);

  return createTemplate({
    name,
    description: existing.description ?? undefined,
    type: existing.type,
    resource_preset_id: existing.resource_preset_id ?? undefined,
    network_profile_id: existing.network_profile_id ?? undefined,
    os_template: existing.os_template ?? undefined,
    os_type: existing.os_type ?? undefined,
    os_version: existing.os_version ?? undefined,
    cores: existing.cores ?? undefined,
    memory: existing.memory ?? undefined,
    swap: existing.swap ?? undefined,
    disk: existing.disk ?? undefined,
    storage: existing.storage ?? undefined,
    bridge: existing.bridge ?? undefined,
    ip_mode: existing.ip_mode ?? undefined,
    ip_address: existing.ip_address ?? undefined,
    gateway: existing.gateway ?? undefined,
    dns: existing.dns ?? undefined,
    vlan: existing.vlan ?? undefined,
    unprivileged: !!existing.unprivileged,
    nesting: !!existing.nesting,
    features: existing.features ?? undefined,
    startup_order: existing.startup_order ?? undefined,
    protection: !!existing.protection,
    ssh_enabled: !!existing.ssh_enabled,
    ssh_keys: existing.ssh_keys ?? undefined,
    root_password: existing.root_password ?? undefined,
    default_user: existing.default_user ?? undefined,
    timezone: existing.timezone ?? undefined,
    community_script_slug: existing.community_script_slug ?? undefined,
    installed_software: existing.installed_software ? JSON.parse(existing.installed_software) : undefined,
    custom_script: existing.custom_script ?? undefined,
    tags: existing.tags ?? undefined,
    software_pool_ids: poolIds.length > 0 ? poolIds : undefined
  });
}
