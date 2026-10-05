import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type {
  AuthInfo,
  ClientCapabilities,
  McpHttpHandler,
  McpServerFactory,
} from '@modelcontextprotocol/server';
import { createMcpHandler } from '@modelcontextprotocol/server';
import type { Hono } from 'hono';
import { type App, createApp } from '../src/platform/app';
import { type Config, parseConfig } from '../src/platform/config';
import type { LogFields, Logger } from '../src/platform/logger';
import { createServer, type Deps } from '../src/server';
import type { GoogleMapsService, Place } from '../src/services/google-maps';
import { fixtureServer } from './fixture';
import { TEST_SETTINGS } from './settings';

export const PUBLIC_URL = 'http://127.0.0.1:3000/mcp';

export function testConfig(env: Record<string, string> = {}): Config {
  return parseConfig({ NODE_ENV: 'test', MCP_PUBLIC_URL: PUBLIC_URL, ...TEST_SETTINGS, ...env });
}

export interface LogEntry {
  level: 'debug' | 'info' | 'warning' | 'error';
  message: string;
  fields: LogFields;
}

/** Records entries instead of printing them, so tests can assert on what was logged. */
export function memoryLogger(entries: LogEntry[] = [], context: LogFields = {}): Logger {
  const log =
    (level: LogEntry['level']) =>
    (message: string, fields: LogFields = {}) => {
      entries.push({ level, message, fields: { ...context, ...fields } });
    };
  return {
    debug: log('debug'),
    info: log('info'),
    warning: log('warning'),
    error: log('error'),
    child: (fields) => memoryLogger(entries, { ...context, ...fields }),
  };
}

export const CAFE: Place = {
  id: 'place-1',
  displayName: { text: 'Test Cafe', languageCode: 'en' },
  formattedAddress: '1 Test Street',
  shortFormattedAddress: '1 Test St',
  location: { latitude: 52.23, longitude: 21.01 },
  rating: 4.8,
  userRatingCount: 42,
  priceLevel: 'PRICE_LEVEL_INEXPENSIVE',
  types: ['cafe'],
  primaryType: 'cafe',
  currentOpeningHours: { openNow: true },
  businessStatus: 'OPERATIONAL',
  googleMapsUri: 'https://maps.example.test/place-1',
};

/** A Google Maps service that answers from memory. Override any method per test. */
export function fakeMaps(overrides: Partial<GoogleMapsService> = {}): GoogleMapsService {
  return {
    searchNearby: async () => [CAFE],
    searchText: async () => [CAFE],
    getPlace: async () => CAFE,
    getPhotoUri: async (name) => `https://photos.example.test/${name}`,
    computeRoutes: async () => [{ distanceMeters: 1200, duration: '600s', legs: [] }],
    computeRouteMatrix: async (params) =>
      params.destinations.map((_, index) => ({
        originIndex: 0,
        destinationIndex: index,
        condition: 'ROUTE_EXISTS' as const,
        distanceMeters: 1000 * (index + 1),
        duration: `${600 * (index + 1)}s`,
      })),
    ...overrides,
  };
}

export interface TestDeps extends Deps {
  logs: LogEntry[];
}

export function testDeps(overrides: Partial<Deps> = {}): TestDeps {
  const logs: LogEntry[] = [];
  return {
    config: testConfig(),
    logger: memoryLogger(logs),
    maps: fakeMaps(),
    ...overrides,
    logs,
  };
}

const open: Array<{ close(): Promise<void> }> = [];

/** Close `resource` in the next `cleanup()`. */
export function track<T extends { close(): Promise<void> }>(resource: T): T {
  open.push(resource);
  return resource;
}

/** Close every client, handler and app the test opened. Call from `afterEach`. */
export async function cleanup(): Promise<void> {
  // Last opened first: clients before the handlers serving them (docs/testing.md).
  for (const resource of open.splice(0).reverse()) await resource.close();
}

export interface ConnectOptions {
  deps?: Deps;
  /** The verified caller, as the bearer gate would pass it. Omit for an anonymous caller. */
  authInfo?: AuthInfo;
  era?: 'modern' | 'legacy';
  capabilities?: ClientCapabilities;
}

/**
 * An SDK client talking to `createServer` in process, through the same `createMcpHandler`
 * the app deploys, with no HTTP shell in between. This is how to test a tool.
 */
export async function connect(options: ConnectOptions = {}): Promise<Client> {
  const handler: McpHttpHandler = track(createMcpHandler(createServer(options.deps ?? testDeps())));

  const client = new Client(
    { name: 'test-client', version: '1.0.0' },
    {
      versionNegotiation: { mode: options.era === 'legacy' ? 'legacy' : 'auto' },
      ...(options.capabilities && { capabilities: options.capabilities }),
    },
  );
  const authInfo = options.authInfo;
  await client.connect(
    new StreamableHTTPClientTransport(new URL(PUBLIC_URL), {
      fetch: (url, init) =>
        handler.fetch(new Request(String(url), init), authInfo ? { authInfo } : undefined),
    }),
  );
  return track(client);
}

export interface TestAppOptions {
  deps?: Deps;
  /** Defaults to the fixture server, so platform tests don't depend on the samples. */
  server?: (deps: Deps) => McpServerFactory;
  routes?: (app: Hono, deps: Deps) => void;
}

/** The full app (Host/Origin guards, auth, CORS) as a fetch function, for HTTP-level tests. */
export function testApp(config: Config = testConfig(), options: TestAppOptions = {}): App {
  return track(
    createApp(config, {
      deps: options.deps ?? testDeps({ config }),
      server: options.server ?? fixtureServer,
      ...(options.routes && { routes: options.routes }),
    }),
  );
}

/** A raw JSON-RPC POST, with the headers a 2026-07-28 client sends. */
export function post(
  app: App,
  body: { method: string; [key: string]: unknown },
  headers: Record<string, string | null> = {},
): Promise<Response> {
  const merged = new Headers({
    Host: '127.0.0.1:3000',
    Accept: 'application/json, text/event-stream',
    'Content-Type': 'application/json',
    'MCP-Protocol-Version': '2026-07-28',
    'Mcp-Method': body.method,
  });
  for (const [name, value] of Object.entries(headers)) {
    if (value === null) merged.delete(name);
    else merged.set(name, value);
  }
  return app.fetch(
    new Request(PUBLIC_URL, { method: 'POST', headers: merged, body: JSON.stringify(body) }),
  );
}

/** A 2026-07-28 request message: protocol metadata travels in `_meta` on every request. */
export function message(method: string, params: Record<string, unknown> = {}, id = 1) {
  return {
    jsonrpc: '2.0',
    id,
    method,
    params: {
      ...params,
      _meta: {
        'io.modelcontextprotocol/protocolVersion': '2026-07-28',
        'io.modelcontextprotocol/clientCapabilities': {},
      },
    },
  };
}

export function textOf(result: { content?: unknown }): string {
  const [first] = (result.content ?? []) as Array<{ type: string; text?: string }>;
  return first?.type === 'text' ? (first.text ?? '') : '';
}
