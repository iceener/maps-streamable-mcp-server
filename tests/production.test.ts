import { expect, test } from 'bun:test';
import { parseConfig } from '../src/platform/config';
import { BEARER_TOKEN, PRODUCTION_ENV } from './production';
import {
  DEVELOPMENT,
  describePrivate,
  digestOf,
  EXAMPLE,
  HOST,
  PRIVATE,
  servedAs,
  shapeOf,
  type WranglerConfig,
} from './production-config';
import { TEST_SETTINGS } from './settings';

/**
 * The production config. The committed example, with stand-in values, is checked here and
 * served by the other tests. The real file is gitignored and is checked where it exists.
 */
test('the production Worker: name, workers.dev, and no storage', () => {
  expect(EXAMPLE.name).toBe('google-maps');
  expect(EXAMPLE.workers_dev).toBe(true);
  // The unused TOKENS namespace is no longer bound. Nothing else is, or was.
  expect(EXAMPLE.kv_namespaces).toBeUndefined();
  expect(EXAMPLE.durable_objects).toBeUndefined();
  expect(EXAMPLE.migrations).toBeUndefined();
});

test('production runs the same code and runtime as development', () => {
  expect(shapeOf(EXAMPLE).runtime).toEqual(shapeOf(DEVELOPMENT).runtime);
});

test('the production vars, with both secrets, configure the server', () => {
  const config = parseConfig(PRODUCTION_ENV);
  expect(config.environment).toBe('production');
  expect(config.auth).toEqual({ mode: 'bearer', token: BEARER_TOKEN });
  expect(config.publicUrl.href).toBe(`https://${HOST}/mcp`);
  expect(config.allowedHosts).toEqual([HOST]);
  expect(config.allowedOrigins).toEqual([
    HOST,
    'claude.ai',
    'claude.com',
    'alice.example.org',
    'ai.example.net',
    'agi.example.net',
    'example.org',
  ]);
  expect(config.legacy).toBe('stateless');
  expect(config.maxRequestBytes).toBe(1_048_576);
});

test('both secrets are trimmed, so one stored with a newline still works', () => {
  const config = parseConfig({
    ...PRODUCTION_ENV,
    BEARER_TOKEN: `${BEARER_TOKEN}\n`,
    API_KEY: 'AIza-key\n',
  });
  expect(config.auth).toEqual({ mode: 'bearer', token: BEARER_TOKEN });
  expect(config.settings.API_KEY).toBe('AIza-key');
});

describePrivate('wrangler.production.jsonc, the deployed configuration', () => {
  const real = PRIVATE as WranglerConfig;

  test("has the example's shape: the same keys, vars, list lengths, bindings and migrations", () => {
    expect(shapeOf(real)).toEqual(shapeOf(EXAMPLE));
  });

  test('serves what the example serves', () => {
    expect(servedAs(parseConfig({ ...real.vars, ...TEST_SETTINGS, BEARER_TOKEN }))).toEqual(
      servedAs(parseConfig({ ...EXAMPLE.vars, ...TEST_SETTINGS, BEARER_TOKEN })),
    );
  });

  test('is unchanged since the last deliberate production change', () => {
    // Any edit to wrangler.production.jsonc changes this digest. Update it in the same commit
    // as a deliberate production change; the values themselves stay out of the repository.
    expect(digestOf(real)).toBe('31eecbba8923d3d71928d7ace5f600388af8f4395ebb2960a6f3d26596b657b5');
  });
});
