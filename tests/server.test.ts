import { afterEach, describe, expect, test } from 'bun:test';
import { ConfigError, parseConfig } from '../src/platform/config';
import { prompts } from '../src/prompts';
import { resources } from '../src/resources';
import { serverInfo } from '../src/server';
import { tools } from '../src/tools';
import { cleanup, connect, PUBLIC_URL } from './helpers';

afterEach(cleanup);

/** `src/server.ts`: identity, capabilities, and that every listed definition is served. */
describe('server', () => {
  for (const era of ['modern', 'legacy'] as const) {
    test(`${era}: identifies itself with an icon served from the public origin`, async () => {
      const client = await connect({ era });

      expect(client.getServerVersion()).toMatchObject({
        ...serverInfo,
        icons: [{ src: new URL('/icon.svg', PUBLIC_URL).href, mimeType: 'image/svg+xml' }],
      });
      expect(client.getInstructions()).toBeString();
    });

    test(`${era}: advertises tools only, with no change stream`, async () => {
      const client = await connect({ era });

      expect(client.getServerCapabilities()).toEqual({ tools: { listChanged: false } });
    });
  }

  test('serves every tool, resource and prompt in the index lists, in order', async () => {
    const client = await connect();

    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(
      tools.map((tool) => tool.name),
    );
    expect(resources).toEqual([]);
    expect(prompts).toEqual([]);
  });

  test('the tool list is cacheable for a minute, by the caller only', async () => {
    const client = await connect();
    const result = await client.listTools();

    expect(result).toMatchObject({ ttlMs: 60_000, cacheScope: 'private' });
  });
});

test('oversized tool arguments are refused before any schema runs', async () => {
  const client = await connect();
  const result = await client.callTool({
    name: 'search_places',
    arguments: {
      location: { latitude: 0, longitude: 0 },
      types: Array.from({ length: 2_000 }, () => 'cafe'),
    },
  });

  expect(result.isError).toBe(true);
  expect(JSON.stringify(result.content)).toContain('1000');
});

describe('settings', () => {
  const problems = (env: Record<string, string>) => {
    try {
      parseConfig(env);
      return [];
    } catch (error) {
      if (error instanceof ConfigError) return error.problems;
      throw error;
    }
  };

  test('API_KEY is required, and surrounding whitespace is ignored', () => {
    expect(problems({}).some((problem) => problem.startsWith('API_KEY:'))).toBe(true);
    expect(problems({ API_KEY: '   ' }).some((problem) => problem.startsWith('API_KEY:'))).toBe(
      true,
    );
    expect(parseConfig({ API_KEY: ' key\n' }).settings.API_KEY).toBe('key');
  });

  test('GOOGLE_API_ORIGIN only accepts a loopback mock', () => {
    for (const origin of ['http://127.0.0.1:9999', 'http://localhost:1', 'http://[::1]:2']) {
      expect(problems({ API_KEY: 'key', GOOGLE_API_ORIGIN: origin })).toEqual([]);
    }
    for (const origin of ['https://evil.example', 'http://10.0.0.1', 'file:///etc/passwd']) {
      expect(problems({ API_KEY: 'key', GOOGLE_API_ORIGIN: origin })).toHaveLength(1);
    }
  });
});
