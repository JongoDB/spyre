import { v4 as uuid } from 'uuid';
import { getDb } from './db';
import { getEnvironment } from './environments';
import { getConnection } from './ssh-pool';
import type { Service } from '$lib/types/environment';

// =============================================================================
// Service Detector — SSH-based port scanning via `ss -tlnp`
// =============================================================================

/** Ports to always exclude from detection */
const EXCLUDED_PORTS = new Set([22, 2375, 2376]);

/** Well-known port-to-name mappings */
const PORT_NAMES: Record<number, string> = {
  80: 'http',
  443: 'https',
  3000: 'dev-server',
  3001: 'dev-server',
  4173: 'vite-preview',
  4200: 'angular',
  5000: 'flask',
  5173: 'vite',
  5174: 'vite',
  8000: 'web',
  8080: 'web',
  8081: 'web',
  8443: 'https',
  8888: 'jupyter',
  9000: 'web',
  9090: 'web',
};

/** Allowed port ranges for detection */
function isRelevantPort(port: number): boolean {
  if (EXCLUDED_PORTS.has(port)) return false;
  if (port === 80 || port === 443) return true;
  if (port >= 3000 && port <= 9999) return true;
  return false;
}

function guessServiceName(port: number, process: string): string {
  // Check well-known port names first
  const known = PORT_NAMES[port];
  if (known) return known;

  // Try to infer from process name
  const lower = process.toLowerCase();
  if (lower.includes('node')) return 'node';
  if (lower.includes('python')) return 'python';
  if (lower.includes('nginx')) return 'nginx';
  if (lower.includes('apache') || lower.includes('httpd')) return 'apache';

  return `port-${port}`;
}

interface DetectedService {
  port: number;
  name: string;
  process: string;
}

/**
 * SSH into an environment and detect listening TCP services via `ss -tlnp`.
 * Returns an array of detected services with port and inferred name.
 */
export async function detectServices(envId: string): Promise<DetectedService[]> {
  const env = getEnvironment(envId);
  if (!env || !env.ip_address) return [];

  const client = await getConnection(envId);

  const output = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('ss command timed out')), 15000);
    client.exec('ss -tlnp 2>/dev/null', (err, stream) => {
      if (err) { clearTimeout(timer); reject(err); return; }
      let stdout = '';
      stream.on('data', (d: Buffer) => { stdout += d.toString(); });
      stream.stderr.on('data', () => { /* consume */ });
      stream.on('close', () => { clearTimeout(timer); resolve(stdout); });
    });
  });

  const services: DetectedService[] = [];
  const seen = new Set<number>();

  for (const line of output.split('\n')) {
    // ss -tlnp output format:
    // LISTEN  0  128  0.0.0.0:3000  0.0.0.0:*  users:(("node",pid=123,fd=19))
    // LISTEN  0  128  *:8080  *:*  users:(("java",pid=456,fd=5))
    const trimmed = line.trim();
    if (!trimmed.startsWith('LISTEN')) continue;

    // Parse the local address column (4th field)
    const parts = trimmed.split(/\s+/);
    const localAddr = parts[3];
    if (!localAddr) continue;

    // Extract port from address (e.g., "0.0.0.0:3000", "*:8080", ":::3000", "[::]:8080")
    const lastColon = localAddr.lastIndexOf(':');
    if (lastColon === -1) continue;

    const host = localAddr.slice(0, lastColon);
    const portStr = localAddr.slice(lastColon + 1);
    const port = parseInt(portStr, 10);
    if (isNaN(port)) continue;

    // Only include ports bound to all interfaces (0.0.0.0, *, ::, [::])
    const isWildcard = host === '0.0.0.0' || host === '*' || host === '::' || host === '[::]';
    if (!isWildcard) continue;

    if (!isRelevantPort(port)) continue;
    if (seen.has(port)) continue;
    seen.add(port);

    // Extract process name from users:((...)) if present
    const usersMatch = trimmed.match(/users:\(\("([^"]+)"/);
    const processName = usersMatch?.[1] ?? '';

    services.push({
      port,
      name: guessServiceName(port, processName),
      process: processName,
    });
  }

  // Sort by port number
  services.sort((a, b) => a.port - b.port);

  return services;
}

/**
 * Detect services and upsert them into the `services` table.
 * Returns the current list of services for the environment.
 */
export async function scanAndStoreServices(envId: string): Promise<Service[]> {
  const detected = await detectServices(envId);
  const db = getDb();

  const upsert = db.prepare(`
    INSERT INTO services (id, env_id, name, port, protocol, status)
    VALUES (?, ?, ?, ?, 'http', 'up')
    ON CONFLICT(env_id, port) DO UPDATE SET
      name = excluded.name,
      status = 'up'
  `);

  // Mark all existing services as down first, then re-up the ones we found
  db.prepare("UPDATE services SET status = 'down' WHERE env_id = ?").run(envId);

  db.transaction(() => {
    for (const svc of detected) {
      upsert.run(uuid(), envId, svc.name, svc.port);
    }
  })();

  return getServicesForEnv(envId);
}

/**
 * Read services from the database for a given environment.
 */
export function getServicesForEnv(envId: string): Service[] {
  const db = getDb();
  return db.prepare(
    'SELECT * FROM services WHERE env_id = ? ORDER BY port ASC'
  ).all(envId) as Service[];
}
