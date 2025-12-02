// Unified config reader for both Node.js and Cloudflare Workers
// Simplified for bearer token auth + API key for Google Maps

import type { AuthStrategyType } from '../auth/strategy.js';

export type UnifiedConfig = {
  // Server
  HOST: string;
  PORT: number;
  NODE_ENV: 'development' | 'production' | 'test';

  // MCP
  MCP_TITLE: string;
  MCP_INSTRUCTIONS: string;
  MCP_VERSION: string;
  MCP_PROTOCOL_VERSION: string;
  MCP_ACCEPT_HEADERS: string[];

  // Auth Strategy
  AUTH_STRATEGY: AuthStrategyType;
  AUTH_ENABLED: boolean;
  AUTH_REQUIRE_RS: boolean;
  AUTH_ALLOW_DIRECT_BEARER: boolean;

  // Google Maps API Key (used internally by server)
  API_KEY?: string;
  API_KEY_HEADER: string;

  // Bearer token auth (client authentication to MCP server)
  BEARER_TOKEN?: string;

  // Storage
  RS_TOKENS_FILE?: string;
  /** Base64url-encoded 32-byte key for encrypting tokens at rest */
  RS_TOKENS_ENC_KEY?: string;

  // Rate limiting
  RPS_LIMIT: number;
  CONCURRENCY_LIMIT: number;

  // Logging
  LOG_LEVEL: 'debug' | 'info' | 'warning' | 'error';
};

function parseBoolean(value: unknown): boolean {
  return String(value || 'false').toLowerCase() === 'true';
}

function parseNumber(value: unknown, defaultValue: number): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : defaultValue;
}

function parseStringArray(value: unknown): string[] {
  return String(value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Determine auth strategy from env.
 */
function parseAuthStrategy(env: Record<string, unknown>): AuthStrategyType {
  const explicit = (env.AUTH_STRATEGY as string)?.toLowerCase();

  if (
    explicit === 'none' ||
    env.AUTH_ENABLED === 'false' ||
    env.AUTH_ENABLED === false
  ) {
    return 'none';
  }

  // Default to bearer if BEARER_TOKEN is set or AUTH_ENABLED is true
  if (env.BEARER_TOKEN || parseBoolean(env.AUTH_ENABLED)) {
    return 'bearer';
  }

  return 'none';
}

/**
 * Parse environment variables into a unified config object
 * Works for both process.env (Node.js) and Workers env bindings
 */
export function parseConfig(env: Record<string, unknown>): UnifiedConfig {
  const authStrategy = parseAuthStrategy(env);

  return {
    HOST: String(env.HOST || '127.0.0.1'),
    PORT: parseNumber(env.PORT, 3000),
    NODE_ENV: (env.NODE_ENV as UnifiedConfig['NODE_ENV']) || 'development',

    MCP_TITLE: String(env.MCP_TITLE || 'Google Maps MCP'),
    MCP_INSTRUCTIONS: String(
      env.MCP_INSTRUCTIONS ||
        'Use these tools to search places, get details, and plan routes.',
    ),
    MCP_VERSION: String(env.MCP_VERSION || '1.0.0'),
    MCP_PROTOCOL_VERSION: String(env.MCP_PROTOCOL_VERSION || '2025-06-18'),
    MCP_ACCEPT_HEADERS: parseStringArray(env.MCP_ACCEPT_HEADERS),

    // Auth Strategy
    AUTH_STRATEGY: authStrategy,
    AUTH_ENABLED: authStrategy === 'bearer',
    AUTH_REQUIRE_RS: parseBoolean(env.AUTH_REQUIRE_RS),
    AUTH_ALLOW_DIRECT_BEARER: parseBoolean(env.AUTH_ALLOW_DIRECT_BEARER),

    // API Key (Google Maps)
    API_KEY: env.API_KEY as string | undefined,
    API_KEY_HEADER: String(env.API_KEY_HEADER || 'x-api-key'),

    // Bearer token auth
    BEARER_TOKEN: env.BEARER_TOKEN as string | undefined,

    RS_TOKENS_FILE: env.RS_TOKENS_FILE as string | undefined,
    RS_TOKENS_ENC_KEY: env.RS_TOKENS_ENC_KEY as string | undefined,

    RPS_LIMIT: parseNumber(env.RPS_LIMIT, 10),
    CONCURRENCY_LIMIT: parseNumber(env.CONCURRENCY_LIMIT, 5),

    LOG_LEVEL: (env.LOG_LEVEL as UnifiedConfig['LOG_LEVEL']) || 'info',
  };
}

export function resolveConfig(): UnifiedConfig {
  return parseConfig(process.env as Record<string, unknown>);
}
