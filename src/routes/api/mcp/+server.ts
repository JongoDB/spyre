// This route ensures the mcp-server module is bundled into the SvelteKit build
// output. The actual MCP endpoint is handled at the raw HTTP level by server.js
// (production) or vite-ws-plugin.ts (dev) because MCP Streamable HTTP requires
// Node IncomingMessage/ServerResponse for SSE streaming.
//
// Importing handleMcpRequest here forces Vite to include the module graph in
// the build. The production server.js finds it via chunk imports.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { handleMcpRequest } from '$lib/server/mcp-server';

// Prefixed exports are allowed by SvelteKit
export const _handleMcpRequest = handleMcpRequest;

export const GET: RequestHandler = async () => {
  return json({
    name: 'spyre-mcp',
    version: '1.0.0',
    message: 'MCP endpoint is handled at the raw HTTP level. POST to /mcp with a valid bearer token.',
  });
};
