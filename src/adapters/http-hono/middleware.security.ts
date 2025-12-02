// Hono adapter for MCP security middleware (simplified for bearer token auth)

import { randomUUID } from 'node:crypto';
import type { HttpBindings } from '@hono/node-server';
import type { MiddlewareHandler } from 'hono';
import type { UnifiedConfig } from '../../shared/config/env.js';
import {
  buildUnauthorizedChallenge,
  validateOrigin,
  validateProtocolVersion,
} from '../../shared/mcp/security.js';
import { sharedLogger as logger } from '../../shared/utils/logger.js';

/**
 * Helper to return 401 challenge response
 */
function challengeResponse(
  c: Parameters<MiddlewareHandler>[0],
  origin: string,
  sid: string,
  message?: string,
) {
  const challenge = buildUnauthorizedChallenge({ origin, sid, message });
  c.header('Mcp-Session-Id', sid);
  c.header('WWW-Authenticate', challenge.headers['WWW-Authenticate']);
  return c.json(challenge.body, challenge.status);
}

export function createMcpSecurityMiddleware(config: UnifiedConfig): MiddlewareHandler<{
  Bindings: HttpBindings;
}> {
  return async (c, next) => {
    try {
      validateOrigin(c.req.raw.headers, config.NODE_ENV === 'development');
      validateProtocolVersion(c.req.raw.headers, config.MCP_PROTOCOL_VERSION);

      // No auth required
      if (!config.AUTH_ENABLED || config.AUTH_STRATEGY === 'none') {
        return next();
      }

      const auth = c.req.header('Authorization') ?? undefined;
      const sid = c.req.header('Mcp-Session-Id') ?? randomUUID();
      const origin = new URL(c.req.url).origin;

      // Challenge if no auth header
      if (!auth) {
        logger.debug('mcp_security', { message: 'No auth header, challenging', sid });
        return challengeResponse(c, origin, sid);
      }

      // Extract Bearer token
      const [scheme, token] = auth.split(' ', 2);
      const bearer = scheme?.toLowerCase() === 'bearer' ? token?.trim() : '';

      if (!bearer) {
        logger.debug('mcp_security', { message: 'Invalid auth scheme', sid });
        return challengeResponse(c, origin, sid, 'Bearer token required');
      }

      // Bearer token validation
      if (config.AUTH_STRATEGY === 'bearer') {
        if (!config.BEARER_TOKEN) {
          logger.error('mcp_security', { message: 'BEARER_TOKEN not configured' });
          return challengeResponse(c, origin, sid, 'Server misconfigured');
        }

        if (bearer !== config.BEARER_TOKEN) {
          logger.debug('mcp_security', { message: 'Invalid bearer token', sid });
          return challengeResponse(c, origin, sid, 'Invalid token');
        }

        // Valid - inject minimal auth context
        const authContext = {
          strategy: 'bearer' as const,
          authHeaders: { authorization: auth },
          resolvedHeaders: { authorization: auth },
        };
        (c as unknown as { authContext: typeof authContext }).authContext = authContext;
        return next();
      }

      // Fallback - allow if auth provided
      return next();
    } catch (error) {
      logger.error('mcp_security', {
        message: 'Security check failed',
        error: (error as Error).message,
      });

      return c.json(
        {
          jsonrpc: '2.0',
          error: {
            code: -32603,
            message: (error as Error).message || 'Internal server error',
          },
          id: null,
        },
        500,
      );
    }
  };
}
