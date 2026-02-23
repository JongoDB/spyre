import { createHash } from 'node:crypto';
import { getDb } from './db';
import type { CommunityScript, CommunityScriptSearchParams, CommunityScriptListResult } from '$lib/types/community-script';
import type { Template } from '$lib/types/template';
import { createTemplate } from './templates';

const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/community-scripts/ProxmoxVE/main';
const METADATA_JSON = `${GITHUB_RAW_BASE}/frontend/public/json`;
const GITHUB_TREES_API = 'https://api.github.com/repos/community-scripts/ProxmoxVE/git/trees/main?recursive=1';

function rowToScript(row: Record<string, unknown>): CommunityScript {
  return {
    slug: row.slug as string,
    name: row.name as string,
    description: (row.description as string) ?? null,
    type: (row.type as 'ct' | 'vm') ?? null,
    categories: row.categories ? JSON.parse(row.categories as string) : [],
    website: (row.website as string) ?? null,
    logo_url: (row.logo_url as string) ?? null,
    documentation: (row.documentation as string) ?? null,
    interface_port: (row.interface_port as number) ?? null,
    default_cpu: (row.default_cpu as number) ?? null,
    default_ram: (row.default_ram as number) ?? null,
    default_disk: (row.default_disk as number) ?? null,
    default_os: (row.default_os as string) ?? null,
    default_os_version: (row.default_os_version as string) ?? null,
    script_path: (row.script_path as string) ?? null,
    install_methods: row.install_methods ? JSON.parse(row.install_methods as string) : [],
    default_username: (row.default_username as string) ?? null,
    default_password: (row.default_password as string) ?? null,
    notes: row.notes ? JSON.parse(row.notes as string) : [],
    fetched_at: row.fetched_at as string,
    source_hash: (row.source_hash as string) ?? null
  };
}

export function listScripts(params: CommunityScriptSearchParams = {}): CommunityScriptListResult {
  const db = getDb();
  const page = params.page ?? 1;
  const limit = params.limit ?? 24;
  const offset = (page - 1) * limit;

  let where = 'WHERE 1=1';
  const binds: unknown[] = [];

  if (params.query) {
    where += ' AND (name LIKE ? OR description LIKE ? OR slug LIKE ?)';
    const q = `%${params.query}%`;
    binds.push(q, q, q);
  }

  if (params.type) {
    where += ' AND type = ?';
    binds.push(params.type);
  }

  if (params.category) {
    where += ' AND categories LIKE ?';
    binds.push(`%"${params.category}"%`);
  }

  const total = (db.prepare(`SELECT COUNT(*) as count FROM community_scripts_cache ${where}`).get(...binds) as { count: number }).count;

  const scripts = db.prepare(
    `SELECT * FROM community_scripts_cache ${where} ORDER BY name ASC LIMIT ? OFFSET ?`
  ).all(...binds, limit, offset) as Array<Record<string, unknown>>;

  return {
    scripts: scripts.map(rowToScript),
    total,
    page,
    limit
  };
}

export function getScript(slug: string): CommunityScript | undefined {
  const db = getDb();
  const row = db.prepare('SELECT * FROM community_scripts_cache WHERE slug = ?').get(slug) as Record<string, unknown> | undefined;
  if (!row) return undefined;
  return rowToScript(row);
}

export function getLastSyncTime(): string | null {
  const db = getDb();
  const row = db.prepare('SELECT MAX(fetched_at) as last_sync FROM community_scripts_cache').get() as { last_sync: string | null };
  return row.last_sync;
}

async function fetchScriptSlugs(): Promise<string[]> {
  // Use the GitHub Git Trees API to list all JSON files in the directory
  const res = await fetch(GITHUB_TREES_API, {
    headers: {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'Spyre/0.1'
    }
  });

  if (!res.ok) {
    throw new Error(`GitHub Trees API returned ${res.status}`);
  }

  const data = await res.json() as { tree: Array<{ path: string; type: string }> };

  const slugs: string[] = [];
  const prefix = 'frontend/public/json/';
  const exclude = new Set(['metadata.json', 'version.json']);

  for (const entry of data.tree) {
    if (entry.type !== 'blob') continue;
    if (!entry.path.startsWith(prefix)) continue;

    const filename = entry.path.slice(prefix.length);
    // Skip subdirectories and non-json files
    if (filename.includes('/') || !filename.endsWith('.json')) continue;
    if (exclude.has(filename)) continue;

    slugs.push(filename.replace('.json', ''));
  }

  return slugs;
}

export async function syncFromGitHub(): Promise<{ added: number; updated: number; total: number }> {
  const db = getDb();

  let scriptSlugs: string[];
  try {
    scriptSlugs = await fetchScriptSlugs();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw { code: 'SYNC_FAILED', message: `Failed to fetch community scripts index: ${message}` };
  }

  if (scriptSlugs.length === 0) {
    throw { code: 'SYNC_FAILED', message: 'No scripts found in the community-scripts repository.' };
  }

  let added = 0;
  let updated = 0;

  const upsert = db.prepare(`
    INSERT INTO community_scripts_cache (
      slug, name, description, type, categories, website, logo_url, documentation,
      interface_port, default_cpu, default_ram, default_disk, default_os, default_os_version,
      script_path, install_methods, default_username, default_password, notes,
      fetched_at, source_hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)
    ON CONFLICT(slug) DO UPDATE SET
      name = excluded.name, description = excluded.description, type = excluded.type,
      categories = excluded.categories, website = excluded.website, logo_url = excluded.logo_url,
      documentation = excluded.documentation, interface_port = excluded.interface_port,
      default_cpu = excluded.default_cpu, default_ram = excluded.default_ram,
      default_disk = excluded.default_disk, default_os = excluded.default_os,
      default_os_version = excluded.default_os_version, script_path = excluded.script_path,
      install_methods = excluded.install_methods, default_username = excluded.default_username,
      default_password = excluded.default_password, notes = excluded.notes,
      fetched_at = datetime('now'), source_hash = excluded.source_hash
  `);

  // Batch fetch in chunks to avoid overwhelming GitHub
  const chunkSize = 20;
  for (let i = 0; i < scriptSlugs.length; i += chunkSize) {
    const chunk = scriptSlugs.slice(i, i + chunkSize);
    const results = await Promise.allSettled(
      chunk.map(async (slug) => {
        const res = await fetch(`${METADATA_JSON}/${slug}.json`, {
          headers: { 'User-Agent': 'Spyre/0.1' }
        });
        if (!res.ok) return null;
        const data = await res.json();
        return { slug, data };
      })
    );

    for (const result of results) {
      if (result.status !== 'fulfilled' || !result.value) continue;
      const { slug, data } = result.value;

      const jsonStr = JSON.stringify(data);
      const hash = createHash('sha256').update(jsonStr).digest('hex');

      // Check if unchanged
      const existing = db.prepare('SELECT source_hash FROM community_scripts_cache WHERE slug = ?').get(slug) as { source_hash: string | null } | undefined;
      if (existing?.source_hash === hash) continue;

      const isNew = !existing;

      // Extract fields from the community-scripts JSON format
      const installMethods = data.install_methods ?? [];
      const defaultMethod = installMethods[0]?.resources ?? {};

      // Categories are stored as integer IDs in the repo
      const categories = data.categories ?? [];

      // Map type field
      let scriptType = data.type ?? null;
      if (scriptType && scriptType !== 'ct' && scriptType !== 'vm') {
        // Types like 'pve', 'addon', 'turnkey' — normalize to ct
        scriptType = 'ct';
      }

      upsert.run(
        slug,
        data.name ?? slug,
        data.description ?? null,
        scriptType,
        categories.length > 0 ? JSON.stringify(categories) : null,
        data.website ?? null,
        data.logo ?? null,
        data.documentation ?? null,
        data.interface_port ?? null,
        defaultMethod.cpu ?? null,
        defaultMethod.ram ?? null,
        defaultMethod.hdd ?? null,
        defaultMethod.os ?? null,
        defaultMethod.version ?? null,
        installMethods[0]?.script ?? null,
        installMethods.length > 0 ? JSON.stringify(installMethods) : null,
        data.default_credentials?.username ?? null,
        data.default_credentials?.password ?? null,
        data.notes ? JSON.stringify(data.notes) : null,
        hash
      );

      if (isNew) added++;
      else updated++;
    }
  }

  const totalRow = db.prepare('SELECT COUNT(*) as count FROM community_scripts_cache').get() as { count: number };

  return { added, updated, total: totalRow.count };
}

export function importAsTemplate(slug: string, templateName?: string): Template {
  const script = getScript(slug);
  if (!script) {
    throw { code: 'NOT_FOUND', message: `Community script '${slug}' not found. Try syncing first.` };
  }

  const name = templateName ?? `${script.name} (Community)`;

  return createTemplate({
    name,
    description: script.description ?? `Imported from community script: ${script.name}`,
    type: script.type === 'vm' ? 'vm' : 'lxc',
    cores: script.default_cpu ?? undefined,
    memory: script.default_ram ?? undefined,
    disk: script.default_disk ?? undefined,
    community_script_slug: slug,
    installed_software: [script.name],
    tags: Array.isArray(script.categories) ? script.categories.map(String).join(', ') : undefined
  });
}

export function getAllCategories(): string[] {
  const db = getDb();
  const rows = db.prepare('SELECT DISTINCT categories FROM community_scripts_cache WHERE categories IS NOT NULL').all() as Array<{ categories: string }>;

  const categorySet = new Set<string>();
  for (const row of rows) {
    const cats = JSON.parse(row.categories);
    if (Array.isArray(cats)) {
      for (const cat of cats) {
        categorySet.add(String(cat));
      }
    }
  }

  return Array.from(categorySet).sort();
}
