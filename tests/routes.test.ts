import { afterEach, expect, test } from 'bun:test';
import before from './fixtures/routes-before.json';
import { cleanup, track } from './helpers';
import { BEARER_TOKEN, HOST, ORIGIN, productionApp } from './production';

/**
 * Every public route answers as the checkpoint did. `fixtures/routes-before.json` was
 * recorded from the checkpoint (the code deployed before the template 2.1 migration) with
 * the same production vars and these same probes, in this order.
 */
afterEach(cleanup);

const auth = { Authorization: `Bearer ${BEARER_TOKEN}` };
const mcpHeaders = {
  Accept: 'application/json, text/event-stream',
  'Content-Type': 'application/json',
  'MCP-Protocol-Version': '2026-07-28',
  'Mcp-Method': 'tools/list',
};
const toolsList = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/list',
  params: {
    _meta: {
      'io.modelcontextprotocol/protocolVersion': '2026-07-28',
      'io.modelcontextprotocol/clientCapabilities': {},
    },
  },
});
const initialize = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-11-25',
    capabilities: {},
    clientInfo: { name: 'probe', version: '1.0.0' },
  },
});

interface Probe {
  label: string;
  method: string;
  path: string;
  headers?: Record<string, string>;
  body?: string;
}

const list = (label: string, headers: Record<string, string>): Probe => ({
  label,
  method: 'POST',
  path: '/mcp',
  headers: { ...mcpHeaders, ...headers },
  body: toolsList,
});

const PROBES: Probe[] = [
  { label: 'health', method: 'GET', path: '/health' },
  { label: 'icon', method: 'GET', path: '/icon.svg' },
  { label: 'root', method: 'GET', path: '/' },
  { label: 'unknown path', method: 'GET', path: '/missing' },
  ...[
    '/.well-known/oauth-protected-resource',
    '/.well-known/oauth-protected-resource/mcp',
    '/.well-known/oauth-authorization-server',
    '/.well-known/openid-configuration',
  ].map((path) => ({ label: 'discovery', method: 'GET', path })),
  { label: 'oauth route', method: 'GET', path: '/authorize' },
  { label: 'oauth route', method: 'POST', path: '/token' },
  { label: 'oauth route', method: 'POST', path: '/register' },
  { label: 'oauth route', method: 'POST', path: '/revoke' },
  { label: 'oauth route', method: 'GET', path: '/callback' },
  { label: 'oauth route', method: 'GET', path: '/oauth/callback' },
  list('no token', {}),
  list('wrong token', { Authorization: 'Bearer wrong' }),
  list('Google key as bearer', { Authorization: 'Bearer synthetic-google-key' }),
  list('token in x-api-key only', { 'x-api-key': BEARER_TOKEN }),
  list('lowercase bearer scheme', { Authorization: `bearer ${BEARER_TOKEN}` }),
  list('modern tools/list', auth),
  {
    label: 'legacy initialize',
    method: 'POST',
    path: '/mcp',
    headers: {
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
      ...auth,
    },
    body: initialize,
  },
  list('allowed Origin', { ...auth, Origin: 'https://claude.ai' }),
  list('foreign Origin', { ...auth, Origin: 'https://evil.example' }),
  list('foreign Host', { ...auth, Host: 'evil.example' }),
  { label: 'foreign Host', method: 'GET', path: '/health', headers: { Host: 'evil.example' } },
  { label: 'GET with token', method: 'GET', path: '/mcp', headers: auth },
  { label: 'DELETE with token', method: 'DELETE', path: '/mcp', headers: auth },
  { label: 'GET without token', method: 'GET', path: '/mcp' },
  {
    label: 'preflight',
    method: 'OPTIONS',
    path: '/mcp',
    headers: {
      Origin: 'https://claude.ai',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers':
        'authorization, content-type, mcp-protocol-version, mcp-method, mcp-name',
    },
  },
  {
    label: 'preflight, custom header',
    method: 'OPTIONS',
    path: '/mcp',
    headers: {
      Origin: 'https://claude.ai',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type, x-request-id',
    },
  },
  {
    label: 'preflight, DELETE',
    method: 'OPTIONS',
    path: '/mcp',
    headers: { Origin: 'https://claude.ai', 'Access-Control-Request-Method': 'DELETE' },
  },
  {
    label: 'preflight, foreign Origin',
    method: 'OPTIONS',
    path: '/mcp',
    headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' },
  },
  {
    label: 'body over 1 MiB',
    method: 'POST',
    path: '/mcp',
    headers: { ...mcpHeaders, ...auth },
    body: 'x'.repeat(1_048_577),
  },
];

/** Deliberate differences from the checkpoint, keyed by `<route> | <label>`. */
const CHANGED: Record<string, { status: number; reason: string }> = {
  'GET /icon.svg | icon': {
    status: 200,
    reason: 'The template serves the icon that serverInfo.icons points to.',
  },
  'OPTIONS /mcp | preflight, custom header': {
    status: 204,
    reason:
      'The template preflight allows any request header from an allowed Origin; the Origin ' +
      'check is unchanged.',
  },
};

test('the probes are the ones the checkpoint answered', () => {
  expect(PROBES.map(({ method, path, label }) => `${method} ${path} | ${label}`)).toEqual(
    before.map(({ route, label }) => `${route} | ${label}`),
  );
});

test('every route answers with the checkpoint status, except the listed changes', async () => {
  const app = track(productionApp());
  const rows = [];
  for (const probe of PROBES) {
    const response = await app.fetch(
      new Request(`${ORIGIN}${probe.path}`, {
        method: probe.method,
        headers: { Host: HOST, ...probe.headers },
        ...(probe.body !== undefined && { body: probe.body }),
      }),
    );
    await response.body?.cancel();
    rows.push({
      key: `${probe.method} ${probe.path} | ${probe.label}`,
      status: response.status,
      challenge: response.headers.get('WWW-Authenticate'),
      allowOrigin: response.headers.get('Access-Control-Allow-Origin'),
    });
  }

  const expected = before.map(({ route, label, status }) => {
    const key = `${route} | ${label}`;
    return { key, status: CHANGED[key]?.status ?? status };
  });
  expect(rows.map(({ key, status }) => ({ key, status }))).toEqual(expected);

  // A refused caller is still told to send a bearer token, and is not sent to OAuth.
  for (const row of rows.filter(({ status }) => status === 401)) {
    expect(row.challenge).toStartWith('Bearer ');
    expect(row.challenge).not.toContain('resource_metadata');
  }
  // Browser clients on allowed origins can still read the answers.
  for (const label of ['allowed Origin', 'preflight']) {
    const row = rows.find(({ key }) => key.endsWith(`| ${label}`));
    expect(row?.allowOrigin).toBe('https://claude.ai');
  }
});
