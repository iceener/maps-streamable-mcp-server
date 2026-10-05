import * as z from 'zod/v4';

/**
 * Google Maps Platform client: Places API (New) and Routes API.
 *
 * Services know nothing about MCP. They take an `AbortSignal` so a cancelled tool call stops
 * its upstream requests, check the shape of every response, and throw `GoogleMapsError` when
 * Google refuses a request or does not answer. The API key comes from `src/settings.ts`, never
 * from the caller: it travels only in the `X-Goog-Api-Key` header to Google, and it is removed
 * from every error message this client produces.
 */
export interface GoogleMapsService {
  searchNearby(params: SearchNearbyParams, signal: AbortSignal): Promise<Place[]>;
  searchText(params: TextSearchParams, signal: AbortSignal): Promise<Place[]>;
  getPlace(params: PlaceDetailsParams, signal: AbortSignal): Promise<Place>;
  /**
   * A public HTTPS URL for a place photo, resolved through the Place Photos media endpoint.
   * The URL never carries the API key.
   */
  getPhotoUri(photoName: string, size: PhotoSize, signal: AbortSignal): Promise<string>;
  computeRoutes(params: ComputeRoutesParams, signal: AbortSignal): Promise<Route[]>;
  computeRouteMatrix(
    params: ComputeRouteMatrixParams,
    signal: AbortSignal,
  ): Promise<RouteMatrixElement[]>;
}

/**
 * Google refused the request, did not answer in time, or sent something unusable. The message
 * is safe to show to the model: it never contains the API key.
 */
export class GoogleMapsError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'GoogleMapsError';
  }
}

export interface GoogleMapsServiceOptions {
  apiKey: string;
  /** Tests only: a loopback origin that stands in for both Google API hosts. */
  origin?: string | undefined;
  /** Injected in tests. Defaults to the runtime's `fetch`. */
  fetch?: typeof fetch;
  /** Upper bound per request, including reading the response, on top of cancellation. */
  timeoutMs?: number;
}

// ============================================================================
// Types: locations and places
// ============================================================================

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface Circle {
  center: LatLng;
  /** Meters. */
  radius: number;
}

export type Waypoint = LatLng | { placeId: string } | { address: string };

export interface Place {
  id: string;
  displayName?: { text: string; languageCode: string };
  formattedAddress?: string;
  shortFormattedAddress?: string;
  location?: LatLng;
  rating?: number;
  userRatingCount?: number;
  priceLevel?:
    | 'PRICE_LEVEL_FREE'
    | 'PRICE_LEVEL_INEXPENSIVE'
    | 'PRICE_LEVEL_MODERATE'
    | 'PRICE_LEVEL_EXPENSIVE'
    | 'PRICE_LEVEL_VERY_EXPENSIVE';
  types?: string[];
  primaryType?: string;
  primaryTypeDisplayName?: { text: string; languageCode: string };
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  googleMapsUri?: string;
  businessStatus?: 'OPERATIONAL' | 'CLOSED_TEMPORARILY' | 'CLOSED_PERMANENTLY';
  regularOpeningHours?: OpeningHours;
  currentOpeningHours?: OpeningHours;
  editorialSummary?: { text: string; languageCode: string };
  reviews?: Review[];
  photos?: Photo[];
  addressComponents?: AddressComponent[];
  plusCode?: { globalCode: string; compoundCode?: string };
}

export interface OpeningHours {
  openNow?: boolean;
  periods?: OpeningPeriod[];
  weekdayDescriptions?: string[];
}

export interface OpeningPeriod {
  open: { day: number; hour: number; minute: number };
  close?: { day: number; hour: number; minute: number };
}

export interface Review {
  name: string;
  rating: number;
  text?: { text: string; languageCode: string };
  originalText?: { text: string; languageCode: string };
  authorAttribution: { displayName: string; uri?: string; photoUri?: string };
  publishTime: string;
  relativePublishTimeDescription?: string;
}

export interface Photo {
  name: string;
  widthPx: number;
  heightPx: number;
  authorAttributions: Array<{ displayName: string; uri?: string; photoUri?: string }>;
  googleMapsUri?: string;
}

export interface AddressComponent {
  longText: string;
  shortText: string;
  types: string[];
  languageCode: string;
}

// ============================================================================
// Types: routes
// ============================================================================

export interface Route {
  distanceMeters: number;
  /** For example "1234s". */
  duration: string;
  staticDuration?: string;
  polyline?: { encodedPolyline: string };
  description?: string;
  warnings?: string[];
  legs: RouteLeg[];
  localizedValues?: {
    distance?: { text: string };
    duration?: { text: string };
    staticDuration?: { text: string };
  };
}

export interface RouteLeg {
  distanceMeters: number;
  duration: string;
  staticDuration?: string;
  polyline?: { encodedPolyline: string };
  startLocation?: { latLng: LatLng };
  endLocation?: { latLng: LatLng };
  steps?: RouteStep[];
  localizedValues?: {
    distance?: { text: string };
    duration?: { text: string };
  };
}

export interface RouteStep {
  distanceMeters: number;
  staticDuration: string;
  polyline?: { encodedPolyline: string };
  startLocation?: { latLng: LatLng };
  endLocation?: { latLng: LatLng };
  navigationInstruction?: {
    maneuver?: string;
    instructions?: string;
  };
  localizedValues?: {
    distance?: { text: string };
    staticDuration?: { text: string };
  };
  travelMode?: string;
  transitDetails?: TransitDetails;
}

export interface TransitDetails {
  stopDetails?: {
    arrivalStop?: { name: string; location?: LatLng };
    departureStop?: { name: string; location?: LatLng };
    arrivalTime?: string;
    departureTime?: string;
  };
  transitLine?: {
    name?: string;
    shortName?: string;
    color?: string;
    textColor?: string;
    vehicle?: { type: string; name?: { text: string } };
  };
  headsign?: string;
  stopCount?: number;
}

export interface RouteMatrixElement {
  originIndex?: number;
  destinationIndex?: number;
  status?: { code: number; message: string };
  condition?: 'ROUTE_EXISTS' | 'ROUTE_NOT_FOUND';
  distanceMeters?: number;
  duration?: string;
  staticDuration?: string;
  localizedValues?: {
    distance?: { text: string };
    duration?: { text: string };
  };
}

// ============================================================================
// Request parameters
// ============================================================================

export type TravelMode = 'WALK' | 'DRIVE' | 'BICYCLE' | 'TRANSIT' | 'TWO_WHEELER';

export interface SearchNearbyParams {
  location: LatLng;
  radius: number;
  includedTypes?: string[] | undefined;
  maxResultCount?: number;
  rankPreference?: 'DISTANCE' | 'POPULARITY';
  languageCode?: string;
}

export interface TextSearchParams {
  textQuery: string;
  locationBias?: LatLng | Circle;
  openNow?: boolean;
  minRating?: number | undefined;
  priceLevels?: string[] | undefined;
  maxResultCount?: number;
  rankPreference?: 'DISTANCE' | 'RELEVANCE';
  languageCode?: string;
}

export interface PlaceDetailsParams {
  placeId: string;
  /** Place fields without the `places.` prefix, for example `displayName`. */
  fields: string[];
  languageCode?: string;
}

export interface PhotoSize {
  maxWidth: number;
  maxHeight?: number;
}

export interface ComputeRoutesParams {
  origin: Waypoint;
  destination: Waypoint;
  travelMode: TravelMode;
  departureTime?: string | undefined;
  routeModifiers?:
    | {
        avoidTolls?: boolean;
        avoidHighways?: boolean;
        avoidFerries?: boolean;
      }
    | undefined;
  languageCode?: string;
}

export interface ComputeRouteMatrixParams {
  origins: Waypoint[];
  destinations: Waypoint[];
  travelMode: TravelMode;
  departureTime?: string | undefined;
  languageCode?: string;
}

// ============================================================================
// Field masks
// ============================================================================

export const PLACE_FIELDS = {
  basic: [
    'id',
    'displayName',
    'formattedAddress',
    'shortFormattedAddress',
    'location',
    'types',
    'primaryType',
    'primaryTypeDisplayName',
  ],
  rating: ['rating', 'userRatingCount', 'priceLevel'],
  contact: ['nationalPhoneNumber', 'internationalPhoneNumber', 'websiteUri', 'googleMapsUri'],
  hours: ['regularOpeningHours', 'currentOpeningHours', 'businessStatus'],
  reviews: ['reviews'],
  photos: ['photos'],
  editorial: ['editorialSummary'],
  address: ['addressComponents', 'plusCode'],
} as const;

/** The search field mask: `places.<field>` for every field in the categories. */
function searchFieldMask(categories: Array<keyof typeof PLACE_FIELDS>): string {
  return [...new Set(categories.flatMap((category) => PLACE_FIELDS[category]))]
    .map((field) => `places.${field}`)
    .join(',');
}

const ROUTE_FIELD_MASK = [
  'routes.distanceMeters',
  'routes.duration',
  'routes.polyline.encodedPolyline',
  'routes.legs.distanceMeters',
  'routes.legs.duration',
  'routes.legs.startLocation',
  'routes.legs.endLocation',
  'routes.legs.steps.distanceMeters',
  'routes.legs.steps.staticDuration',
  'routes.legs.steps.navigationInstruction',
  'routes.legs.steps.travelMode',
  'routes.legs.steps.transitDetails',
  'routes.localizedValues',
  'routes.legs.localizedValues',
  'routes.legs.steps.localizedValues',
].join(',');

const MATRIX_FIELD_MASK =
  'originIndex,destinationIndex,status,condition,distanceMeters,duration,staticDuration,localizedValues';

// ============================================================================
// Response shapes. Only what the tools rely on is checked; Google adds fields over time.
// ============================================================================

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const PlaceShape = z.custom<Place>((value) => isObject(value) && typeof value.id === 'string');
const PlacesResponse = z.looseObject({ places: z.array(PlaceShape).optional() });
const RoutesResponse = z.looseObject({ routes: z.array(z.custom<Route>(isObject)).optional() });
const MatrixResponse = z.array(z.custom<RouteMatrixElement>(isObject));
const PhotoMediaResponse = z.looseObject({ photoUri: z.unknown() });
const ErrorResponse = z.object({ error: z.object({ message: z.string().optional() }) });

const PHOTO_NAME = /^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/;
const MAX_PHOTO_PX = 4800;

// ============================================================================
// Client
// ============================================================================

export function createGoogleMapsService(options: GoogleMapsServiceOptions): GoogleMapsService {
  const fetchImpl = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;
  const places = `${options.origin ?? 'https://places.googleapis.com'}/v1`;
  const routes = options.origin ?? 'https://routes.googleapis.com';
  const secrets = [options.apiKey, encodeURIComponent(options.apiKey)].filter(Boolean);

  /** Provider messages may echo the request, key included. Never pass the key on. */
  const redact = (message: string) =>
    secrets.reduce((text, secret) => text.split(secret).join('[redacted]'), message);

  async function request<T>(
    url: string,
    init: { method: 'GET' | 'POST'; body?: unknown; fieldMask?: string },
    schema: z.ZodType<T>,
    signal: AbortSignal,
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': options.apiKey,
    };
    if (init.fieldMask) headers['X-Goog-FieldMask'] = init.fieldMask;

    let body: unknown;
    try {
      const response = await fetchImpl(url, {
        method: init.method,
        headers,
        ...(init.body !== undefined && { body: JSON.stringify(init.body) }),
        // Never follow a redirect: fetch would resend X-Goog-Api-Key to wherever it points.
        // Workers reject `redirect: 'error'`, so a 3xx is refused below like any error status.
        redirect: 'manual',
        signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
      });
      if (!response.ok) {
        const detail = ErrorResponse.safeParse(await response.json().catch(() => undefined));
        const message = detail.success ? detail.data.error.message : undefined;
        throw new GoogleMapsError(
          redact(
            `Google Maps API error: ${response.status} ${response.statusText}` +
              (message ? ` - ${message}` : ''),
          ),
          response.status,
        );
      }
      body = await response.json();
    } catch (error) {
      // Cancelled by the caller, or already classified: pass it on unchanged.
      if (signal.aborted || error instanceof GoogleMapsError) throw error;
      // A network failure, a timeout, or a body cut off or garbled in transit.
      throw new GoogleMapsError(
        'Google Maps did not respond in time, or the response was cut off',
        undefined,
        {
          cause: error,
        },
      );
    }
    // A complete response in an unexpected shape is a bug to fix, not an outage: let it throw.
    return schema.parse(body);
  }

  return {
    async searchNearby(params, signal) {
      const { places: found = [] } = await request(
        `${places}/places:searchNearby`,
        {
          method: 'POST',
          body: {
            locationRestriction: { circle: { center: params.location, radius: params.radius } },
            maxResultCount: params.maxResultCount ?? 10,
            rankPreference: params.rankPreference ?? 'DISTANCE',
            languageCode: params.languageCode ?? 'en',
            ...(params.includedTypes?.length ? { includedTypes: params.includedTypes } : {}),
          },
          fieldMask: searchFieldMask(['basic', 'rating', 'hours']),
        },
        PlacesResponse,
        signal,
      );
      return found;
    },

    async searchText(params, signal) {
      const bias = params.locationBias;
      const { places: found = [] } = await request(
        `${places}/places:searchText`,
        {
          method: 'POST',
          body: {
            textQuery: params.textQuery,
            maxResultCount: params.maxResultCount ?? 10,
            languageCode: params.languageCode ?? 'en',
            // A bare point is biased to a 5 km circle around it.
            ...(bias && {
              locationBias: { circle: 'radius' in bias ? bias : { center: bias, radius: 5000 } },
            }),
            ...(params.openNow !== undefined && { openNow: params.openNow }),
            ...(params.minRating !== undefined && { minRating: params.minRating }),
            ...(params.priceLevels?.length ? { priceLevels: params.priceLevels } : {}),
            ...(params.rankPreference && { rankPreference: params.rankPreference }),
          },
          fieldMask: searchFieldMask(['basic', 'rating', 'hours']),
        },
        PlacesResponse,
        signal,
      );
      return found;
    },

    async getPlace(params, signal) {
      return request(
        `${places}/places/${params.placeId}`,
        { method: 'GET', fieldMask: params.fields.join(',') },
        PlaceShape,
        signal,
      );
    },

    async getPhotoUri(photoName, { maxWidth, maxHeight }, signal) {
      if (!PHOTO_NAME.test(photoName)) {
        throw new GoogleMapsError('Invalid Google photo resource name');
      }
      for (const dimension of [maxWidth, maxHeight]) {
        if (
          dimension !== undefined &&
          (!Number.isInteger(dimension) || dimension < 1 || dimension > MAX_PHOTO_PX)
        ) {
          throw new GoogleMapsError(
            `Photo dimensions must be integers between 1 and ${MAX_PHOTO_PX}`,
          );
        }
      }
      // Ask for the media URL as JSON instead of following Google's redirect. The key stays in
      // the request header, and never reaches a URL the model or the user can see.
      const query = new URLSearchParams({
        maxWidthPx: String(maxWidth),
        skipHttpRedirect: 'true',
      });
      if (maxHeight !== undefined) query.set('maxHeightPx', String(maxHeight));
      const { photoUri } = await request(
        `${places}/${photoName}/media?${query}`,
        { method: 'GET' },
        PhotoMediaResponse,
        signal,
      );
      if (!isSafePhotoUrl(photoUri, secrets)) {
        throw new GoogleMapsError('Google returned an invalid photo URL');
      }
      return new URL(photoUri).href;
    },

    async computeRoutes(params, signal) {
      const waypoint = (point: Waypoint) =>
        'latitude' in point
          ? { location: { latLng: point } }
          : 'placeId' in point
            ? { placeId: point.placeId }
            : { address: point.address };

      const { routes: found = [] } = await request(
        `${routes}/directions/v2:computeRoutes`,
        {
          method: 'POST',
          body: {
            origin: waypoint(params.origin),
            destination: waypoint(params.destination),
            travelMode: params.travelMode,
            languageCode: params.languageCode ?? 'en',
            ...departure(params.travelMode, params.departureTime),
            ...(params.routeModifiers && { routeModifiers: params.routeModifiers }),
          },
          fieldMask: ROUTE_FIELD_MASK,
        },
        RoutesResponse,
        signal,
      );
      return found;
    },

    async computeRouteMatrix(params, signal) {
      const waypoint = (point: Waypoint) => ({
        waypoint:
          'latitude' in point
            ? { location: { latLng: point } }
            : 'placeId' in point
              ? { placeId: point.placeId }
              : { address: point.address },
      });

      return request(
        `${routes}/distanceMatrix/v2:computeRouteMatrix`,
        {
          method: 'POST',
          body: {
            origins: params.origins.map(waypoint),
            destinations: params.destinations.map(waypoint),
            travelMode: params.travelMode,
            languageCode: params.languageCode ?? 'en',
            ...departure(params.travelMode, params.departureTime),
          },
          fieldMask: MATRIX_FIELD_MASK,
        },
        MatrixResponse,
        signal,
      );
    },
  };
}

/** A departure time needs traffic-aware routing, except for transit, which has none. */
function departure(mode: TravelMode, departureTime: string | undefined) {
  if (!departureTime) return {};
  return {
    departureTime,
    ...(mode !== 'TRANSIT' && { routingPreference: 'TRAFFIC_AWARE_OPTIMAL' }),
  };
}

/** Only plain HTTPS URLs that carry no credentials, and never the API key itself. */
function isSafePhotoUrl(value: unknown, secrets: string[]): value is string {
  if (typeof value !== 'string' || !URL.canParse(value)) return false;
  const url = new URL(value);
  return (
    url.protocol === 'https:' &&
    !url.username &&
    !url.password &&
    !url.hash &&
    ![...url.searchParams.keys()].some((name) => /^(key|api_key)$/i.test(name)) &&
    !secrets.some((secret) => url.href.includes(secret))
  );
}
