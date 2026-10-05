# Google Maps Platform

This page describes how the server uses the Google APIs. The client is `src/services/google-maps.ts`.

## APIs and endpoints

| Tool | Google endpoint |
|---|---|
| `search_places` with `query` | `POST https://places.googleapis.com/v1/places:searchText` |
| `search_places` without `query` | `POST https://places.googleapis.com/v1/places:searchNearby` |
| `get_place` | `GET https://places.googleapis.com/v1/places/{place_id}` |
| `get_place` with `photos` | `GET https://places.googleapis.com/v1/{photo name}/media?skipHttpRedirect=true` for each photo |
| `get_route`, one destination | `POST https://routes.googleapis.com/directions/v2:computeRoutes` |
| `get_route`, two or more destinations | `POST https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix` |

Each request sends a field mask (`X-Goog-FieldMask`), so Google bills and returns only the fields that the tools use.

- Searches ask for the basic, rating, and hours fields.
- `get_place` asks for `id` and the fields of the categories in `fields`.
- When a request has `departure_time`, the server asks for traffic-aware routing, except for transit.
- `departure_time: "now"` becomes the current time plus one minute, because traffic-aware routing needs a time in the future.

## The API key

- The key is the `API_KEY` secret. The server reads it at startup, in `src/settings.ts`.
- The key goes to Google only, in the `X-Goog-Api-Key` header. It is never in a URL.
- The server does not follow redirects (`redirect: 'manual'`). A redirect would send the key header to another host. The server refuses a `3xx` answer as an error.
- The server removes the key from Google's error messages before it shows them to the model or writes them to the log.

## Photos

A place photo URL from the older Places API contains the API key. This server does not make such URLs. For each photo, it asks the media endpoint for JSON (`skipHttpRedirect=true`), and it gives the `photoUri` from that answer. Google makes this URL for each request, and it contains no key.

The server accepts the URL only if it uses HTTPS, has no user name, password, or fragment, has no `key` or `api_key` parameter, and does not contain the API key. Otherwise the tool gives an error. Photo names must have the form `places/{id}/photos/{id}`.

The photos are 800 pixels wide at most. A `get_place` call with `photos` sends one more request to Google for each photo, up to `max_photos` (3 by default).

## Errors

| Situation | Result for the model |
|---|---|
| Google refuses the request, for example an unknown place ID or a disabled API | A tool error with Google's message: `Failed to get place details: Google Maps API error: 404 Not Found - …` |
| Google does not answer in 15 seconds, the network fails, or the answer is cut off | A tool error: `Failed to search places: Google Maps did not respond in time, or the response was cut off` |
| Google sends an answer in an unexpected format, or the server has a bug | A tool error with a reference only. The log has the details at `error` level. |

The server logs Google's refusals at `warning` level as `Google Maps request failed`, with the tool name.

If the client cancels a call, the server stops the request to Google.

## Testing without Google

The tests never call Google. Unit tests replace the service with a fake (`fakeMaps` in `tests/helpers.ts`), or give the service a fake `fetch`. The smoke tests start `scripts/google-mock.ts`, a loopback server that answers like the Google endpoints, and point the server at it with `GOOGLE_API_ORIGIN`. The server accepts only loopback values for this setting.
