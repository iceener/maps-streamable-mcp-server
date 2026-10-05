import { localhostAllowedHostnames } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';

/**
 * Settings your own code needs: API keys, feature flags, upstream URLs. They are read from
 * the environment and validated at startup together with the platform's configuration, so
 * one misconfigured deploy reports every problem at once. Code reads them as
 * `deps.config.settings`.
 *
 * On Workers, store secrets with `wrangler secret put NAME --config wrangler.production.jsonc`, not in `vars`.
 */
export const Settings = z.object({
  API_KEY: z
    .string()
    .trim()
    .min(1)
    .describe(
      'Google Maps Platform API key, with Places API (New) and Routes API enabled. ' +
        'Sent to Google only, in the X-Goog-Api-Key header.',
    ),
  GOOGLE_API_ORIGIN: z
    .string()
    .refine(isLoopbackOrigin, {
      message: 'must be an http(s) origin on a loopback host: it is for local mocks only',
    })
    .optional()
    .describe(
      'Tests only: a loopback server that stands in for places.googleapis.com and ' +
        'routes.googleapis.com. Leave it unset everywhere else.',
    ),
});

export type Settings = z.infer<typeof Settings>;

function isLoopbackOrigin(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return (
    (url.protocol === 'http:' || url.protocol === 'https:') &&
    localhostAllowedHostnames().includes(url.hostname) &&
    url.origin === value.replace(/\/$/, '')
  );
}
