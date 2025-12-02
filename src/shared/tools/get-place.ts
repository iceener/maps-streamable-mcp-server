/**
 * Get Place tool - get detailed information about a specific place.
 */

import { z } from 'zod';
import { toolsMetadata } from '../../config/metadata.js';
import {
  GoogleMapsClient,
  type Photo,
  PLACE_FIELDS,
  type Place,
  type Review,
} from '../../services/google-maps.js';
import { defineTool, type ToolResult } from './types.js';

const FieldCategory = z.enum(['basic', 'contact', 'hours', 'reviews', 'photos']);

const InputSchema = z.object({
  place_id: z.string().describe('Place ID from search_places results'),
  fields: z
    .array(FieldCategory)
    .optional()
    .default(['basic', 'hours'])
    .describe(
      'Information to include: basic (name, address, rating), contact (phone, website), hours (opening hours), reviews (user reviews), photos (photo URLs)',
    ),
  language: z
    .string()
    .optional()
    .default('en')
    .describe('Language code (e.g., "en", "pl", "de")'),
  max_photos: z
    .number()
    .int()
    .min(1)
    .max(10)
    .optional()
    .default(3)
    .describe('Maximum photos to return'),
  max_reviews: z
    .number()
    .int()
    .min(1)
    .max(5)
    .optional()
    .default(3)
    .describe('Maximum reviews to return'),
});

function formatOpeningHours(hours: Place['regularOpeningHours']): string[] {
  if (!hours?.weekdayDescriptions) return [];
  return hours.weekdayDescriptions;
}

function formatReview(review: Review): { text: string; data: Record<string, unknown> } {
  const author = review.authorAttribution.displayName;
  const rating = '★'.repeat(Math.round(review.rating));
  const time = review.relativePublishTimeDescription ?? '';
  const text = review.text?.text ?? review.originalText?.text ?? '';

  const formatted = `${author} ${rating} (${time})\n  "${text.slice(0, 200)}${text.length > 200 ? '...' : ''}"`;

  return {
    text: formatted,
    data: {
      author: review.authorAttribution.displayName,
      author_uri: review.authorAttribution.uri,
      rating: review.rating,
      text: review.text?.text ?? review.originalText?.text,
      publish_time: review.publishTime,
      relative_time: review.relativePublishTimeDescription,
    },
  };
}

function formatPhoto(
  photo: Photo,
  client: GoogleMapsClient,
  maxWidth: number,
): { text: string; data: Record<string, unknown> } {
  const uri = client.getPhotoUri(photo.name, maxWidth);
  const attribution = photo.authorAttributions?.[0]?.displayName ?? 'Unknown';

  return {
    text: `- ${uri} (by ${attribution})`,
    data: {
      uri,
      width: photo.widthPx,
      height: photo.heightPx,
      attribution,
      google_maps_uri: photo.googleMapsUri,
    },
  };
}

function formatPriceLevel(priceLevel?: string): string {
  const levels: Record<string, string> = {
    PRICE_LEVEL_FREE: 'Free',
    PRICE_LEVEL_INEXPENSIVE: '$',
    PRICE_LEVEL_MODERATE: '$$',
    PRICE_LEVEL_EXPENSIVE: '$$$',
    PRICE_LEVEL_VERY_EXPENSIVE: '$$$$',
  };
  return levels[priceLevel ?? ''] ?? 'N/A';
}

export const getPlaceTool = defineTool({
  name: toolsMetadata.get_place.name,
  title: toolsMetadata.get_place.title,
  description: toolsMetadata.get_place.description,
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
      // Build field list based on requested categories
      const allFields: string[] = [];
      for (const category of args.fields) {
        const categoryFields = PLACE_FIELDS[category as keyof typeof PLACE_FIELDS];
        if (categoryFields) {
          allFields.push(...categoryFields);
        }
      }

      // Always include ID
      if (!allFields.includes('id')) {
        allFields.unshift('id');
      }

      const place = await client.getPlaceDetails({
        placeId: args.place_id,
        fields: allFields,
        languageCode: args.language,
      });

      // Format output
      const lines: string[] = [];
      const structuredData: Record<string, unknown> = { id: place.id };

      // Basic info
      if (args.fields.includes('basic')) {
        const name = place.displayName?.text ?? 'Unknown';
        lines.push(`# ${name}`);

        if (place.formattedAddress) {
          lines.push(`📍 ${place.formattedAddress}`);
          structuredData.address = place.formattedAddress;
        }

        if (place.rating) {
          const ratingStars =
            '★'.repeat(Math.round(place.rating)) +
            '☆'.repeat(5 - Math.round(place.rating));
          lines.push(
            `${ratingStars} ${place.rating.toFixed(1)} (${place.userRatingCount ?? 0} reviews)`,
          );
          structuredData.rating = place.rating;
          structuredData.user_rating_count = place.userRatingCount;
        }

        if (place.priceLevel) {
          lines.push(`💰 ${formatPriceLevel(place.priceLevel)}`);
          structuredData.price_level = place.priceLevel;
        }

        if (place.primaryType) {
          structuredData.primary_type = place.primaryType;
        }
        if (place.types) {
          structuredData.types = place.types;
        }
        if (place.location) {
          structuredData.location = place.location;
        }

        if (place.editorialSummary?.text) {
          lines.push('');
          lines.push(`"${place.editorialSummary.text}"`);
          structuredData.editorial_summary = place.editorialSummary.text;
        }

        if (place.googleMapsUri) {
          structuredData.google_maps_uri = place.googleMapsUri;
        }

        lines.push('');
      }

      // Contact info
      if (args.fields.includes('contact')) {
        if (place.internationalPhoneNumber || place.nationalPhoneNumber) {
          lines.push(
            `📞 ${place.internationalPhoneNumber ?? place.nationalPhoneNumber}`,
          );
          structuredData.phone =
            place.internationalPhoneNumber ?? place.nationalPhoneNumber;
        }

        if (place.websiteUri) {
          lines.push(`🌐 ${place.websiteUri}`);
          structuredData.website = place.websiteUri;
        }

        if (place.googleMapsUri) {
          lines.push(`🗺️ ${place.googleMapsUri}`);
        }

        lines.push('');
      }

      // Hours
      if (args.fields.includes('hours')) {
        const openNow = place.currentOpeningHours?.openNow;
        if (openNow !== undefined) {
          lines.push(openNow ? '🟢 Currently OPEN' : '🔴 Currently CLOSED');
          structuredData.open_now = openNow;
        }

        if (place.businessStatus) {
          structuredData.business_status = place.businessStatus;
          if (place.businessStatus !== 'OPERATIONAL') {
            lines.push(`⚠️ Status: ${place.businessStatus.replace(/_/g, ' ')}`);
          }
        }

        const hours = formatOpeningHours(place.regularOpeningHours);
        if (hours.length > 0) {
          lines.push('');
          lines.push('**Opening Hours:**');
          hours.forEach((h) => lines.push(`  ${h}`));
          structuredData.opening_hours = hours;
        }

        lines.push('');
      }

      // Reviews
      if (args.fields.includes('reviews') && place.reviews?.length) {
        const reviewsToShow = place.reviews.slice(0, args.max_reviews);
        const formattedReviews = reviewsToShow.map((r) => formatReview(r));

        lines.push('**Reviews:**');
        formattedReviews.forEach((r) => lines.push(r.text));
        lines.push('');

        structuredData.reviews = formattedReviews.map((r) => r.data);
      }

      // Photos
      if (args.fields.includes('photos') && place.photos?.length) {
        const photosToShow = place.photos.slice(0, args.max_photos);
        const formattedPhotos = photosToShow.map((p) => formatPhoto(p, client, 800));

        lines.push('**Photos:**');
        formattedPhotos.forEach((p) => lines.push(p.text));
        lines.push('');

        structuredData.photos = formattedPhotos.map((p) => p.data);
      }

      return {
        content: [{ type: 'text', text: lines.join('\n').trim() }],
        structuredContent: structuredData,
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Failed to get place details: ${(error as Error).message}`,
          },
        ],
      };
    }
  },
});
