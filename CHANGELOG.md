# Changelog

## 1.1.0 — 2026-10-05

The server now follows the [MCP server template](https://github.com/iceener/streamable-mcp-server-template) 2.1, on `@modelcontextprotocol/server` 2.3.0. The tools are the same: `search_places`, `get_place` and `get_route` keep their names, input schemas, descriptions and annotations. The public routes give the same status codes, with the two changes listed below.

### Fixed

- **Photos on Cloudflare Workers.** `get_place` with `fields: ["photos"]` failed on Workers with `Invalid redirect value`, because workerd does not accept `redirect: 'error'`. Google requests now use `redirect: 'manual'`, and a `3xx` answer is an error. The key header still never follows a redirect.
- **Route matrix order.** `get_route` with several destinations named each result by its position in Google's answer. It now uses the `destinationIndex` that Google gives for each result, so `closest_index` and "Destination N" name the correct place.

### Changed

- **Configuration:** `AUTH_MODE=bearer` replaces `AUTH_ENABLED=true` and `AUTH_STRATEGY=bearer`. The secrets keep their names: `BEARER_TOKEN` and `API_KEY`.
- **Startup checks:** the server does not start without `API_KEY`, or with a `BEARER_TOKEN` that has whitespace inside it (whitespace at the start or end is ignored). A Worker then answers `500 {"error":"server_misconfigured"}`. Before, each tool answered "API key not configured", and a missing `BEARER_TOKEN` gave `503`.
- **`Authorization` parsing** is stricter: `Bearer` must be followed by exactly one space. `Bearer  <token>` with two spaces, or a header with leading whitespace, now gets `401`. Alice's header is unaffected.
- **Google requests** stop after 15 seconds. A slow or failed request gives a tool error that the model can read. Errors that are not from Google, such as a bug, give only a reference; the details are in the log.
- **401 answers** come from the SDK: `{"error":"invalid_token", …}` with `WWW-Authenticate: Bearer error="invalid_token", …`. Before, the body was a JSON-RPC error and the challenge was `Bearer`. The status is the same.
- **CORS preflight** accepts any request header from an allowed origin. Before, it refused headers that were not on a fixed list, with `400`.
- **New route:** `GET /icon.svg` serves the server icon. `serverInfo` now has `description`, `websiteUrl` and `icons`.
- **Capabilities:** `tools.listChanged` is now `false` for all clients. Before, it was `true` for 2026-07-28 clients, but the server never sent the notification.
- **`/health`** gives `{ "status": "ok", "name": "Google Maps", "version": "1.1.0" }`.
- **Requests without `MCP-Protocol-Version`** from 2026-07-28 clients get `400`, as SDK 2.3.0 requires.
- **Compatibility date:** `2026-09-08`.

### Removed

- The `TOKENS` KV binding. No code read it. The namespace still exists in the account.
- Variables that the server did not use, or that only had compatibility value: `AUTH_ENABLED`, `AUTH_STRATEGY`, `AUTH_REQUIRE_RS`, `AUTH_ALLOW_DIRECT_BEARER`, `RS_TOKENS_FILE`, `RS_TOKENS_ENC_KEY`, `API_KEY_HEADER`, `MCP_ACCEPT_HEADERS`, `RPS_LIMIT`, `CONCURRENCY_LIMIT`, `MCP_NAME`, `MCP_TITLE`, `MCP_VERSION`, `MCP_INSTRUCTIONS` and `MCP_PROTOCOL_VERSION`. The server identity is now in `src/server.ts`.
- The hand-written HTTP, auth, body-limit, CORS, logger and config modules. The template's `src/platform/` replaces them.
- The tracked production config. `wrangler.production.jsonc` is now gitignored, and `wrangler.production.example.jsonc` shows its shape with stand-in values.
- `env.example` (now `.env.example`), `docs/places-api.md` (a copy of Google's documentation), and the audit notes `docs/MCP_SDK_COMPATIBILITY.md`, `docs/MCP_2026_DEPLOYMENT.md` and `docs/ALICE_NATIVE_OAUTH.md`. The facts that still apply are in `docs/deploy.md` and `docs/google-maps.md`.
- Dependencies: `@cloudflare/workers-types`, `@types/node` and `bun-types`. `@types/bun` and the generated Worker types replace them.

## 1.0.0

The version deployed until 2026-10-05, on `@modelcontextprotocol/server` 2.0.0.
