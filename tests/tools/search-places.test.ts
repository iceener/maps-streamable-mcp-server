import { afterEach, describe, expect, test } from 'bun:test';
import {
  GoogleMapsError,
  type Place,
  type SearchNearbyParams,
  type TextSearchParams,
} from '../../src/services/google-maps';
import { CAFE, cleanup, connect, fakeMaps, testDeps, textOf } from '../helpers';

afterEach(cleanup);

const location = { latitude: 52.23, longitude: 21.01 };

function recording(places: Place[] = [CAFE]) {
  const nearby: SearchNearbyParams[] = [];
  const text: TextSearchParams[] = [];
  const maps = fakeMaps({
    searchNearby: async (params) => {
      nearby.push(params);
      return places.map((place) => ({ ...place }));
    },
    searchText: async (params) => {
      text.push(params);
      return places.map((place) => ({ ...place }));
    },
  });
  return { deps: testDeps({ maps }), nearby, text };
}

describe('search_places', () => {
  test('types: a nearby search by distance, with defaults, listed as text and data', async () => {
    const { deps, nearby, text } = recording();
    const client = await connect({ deps });

    const result = await client.callTool({
      name: 'search_places',
      arguments: { location, types: ['cafe'] },
    });

    expect(nearby).toEqual([
      {
        location,
        radius: 1000,
        includedTypes: ['cafe'],
        maxResultCount: 10,
        rankPreference: 'DISTANCE',
        languageCode: 'en',
      },
    ]);
    expect(text).toEqual([]);
    expect(textOf(result)).toBe(
      'cafe nearby (1 found):\n\n- Test Cafe (0m) ★4.8(42) $ 🟢 Open\n  1 Test St\n  ID: place-1',
    );
    expect(result.structuredContent).toEqual({
      places: [
        {
          id: 'place-1',
          name: 'Test Cafe',
          address: '1 Test Street',
          short_address: '1 Test St',
          location,
          rating: 4.8,
          user_rating_count: 42,
          price_level: 'PRICE_LEVEL_INEXPENSIVE',
          types: ['cafe'],
          primary_type: 'cafe',
          open_now: true,
          business_status: 'OPERATIONAL',
          google_maps_uri: 'https://maps.example.test/place-1',
        },
      ],
      types: ['cafe'],
      location,
      radius: 1000,
    });
  });

  test('types sorted by rating rank by popularity; no types always rank by distance', async () => {
    const { deps, nearby } = recording();
    const client = await connect({ deps });

    await client.callTool({
      name: 'search_places',
      arguments: { location, types: ['bar'], sort_by: 'rating' },
    });
    await client.callTool({ name: 'search_places', arguments: { location, sort_by: 'rating' } });

    expect(nearby.map((params) => params.rankPreference)).toEqual(['POPULARITY', 'DISTANCE']);
    expect(nearby[1]?.includedTypes).toBeUndefined();
  });

  test('query: a text search biased to the location, with filters mapped', async () => {
    const { deps, nearby, text } = recording();
    const client = await connect({ deps });

    const result = await client.callTool({
      name: 'search_places',
      arguments: {
        location,
        query: 'sushi',
        open_now: true,
        min_rating: 4,
        price_levels: ['MODERATE'],
        sort_by: 'relevance',
        max_results: 5,
        language: 'pl',
      },
    });

    expect(nearby).toEqual([]);
    expect(text).toEqual([
      {
        textQuery: 'sushi',
        locationBias: location,
        openNow: true,
        minRating: 4,
        priceLevels: ['PRICE_LEVEL_MODERATE'],
        maxResultCount: 5,
        rankPreference: 'RELEVANCE',
        languageCode: 'pl',
      },
    ]);
    expect(textOf(result)).toStartWith('Results for "sushi" (1 found):');
    expect(result.structuredContent).toMatchObject({ query: 'sushi' });
  });

  test('open_now filters nearby results here, since Nearby Search cannot', async () => {
    const closed = { ...CAFE, id: 'closed', currentOpeningHours: { openNow: false } };
    const { deps } = recording([closed, CAFE]);
    const client = await connect({ deps });

    const result = await client.callTool({
      name: 'search_places',
      arguments: { location, types: ['cafe'], open_now: true },
    });

    expect(result.structuredContent).toMatchObject({ places: [{ id: 'place-1' }] });
  });

  test('sort_by rating orders the results by rating', async () => {
    const low = { ...CAFE, id: 'low', rating: 3.1 };
    const { deps } = recording([low, CAFE]);
    const client = await connect({ deps });

    const result = await client.callTool({
      name: 'search_places',
      arguments: { location, query: 'cafe', sort_by: 'rating' },
    });

    expect(result.structuredContent).toMatchObject({ places: [{ id: 'place-1' }, { id: 'low' }] });
  });

  test('no results: a plain answer and an empty list', async () => {
    const { deps } = recording([]);
    const client = await connect({ deps });

    const result = await client.callTool({
      name: 'search_places',
      arguments: { location, types: ['zoo'], radius: 500 },
    });

    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toBe('No zoo found within 500m of your location.');
    expect(result.structuredContent).toEqual({ places: [] });
  });

  test("Google's refusal reaches the model, and is logged as a warning", async () => {
    const deps = testDeps({
      maps: fakeMaps({
        searchNearby: async () => {
          throw new GoogleMapsError('Google Maps API error: 403  - mock denied', 403);
        },
      }),
    });
    const client = await connect({ deps });

    const result = await client.callTool({ name: 'search_places', arguments: { location } });

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      'Failed to search places: Google Maps API error: 403  - mock denied',
    );
    expect(deps.logs).toContainEqual(
      expect.objectContaining({ level: 'warning', message: 'Google Maps request failed' }),
    );
  });

  test('an unexpected failure shows only a reference', async () => {
    const deps = testDeps({
      maps: fakeMaps({
        searchNearby: async () => {
          throw new TypeError('secret internal detail');
        },
      }),
    });
    const client = await connect({ deps });

    const result = await client.callTool({ name: 'search_places', arguments: { location } });

    expect(result.isError).toBe(true);
    expect(textOf(result)).not.toContain('secret internal detail');
    expect(textOf(result)).toContain(String(deps.logs[0]?.fields.reference));
  });

  test('invalid input is refused without calling Google', async () => {
    const { deps, nearby, text } = recording();
    const client = await connect({ deps });

    const result = await client.callTool({ name: 'search_places', arguments: {} });

    expect(result.isError).toBe(true);
    expect([...nearby, ...text]).toEqual([]);
  });

  test("the client's cancellation reaches the Google request", async () => {
    const started = Promise.withResolvers<void>();
    const aborted = Promise.withResolvers<void>();
    const deps = testDeps({
      maps: fakeMaps({
        searchNearby: (_params, signal) =>
          new Promise((_, reject) => {
            signal.addEventListener('abort', () => {
              aborted.resolve();
              reject(signal.reason);
            });
            started.resolve();
          }),
      }),
    });
    const client = await connect({ deps });
    const controller = new AbortController();

    const pending = client.callTool(
      { name: 'search_places', arguments: { location } },
      { signal: controller.signal },
    );
    await started.promise;
    controller.abort();

    await expect(pending).rejects.toThrow();
    await aborted.promise;
    expect(deps.logs.filter(({ level }) => level === 'error')).toEqual([]);
  });
});
