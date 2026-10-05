import assert from 'node:assert/strict';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { serve } from '../src/bun';
import { createApp } from '../src/platform/app';
import { parseConfig } from '../src/platform/config';
import { createLogger } from '../src/platform/logger';
import { createDeps, type Deps } from '../src/server';
import { TEST_SETTINGS } from '../tests/settings';
import { startGoogleMock } from './google-mock';
import { smoke } from './smoke-client';

/**
 * Bun drops a connection that stays quiet for 10 s by default. A Google request may take
 * up to 15 s before the service gives up, so this check holds a call quiet for longer than
 * Bun's window: it fails reliably without the fix in src/bun.ts.
 */
const QUIET_MS = 15_000;
const PUBLIC_URL = 'http://127.0.0.1/mcp';
const TOKEN = 'smoke-bearer-token';

/** Run the real Bun server on a free port, call `run` with its MCP URL, then stop it. */
async function withServer(
  env: Record<string, string>,
  run: (endpoint: URL) => Promise<void>,
  configure: (deps: Deps) => void = () => {},
): Promise<void> {
  const config = parseConfig({
    NODE_ENV: 'test',
    PORT: '0',
    MCP_PUBLIC_URL: PUBLIC_URL,
    MCP_MAX_REQUEST_BYTES: '1024',
    AUTH_MODE: 'bearer',
    BEARER_TOKEN: TOKEN,
    ...TEST_SETTINGS,
    ...env,
  });
  const deps = createDeps(config, createLogger('warning'), {});
  configure(deps);
  const app = createApp(config, { deps });
  const server = serve(config, app);
  try {
    await run(new URL('/mcp', server.url));
  } finally {
    await app.close();
    await server.stop(true);
  }
}

// Production auth mode, every tool through the loopback Google mock, both protocol eras.
const google = await startGoogleMock(TEST_SETTINGS.API_KEY ?? '');
try {
  await withServer({ GOOGLE_API_ORIGIN: google.origin }, (endpoint) =>
    smoke(endpoint, 'bun', TOKEN),
  );
  assert.ok(google.requests.length > 0, 'the tools reached the Google mock');
} finally {
  await google.close();
}

// A slow Google answer: the call stays quiet past Bun's default idle timeout and still ends.
await withServer(
  {},
  async (endpoint) => {
    const client = new Client(
      { name: 'smoke', version: '1.0.0' },
      { versionNegotiation: { mode: 'auto' } },
    );
    await client.connect(
      new StreamableHTTPClientTransport(endpoint, {
        fetch: (url, init) => {
          const headers = new Headers(init?.headers);
          headers.set('Authorization', `Bearer ${TOKEN}`);
          return fetch(url, { ...init, headers });
        },
      }),
    );
    const result = await client.callTool(
      {
        name: 'search_places',
        arguments: { location: { latitude: 0, longitude: 0 }, query: 'slow' },
      },
      { timeout: 20_000 },
    );
    await client.close();

    assert.equal(result.isError, undefined, JSON.stringify(result));
    console.info(`bun: a call quiet for ${QUIET_MS / 1000} s survived the idle timeout`);
  },
  (deps) => {
    deps.maps = {
      ...deps.maps,
      searchText: async (_params, signal) => {
        await new Promise((resolve) => setTimeout(resolve, QUIET_MS));
        signal.throwIfAborted();
        return [];
      },
    };
  },
);
