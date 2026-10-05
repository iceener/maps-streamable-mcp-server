import { describe, expect, test } from 'bun:test';
import {
  createGoogleMapsService,
  GoogleMapsError,
  type GoogleMapsServiceOptions,
} from '../../src/services/google-maps';

const API_KEY = 'synthetic-provider-secret';
const PHOTO_NAME = 'places/place_123/photos/photo_456';
const PUBLIC_PHOTO = 'https://lh3.googleusercontent.com/photo-456=w800';

interface Seen {
  url: URL;
  method: string;
  headers: Headers;
  body: unknown;
  redirect: RequestInit['redirect'];
  signal: AbortSignal | undefined;
}

/** A fetch that records each request and answers with `respond`. */
function fakeFetch(respond: (seen: Seen) => Response | Promise<Response>) {
  const seen: Seen[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request: Seen = {
      url: new URL(String(input)),
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      redirect: init?.redirect,
      signal: init?.signal ?? undefined,
    };
    seen.push(request);
    return respond(request);
  }) as typeof globalThis.fetch;
  return { fetch, seen };
}

function service(
  respond: (seen: Seen) => Response | Promise<Response>,
  options: Partial<GoogleMapsServiceOptions> = {},
) {
  const { fetch, seen } = fakeFetch(respond);
  return { maps: createGoogleMapsService({ apiKey: API_KEY, fetch, ...options }), seen };
}

const signal = () => new AbortController().signal;
const location = { latitude: 52.23, longitude: 21.01 };

async function failure(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  throw new Error('expected a failure');
}

describe('credentials', () => {
  test('the key travels only in X-Goog-Api-Key, to Google hosts', async () => {
    const { maps, seen } = service(() => Response.json({ places: [] }));
    await maps.searchNearby({ location, radius: 1000 }, signal());
    await maps.searchText({ textQuery: 'cafe' }, signal());

    for (const request of seen) {
      expect(request.url.origin).toBe('https://places.googleapis.com');
      expect(request.headers.get('X-Goog-Api-Key')).toBe(API_KEY);
      expect(request.headers.has('Authorization')).toBe(false);
      expect(request.url.href).not.toContain(API_KEY);
    }
  });

  test('a loopback origin replaces both Google hosts, for the smoke tests', async () => {
    const { maps, seen } = service(() => Response.json([]), { origin: 'http://127.0.0.1:9' });
    await maps.computeRouteMatrix(
      { origins: [location], destinations: [location], travelMode: 'WALK' },
      signal(),
    );

    expect(seen[0]?.url.href).toBe('http://127.0.0.1:9/distanceMatrix/v2:computeRouteMatrix');
  });
});

test('a redirect is refused, never followed, so the key header stays with Google', async () => {
  const { maps, seen } = service(
    () => new Response(null, { status: 302, headers: { Location: 'https://evil.example/' } }),
  );

  const error = await failure(maps.getPhotoUri(PHOTO_NAME, { maxWidth: 800 }, signal()));

  expect(error).toBeInstanceOf(GoogleMapsError);
  expect((error as GoogleMapsError).status).toBe(302);
  expect(seen.map(({ redirect }) => redirect)).toEqual(['manual']);
});

describe('photos', () => {
  test('resolved through the media endpoint as JSON, so the URL never carries the key', async () => {
    const { maps, seen } = service(() =>
      Response.json({ name: `${PHOTO_NAME}/media`, photoUri: PUBLIC_PHOTO }),
    );

    const uri = await maps.getPhotoUri(PHOTO_NAME, { maxWidth: 800 }, signal());

    expect(uri).toBe(PUBLIC_PHOTO);
    const [request] = seen;
    expect(`${request?.url.origin}${request?.url.pathname}`).toBe(
      `https://places.googleapis.com/v1/${PHOTO_NAME}/media`,
    );
    expect(request?.url.searchParams.get('skipHttpRedirect')).toBe('true');
    expect(request?.url.searchParams.get('maxWidthPx')).toBe('800');
    expect(request?.url.searchParams.has('key')).toBe(false);
    expect(request?.redirect).toBe('manual');
    expect(request?.headers.get('X-Goog-Api-Key')).toBe(API_KEY);
  });

  test('invalid photo names and sizes are refused without a request', async () => {
    const { maps, seen } = service(() => Response.json({ photoUri: PUBLIC_PHOTO }));
    for (const name of [
      'https://evil.example/image',
      '../photo',
      `${PHOTO_NAME}?key=oops`,
      'places/../photos/x',
    ]) {
      const error = await failure(maps.getPhotoUri(name, { maxWidth: 800 }, signal()));
      expect(error).toBeInstanceOf(GoogleMapsError);
      expect(error.message).toBe('Invalid Google photo resource name');
    }
    for (const size of [{ maxWidth: 0 }, { maxWidth: 4801 }, { maxWidth: 800, maxHeight: 1.5 }]) {
      const error = await failure(maps.getPhotoUri(PHOTO_NAME, size, signal()));
      expect(error.message).toBe('Photo dimensions must be integers between 1 and 4800');
    }
    expect(seen).toEqual([]);
  });

  test('a photo URL that carries credentials, or is not plain HTTPS, fails closed', async () => {
    for (const photoUri of [
      `https://images.example/p?key=${API_KEY}`,
      `https://images.example/p?api_key=x`,
      `https://images.example/${API_KEY}`,
      `https://images.example/${encodeURIComponent(API_KEY)}`,
      'http://images.example/p',
      'https://user:password@images.example/p',
      'https://images.example/p#fragment',
      'javascript:alert(1)',
      null,
    ]) {
      const { maps } = service(() => Response.json({ photoUri }));
      const error = await failure(maps.getPhotoUri(PHOTO_NAME, { maxWidth: 800 }, signal()));
      expect(error).toBeInstanceOf(GoogleMapsError);
      expect(error.message).toBe('Google returned an invalid photo URL');
    }
  });
});

describe('errors', () => {
  test("Google's refusal keeps its message, with the key removed", async () => {
    const { maps } = service(() =>
      Response.json(
        {
          error: {
            message: `API key ${API_KEY} (or ${encodeURIComponent(API_KEY)}) is not valid`,
          },
        },
        { status: 403, statusText: 'Forbidden' },
      ),
    );

    const error = await failure(maps.getPhotoUri(PHOTO_NAME, { maxWidth: 800 }, signal()));

    expect(error).toBeInstanceOf(GoogleMapsError);
    expect((error as GoogleMapsError).status).toBe(403);
    expect(error.message).toBe(
      'Google Maps API error: 403 Forbidden - API key [redacted] (or [redacted]) is not valid',
    );
  });

  test('a refusal without a JSON body names the status only', async () => {
    const { maps } = service(() => new Response('<html>', { status: 502 }));
    const error = await failure(maps.getPlace({ placeId: 'p', fields: ['id'] }, signal()));
    expect(error.message).toBe('Google Maps API error: 502 ');
  });

  test('a network failure, a timeout or a cut-off body is an outage', async () => {
    const outages: Array<() => Promise<Response>> = [
      async () => {
        throw new TypeError(`fetch failed for key=${API_KEY}`);
      },
      () => new Promise(() => {}),
      async () => new Response('{"places": [', { headers: { 'Content-Type': 'application/json' } }),
    ];
    for (const respond of outages) {
      const { fetch } = fakeFetch(respond);
      // The never-settling response must still end, through the timeout signal.
      const neverSettles = (async (input: string | URL | Request, init?: RequestInit) =>
        Promise.race([
          fetch(input, init),
          new Promise<never>((_, reject) =>
            init?.signal?.addEventListener('abort', () => reject(init.signal?.reason)),
          ),
        ])) as typeof globalThis.fetch;
      const maps = createGoogleMapsService({ apiKey: API_KEY, fetch: neverSettles, timeoutMs: 50 });

      const error = await failure(maps.searchText({ textQuery: 'x' }, signal()));

      expect(error).toBeInstanceOf(GoogleMapsError);
      expect(error.message).not.toContain(API_KEY);
    }
  });

  test("the caller's cancellation passes through as is", async () => {
    const controller = new AbortController();
    const { maps, seen } = service(
      ({ signal }) =>
        new Promise((_, reject) => {
          signal?.addEventListener('abort', () => reject(signal.reason));
          controller.abort();
        }),
    );

    const error = await failure(maps.searchText({ textQuery: 'x' }, controller.signal));

    expect(error).not.toBeInstanceOf(GoogleMapsError);
    expect(error.name).toBe('AbortError');
    expect(seen).toHaveLength(1);
  });

  test('a complete answer in an unexpected shape is a bug, not an outage', async () => {
    const { maps } = service(() => Response.json({ places: [{ name: 'no id' }] }));
    const error = await failure(maps.searchNearby({ location, radius: 1 }, signal()));
    expect(error).not.toBeInstanceOf(GoogleMapsError);
  });
});

describe('requests', () => {
  test('nearby search: a circle around the location, and the search field mask', async () => {
    const { maps, seen } = service(() => Response.json({}));

    expect(
      await maps.searchNearby(
        { location, radius: 500, includedTypes: ['cafe'], rankPreference: 'POPULARITY' },
        signal(),
      ),
    ).toEqual([]);
    expect(seen[0]?.url.pathname).toBe('/v1/places:searchNearby');
    expect(seen[0]?.method).toBe('POST');
    expect(seen[0]?.body).toEqual({
      locationRestriction: { circle: { center: location, radius: 500 } },
      maxResultCount: 10,
      rankPreference: 'POPULARITY',
      languageCode: 'en',
      includedTypes: ['cafe'],
    });
    expect(seen[0]?.headers.get('X-Goog-FieldMask')).toBe(
      [
        'id',
        'displayName',
        'formattedAddress',
        'shortFormattedAddress',
        'location',
        'types',
        'primaryType',
        'primaryTypeDisplayName',
        'rating',
        'userRatingCount',
        'priceLevel',
        'regularOpeningHours',
        'currentOpeningHours',
        'businessStatus',
      ]
        .map((field) => `places.${field}`)
        .join(','),
    );
  });

  test('text search: a point is biased to a 5 km circle; empty filters are left out', async () => {
    const { maps, seen } = service(() => Response.json({ places: [{ id: 'a' }] }));

    expect(
      await maps.searchText(
        { textQuery: 'cafe', locationBias: location, openNow: false, priceLevels: [] },
        signal(),
      ),
    ).toEqual([{ id: 'a' }]);
    expect(seen[0]?.body).toEqual({
      textQuery: 'cafe',
      maxResultCount: 10,
      languageCode: 'en',
      locationBias: { circle: { center: location, radius: 5000 } },
      openNow: false,
    });
  });

  test('place details: the fields asked for, without the places. prefix', async () => {
    const { maps, seen } = service(() => Response.json({ id: 'abc' }));

    await maps.getPlace({ placeId: 'abc', fields: ['id', 'displayName'] }, signal());

    expect(seen[0]?.method).toBe('GET');
    expect(seen[0]?.url.href).toBe('https://places.googleapis.com/v1/places/abc');
    expect(seen[0]?.headers.get('X-Goog-FieldMask')).toBe('id,displayName');
  });

  test('routes: a departure time asks for traffic-aware routing, except for transit', async () => {
    const { maps, seen } = service(({ url }) =>
      Response.json(url.pathname.includes('Matrix') ? [] : {}),
    );
    const departureTime = '2026-10-05T12:00:00Z';

    expect(
      await maps.computeRoutes(
        {
          origin: location,
          destination: { placeId: 'p' },
          travelMode: 'DRIVE',
          departureTime,
          routeModifiers: { avoidTolls: true },
        },
        signal(),
      ),
    ).toEqual([]);
    await maps.computeRouteMatrix(
      {
        origins: [location],
        destinations: [{ address: 'a' }],
        travelMode: 'TRANSIT',
        departureTime,
      },
      signal(),
    );

    expect(seen[0]?.url.href).toBe('https://routes.googleapis.com/directions/v2:computeRoutes');
    expect(seen[0]?.body).toEqual({
      origin: { location: { latLng: location } },
      destination: { placeId: 'p' },
      travelMode: 'DRIVE',
      languageCode: 'en',
      departureTime,
      routingPreference: 'TRAFFIC_AWARE_OPTIMAL',
      routeModifiers: { avoidTolls: true },
    });
    expect(seen[1]?.url.href).toBe(
      'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix',
    );
    expect(seen[1]?.body).toEqual({
      origins: [{ waypoint: { location: { latLng: location } } }],
      destinations: [{ waypoint: { address: 'a' } }],
      travelMode: 'TRANSIT',
      languageCode: 'en',
      departureTime,
    });
    expect(seen[1]?.headers.get('X-Goog-FieldMask')).toBe(
      'originIndex,destinationIndex,status,condition,distanceMeters,duration,staticDuration,localizedValues',
    );
  });
});
