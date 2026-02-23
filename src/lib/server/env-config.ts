import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { env } from '$env/dynamic/private';
import type { EnvironmentConfig } from '$lib/types/config';

let _config: EnvironmentConfig | null = null;

function loadConfig(): EnvironmentConfig {
  const configPath = resolve(process.cwd(), 'environment.yaml');

  let raw: string;
  try {
    raw = readFileSync(configPath, 'utf-8');
  } catch {
    throw new Error(
      `Missing environment.yaml at ${configPath}. Run setup.sh first or create it manually.`
    );
  }

  const parsed = parse(raw);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('environment.yaml is empty or malformed.');
  }

  if (!parsed.proxmox?.host) {
    throw new Error('environment.yaml is missing proxmox.host. Check the file.');
  }

  if (!parsed.proxmox?.token_id) {
    throw new Error('environment.yaml is missing proxmox.token_id. Check the file.');
  }

  return parsed as EnvironmentConfig;
}

export function getEnvConfig(): EnvironmentConfig {
  if (!_config) {
    _config = loadConfig();
  }
  return _config;
}

export function getProxmoxTokenSecret(): string {
  return env.SPYRE_PVE_TOKEN_SECRET ?? '';
}
