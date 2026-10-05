import * as z from 'zod/v4';
import { defineTool, toolError } from '../platform/primitives';
import { GoogleMapsError, type LatLng, type Place } from '../services/google-maps';

const LatLngSchema = z.object({
  latitude: z.number().min(-90).max(90).describe('Latitude'),
  longitude: z.number().min(-180).max(180).describe('Longitude'),
});

const InputSchema = z.object({
  // Required: the user's location.
  location: LatLngSchema.describe('Current location (latitude, longitude)'),

  // Search mode: a text query, or a nearby search by type.
  query: z
    .string()
    .optional()
    .describe('Text search query (e.g., "sushi near Central Park", "Starbucks")'),
  types: z
    .array(z.string())
    .optional()
    .describe(
      'Place types for nearby search (e.g., ["restaurant", "cafe"]). See: https://developers.google.com/maps/documentation/places/web-service/place-types',
    ),

  radius: z
    .number()
    .int()
    .min(1)
    .max(50000)
    .optional()
    .default(1000)
    .describe('Search radius in meters (default: 1000, max: 50000)'),

  // Filters.
  open_now: z.boolean().optional().default(false).describe('Only return places that are open now'),
  min_rating: z.number().min(0).max(5).optional().describe('Minimum rating (0-5)'),
  price_levels: z
    .array(z.enum(['FREE', 'INEXPENSIVE', 'MODERATE', 'EXPENSIVE', 'VERY_EXPENSIVE']))
    .optional()
    .describe('Filter by price level'),

  // Result options.
  max_results: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .default(10)
    .describe('Maximum results to return (1-20)'),
  sort_by: z
    .enum(['distance', 'rating', 'relevance'])
    .optional()
    .default('distance')
    .describe('Sort results by: distance, rating, or relevance'),

  language: z.string().optional().default('en').describe('Language code (e.g., "en", "pl", "de")'),
});

/**
 * One tool for both Places searches: Text Search when `query` is set, Nearby Search
 * otherwise, optionally narrowed to `types`.
 */
export const searchPlaces = defineTool(
  'search_places',
  {
    description: `Find places by text query OR by type near a location. Unified search for nearby and text-based queries.

SEARCH MODES (mutually exclusive):
1. Text query: Pass 'query' (e.g., "sushi near Central Park", "Starbucks")
2. Nearby by type: Pass 'types' array (e.g., ["restaurant", "cafe"])  
3. Everything nearby: Pass neither (returns all places within radius)

INPUTS:
- location: { latitude, longitude } (REQUIRED) — user's current position
- query?: string — text search (name, category, area)
- types?: string[] — place types for nearby search (see: https://developers.google.com/maps/documentation/places/web-service/place-types)
- radius?: number — search radius in meters (default: 1000, max: 50000)
- open_now?: boolean — only open places (default: false)
- min_rating?: number — minimum rating 0-5
- price_levels?: ["FREE"|"INEXPENSIVE"|"MODERATE"|"EXPENSIVE"|"VERY_EXPENSIVE"]
- max_results?: number — 1-20 (default: 10)
- sort_by?: "distance"|"rating"|"relevance" (default: distance)

RETURNS: List of places with:
- id (use with get_place), name, address, location
- rating, user_rating_count, price_level
- open_now, business_status
- google_maps_uri (link to Google Maps)

EXAMPLES:
- Nearby cafes: { location: {...}, types: ["cafe"] }
- Text search: { location: {...}, query: "pizza" }
- Open pharmacies: { location: {...}, types: ["pharmacy"], open_now: true }
- Best rated: { location: {...}, types: ["restaurant"], sort_by: "rating", min_rating: 4 }`,
    inputSchema: InputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  },
  async (args, ctx, { maps, logger }) => {
    const { signal } = ctx.mcpReq;
    const useTextSearch = Boolean(args.query);

    let places: Place[];
    try {
      places = args.query
        ? await maps.searchText(
            {
              textQuery: args.query,
              locationBias: args.location,
              openNow: args.open_now,
              minRating: args.min_rating,
              priceLevels: args.price_levels?.map((level) => `PRICE_LEVEL_${level}`),
              maxResultCount: args.max_results,
              rankPreference: args.sort_by === 'distance' ? 'DISTANCE' : 'RELEVANCE',
              languageCode: args.language,
            },
            signal,
          )
        : await maps.searchNearby(
            {
              location: args.location,
              radius: args.radius,
              includedTypes: args.types,
              maxResultCount: args.max_results,
              // Without types, nearby search always ranks by distance.
              rankPreference:
                args.types?.length && args.sort_by !== 'distance' ? 'POPULARITY' : 'DISTANCE',
              languageCode: args.language,
            },
            signal,
          );
    } catch (error) {
      if (error instanceof GoogleMapsError) {
        logger.warning('Google Maps request failed', { tool: 'search_places', error });
        return toolError(`Failed to search places: ${error.message}`);
      }
      throw error;
    }

    // Nearby Search has no open-now filter, so it is applied here.
    if (args.open_now && !useTextSearch) {
      places = places.filter((place) => place.currentOpeningHours?.openNow === true);
    }
    if (args.sort_by === 'rating') {
      places.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
    }

    if (places.length === 0) {
      const searchType = useTextSearch ? `"${args.query}"` : (args.types?.join(', ') ?? 'places');
      return {
        content: [
          {
            type: 'text',
            text: `No ${searchType} found within ${formatDistance(args.radius)} of your location.`,
          },
        ],
        structuredContent: { places: [] },
      };
    }

    const formatted = places.map((place) => formatPlace(place, args.location));
    const heading = useTextSearch
      ? `Results for "${args.query}"`
      : args.types?.length
        ? `${args.types.join(', ')} nearby`
        : 'Places nearby';

    return {
      content: [
        {
          type: 'text',
          text: [
            `${heading} (${places.length} found):\n`,
            ...formatted.map((place) => place.text),
          ].join('\n'),
        },
      ],
      structuredContent: {
        places: formatted.map((place) => place.data),
        query: args.query,
        types: args.types,
        location: args.location,
        radius: args.radius,
      },
    };
  },
);

function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)}m`;
  return `${(meters / 1000).toFixed(1)}km`;
}

/** Great-circle distance in meters (haversine formula). */
function calculateDistance(from: LatLng, to: LatLng): number {
  const earthRadius = 6371000;
  const lat1 = (from.latitude * Math.PI) / 180;
  const lat2 = (to.latitude * Math.PI) / 180;
  const deltaLat = ((to.latitude - from.latitude) * Math.PI) / 180;
  const deltaLng = ((to.longitude - from.longitude) * Math.PI) / 180;

  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const PRICE_LEVELS: Record<string, string> = {
  PRICE_LEVEL_FREE: 'Free',
  PRICE_LEVEL_INEXPENSIVE: '$',
  PRICE_LEVEL_MODERATE: '$$',
  PRICE_LEVEL_EXPENSIVE: '$$$',
  PRICE_LEVEL_VERY_EXPENSIVE: '$$$$',
};

function formatPlace(place: Place, userLocation: LatLng) {
  const name = place.displayName?.text ?? 'Unknown';
  const address = place.shortFormattedAddress ?? place.formattedAddress ?? '';
  const rating = place.rating ? `★${place.rating.toFixed(1)}` : '';
  const reviews = place.userRatingCount ? `(${place.userRatingCount})` : '';
  const price = PRICE_LEVELS[place.priceLevel ?? ''] ?? '';
  const openNow = place.currentOpeningHours?.openNow;
  const openStatus = openNow === true ? '🟢 Open' : openNow === false ? '🔴 Closed' : '';
  const distance = place.location
    ? formatDistance(calculateDistance(userLocation, place.location))
    : '';

  const parts = [name];
  if (distance) parts.push(`(${distance})`);
  if (rating) parts.push(`${rating}${reviews}`);
  if (price) parts.push(price);
  if (openStatus) parts.push(openStatus);

  return {
    text: `- ${parts.join(' ')}${address ? `\n  ${address}` : ''}\n  ID: ${place.id}`,
    data: {
      id: place.id,
      name: place.displayName?.text,
      address: place.formattedAddress,
      short_address: place.shortFormattedAddress,
      location: place.location,
      rating: place.rating,
      user_rating_count: place.userRatingCount,
      price_level: place.priceLevel,
      types: place.types,
      primary_type: place.primaryType,
      open_now: place.currentOpeningHours?.openNow,
      business_status: place.businessStatus,
      google_maps_uri: place.googleMapsUri,
    },
  };
}
