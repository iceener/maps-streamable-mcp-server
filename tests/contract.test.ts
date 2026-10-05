import { afterEach, describe, expect, test } from 'bun:test';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { serverInfo } from '../src/server';
import before from './fixtures/contract-before.json';
import pinned from './fixtures/tools-contract.json';
import { cleanup, track } from './helpers';
import { BEARER_TOKEN, HOST, ORIGIN, productionApp } from './production';

/**
 * What clients see must not change. `fixtures/contract-before.json` was recorded from the
 * checkpoint (the code deployed before the template 2.1 migration) in both protocol eras;
 * `fixtures/tools-contract.json` is the raw `tools/list` answer pinned before the SDK 2.0
 * upgrade. Both are compared through the full HTTP app, in bearer mode, as production runs.
 */
afterEach(cleanup);

async function connect(era: 'modern' | 'legacy'): Promise<Client> {
  const app = track(productionApp());
  const client = new Client(
    { name: 'contract', version: '1.0.0' },
    { versionNegotiation: { mode: era === 'modern' ? 'auto' : 'legacy' } },
  );
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${ORIGIN}/mcp`), {
      fetch: (url, init) => {
        const headers = new Headers(init?.headers);
        headers.set('Host', HOST);
        headers.set('Authorization', `Bearer ${BEARER_TOKEN}`);
        return app.fetch(new Request(String(url), { ...init, headers }));
      },
    }),
  );
  return track(client);
}

for (const era of ['modern', 'legacy'] as const) {
  const recorded = before[era];

  describe(`${era} client`, () => {
    test('tool names, order, input schemas and annotations are unchanged', async () => {
      const client = await connect(era);
      const { tools } = await client.listTools();
      const shape = (tool: { name: string; inputSchema: unknown; annotations?: unknown }) => ({
        name: tool.name,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
      });

      expect(tools.map(shape)).toEqual(recorded['tools/list'].result.tools.map(shape));
      // Still no titles and no output schemas, as before.
      expect(tools.every((tool) => tool.title === undefined)).toBe(true);
      expect(tools.every((tool) => tool.outputSchema === undefined)).toBe(true);
    });

    test('the tool list equals the pinned pre-upgrade contract, descriptions included', async () => {
      const client = await connect(era);
      const { tools } = await client.listTools();

      expect<unknown>(tools).toEqual(pinned.result.tools);
      expect<unknown>(tools).toEqual(recorded['tools/list'].result.tools);
    });

    test('there are still no resources, resource templates or prompts', async () => {
      const client = await connect(era);

      expect(await client.listResources()).toMatchObject(recorded['resources/list'].result);
      expect(await client.listResourceTemplates()).toMatchObject(
        recorded['resources/templates/list'].result,
      );
      expect(await client.listPrompts()).toMatchObject(recorded['prompts/list'].result);
    });

    test('name, title and instructions are unchanged', async () => {
      const client = await connect(era);

      expect(client.getServerVersion()).toMatchObject({
        name: recorded.serverInfo.name,
        title: recorded.serverInfo.title,
      });
      expect(client.getInstructions()).toBe(recorded.instructions);
    });

    test('deliberate differences: richer serverInfo, and no tools/list_changed promise', async () => {
      const client = await connect(era);

      // Added: description, websiteUrl and an icon. The version marks this release.
      expect(client.getServerVersion()).toEqual({
        ...serverInfo,
        icons: [{ src: `${ORIGIN}/icon.svg`, mimeType: 'image/svg+xml', sizes: ['any'] }],
      });
      // The checkpoint advertised `listChanged: true` to modern clients but never sent the
      // notification. The list only changes on deploy.
      expect(client.getServerCapabilities()).toEqual({ tools: { listChanged: false } });
    });
  });
}

test('the raw modern tools/list answer keeps its private one-minute cache hint', async () => {
  const app = track(productionApp());
  const response = await app.fetch(
    new Request(`${ORIGIN}/mcp`, {
      method: 'POST',
      headers: {
        Host: HOST,
        Authorization: `Bearer ${BEARER_TOKEN}`,
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
        'MCP-Protocol-Version': '2026-07-28',
        'Mcp-Method': 'tools/list',
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
    }),
  );
  const { result } = (await response.json()) as { result: unknown };

  expect(result).toMatchObject({
    resultType: pinned.result.resultType,
    ttlMs: pinned.result.ttlMs,
    cacheScope: pinned.result.cacheScope,
    tools: pinned.result.tools,
  });
});
