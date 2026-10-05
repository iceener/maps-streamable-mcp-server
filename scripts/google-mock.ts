import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A loopback stand-in for places.googleapis.com and routes.googleapis.com, for the smoke
 * tests. The server under test reaches it through `GOOGLE_API_ORIGIN`. It answers only
 * requests that carry the expected key in `X-Goog-Api-Key`, and refuses any request that
 * carries an `Authorization` header or a key in the URL: the caller's token must never
 * reach Google, and the key must travel only in the header.
 */
export const PHOTO_URL = 'https://lh3.googleusercontent.com/smoke-photo=w800';

const PLACE = {
  id: 'smoke-place',
  displayName: { text: 'Smoke Cafe', languageCode: 'en' },
  formattedAddress: '1 Loopback Street',
  location: { latitude: 52.23, longitude: 21.01 },
  rating: 4.5,
  userRatingCount: 10,
  currentOpeningHours: { openNow: true },
  photos: [
    {
      name: 'places/smoke-place/photos/photo-1',
      widthPx: 1200,
      heightPx: 900,
      authorAttributions: [{ displayName: 'Photographer' }],
    },
  ],
};

export interface GoogleMock {
  origin: string;
  /** `METHOD path` of every request answered, in order. */
  requests: string[];
  close(): Promise<void>;
}

export async function startGoogleMock(apiKey: string): Promise<GoogleMock> {
  const requests: string[] = [];

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const body = await readJson(request);
    const answer = (status: number, json: unknown) => {
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(json));
    };

    if (
      request.headers['x-goog-api-key'] !== apiKey ||
      request.headers.authorization !== undefined ||
      url.searchParams.has('key')
    ) {
      answer(403, { error: { message: 'The mock refused the credentials it was sent' } });
      return;
    }
    requests.push(`${request.method} ${url.pathname}`);

    switch (`${request.method} ${url.pathname}`) {
      case 'POST /v1/places:searchNearby':
      case 'POST /v1/places:searchText':
        return answer(200, { places: [PLACE] });
      case 'GET /v1/places/smoke-place':
        return answer(200, PLACE);
      case 'GET /v1/places/smoke-place/photos/photo-1/media':
        return answer(200, { name: `${PLACE.photos[0]?.name}/media`, photoUri: PHOTO_URL });
      case 'POST /directions/v2:computeRoutes':
        return answer(200, { routes: [{ distanceMeters: 1200, duration: '900s', legs: [] }] });
      case 'POST /distanceMatrix/v2:computeRouteMatrix': {
        const count = Array.isArray(body.destinations) ? body.destinations.length : 0;
        // Reverse order, as Google may: each element names its destination.
        return answer(
          200,
          Array.from({ length: count }, (_, index) => ({
            originIndex: 0,
            destinationIndex: index,
            condition: 'ROUTE_EXISTS',
            distanceMeters: 1000 * (index + 1),
            duration: `${600 * (index + 1)}s`,
          })).reverse(),
        );
      }
      default:
        return answer(404, { error: { message: `No mock for ${request.method} ${url.pathname}` } });
    }
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    origin: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  let text = '';
  for await (const chunk of request) text += chunk;
  return text ? JSON.parse(text) : {};
}
