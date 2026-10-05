import { afterEach, describe, expect, setSystemTime, test } from 'bun:test';
import {
  type ComputeRouteMatrixParams,
  type ComputeRoutesParams,
  GoogleMapsError,
  type Route,
  type RouteMatrixElement,
} from '../../src/services/google-maps';
import { cleanup, connect, fakeMaps, testDeps, textOf } from '../helpers';

afterEach(() => {
  setSystemTime();
  return cleanup();
});

const origin = { latitude: 52.23, longitude: 21.01 };

const ROUTE: Route = {
  distanceMeters: 1200,
  duration: '900s',
  polyline: { encodedPolyline: 'encoded' },
  warnings: ['Walking directions may be missing sidewalks.'],
  legs: [
    {
      distanceMeters: 1200,
      duration: '900s',
      steps: [
        {
          distanceMeters: 400,
          staticDuration: '300s',
          navigationInstruction: { maneuver: 'TURN_LEFT', instructions: 'Turn left' },
          travelMode: 'WALK',
        },
        {
          distanceMeters: 800,
          staticDuration: '600s',
          localizedValues: { distance: { text: '0.8 km' }, staticDuration: { text: '10 mins' } },
          travelMode: 'TRANSIT',
          transitDetails: {
            transitLine: { shortName: '52', vehicle: { type: 'TRAM', name: { text: 'Tram' } } },
            headsign: 'Centrum',
            stopCount: 3,
            stopDetails: { departureStop: { name: 'A' }, arrivalStop: { name: 'B' } },
          },
        },
      ],
    },
  ],
};

function recording(
  routes: Route[] = [ROUTE],
  elements?: (params: ComputeRouteMatrixParams) => RouteMatrixElement[],
) {
  const single: ComputeRoutesParams[] = [];
  const matrix: ComputeRouteMatrixParams[] = [];
  const base = fakeMaps();
  const maps = fakeMaps({
    computeRoutes: async (params) => {
      single.push(params);
      return routes;
    },
    computeRouteMatrix: async (params, signal) => {
      matrix.push(params);
      return elements ? elements(params) : base.computeRouteMatrix(params, signal);
    },
  });
  return { deps: testDeps({ maps }), single, matrix };
}

describe('get_route, one destination', () => {
  test('walks by default, and converts each kind of waypoint', async () => {
    const { deps, single, matrix } = recording();
    const client = await connect({ deps });

    const result = await client.callTool({
      name: 'get_route',
      arguments: { origin: { place_id: 'from' }, destinations: [{ address: 'to' }] },
    });

    expect(matrix).toEqual([]);
    expect(single).toEqual([
      {
        origin: { placeId: 'from' },
        destination: { address: 'to' },
        travelMode: 'WALK',
        departureTime: undefined,
        routeModifiers: undefined,
        languageCode: 'en',
      },
    ]);
    expect(textOf(result)).toBe(
      [
        '📍 **Route Summary**',
        '⏱️ Duration: 15 min',
        '📏 Distance: 1.2 km',
        '',
        '⚠️ Warnings:',
        '  - Walking directions may be missing sidewalks.',
      ].join('\n'),
    );
    expect(result.structuredContent).toEqual({
      duration_seconds: 900,
      duration_text: '15 min',
      distance_meters: 1200,
      distance_text: '1.2 km',
      warnings: ['Walking directions may be missing sidewalks.'],
      mode: 'walk',
    });
  });

  test('steps, polyline, avoidances, and "now" as a time just ahead', async () => {
    setSystemTime(new Date('2026-10-05T12:00:00Z'));
    const { deps, single } = recording();
    const client = await connect({ deps });

    const result = await client.callTool({
      name: 'get_route',
      arguments: {
        origin,
        destinations: [{ latitude: 52.25, longitude: 21.0 }],
        mode: 'transit',
        departure_time: 'now',
        avoid: ['tolls'],
        include_steps: true,
        include_polyline: true,
        language: 'pl',
      },
    });

    expect(single[0]).toEqual({
      origin,
      destination: { latitude: 52.25, longitude: 21.0 },
      travelMode: 'TRANSIT',
      departureTime: '2026-10-05T12:01:00.000Z',
      routeModifiers: { avoidTolls: true, avoidHighways: false, avoidFerries: false },
      languageCode: 'pl',
    });
    expect(textOf(result)).toContain(
      [
        '**Directions:**',
        '1. Turn left (400 m, 5 min)',
        '2. Continue (0.8 km, 10 mins)',
        '   🚌 Tram - 52 - toward Centrum - 3 stops',
        '   From: A',
        '   To: B',
      ].join('\n'),
    );
    expect(result.structuredContent).toMatchObject({
      polyline: 'encoded',
      mode: 'transit',
      steps: [
        { instruction: 'Turn left', maneuver: 'TURN_LEFT', duration_text: '5 min' },
        {
          instruction: 'Continue',
          transit_details: { short_name: '52', vehicle_type: 'TRAM', stop_count: 3 },
        },
      ],
    });
  });

  test('no route found is an answer, not an error', async () => {
    const { deps } = recording([]);
    const client = await connect({ deps });

    const result = await client.callTool({
      name: 'get_route',
      arguments: { origin, destinations: [{ address: 'nowhere' }] },
    });

    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toBe('No route found between the specified locations.');
    expect(result.structuredContent).toEqual({ route: null });
  });
});

describe('get_route, several destinations', () => {
  test('compares them, closest first', async () => {
    const { deps, matrix } = recording();
    const client = await connect({ deps });

    const result = await client.callTool({
      name: 'get_route',
      arguments: { origin, destinations: [{ address: 'a' }, { address: 'b' }], mode: 'drive' },
    });

    expect(matrix).toEqual([
      {
        origins: [origin],
        destinations: [{ address: 'a' }, { address: 'b' }],
        travelMode: 'DRIVE',
        departureTime: undefined,
        languageCode: 'en',
      },
    ]);
    expect(textOf(result)).toBe(
      [
        '**Distance Matrix:**',
        '',
        'Destination 1: 10 min (1.0 km)',
        'Destination 2: 20 min (2.0 km)',
        '',
        '✅ Closest: Destination 1',
      ].join('\n'),
    );
    expect(result.structuredContent).toEqual({
      mode: 'drive',
      destinations: [
        {
          index: 0,
          available: true,
          duration_seconds: 600,
          duration_text: '10 min',
          distance_meters: 1000,
          distance_text: '1.0 km',
        },
        {
          index: 1,
          available: true,
          duration_seconds: 1200,
          duration_text: '20 min',
          distance_meters: 2000,
          distance_text: '2.0 km',
        },
      ],
      closest_index: 0,
    });
  });

  test('names destinations by the index Google reports, whatever the answer order', async () => {
    const { deps } = recording([], () => [
      { destinationIndex: 2, distanceMeters: 300, duration: '120s', condition: 'ROUTE_EXISTS' },
      { destinationIndex: 0, condition: 'ROUTE_NOT_FOUND' },
      { destinationIndex: 1, distanceMeters: 900, duration: '600s', condition: 'ROUTE_EXISTS' },
    ]);
    const client = await connect({ deps });

    const result = await client.callTool({
      name: 'get_route',
      arguments: { origin, destinations: [{ address: 'a' }, { address: 'b' }, { address: 'c' }] },
    });

    expect(result.structuredContent).toMatchObject({
      destinations: [
        { index: 2, available: true },
        { index: 1, available: true },
        { index: 0, available: false },
      ],
      closest_index: 2,
    });
    expect(textOf(result)).toContain('Destination 1: Route not available');
    expect(textOf(result)).toContain('✅ Closest: Destination 3');
  });

  test('an empty matrix is an answer, not an error', async () => {
    const { deps } = recording([], () => []);
    const client = await connect({ deps });

    const result = await client.callTool({
      name: 'get_route',
      arguments: { origin, destinations: [{ address: 'a' }, { address: 'b' }] },
    });

    expect(textOf(result)).toBe('No routes found.');
    expect(result.structuredContent).toEqual({ destinations: [] });
  });
});

test("Google's refusal reaches the model", async () => {
  const deps = testDeps({
    maps: fakeMaps({
      computeRoutes: async () => {
        throw new GoogleMapsError('Google Maps API error: 403  - mock denied', 403);
      },
    }),
  });
  const client = await connect({ deps });

  const result = await client.callTool({
    name: 'get_route',
    arguments: { origin, destinations: [{ address: 'b' }] },
  });

  expect(result.isError).toBe(true);
  expect(textOf(result)).toBe('Failed to get route: Google Maps API error: 403  - mock denied');
});

test('invalid input is refused without calling Google', async () => {
  const { deps, single, matrix } = recording();
  const client = await connect({ deps });

  for (const args of [{}, { origin, destinations: [] }]) {
    const result = await client.callTool({ name: 'get_route', arguments: args });
    expect(result.isError).toBe(true);
  }
  expect([...single, ...matrix]).toEqual([]);
});
