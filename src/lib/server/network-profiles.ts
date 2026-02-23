import { v4 as uuid } from 'uuid';
import { getDb } from './db';
import type { NetworkProfile, NetworkProfileInput } from '$lib/types/template';

export function listProfiles(): NetworkProfile[] {
  const db = getDb();
  return db.prepare('SELECT * FROM network_profiles ORDER BY name ASC').all() as NetworkProfile[];
}

export function getProfile(id: string): NetworkProfile | undefined {
  const db = getDb();
  return db.prepare('SELECT * FROM network_profiles WHERE id = ?').get(id) as NetworkProfile | undefined;
}

export function createProfile(input: NetworkProfileInput): NetworkProfile {
  const db = getDb();
  const id = uuid();

  const existing = db.prepare('SELECT id FROM network_profiles WHERE name = ?').get(input.name);
  if (existing) {
    throw { code: 'DUPLICATE_NAME', message: `Network profile '${input.name}' already exists.` };
  }

  db.prepare(`
    INSERT INTO network_profiles (id, name, description, bridge, ip_mode, ip_address, gateway,
      ip6_mode, ip6_address, ip6_gateway, dns, dns_search, vlan, mtu, firewall, rate_limit)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.name,
    input.description ?? null,
    input.bridge ?? 'vmbr0',
    input.ip_mode ?? 'dhcp',
    input.ip_address ?? null,
    input.gateway ?? null,
    input.ip6_mode ?? 'auto',
    input.ip6_address ?? null,
    input.ip6_gateway ?? null,
    input.dns ?? null,
    input.dns_search ?? null,
    input.vlan ?? null,
    input.mtu ?? null,
    input.firewall ? 1 : 0,
    input.rate_limit ?? null
  );

  return getProfile(id) as NetworkProfile;
}

export function updateProfile(id: string, input: Partial<NetworkProfileInput>): NetworkProfile {
  const db = getDb();
  const existing = getProfile(id);
  if (!existing) {
    throw { code: 'NOT_FOUND', message: 'Network profile not found.' };
  }

  if (input.name && input.name !== existing.name) {
    const dupe = db.prepare('SELECT id FROM network_profiles WHERE name = ? AND id != ?').get(input.name, id);
    if (dupe) {
      throw { code: 'DUPLICATE_NAME', message: `Network profile '${input.name}' already exists.` };
    }
  }

  db.prepare(`
    UPDATE network_profiles
    SET name = ?, description = ?, bridge = ?, ip_mode = ?, ip_address = ?, gateway = ?,
        ip6_mode = ?, ip6_address = ?, ip6_gateway = ?, dns = ?, dns_search = ?,
        vlan = ?, mtu = ?, firewall = ?, rate_limit = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    input.name ?? existing.name,
    input.description !== undefined ? input.description ?? null : existing.description,
    input.bridge ?? existing.bridge,
    input.ip_mode ?? existing.ip_mode,
    input.ip_address !== undefined ? input.ip_address ?? null : existing.ip_address,
    input.gateway !== undefined ? input.gateway ?? null : existing.gateway,
    input.ip6_mode ?? existing.ip6_mode,
    input.ip6_address !== undefined ? input.ip6_address ?? null : existing.ip6_address,
    input.ip6_gateway !== undefined ? input.ip6_gateway ?? null : existing.ip6_gateway,
    input.dns !== undefined ? input.dns ?? null : existing.dns,
    input.dns_search !== undefined ? input.dns_search ?? null : existing.dns_search,
    input.vlan !== undefined ? input.vlan ?? null : existing.vlan,
    input.mtu !== undefined ? input.mtu ?? null : existing.mtu,
    input.firewall !== undefined ? (input.firewall ? 1 : 0) : existing.firewall,
    input.rate_limit !== undefined ? input.rate_limit ?? null : existing.rate_limit,
    id
  );

  return getProfile(id) as NetworkProfile;
}

export function deleteProfile(id: string): void {
  const db = getDb();
  const existing = getProfile(id);
  if (!existing) {
    throw { code: 'NOT_FOUND', message: 'Network profile not found.' };
  }

  const usage = db.prepare('SELECT COUNT(*) as count FROM templates WHERE network_profile_id = ?').get(id) as { count: number };
  if (usage.count > 0) {
    throw { code: 'IN_USE', message: `Cannot delete profile '${existing.name}' — it is used by ${usage.count} template(s).` };
  }

  db.prepare('DELETE FROM network_profiles WHERE id = ?').run(id);
}
