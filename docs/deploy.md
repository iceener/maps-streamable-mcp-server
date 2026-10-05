# Deployment

The server runs as the Cloudflare Worker `google-maps`, on `workers.dev`. The MCP endpoint is `MCP_PUBLIC_URL`, and the health check is `/health` on the same origin. For the template's general deployment notes, refer to its [docs/deploy.md](https://github.com/iceener/streamable-mcp-server-template/blob/main/docs/deploy.md).

## Production configuration

`wrangler.production.jsonc` is the production Wrangler config: the Worker name, the account, and the variables. It is gitignored, because it names the deployed Worker. `wrangler.production.example.jsonc` has the same shape with stand-in values. To deploy your own copy, copy the example to `wrangler.production.jsonc` and put in your values. `bun run deploy` runs `wrangler deploy --config wrangler.production.jsonc`. `wrangler.jsonc` is for `wrangler dev` only.

Where the real file exists, `tests/production.test.ts` checks it: it must have the example's shape, serve what the example serves, and match a pinned SHA-256 digest. A deliberate change to the file needs the new digest in that test, in the same commit. Without the file, those tests are skipped, and the workerd smoke run starts the example.

## Secrets

| Secret | Content |
|---|---|
| `BEARER_TOKEN` | The shared token that clients send as `Authorization: Bearer <token>`. Alice has it. |
| `API_KEY` | The Google Maps Platform API key. |

To set a secret, run `bunx wrangler secret put <NAME> --config wrangler.production.jsonc` and enter the value at the prompt. Do not put secrets in `vars`.

The server validates the secrets at startup:

- `BEARER_TOKEN` must not contain whitespace inside it. The server ignores whitespace at the start and at the end, such as a line break after the token.
- `API_KEY` must not be empty. The server removes whitespace at the start and at the end.

If a check fails, the Worker answers `500 {"error":"server_misconfigured"}` to all requests, and Workers Logs gives the problem.

## Bindings

The Worker has no bindings other than its variables and secrets. It keeps no state.

## Before you deploy

1. Run `bun run check && bun run test:smoke`.
2. Run the dry run and read the bindings list:

   ```sh
   CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false WRANGLER_SEND_METRICS=false \
     bunx wrangler deploy --dry-run --config wrangler.production.jsonc --outdir /tmp/google-maps-dryrun
   ```

`wrangler deploy` replaces the Worker's variables with the variables in `wrangler.production.jsonc`. Variables that are only in the dashboard are removed.

## After you deploy

1. Get the health check:

   ```sh
   curl -s "$(bun -e "console.log(new URL('/health', Bun.JSONC.parse(await Bun.file('wrangler.production.jsonc').text()).vars.MCP_PUBLIC_URL).href)")"
   ```

   The answer must be `200` with `{"status":"ok","name":"Google Maps","version":"…"}`. If the answer is `500` with `server_misconfigured`, read the Workers Logs, correct the configuration, or roll back.
2. In Alice, do a place search, and get the details of a place with photos.

To roll back, run `bunx wrangler rollback --name google-maps` and select the previous version.

## Logs

`observability` is on. The server writes JSON lines.

- `Google Maps request failed` (`warning`): Google refused a request or did not answer. The `tool` and `error` fields give the details.
- `Unexpected tool failure` (`error`): a bug. The model saw only the `reference` value. Search for it.

The logger removes secrets from the log. The Google client also removes the API key from Google's error messages.

## Earlier key exposure

Versions before 2026-09-08 put the API key in the photo URLs that `get_place` returned. If the key was not changed after that date, make a new key in the Google Cloud console, store it with `bunx wrangler secret put API_KEY --config wrangler.production.jsonc`, and then delete the old key.
