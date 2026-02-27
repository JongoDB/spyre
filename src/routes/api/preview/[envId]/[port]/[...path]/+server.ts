import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { getEnvironment } from '$lib/server/environments';

const PROXY_TIMEOUT = 30000;

async function proxyRequest(envIp: string, port: number, path: string, request: Request, envId: string): Promise<Response> {
  const upstream = `http://${envIp}:${port}/${path}`;

  const headers = new Headers();
  for (const [key, value] of request.headers) {
    // Skip hop-by-hop headers and host
    if (['host', 'connection', 'keep-alive', 'transfer-encoding', 'upgrade'].includes(key.toLowerCase())) continue;
    headers.set(key, value);
  }
  headers.set('X-Forwarded-For', '127.0.0.1');
  headers.set('X-Forwarded-Proto', 'https');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROXY_TIMEOUT);

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(upstream, {
      method: request.method,
      headers,
      body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
      signal: controller.signal,
      redirect: 'manual',
      // @ts-expect-error: duplex needed for streaming body
      duplex: 'half',
    });
  } catch (err) {
    clearTimeout(timer);
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('abort')) {
      throw error(504, 'Upstream request timed out');
    }
    throw error(502, `Cannot connect to service at ${envIp}:${port}`);
  }
  clearTimeout(timer);

  const responseHeaders = new Headers();
  for (const [key, value] of upstreamResponse.headers) {
    if (['transfer-encoding', 'connection', 'keep-alive'].includes(key.toLowerCase())) continue;
    responseHeaders.set(key, value);
  }

  const contentType = upstreamResponse.headers.get('content-type') ?? '';
  const basePath = `/api/preview/${envId}/${port}/`;

  // For HTML responses, inject <base> tag so relative URLs resolve through the proxy
  if (contentType.includes('text/html') && upstreamResponse.body) {
    const html = await upstreamResponse.text();
    const baseTag = `<base href="${basePath}">`;

    let modified: string;
    if (html.includes('<head>')) {
      modified = html.replace('<head>', `<head>${baseTag}`);
    } else if (html.includes('<HEAD>')) {
      modified = html.replace('<HEAD>', `<HEAD>${baseTag}`);
    } else if (html.includes('<html>') || html.includes('<HTML>')) {
      // No <head> tag — inject one
      modified = html.replace(/(<html[^>]*>)/i, `$1<head>${baseTag}</head>`);
    } else {
      // No html structure at all — prepend
      modified = baseTag + html;
    }

    responseHeaders.set('content-length', String(Buffer.byteLength(modified)));
    return new Response(modified, {
      status: upstreamResponse.status,
      headers: responseHeaders,
    });
  }

  return new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: responseHeaders,
  });
}

function validateAndGetEnv(envId: string, portStr: string) {
  const env = getEnvironment(envId);
  if (!env) throw error(404, 'Environment not found');
  if (!env.ip_address) throw error(400, 'Environment has no IP address');

  const port = parseInt(portStr, 10);
  if (isNaN(port) || port < 1 || port > 65535) throw error(400, 'Invalid port');

  return { env, port };
}

export const GET: RequestHandler = async ({ params, request }) => {
  const { env, port } = validateAndGetEnv(params.envId, params.port);
  return proxyRequest(env.ip_address!, port, params.path ?? '', request, params.envId);
};

export const POST: RequestHandler = async ({ params, request }) => {
  const { env, port } = validateAndGetEnv(params.envId, params.port);
  return proxyRequest(env.ip_address!, port, params.path ?? '', request, params.envId);
};

export const PUT: RequestHandler = async ({ params, request }) => {
  const { env, port } = validateAndGetEnv(params.envId, params.port);
  return proxyRequest(env.ip_address!, port, params.path ?? '', request, params.envId);
};

export const DELETE: RequestHandler = async ({ params, request }) => {
  const { env, port } = validateAndGetEnv(params.envId, params.port);
  return proxyRequest(env.ip_address!, port, params.path ?? '', request, params.envId);
};
