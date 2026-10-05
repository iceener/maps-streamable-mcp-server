import { type App, createApp } from '../src/platform/app';
import { parseConfig } from '../src/platform/config';
import { createServer } from '../src/server';
import { memoryLogger, testDeps } from './helpers';
import { PRODUCTION_VARS } from './production-config';
import { TEST_SETTINGS } from './settings';

export { HOST, ORIGIN } from './production-config';

/**
 * The stand-in production configuration for in-process tests: the vars of
 * wrangler.production.example.jsonc, plus stand-ins for its two secrets.
 */
export const BEARER_TOKEN = 'synthetic-caller-token';

export const PRODUCTION_ENV: Record<string, string> = {
  ...PRODUCTION_VARS,
  ...TEST_SETTINGS,
  BEARER_TOKEN,
};

/** The full app with the production configuration and a fake Google Maps service. */
export function productionApp(): App {
  const config = parseConfig(PRODUCTION_ENV);
  return createApp(config, {
    deps: testDeps({ config, logger: memoryLogger() }),
    server: createServer,
  });
}
