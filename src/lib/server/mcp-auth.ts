import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getSetting, setSetting } from './settings';

// =============================================================================
// MCP Auth — HMAC-SHA256 Bearer Tokens
// =============================================================================
// Stateless token auth for MCP connections. Each token encodes envId + agentId
// and is signed with a server secret stored in the settings table.

let _cachedSecret: string | null = null;

/**
 * Get (or create on first call) the MCP server secret.
 * Stored in the `settings` table as `mcp_server_secret`.
 */
export function getOrCreateMcpSecret(): string {
  if (_cachedSecret) return _cachedSecret;

  const existing = getSetting('mcp_server_secret');
  if (existing) {
    _cachedSecret = existing;
    return existing;
  }

  const secret = randomBytes(32).toString('hex');
  setSetting('mcp_server_secret', secret);
  _cachedSecret = secret;
  return secret;
}

/**
 * Generate an MCP bearer token for a specific environment + agent.
 * Token format: `${base64(payload)}.${base64(signature)}`
 * The optional role field controls MCP tool visibility (orchestrator vs agent).
 */
export function generateMcpToken(envId: string, agentId: string, role?: 'orchestrator' | 'agent'): string {
  const secret = getOrCreateMcpSecret();
  const payload = role
    ? `${envId}:${agentId}:${Date.now()}:${role}`
    : `${envId}:${agentId}:${Date.now()}`;
  const payloadB64 = Buffer.from(payload).toString('base64url');

  const signature = createHmac('sha256', secret)
    .update(payloadB64)
    .digest();
  const signatureB64 = signature.toString('base64url');

  return `${payloadB64}.${signatureB64}`;
}

export interface McpTokenPayload {
  envId: string;
  agentId: string;
  issuedAt: number;
  role?: 'orchestrator' | 'agent';
}

/**
 * Validate an MCP bearer token. Returns decoded payload or null if invalid.
 */
export function validateMcpToken(token: string): McpTokenPayload | null {
  const dotIndex = token.indexOf('.');
  if (dotIndex === -1) return null;

  const payloadB64 = token.slice(0, dotIndex);
  const signatureB64 = token.slice(dotIndex + 1);

  const secret = getOrCreateMcpSecret();

  // Recompute signature
  const expected = createHmac('sha256', secret)
    .update(payloadB64)
    .digest();

  let provided: Buffer;
  try {
    provided = Buffer.from(signatureB64, 'base64url');
  } catch {
    return null;
  }

  // Constant-time comparison
  if (expected.length !== provided.length) return null;
  if (!timingSafeEqual(expected, provided)) return null;

  // Decode payload
  let payload: string;
  try {
    payload = Buffer.from(payloadB64, 'base64url').toString();
  } catch {
    return null;
  }

  const parts = payload.split(':');
  if (parts.length < 3) return null;

  // Check if last part is a role (orchestrator/agent) — 4-field format
  const lastPart = parts[parts.length - 1];
  let role: 'orchestrator' | 'agent' | undefined;
  let timestampIdx: number;

  if (lastPart === 'orchestrator' || lastPart === 'agent') {
    role = lastPart;
    timestampIdx = parts.length - 2;
  } else {
    timestampIdx = parts.length - 1;
  }

  const issuedAt = parseInt(parts[timestampIdx], 10);
  if (isNaN(issuedAt)) return null;

  // agentId is one before the timestamp
  const agentIdx = timestampIdx - 1;
  if (agentIdx < 1) return null;

  const agentId = parts[agentIdx];
  // envId is everything before agentId (may contain colons)
  const envId = parts.slice(0, agentIdx).join(':');

  if (!envId || !agentId) return null;

  return { envId, agentId, issuedAt, role };
}
