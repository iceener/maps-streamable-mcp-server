import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { unstable_readConfig, unstable_startWorker } from 'wrangler';
// Node runs this file directly, so the imports name the .ts files.
import { TEST_SETTINGS } from '../tests/settings.ts';
import { startGoogleMock } from './google-mock.ts';

/**
 * Run the real Worker in local workerd: once in bearer mode, as production runs, with every
 * tool calling a loopback Google mock and driven by the shared smoke client; once
 * misconfigured, to check it fails safely. Wrangler's API needs Node, so this file runs
 * under Node; the client runs under Bun.
 */
const root = fileURLToPath(new URL('../', import.meta.url));
const plain = (value: string) => ({ type: 'plain_text' as const, value });
const PUBLIC_URL = 'http://127.0.0.1/mcp';
const TOKEN = 'smoke-bearer-token';

process.env.WRANGLER_SEND_METRICS = 'false';
process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = 'false';

function startWorker(vars: Record<string, string>, logLevel: 'warn' | 'none' = 'warn') {
  return unstable_startWorker({
    config: `${root}wrangler.jsonc`,
    bindings: Object.fromEntries(Object.entries(vars).map(([name, value]) => [name, plain(value)])),
    dev: {
      server: { hostname: '127.0.0.1', port: 0 },
      inspector: false,
      watch: false,
      logLevel,
    },
  });
}

const google = await startGoogleMock(TEST_SETTINGS.API_KEY ?? '');
const worker = await startWorker({
  ...TEST_SETTINGS,
  NODE_ENV: 'test',
  MCP_PUBLIC_URL: PUBLIC_URL,
  MCP_MAX_REQUEST_BYTES: '1024',
  AUTH_MODE: 'bearer',
  BEARER_TOKEN: TOKEN,
  GOOGLE_API_ORIGIN: google.origin,
});
try {
  const endpoint = new URL('/mcp', await worker.url).href;
  const { stdout, stderr } = await promisify(execFile)(
    'bun',
    [`${root}scripts/smoke-client.ts`, endpoint, 'workers', TOKEN],
    { cwd: root, timeout: 60_000 },
  );
  process.stdout.write(stdout);
  process.stderr.write(stderr);
  assert.ok(google.requests.length > 0, 'the tools reached the Google mock');
} finally {
  await worker.dispose();
  await google.close();
}

// The production config: the real, gitignored file where it exists, else the committed
// example with stand-in values. Its two secrets get stand-ins.
// `origin` makes the Worker see its public hostname, so the production Host check applies.
const productionConfig = existsSync(`${root}wrangler.production.jsonc`)
  ? `${root}wrangler.production.jsonc`
  : `${root}wrangler.production.example.jsonc`;
const productionUrl = new URL(
  String(unstable_readConfig({ config: productionConfig }).vars.MCP_PUBLIC_URL),
);
const production = await unstable_startWorker({
  config: productionConfig,
  bindings: { BEARER_TOKEN: plain(TOKEN), API_KEY: plain(TEST_SETTINGS.API_KEY ?? '') },
  dev: {
    server: { hostname: '127.0.0.1', port: 0 },
    origin: { hostname: productionUrl.hostname, secure: true },
    inspector: false,
    watch: false,
    logLevel: 'warn',
  },
});
try {
  const url = await production.url;
  const health = await fetch(new URL('/health', url));
  assert.equal(health.status, 200);
  assert.equal(((await health.json()) as { name: string }).name, 'Google Maps');

  const call = (headers: Record<string, string>) =>
    fetch(new URL('/mcp', url), {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
        'MCP-Protocol-Version': '2026-07-28',
        'Mcp-Method': 'tools/list',
        ...headers,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        },
      }),
    });
  assert.equal((await call({})).status, 401);
  const listed = await call({ Authorization: `Bearer ${TOKEN}` });
  assert.equal(listed.status, 200);
  const { result } = (await listed.json()) as { result: { tools: Array<{ name: string }> } };
  assert.deepEqual(
    result.tools.map((tool) => tool.name),
    ['search_places', 'get_place', 'get_route'],
  );
  assert.equal((await call({ Origin: 'https://claude.ai' })).status, 401);
  assert.equal((await call({ Origin: 'https://evil.example' })).status, 403);
  console.info(
    `workers: ${productionConfig.split('/').pop()} starts, and asks for the bearer token`,
  );
} finally {
  await production.dispose();
}

// Production settings with the auth decision missing: every request gets a generic 500.
// Its configuration error is the point here, so keep it out of the output.
const misconfigured = await startWorker(
  { NODE_ENV: 'production', MCP_PUBLIC_URL: 'https://mcp.example.com/mcp', AUTH_MODE: '' },
  'none',
);
try {
  const response = await fetch(new URL('/health', await misconfigured.url));
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'server_misconfigured' });
  console.info('workers: invalid configuration answers a generic 500');
} finally {
  await misconfigured.dispose();
}
