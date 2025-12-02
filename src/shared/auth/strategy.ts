// Auth Strategy Pattern (Simplified for Bearer Token auth)

/**
 * Auth strategy types supported.
 *
 * - 'bearer': Client must provide Bearer token matching BEARER_TOKEN secret
 * - 'none': No authentication required
 */
export type AuthStrategyType = 'bearer' | 'none';

/**
 * Resolved auth info.
 */
export interface ResolvedAuth {
  /** Auth strategy used */
  strategy: AuthStrategyType;
  /** Headers to pass to API calls */
  headers: Record<string, string>;
  /** Raw access token (if bearer) */
  accessToken?: string;
}

/**
 * Strategy configuration parsed from env.
 */
export interface AuthStrategyConfig {
  type: AuthStrategyType;
  /** For bearer: the expected token value */
  value?: string;
}

/**
 * Parse auth strategy from config.
 *
 * Reads from:
 * - AUTH_STRATEGY: 'bearer' | 'none'
 * - BEARER_TOKEN: Expected bearer token from clients
 */
export function parseAuthStrategy(env: Record<string, unknown>): AuthStrategyConfig {
  const strategy = (env.AUTH_STRATEGY as string)?.toLowerCase();

  if (
    strategy === 'none' ||
    env.AUTH_ENABLED === 'false' ||
    env.AUTH_ENABLED === false
  ) {
    return { type: 'none' };
  }

  // Default to bearer
  return {
    type: 'bearer',
    value: env.BEARER_TOKEN as string,
  };
}

/**
 * Build auth headers from strategy config.
 */
export function buildAuthHeaders(
  _strategyConfig: AuthStrategyConfig,
): Record<string, string> {
  // For bearer strategy, we validate incoming token, not add headers
  return {};
}

/**
 * Resolve auth for a request.
 */
export function resolveStaticAuth(strategyConfig: AuthStrategyConfig): ResolvedAuth {
  return {
    strategy: strategyConfig.type,
    headers: {},
    accessToken: strategyConfig.type === 'bearer' ? strategyConfig.value : undefined,
  };
}

/**
 * Check if auth strategy requires any authentication.
 */
export function requiresAuth(config: AuthStrategyConfig): boolean {
  return config.type !== 'none';
}

/**
 * Validate that required config values are present for the strategy.
 */
export function validateAuthConfig(config: AuthStrategyConfig): string[] {
  const errors: string[] = [];

  if (config.type === 'bearer' && !config.value) {
    errors.push('BEARER_TOKEN is required when AUTH_STRATEGY=bearer');
  }

  return errors;
}

/**
 * Validate incoming bearer token against expected token.
 */
export function validateBearerToken(
  authHeader: string | null,
  expectedToken: string | undefined,
): boolean {
  if (!expectedToken) return false;
  if (!authHeader) return false;

  const match = authHeader.match(/^\s*Bearer\s+(.+)$/i);
  const token = match?.[1];

  return token === expectedToken;
}
