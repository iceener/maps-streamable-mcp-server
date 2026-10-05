import assert from 'node:assert/strict';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import contract from '../tests/fixtures/tools-contract.json';
import { TEST_SETTINGS } from '../tests/settings';
import { PHOTO_URL } from './google-mock';

/** The parts of the tool results this check reads. */
interface StructuredData {
  places?: Array<{ id: string }>;
  query?: string;
  photos?: Array<{ uri: string }>;
  distance_meters?: number;
  closest_index?: number;
}

/**
 * Drive a running server over real sockets with the official client, in both protocol
 * eras, with `AUTH_MODE=bearer` and `token` as the shared secret. Shared by the Bun and
 * Workers smoke tests. Every tool calls the loopback Google mock (scripts/google-mock.ts),
 * so no traffic leaves the machine.
 */
export async function smoke(endpoint: URL, label: string, token: string): Promise<void> {
  assert.equal(endpoint.hostname, '127.0.0.1', 'smoke traffic stays on loopback');

  const health = await fetch(new URL('/health', endpoint));
  assert.equal(health.status, 200);

  for (const authorization of [undefined, 'Bearer wrong', `Bearer ${TEST_SETTINGS.API_KEY}`]) {
    const refused = await fetch(endpoint, {
      method: 'POST',
      headers: authorization ? { Authorization: authorization } : {},
    });
    assert.equal(refused.status, 401);
    const challenge = refused.headers.get('WWW-Authenticate') ?? '';
    assert.match(challenge, /^Bearer /);
    assert.doesNotMatch(challenge, /resource_metadata=/, 'bearer mode publishes no OAuth');
  }

  for (const era of ['modern', 'legacy'] as const) {
    const client = new Client(
      { name: 'smoke', version: '1.0.0' },
      { versionNegotiation: { mode: era === 'modern' ? 'auto' : 'legacy' } },
    );
    await client.connect(
      new StreamableHTTPClientTransport(endpoint, {
        fetch: async (url, init) => {
          const headers = new Headers(init?.headers);
          headers.set('Authorization', `Bearer ${token}`);
          const response = await fetch(url, { ...init, headers, redirect: 'error' });
          assert.equal(response.headers.has('Mcp-Session-Id'), false, 'the server is stateless');
          return response;
        },
      }),
    );
    try {
      assert.equal(client.getProtocolEra(), era);
      assert.equal(client.getServerVersion()?.name, 'Google Maps');
      const { tools } = await client.listTools();
      assert.deepEqual(tools, contract.result.tools);

      const location = { latitude: 52.23, longitude: 21.01 };
      const results = [
        await client.callTool({ name: 'search_places', arguments: { location, types: ['cafe'] } }),
        await client.callTool({ name: 'search_places', arguments: { location, query: 'cafe' } }),
        await client.callTool({
          name: 'get_place',
          arguments: { place_id: 'smoke-place', fields: ['basic', 'photos'] },
        }),
        await client.callTool({
          name: 'get_route',
          arguments: { origin: location, destinations: [{ place_id: 'smoke-place' }] },
        }),
        await client.callTool({
          name: 'get_route',
          arguments: { origin: location, destinations: [{ address: 'a' }, { address: 'b' }] },
        }),
      ];
      for (const result of results) {
        assert.equal(result.isError, undefined, JSON.stringify(result));
        assert.ok(!JSON.stringify(result).includes(TEST_SETTINGS.API_KEY ?? ''), 'no key');
      }
      const [nearby, text, place, route, matrix] = results.map(
        (result) => result.structuredContent as StructuredData | undefined,
      );
      assert.equal(nearby?.places?.[0]?.id, 'smoke-place');
      assert.equal(text?.query, 'cafe');
      assert.equal(place?.photos?.[0]?.uri, PHOTO_URL);
      assert.equal(route?.distance_meters, 1200);
      assert.equal(matrix?.closest_index, 0);
    } finally {
      await client.close();
    }
    console.info(`${label}: ${era} client called every tool through the Google mock`);
  }

  const foreignOrigin = await fetch(endpoint, {
    method: 'POST',
    headers: { Origin: 'https://evil.example', Authorization: `Bearer ${token}` },
  });
  assert.equal(foreignOrigin.status, 403);

  const oversized = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(700));
        controller.enqueue(new Uint8Array(700));
        controller.close();
      },
    }),
  });
  assert.equal(oversized.status, 413);
  console.info(`${label}: bearer gate, Origin guard and streamed body limit passed`);
}

if (import.meta.main) {
  const [endpoint, label = 'server', token] = process.argv.slice(2);
  assert.ok(
    endpoint && token,
    'usage: bun scripts/smoke-client.ts <loopback MCP URL> <label> <bearer token>',
  );
  await smoke(new URL(endpoint), label, token);
}
