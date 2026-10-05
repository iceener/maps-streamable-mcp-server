import * as z from 'zod/v4';
import { defineTool, toolError } from '../platform/primitives';
import {
  GoogleMapsError,
  type GoogleMapsService,
  type Photo,
  PLACE_FIELDS,
  type Place,
  type Review,
} from '../services/google-maps';

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
  language: z.string().optional().default('en').describe('Language code (e.g., "en", "pl", "de")'),
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

/** Width asked for each photo. Google scales the image down to fit. */
const PHOTO_WIDTH_PX = 800;

/**
 * Place Details for the requested field categories. Photo URLs are resolved on the server
 * through the Place Photos media endpoint, so no result ever contains the API key.
 */
export const getPlace = defineTool(
  'get_place',
  {
    description: `Get detailed information about a specific place by ID.

INPUTS:
- place_id: string (REQUIRED) — from search_places results
- fields?: ["basic"|"contact"|"hours"|"reviews"|"photos"] — what to include (default: ["basic", "hours"])
- language?: string — language code (default: "en")
- max_photos?: number — 1-10 (default: 3)
- max_reviews?: number — 1-5 (default: 3)

FIELD CATEGORIES:
- basic: name, address, rating, price level, types, location, google_maps_uri
- contact: phone, website
- hours: opening hours, open now status, business status
- reviews: user reviews with ratings
- photos: photo URLs with attributions

RETURNS based on requested fields:
- Basic: id, name, address, rating, user_rating_count, price_level, types
- Contact: phone, website, google_maps_uri
- Hours: open_now, business_status, opening_hours (by day)
- Reviews: array of { author, rating, text, relative_time }
- Photos: array of { uri, width, height, attribution }

EXAMPLES:
- Quick check if open: { place_id: "...", fields: ["hours"] }
- Full info: { place_id: "...", fields: ["basic", "contact", "hours", "reviews"] }
- Get photos: { place_id: "...", fields: ["photos"], max_photos: 5 }`,
    inputSchema: InputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  },
  async (args, ctx, { maps, logger }) => {
    const { signal } = ctx.mcpReq;
    const fields = [
      ...new Set(['id', ...args.fields.flatMap((category) => PLACE_FIELDS[category])]),
    ];

    let place: Place;
    let photos: FormattedPhoto[] = [];
    try {
      place = await maps.getPlace(
        { placeId: args.place_id, fields, languageCode: args.language },
        signal,
      );
      if (args.fields.includes('photos') && place.photos?.length) {
        photos = await Promise.all(
          place.photos.slice(0, args.max_photos).map((photo) => formatPhoto(photo, maps, signal)),
        );
      }
    } catch (error) {
      if (error instanceof GoogleMapsError) {
        logger.warning('Google Maps request failed', { tool: 'get_place', error });
        return toolError(`Failed to get place details: ${error.message}`);
      }
      throw error;
    }

    const lines: string[] = [];
    const structured: Record<string, unknown> = { id: place.id };

    if (args.fields.includes('basic')) {
      lines.push(`# ${place.displayName?.text ?? 'Unknown'}`);
      if (place.formattedAddress) {
        lines.push(`📍 ${place.formattedAddress}`);
        structured.address = place.formattedAddress;
      }
      if (place.rating) {
        const stars = Math.round(place.rating);
        lines.push(
          `${'★'.repeat(stars)}${'☆'.repeat(5 - stars)} ${place.rating.toFixed(1)} (${place.userRatingCount ?? 0} reviews)`,
        );
        structured.rating = place.rating;
        structured.user_rating_count = place.userRatingCount;
      }
      if (place.priceLevel) {
        lines.push(`💰 ${PRICE_LEVELS[place.priceLevel] ?? 'N/A'}`);
        structured.price_level = place.priceLevel;
      }
      if (place.primaryType) structured.primary_type = place.primaryType;
      if (place.types) structured.types = place.types;
      if (place.location) structured.location = place.location;
      if (place.editorialSummary?.text) {
        lines.push('', `"${place.editorialSummary.text}"`);
        structured.editorial_summary = place.editorialSummary.text;
      }
      if (place.googleMapsUri) structured.google_maps_uri = place.googleMapsUri;
      lines.push('');
    }

    if (args.fields.includes('contact')) {
      const phone = place.internationalPhoneNumber ?? place.nationalPhoneNumber;
      if (phone) {
        lines.push(`📞 ${phone}`);
        structured.phone = phone;
      }
      if (place.websiteUri) {
        lines.push(`🌐 ${place.websiteUri}`);
        structured.website = place.websiteUri;
      }
      if (place.googleMapsUri) lines.push(`🗺️ ${place.googleMapsUri}`);
      lines.push('');
    }

    if (args.fields.includes('hours')) {
      const openNow = place.currentOpeningHours?.openNow;
      if (openNow !== undefined) {
        lines.push(openNow ? '🟢 Currently OPEN' : '🔴 Currently CLOSED');
        structured.open_now = openNow;
      }
      if (place.businessStatus) {
        structured.business_status = place.businessStatus;
        if (place.businessStatus !== 'OPERATIONAL') {
          lines.push(`⚠️ Status: ${place.businessStatus.replace(/_/g, ' ')}`);
        }
      }
      const hours = place.regularOpeningHours?.weekdayDescriptions ?? [];
      if (hours.length > 0) {
        lines.push('', '**Opening Hours:**', ...hours.map((hour) => `  ${hour}`));
        structured.opening_hours = hours;
      }
      lines.push('');
    }

    if (args.fields.includes('reviews') && place.reviews?.length) {
      const reviews = place.reviews.slice(0, args.max_reviews).map(formatReview);
      lines.push('**Reviews:**', ...reviews.map((review) => review.text), '');
      structured.reviews = reviews.map((review) => review.data);
    }

    if (photos.length > 0) {
      lines.push('**Photos:**', ...photos.map((photo) => photo.text), '');
      structured.photos = photos.map((photo) => photo.data);
    }

    return {
      content: [{ type: 'text', text: lines.join('\n').trim() }],
      structuredContent: structured,
    };
  },
);

const PRICE_LEVELS: Record<string, string> = {
  PRICE_LEVEL_FREE: 'Free',
  PRICE_LEVEL_INEXPENSIVE: '$',
  PRICE_LEVEL_MODERATE: '$$',
  PRICE_LEVEL_EXPENSIVE: '$$$',
  PRICE_LEVEL_VERY_EXPENSIVE: '$$$$',
};

function formatReview(review: Review) {
  const author = review.authorAttribution.displayName;
  const text = review.text?.text ?? review.originalText?.text ?? '';
  return {
    text:
      `${author} ${'★'.repeat(Math.round(review.rating))} (${review.relativePublishTimeDescription ?? ''})\n` +
      `  "${text.slice(0, 200)}${text.length > 200 ? '...' : ''}"`,
    data: {
      author,
      author_uri: review.authorAttribution.uri,
      rating: review.rating,
      text: review.text?.text ?? review.originalText?.text,
      publish_time: review.publishTime,
      relative_time: review.relativePublishTimeDescription,
    },
  };
}

type FormattedPhoto = Awaited<ReturnType<typeof formatPhoto>>;

async function formatPhoto(photo: Photo, maps: GoogleMapsService, signal: AbortSignal) {
  const uri = await maps.getPhotoUri(photo.name, { maxWidth: PHOTO_WIDTH_PX }, signal);
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
