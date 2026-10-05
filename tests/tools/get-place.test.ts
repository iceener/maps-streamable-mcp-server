import { afterEach, describe, expect, test } from 'bun:test';
import {
  GoogleMapsError,
  type Place,
  type PlaceDetailsParams,
} from '../../src/services/google-maps';
import { CAFE, cleanup, connect, fakeMaps, testDeps, textOf } from '../helpers';

afterEach(cleanup);

const DETAILED: Place = {
  ...CAFE,
  internationalPhoneNumber: '+48 12 345 67 89',
  websiteUri: 'https://cafe.example.test',
  regularOpeningHours: { weekdayDescriptions: ['Monday: 8:00 AM – 6:00 PM'] },
  reviews: [1, 2, 3, 4].map((n) => ({
    name: `review-${n}`,
    rating: 4,
    text: { text: `Review ${n}`, languageCode: 'en' },
    authorAttribution: { displayName: `Author ${n}`, uri: `https://reviews.example.test/${n}` },
    publishTime: '2026-10-01T10:00:00Z',
    relativePublishTimeDescription: 'a week ago',
  })),
  photos: [1, 2, 3, 4].map((n) => ({
    name: `places/place-1/photos/photo-${n}`,
    widthPx: 1200,
    heightPx: 900,
    authorAttributions: [{ displayName: `Photographer ${n}` }],
  })),
};

function recording(place: Place = DETAILED) {
  const requests: PlaceDetailsParams[] = [];
  const photos: Array<{ name: string; maxWidth: number }> = [];
  const maps = fakeMaps({
    getPlace: async (params) => {
      requests.push(params);
      return place;
    },
    getPhotoUri: async (name, { maxWidth }) => {
      photos.push({ name, maxWidth });
      return `https://lh3.googleusercontent.com/${name.split('/').at(-1)}=w${maxWidth}`;
    },
  });
  return { deps: testDeps({ maps }), requests, photos };
}

describe('get_place', () => {
  test('by default asks for basic fields and hours, and shows them', async () => {
    const { deps, requests, photos } = recording();
    const client = await connect({ deps });

    const result = await client.callTool({ name: 'get_place', arguments: { place_id: 'place-1' } });

    expect(requests).toEqual([
      {
        placeId: 'place-1',
        fields: [
          'id',
          'displayName',
          'formattedAddress',
          'shortFormattedAddress',
          'location',
          'types',
          'primaryType',
          'primaryTypeDisplayName',
          'regularOpeningHours',
          'currentOpeningHours',
          'businessStatus',
        ],
        languageCode: 'en',
      },
    ]);
    expect(photos).toEqual([]);
    expect(textOf(result)).toBe(
      [
        '# Test Cafe',
        '📍 1 Test Street',
        '★★★★★ 4.8 (42 reviews)',
        '💰 $',
        '',
        '🟢 Currently OPEN',
        '',
        '**Opening Hours:**',
        '  Monday: 8:00 AM – 6:00 PM',
      ].join('\n'),
    );
    expect(result.structuredContent).toEqual({
      id: 'place-1',
      address: '1 Test Street',
      rating: 4.8,
      user_rating_count: 42,
      price_level: 'PRICE_LEVEL_INEXPENSIVE',
      primary_type: 'cafe',
      types: ['cafe'],
      location: { latitude: 52.23, longitude: 21.01 },
      google_maps_uri: 'https://maps.example.test/place-1',
      open_now: true,
      business_status: 'OPERATIONAL',
      opening_hours: ['Monday: 8:00 AM – 6:00 PM'],
    });
  });

  test('contact, reviews and photos, each limited as asked', async () => {
    const { deps, photos } = recording();
    const client = await connect({ deps });

    const result = await client.callTool({
      name: 'get_place',
      arguments: {
        place_id: 'place-1',
        fields: ['contact', 'reviews', 'photos'],
        max_reviews: 2,
        max_photos: 2,
      },
    });

    expect(photos).toEqual([
      { name: 'places/place-1/photos/photo-1', maxWidth: 800 },
      { name: 'places/place-1/photos/photo-2', maxWidth: 800 },
    ]);
    expect(result.structuredContent).toEqual({
      id: 'place-1',
      phone: '+48 12 345 67 89',
      website: 'https://cafe.example.test',
      reviews: [1, 2].map((n) => ({
        author: `Author ${n}`,
        author_uri: `https://reviews.example.test/${n}`,
        rating: 4,
        text: `Review ${n}`,
        publish_time: '2026-10-01T10:00:00Z',
        relative_time: 'a week ago',
      })),
      photos: [1, 2].map((n) => ({
        uri: `https://lh3.googleusercontent.com/photo-${n}=w800`,
        width: 1200,
        height: 900,
        attribution: `Photographer ${n}`,
        google_maps_uri: undefined,
      })),
    });
    expect(textOf(result)).toContain('Author 1 ★★★★ (a week ago)\n  "Review 1"');
    expect(textOf(result)).toContain(
      '- https://lh3.googleusercontent.com/photo-1=w800 (by Photographer 1)',
    );
  });

  test("Google's refusal, for the place or a photo, reaches the model", async () => {
    for (const maps of [
      fakeMaps({
        getPlace: async () => {
          throw new GoogleMapsError('Google Maps API error: 404  - Place not found', 404);
        },
      }),
      fakeMaps({
        getPlace: async () => DETAILED,
        getPhotoUri: async () => {
          throw new GoogleMapsError('Google returned an invalid photo URL');
        },
      }),
    ]) {
      const client = await connect({ deps: testDeps({ maps }) });
      const result = await client.callTool({
        name: 'get_place',
        arguments: { place_id: 'place-1', fields: ['photos'] },
      });

      expect(result.isError).toBe(true);
      expect(textOf(result)).toStartWith('Failed to get place details: ');
    }
  });

  test('invalid input is refused without calling Google', async () => {
    const { deps, requests } = recording();
    const client = await connect({ deps });

    const result = await client.callTool({ name: 'get_place', arguments: {} });

    expect(result.isError).toBe(true);
    expect(requests).toEqual([]);
  });
});
