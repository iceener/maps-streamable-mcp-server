import { afterEach, describe, expect, test } from 'bun:test';
import {
  Client,
  type FetchLike,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { type AppConfig, parseConfig } from '../src/config/env.js';
import { buildHttpApp, type HttpRuntime } from '../src/http/app.js';

const originalFetch = globalThis.fetch;
const runtimes = new Set<HttpRuntime>();
const clients = new Set<Client>();
afterEach(async () => {
  globalThis.fetch = originalFetch;
  await Promise.all([...clients].map((client) => client.close()));
  await Promise.all([...runtimes].map((runtime) => runtime.close()));
  clients.clear();
  runtimes.clear();
});
function testConfig(overrides: Record<string, unknown> = {}): AppConfig {
  return parseConfig({
    NODE_ENV: 'test',
    MCP_PUBLIC_URL: 'http://localhost:3000/mcp',
    MCP_ALLOWED_HOSTS: 'localhost',
    MCP_ALLOWED_ORIGIN_HOSTNAMES: 'localhost',
    AUTH_ENABLED: 'false',
    AUTH_STRATEGY: 'none',
    API_KEY: 'provider-secret',
    ...overrides,
  });
}
function createRuntime(config = testConfig()): HttpRuntime {
  const runtime = buildHttpApp(config, { runtimeName: 'test' });
  runtimes.add(runtime);
  return runtime;
}
function runtimeFetch(runtime: HttpRuntime, token?: string): FetchLike {
  return async (url, init) => {
    const headers = new Headers(init?.headers);
    headers.set('Host', 'localhost:3000');
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return runtime.fetch(new Request(url, { ...init, headers }));
  };
}
async function connect(
  runtime: HttpRuntime,
  mode: 'modern' | 'legacy',
  token?: string,
): Promise<Client> {
  const client = new Client(
    { name: `maps-${mode}-test`, version: '1.0.0' },
    mode === 'modern'
      ? { versionNegotiation: { mode: { pin: '2026-07-28' } } }
      : undefined,
  );
  await client.connect(
    new StreamableHTTPClientTransport(new URL('http://localhost:3000/mcp'), {
      fetch: runtimeFetch(runtime, token),
      ...(token ? { authProvider: { token: async () => token } } : {}),
    }),
  );
  clients.add(client);
  return client;
}
function installPlacesMock(onHeaders?: (headers: Headers) => void): void {
  globalThis.fetch = Object.assign(
    async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      onHeaders?.(new Headers(init?.headers));
      return Response.json({
        places: [
          {
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
          },
        ],
      });
    },
    { preconnect: originalFetch.preconnect },
  );
}

describe('Google Maps MCP v2 protocol', () => {
  test('negotiates modern protocol and preserves all tool schemas', async () => {
    installPlacesMock();
    const client = await connect(createRuntime(), 'modern');
    expect(client.getProtocolEra()).toBe('modern');
    expect(client.getNegotiatedProtocolVersion()).toBe('2026-07-28');
    expect(client.getServerCapabilities()).toEqual({ tools: { listChanged: true } });
    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual([
      'search_places',
      'get_place',
      'get_route',
    ]);
    expect(listed.tools[0]?.inputSchema).toMatchObject({
      type: 'object',
      required: ['location'],
    });
    expect(listed.tools[1]?.inputSchema).toMatchObject({
      type: 'object',
      required: ['place_id'],
    });
    expect(listed.tools[2]?.inputSchema).toMatchObject({
      type: 'object',
      required: ['origin', 'destinations'],
    });
    expect(listed.tools.every((tool) => tool.outputSchema === undefined)).toBe(true);
    const result = await client.callTool({
      name: 'search_places',
      arguments: {
        location: { latitude: 52.23, longitude: 21.01 },
        types: ['cafe'],
      },
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      places: [{ id: 'place-1', name: 'Test Cafe' }],
      radius: 1000,
    });
  });

  test('serves SDK-owned stateless legacy list and provider-backed call', async () => {
    installPlacesMock();
    const client = await connect(createRuntime(), 'legacy');
    expect(client.getProtocolEra()).toBe('legacy');
    expect(client.getNegotiatedProtocolVersion()).toBe('2025-11-25');
    expect(client.getServerCapabilities()?.tools?.listChanged).toBe(false);
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([
      'search_places',
      'get_place',
      'get_route',
    ]);
    const result = await client.callTool({
      name: 'search_places',
      arguments: {
        query: 'coffee',
        location: { latitude: 52.23, longitude: 21.01 },
      },
    });
    expect(result.structuredContent).toMatchObject({
      query: 'coffee',
      places: [{ id: 'place-1' }],
    });
  });

  test('preserves provider failure mapping as a tool error', async () => {
    globalThis.fetch = Object.assign(
      async () =>
        Response.json(
          { error: { message: 'mock Google failure', status: 'PERMISSION_DENIED' } },
          { status: 403 },
        ),
      { preconnect: originalFetch.preconnect },
    );
    const client = await connect(createRuntime(), 'modern');
    const result = await client.callTool({
      name: 'search_places',
      arguments: { location: { latitude: 52.23, longitude: 21.01 } },
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('mock Google failure'),
    });
  });

  test('propagates client cancellation to Google fetch', async () => {
    globalThis.fetch = Object.assign(
      async (_input: Parameters<typeof fetch>[0], init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        }),
      { preconnect: originalFetch.preconnect },
    );
    const client = await connect(createRuntime(), 'modern');
    const controller = new AbortController();
    const pending = client.callTool(
      {
        name: 'search_places',
        arguments: { location: { latitude: 52.23, longitude: 21.01 } },
      },
      { signal: controller.signal },
    );
    setTimeout(() => controller.abort(), 10);
    await expect(pending).rejects.toThrow();
  });

  test('forwards only the Google API key to the provider', async () => {
    let googleKey = '';
    let providerAuthorization = '';
    installPlacesMock((headers) => {
      googleKey = headers.get('X-Goog-Api-Key') ?? '';
      providerAuthorization = headers.get('Authorization') ?? '';
    });
    const runtime = createRuntime(
      testConfig({
        AUTH_ENABLED: 'true',
        AUTH_STRATEGY: 'bearer',
        BEARER_TOKEN: 'mcp-access-secret',
      }),
    );
    const client = await connect(runtime, 'modern', 'mcp-access-secret');
    await client.callTool({
      name: 'search_places',
      arguments: {
        location: { latitude: 52.23, longitude: 21.01 },
        types: ['cafe'],
      },
    });
    expect(googleKey).toBe('provider-secret');
    expect(googleKey).not.toBe('mcp-access-secret');
    expect(providerAuthorization).toBe('');
  });

  test('enforces Host, Origin, CORS, size limits, and method posture', async () => {
    const runtime = createRuntime(testConfig({ MCP_MAX_REQUEST_BYTES: '1024' }));
    for (const method of ['GET', 'DELETE']) {
      const response = await runtime.fetch(
        new Request('http://localhost:3000/mcp', {
          method,
          headers: { Host: 'localhost:3000' },
        }),
      );
      expect(response.status).toBe(405);
      expect(response.headers.has('Mcp-Session-Id')).toBe(false);
    }
    const unsupportedBody = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'server/discover',
      params: {
        _meta: {
          'io.modelcontextprotocol/protocolVersion': '2099-01-01',
          'io.modelcontextprotocol/clientCapabilities': {},
          'io.modelcontextprotocol/clientInfo': { name: 'raw-test', version: '1.0.0' },
        },
      },
    });
    const unsupported = await runtime.fetch(
      new Request('http://localhost:3000/mcp', {
        method: 'POST',
        headers: {
          Host: 'localhost:3000',
          Accept: 'application/json, text/event-stream',
          'Content-Type': 'application/json',
          'MCP-Protocol-Version': '2099-01-01',
          'Mcp-Method': 'server/discover',
        },
        body: unsupportedBody,
      }),
    );
    expect(unsupported.status).toBe(400);
    expect(await unsupported.json()).toMatchObject({ error: { code: -32022 } });
    expect(
      (
        await runtime.fetch(
          new Request('http://localhost:3000/health', {
            headers: { Host: 'evil.example' },
          }),
        )
      ).status,
    ).toBe(403);
    const origin = await runtime.fetch(
      new Request('http://localhost:3000/mcp', {
        method: 'POST',
        headers: { Host: 'localhost:3000', Origin: 'https://evil.example' },
        body: '{}',
      }),
    );
    expect(origin.status).toBe(403);
    expect(origin.headers.has('Access-Control-Allow-Origin')).toBe(false);
    const preflight = await runtime.fetch(
      new Request('http://localhost:3000/mcp', {
        method: 'OPTIONS',
        headers: {
          Host: 'localhost:3000',
          Origin: 'http://localhost:8080',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'authorization, content-type, mcp-method',
        },
      }),
    );
    expect(preflight.status).toBe(204);
    const oversized = await runtime.fetch(
      new Request('http://localhost:3000/mcp', {
        method: 'POST',
        headers: { Host: 'localhost:3000', 'Content-Type': 'application/json' },
        body: 'x'.repeat(1_025),
      }),
    );
    expect(oversized.status).toBe(413);
  });
});
