import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { AsyncLocalStorage } from 'node:async_hooks';
import { z } from 'zod';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { validateMcpToken, type McpTokenPayload } from './mcp-auth';
import {
  getEnvStatus,
  listAgents,
  getPipelineContext,
  reportProgress,
  getServices,
  getGitActivity,
  getTaskHistory,
  sendMessage,
  getUnreadMessages,
} from './mcp-tools';

// =============================================================================
// MCP Server — Streamable HTTP transport with HMAC auth
// =============================================================================

const authContext = new AsyncLocalStorage<McpTokenPayload>();

/** Get the current request's auth context from AsyncLocalStorage. */
export function getMcpAuthContext(): McpTokenPayload | undefined {
  return authContext.getStore();
}

function getAuthOrThrow(): McpTokenPayload {
  const auth = authContext.getStore();
  if (!auth) throw new Error('MCP auth context not available');
  return auth;
}

// =============================================================================
// McpServer singleton + tool registration
// =============================================================================

let _mcpServer: McpServer | null = null;

function getOrCreateMcpServer(): McpServer {
  if (_mcpServer) return _mcpServer;

  _mcpServer = new McpServer(
    { name: 'spyre', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  // --- Tool: spyre_get_env_status ---
  _mcpServer.tool(
    'spyre_get_env_status',
    'Query this environment\'s state, IP address, and resources',
    {},
    async () => {
      const auth = getAuthOrThrow();
      const result = await getEnvStatus(auth);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  // --- Tool: spyre_list_agents ---
  _mcpServer.tool(
    'spyre_list_agents',
    'List all active agents (devcontainers) and their current tasks',
    {},
    async () => {
      const auth = getAuthOrThrow();
      const result = await listAgents(auth);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  // --- Tool: spyre_get_pipeline_context ---
  _mcpServer.tool(
    'spyre_get_pipeline_context',
    'Read active pipeline state, steps, and gate feedback',
    { pipelineId: z.string().optional().describe('Specific pipeline ID (omit for active pipeline)') },
    async (args) => {
      const auth = getAuthOrThrow();
      const result = await getPipelineContext(auth, { pipelineId: args.pipelineId });
      // Also include any unread messages for this agent
      const messages = getUnreadMessages(auth);
      const output = messages.length > 0
        ? { ...result, unread_messages: messages }
        : result;
      return { content: [{ type: 'text', text: JSON.stringify(output, null, 2) }] };
    }
  );

  // --- Tool: spyre_report_progress ---
  _mcpServer.tool(
    'spyre_report_progress',
    'Report your current progress (preferred over editing progress.json directly)',
    {
      status: z.string().describe('Current status: working, blocked, completed, error'),
      currentTask: z.string().describe('What you are actively doing right now'),
      details: z.string().optional().describe('Additional details or plan summary'),
    },
    async (args) => {
      const auth = getAuthOrThrow();
      const result = await reportProgress(auth, {
        status: args.status,
        currentTask: args.currentTask,
        details: args.details,
      });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  // --- Tool: spyre_get_services ---
  _mcpServer.tool(
    'spyre_get_services',
    'Query detected web services and listening ports',
    {},
    async () => {
      const auth = getAuthOrThrow();
      const result = await getServices(auth);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  // --- Tool: spyre_get_git_activity ---
  _mcpServer.tool(
    'spyre_get_git_activity',
    'Get current branch, recent commits, and diff stats',
    {},
    async () => {
      const auth = getAuthOrThrow();
      const result = await getGitActivity(auth);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  // --- Tool: spyre_get_task_history ---
  _mcpServer.tool(
    'spyre_get_task_history',
    'Get recent Claude task history for this environment',
    { limit: z.number().optional().describe('Max tasks to return (default 10, max 50)') },
    async (args) => {
      const auth = getAuthOrThrow();
      const result = await getTaskHistory(auth, { limit: args.limit });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  // --- Tool: spyre_send_message ---
  _mcpServer.tool(
    'spyre_send_message',
    'Send a message to another agent (async inbox pattern)',
    {
      targetAgentId: z.string().describe('The devcontainer ID or agent ID to message'),
      message: z.string().describe('The message content'),
    },
    async (args) => {
      const auth = getAuthOrThrow();
      const result = await sendMessage(auth, {
        targetAgentId: args.targetAgentId,
        message: args.message,
      });
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  return _mcpServer;
}

// =============================================================================
// Stateful transport management
// =============================================================================
// MCP Streamable HTTP supports stateful sessions. We maintain one transport per
// session. The session ID is generated on the initialize request and reused for
// subsequent requests via the Mcp-Session-Id header.

const transports = new Map<string, StreamableHTTPServerTransport>();

/**
 * Handle an incoming MCP HTTP request.
 * This is the main entry point called by server.js and vite-ws-plugin.ts.
 */
export async function handleMcpRequest(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  // --- Auth: Extract and validate bearer token ---
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing or invalid Authorization header' }));
    return;
  }

  const token = authHeader.slice(7);
  const payload = validateMcpToken(token);
  if (!payload) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid MCP token' }));
    return;
  }

  // --- Handle based on HTTP method ---
  const method = req.method?.toUpperCase();

  if (method === 'POST') {
    // Parse the request body
    const body = await readBody(req);
    if (body === null) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid request body' }));
      return;
    }

    // Check for existing session
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    if (sessionId && transports.has(sessionId)) {
      // Existing session — route to its transport
      const transport = transports.get(sessionId)!;
      await authContext.run(payload, async () => {
        await transport.handleRequest(req, res, body);
      });
      return;
    }

    // New session or no session — check if this is an initialize request
    const isInit = isInitializeRequest(body);

    if (isInit || !sessionId) {
      // Create new transport + session
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
      });

      // Connect to the MCP server
      const server = getOrCreateMcpServer();
      await server.connect(transport);

      // Store the transport by session ID once the response reveals it
      const newSessionId = transport.sessionId;
      if (newSessionId) {
        transports.set(newSessionId, transport);
      }

      // Clean up on close
      transport.onclose = () => {
        if (newSessionId) transports.delete(newSessionId);
      };

      // Handle the request within auth context
      await authContext.run(payload, async () => {
        await transport.handleRequest(req, res, body);
      });
      return;
    }

    // Non-init request without a valid session
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'No valid session. Send an initialize request first.' }));
    return;
  }

  if (method === 'GET') {
    // SSE stream for server-initiated notifications
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (sessionId && transports.has(sessionId)) {
      const transport = transports.get(sessionId)!;
      await authContext.run(payload, async () => {
        await transport.handleRequest(req, res);
      });
      return;
    }
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'No valid session for GET request.' }));
    return;
  }

  if (method === 'DELETE') {
    // Session termination
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (sessionId && transports.has(sessionId)) {
      const transport = transports.get(sessionId)!;
      await transport.handleRequest(req, res);
      transports.delete(sessionId);
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Session not found.' }));
    return;
  }

  // Method not allowed
  res.writeHead(405, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Method not allowed' }));
}

// =============================================================================
// Helpers
// =============================================================================

function readBody(req: IncomingMessage): Promise<unknown | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf-8');
        resolve(JSON.parse(raw));
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
}

function isInitializeRequest(body: unknown): boolean {
  if (typeof body === 'object' && body !== null) {
    const msg = body as Record<string, unknown>;
    if (msg.method === 'initialize') return true;
    // Could be a batch
    if (Array.isArray(body)) {
      return body.some(m => typeof m === 'object' && m !== null && (m as Record<string, unknown>).method === 'initialize');
    }
  }
  return false;
}
