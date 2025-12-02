import type { CancellationToken } from '../utils/cancellation.js';

/**
 * Auth strategy types.
 */
export type AuthStrategy = 'bearer' | 'none';

/**
 * Auth headers extracted by middleware.
 */
export interface AuthHeaders {
  authorization?: string;
  'x-api-key'?: string;
  'x-auth-token'?: string;
  [key: string]: string | undefined;
}

/**
 * Provider token information.
 */
export interface ProviderInfo {
  /** Provider access token */
  access_token: string;
  /** Refresh token (if available) */
  refresh_token?: string;
  /** Token expiry timestamp (ms since epoch) */
  expires_at?: number;
  /** Granted scopes */
  scopes?: string[];
}

/**
 * Request context passed to tool handlers.
 * Contains metadata and utilities for the current request.
 */
export interface RequestContext {
  /**
   * Session ID from the MCP transport (if available).
   */
  sessionId?: string;

  /**
   * Cancellation token for the current request.
   * Tools should check this periodically and throw CancellationError if cancelled.
   */
  cancellationToken: CancellationToken;

  /**
   * Request ID from JSON-RPC message.
   */
  requestId?: string | number;

  /**
   * Timestamp when the request was received.
   */
  timestamp: number;

  /**
   * Active auth strategy.
   * - 'bearer': Client must provide Bearer token matching BEARER_TOKEN
   * - 'none': No authentication
   */
  authStrategy?: AuthStrategy;

  /**
   * Raw auth headers from the request.
   */
  authHeaders?: AuthHeaders;

  /**
   * Resolved headers for downstream use.
   */
  resolvedHeaders?: Record<string, string>;

  /**
   * Provider access token.
   */
  providerToken?: string;

  /**
   * Full provider token information.
   */
  provider?: ProviderInfo;
}
