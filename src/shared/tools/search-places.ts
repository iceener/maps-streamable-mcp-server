/**
 * Search Places tool - unified search for nearby and text-based queries.
 */

import { z } from 'zod';
import { toolsMetadata } from '../../config/metadata.js';
import {
  GoogleMapsClient,
  type LatLng,
  type Place,
} from '../../services/google-maps.js';
import { defineTool, type ToolResult } from './types.js';

const LatLngSchema = z.object({
  latitude: z.number().min(-90).max(90).describe('Latitude'),
  longitude: z.number().min(-180).max(180).describe('Longitude'),
});

const InputSchema = z.object({
  // Required: user's location
  location: LatLngSchema.describe('Current location (latitude, longitude)'),

  // Search mode: text query OR types-based nearby search
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

  // Location parameters
  radius: z
    .number()
    .int()
    .min(1)
    .max(50000)
    .optional()
    .default(1000)
    .describe('Search radius in meters (default: 1000, max: 50000)'),

  // Filters
  open_now: z
    .boolean()
    .optional()
    .default(false)
    .describe('Only return places that are open now'),
  min_rating: z.number().min(0).max(5).optional().describe('Minimum rating (0-5)'),
  price_levels: z
    .array(z.enum(['FREE', 'INEXPENSIVE', 'MODERATE', 'EXPENSIVE', 'VERY_EXPENSIVE']))
    .optional()
    .describe('Filter by price level'),

  // Result options
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

  // Language
  language: z
    .string()
    .optional()
    .default('en')
    .describe('Language code (e.g., "en", "pl", "de")'),
});

function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)}m`;
  }
  return `${(meters / 1000).toFixed(1)}km`;
}

function calculateDistance(from: LatLng, to: LatLng): number {
  // Haversine formula
  const R = 6371000; // Earth's radius in meters
  const lat1 = (from.latitude * Math.PI) / 180;
  const lat2 = (to.latitude * Math.PI) / 180;
  const deltaLat = ((to.latitude - from.latitude) * Math.PI) / 180;
  const deltaLng = ((to.longitude - from.longitude) * Math.PI) / 180;

  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

function formatPriceLevel(priceLevel?: string): string {
  const levels: Record<string, string> = {
    PRICE_LEVEL_FREE: 'Free',
    PRICE_LEVEL_INEXPENSIVE: '$',
    PRICE_LEVEL_MODERATE: '$$',
    PRICE_LEVEL_EXPENSIVE: '$$$',
    PRICE_LEVEL_VERY_EXPENSIVE: '$$$$',
  };
  return levels[priceLevel ?? ''] ?? '';
}

function formatPlace(
  place: Place,
  userLocation: LatLng,
): {
  text: string;
  data: Record<string, unknown>;
} {
  const name = place.displayName?.text ?? 'Unknown';
  const address = place.shortFormattedAddress ?? place.formattedAddress ?? '';
  const rating = place.rating ? `★${place.rating.toFixed(1)}` : '';
  const reviews = place.userRatingCount ? `(${place.userRatingCount})` : '';
  const price = formatPriceLevel(place.priceLevel);
  const openNow = place.currentOpeningHours?.openNow;
  const openStatus =
    openNow === true ? '🟢 Open' : openNow === false ? '🔴 Closed' : '';

  let distance = '';
  if (place.location) {
    const meters = calculateDistance(userLocation, place.location);
    distance = formatDistance(meters);
  }

  const parts = [name];
  if (distance) parts.push(`(${distance})`);
  if (rating) parts.push(`${rating}${reviews}`);
  if (price) parts.push(price);
  if (openStatus) parts.push(openStatus);

  const text = `- ${parts.join(' ')}${address ? `\n  ${address}` : ''}\n  ID: ${place.id}`;

  return {
    text,
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

export const searchPlacesTool = defineTool({
  name: toolsMetadata.search_places.name,
  title: toolsMetadata.search_places.title,
  description: toolsMetadata.search_places.description,
  inputSchema: InputSchema,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true,
  },

  handler: async (args, context): Promise<ToolResult> => {
    // Server-side Google Maps API key
    const apiKey = context.env?.API_KEY;

    if (!apiKey) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: 'Google Maps API key not configured. Run: wrangler secret put API_KEY',
          },
        ],
      };
    }

    const client = new GoogleMapsClient(apiKey);

    try {
      let places: Place[] = [];

      // Determine search mode
      const useTextSearch = !!args.query;
      const useNearbySearch = !args.query && args.types && args.types.length > 0;

      if (useTextSearch && args.query) {
        // Text-based search
        const result = await client.textSearch({
          textQuery: args.query,
          locationBias: args.location,
          openNow: args.open_now,
          minRating: args.min_rating,
          priceLevels: args.price_levels?.map((p) => `PRICE_LEVEL_${p}`),
          maxResultCount: args.max_results,
          rankPreference: args.sort_by === 'distance' ? 'DISTANCE' : 'RELEVANCE',
          languageCode: args.language,
        });
        places = result.places ?? [];
      } else if (useNearbySearch) {
        // Type-based nearby search
        const result = await client.searchNearby({
          location: args.location,
          radius: args.radius,
          includedTypes: args.types,
          maxResultCount: args.max_results,
          rankPreference: args.sort_by === 'distance' ? 'DISTANCE' : 'POPULARITY',
          languageCode: args.language,
        });
        places = result.places ?? [];
      } else {
        // Default: nearby search without type filter
        const result = await client.searchNearby({
          location: args.location,
          radius: args.radius,
          maxResultCount: args.max_results,
          rankPreference: 'DISTANCE',
          languageCode: args.language,
        });
        places = result.places ?? [];
      }

      // Filter by open_now if needed (for nearby search, API doesn't have this filter)
      if (args.open_now && !useTextSearch) {
        places = places.filter((p) => p.currentOpeningHours?.openNow === true);
      }

      // Sort by rating if requested
      if (args.sort_by === 'rating') {
        places.sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
      }

      // Format results
      const formattedPlaces = places.map((p) => formatPlace(p, args.location));

      if (places.length === 0) {
        const searchType = useTextSearch
          ? `"${args.query}"`
          : (args.types?.join(', ') ?? 'places');
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

      const lines: string[] = [];
      const searchDesc = useTextSearch
        ? `Results for "${args.query}"`
        : args.types?.length
          ? `${args.types.join(', ')} nearby`
          : 'Places nearby';

      lines.push(`${searchDesc} (${places.length} found):\n`);
      lines.push(...formattedPlaces.map((p) => p.text));

      return {
        content: [{ type: 'text', text: lines.join('\n') }],
        structuredContent: {
          places: formattedPlaces.map((p) => p.data),
          query: args.query,
          types: args.types,
          location: args.location,
          radius: args.radius,
        },
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Failed to search places: ${(error as Error).message}`,
          },
        ],
      };
    }
  },
});
