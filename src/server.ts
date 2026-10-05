/**
 * The project's half of the template. `platform/` relies on exactly these exports:
 * `serverInfo`, `SERVER_ICON_PATH`, `SERVER_ICON_SVG`, `Runtime`, `Deps`, `createDeps`,
 * `createServer`, `createVerifier`, `oauthMetadata` and `routes`. Change what they contain,
 * but keep their names and shapes.
 */
import {
  type CacheHint,
  McpServer,
  type McpServerFactory,
  type OAuthMetadata,
  type OAuthTokenVerifier,
} from '@modelcontextprotocol/server';
import type { Hono } from 'hono';
import { type Config, ConfigError, type OAuthConfig } from './platform/config';
import { createJwtVerifier } from './platform/jwt';
import type { Logger } from './platform/logger';
import { prompts } from './prompts';
import { resources } from './resources';
import { createGoogleMapsService, type GoogleMapsService } from './services/google-maps';
import { tools } from './tools';

/**
 * Who this server is. Clients already know it as "Google Maps": keep `name` and `title`.
 */
export const serverInfo = {
  name: 'Google Maps',
  title: 'Google Maps',
  version: '1.1.0',
  description: 'Search places, read place details, and plan routes with Google Maps.',
  websiteUrl: 'https://github.com/iceener/maps-streamable-mcp-server',
};

/** Sent to clients on connect. Many hosts add it to the model's system prompt. */
const instructions = 'Use these tools to search places, get details, and plan routes.';

export const SERVER_ICON_PATH = '/icon.svg';
export const SERVER_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Google Maps MCP server">
  <rect width="64" height="64" rx="12" fill="#111827"/>
  <path d="M32 12c-8.3 0-15 6.5-15 14.6C17 37.5 32 52 32 52s15-14.5 15-25.4C47 18.5 40.3 12 32 12zm0 20a5.5 5.5 0 1 1 0-11 5.5 5.5 0 0 1 0 11z" fill="#fff"/>
</svg>`;

/**
 * Resources that only one runtime provides, handed in by the entry points: Workers bindings
 * such as KV, D1 and Durable Objects from `src/worker.ts`, and local stand-ins from
 * `src/bun.ts`. This server is stateless and needs none.
 */
export type Runtime = Record<string, never>;

/** Everything tools may use. Built once, shared by every request. */
export interface Deps {
  config: Config;
  logger: Logger;
  maps: GoogleMapsService;
}

export function createDeps(config: Config, logger: Logger, _runtime: Runtime): Deps {
  return {
    config,
    logger,
    maps: createGoogleMapsService({
      apiKey: config.settings.API_KEY,
      origin: config.settings.GOOGLE_API_ORIGIN,
    }),
  };
}

/**
 * How bearer tokens are checked when `AUTH_MODE=oauth`: JWTs, against the authorization
 * server's published keys. Production uses `AUTH_MODE=bearer`, which does not call this.
 */
export function createVerifier(oauth: OAuthConfig, deps: Deps): OAuthTokenVerifier {
  if (!oauth.jwksUrl) {
    throw new ConfigError(['OAUTH_JWKS_URL is required to verify JWT access tokens']);
  }
  return createJwtVerifier(
    { issuer: oauth.issuer, jwksUrl: oauth.jwksUrl, audience: deps.config.publicUrl.href },
    deps.logger,
  );
}

/**
 * The authorization server metadata (RFC 8414) published at
 * /.well-known/oauth-authorization-server when `AUTH_MODE=oauth`: the main endpoints of the
 * external authorization server. Production uses `AUTH_MODE=bearer` and publishes none.
 */
export function oauthMetadata(oauth: OAuthConfig, _deps: Deps): OAuthMetadata {
  return {
    issuer: oauth.issuer,
    authorization_endpoint: oauth.authorizationUrl.href,
    token_endpoint: oauth.tokenUrl.href,
    ...(oauth.registrationUrl && { registration_endpoint: oauth.registrationUrl.href }),
    // MCP requires the authorization code flow with PKCE S256.
    response_types_supported: ['code'],
    code_challenge_methods_supported: ['S256'],
  };
}

/** Extra HTTP routes outside MCP. This server has none. */
export function routes(_app: Hono, _deps: Deps): void {}

/**
 * Lists change only on deploy and are the same for every caller. `private`, because the
 * server sits behind a shared secret: a shared cache must not serve the list to others.
 */
const LIST_CACHE: CacheHint = { ttlMs: 60_000, cacheScope: 'private' };

/**
 * The SDK calls this factory once per HTTP request and serves that request with the fresh
 * `McpServer` it returns. Keep it cheap and free of I/O: shared clients live in `deps`.
 */
export function createServer(deps: Deps): McpServerFactory {
  const icons = [
    {
      src: new URL(SERVER_ICON_PATH, deps.config.publicUrl).href,
      mimeType: 'image/svg+xml',
      sizes: ['any'],
    },
  ];

  return () => {
    const server = new McpServer(
      { ...serverInfo, icons },
      {
        instructions,
        // The tool list changes only on deploy, and each request has its own server instance,
        // so there is nothing to notify about. This server has no resources or prompts.
        capabilities: { tools: { listChanged: false } },
        cacheHints: { 'server/discover': LIST_CACHE, 'tools/list': LIST_CACHE },
        // Reject tool arguments with more array elements and object members than this,
        // before schema validation runs. `get_route` takes at most 25 destinations.
        maxToolInputElements: 1_000,
      },
    );

    for (const primitive of [...tools, ...resources, ...prompts]) {
      primitive.register(server, deps);
    }
    return server;
  };
}
