/**
 * Auth configuration for Google Maps MCP.
 * Uses simple Bearer token auth - no OAuth/JWT needed.
 */

import type { Context } from 'hono';

/**
 * Extract Bearer token from Authorization header.
 */
export const validateBearer = (headers: Headers): string | null => {
  const auth = headers.get('Authorization') || headers.get('authorization');
  if (!auth || !auth.startsWith('Bearer ')) return null;
  return auth.slice('Bearer '.length).trim();
};

/**
 * Require Bearer token or return 401.
 */
export const requireBearerOr401 = (c: Context): string | Response => {
  const token = validateBearer(c.req.raw.headers);
  if (!token) {
    c.header('WWW-Authenticate', 'Bearer realm="MCP"');
    return c.json(
      {
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Unauthorized' },
        id: null,
      },
      401,
    );
  }
  return token;
};
