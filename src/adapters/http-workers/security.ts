/**
 * Workers security middleware for Bearer token auth.
 */

import type { UnifiedConfig } from '../../shared/config/env.js';
import { withCors } from '../../shared/http/cors.js';
import {
  buildUnauthorizedChallenge,
  validateOrigin,
  validateProtocolVersion,
} from '../../shared/mcp/security.js';

/**
 * Helper to build 401 challenge response.
 */
function buildChallengeResponse(
  origin: string,
  sid: string,
  message?: string,
): Response {
  const challenge = buildUnauthorizedChallenge({ origin, sid, message });
  const resp = new Response(JSON.stringify(challenge.body), {
    status: challenge.status,
    headers: {
      'Content-Type': 'application/json',
      'Mcp-Session-Id': sid,
      'WWW-Authenticate': challenge.headers['WWW-Authenticate'],
    },
  });
  return withCors(resp);
}

/**
 * Check if request is authorized.
 * Returns null if authorized, or a Response to send if not.
 */
export async function checkAuthAndChallenge(
  request: Request,
  config: UnifiedConfig,
  sid: string,
): Promise<Response | null> {
  const origin = new URL(request.url).origin;

  // Validate origin and protocol version
  try {
    validateOrigin(request.headers, config.NODE_ENV === 'development');
    validateProtocolVersion(request.headers, config.MCP_PROTOCOL_VERSION);
  } catch (error) {
    return buildChallengeResponse(origin, sid, (error as Error).message);
  }

  // No auth required
  if (!config.AUTH_ENABLED || config.AUTH_STRATEGY === 'none') {
    return null;
  }

  // Extract Bearer token
  const authHeader = request.headers.get('Authorization');
  const match = authHeader?.match(/^\s*Bearer\s+(.+)$/i);
  const bearer = match?.[1]?.trim();

  // Challenge if no auth
  if (!bearer) {
    return buildChallengeResponse(origin, sid);
  }

  // Bearer token validation
  if (config.AUTH_STRATEGY === 'bearer') {
    if (!config.BEARER_TOKEN) {
      return buildChallengeResponse(
        origin,
        sid,
        'Server misconfigured: BEARER_TOKEN not set',
      );
    }

    if (bearer !== config.BEARER_TOKEN) {
      return buildChallengeResponse(origin, sid, 'Invalid token');
    }

    return null; // Authorized
  }

  // Fallback - allow if auth provided
  return null;
}
