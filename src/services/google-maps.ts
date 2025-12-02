/**
 * Google Maps Platform API client.
 * Supports Places API (New) and Routes API.
 */

import { logger } from '../utils/logger.js';

const PLACES_API_BASE = 'https://places.googleapis.com/v1';
const ROUTES_COMPUTE_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';
const ROUTES_MATRIX_URL =
  'https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix';

// ============================================================================
// Types - Location
// ============================================================================

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface Circle {
  center: LatLng;
  radius: number; // meters
}

// ============================================================================
// Types - Places
// ============================================================================

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
// Types - Routes
// ============================================================================

export interface Route {
  distanceMeters: number;
  duration: string; // e.g., "1234s"
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
  originIndex: number;
  destinationIndex: number;
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
// Request Parameters
// ============================================================================

export interface SearchNearbyParams {
  location: LatLng;
  radius: number;
  includedTypes?: string[];
  excludedTypes?: string[];
  maxResultCount?: number;
  rankPreference?: 'DISTANCE' | 'POPULARITY';
  languageCode?: string;
}

export interface TextSearchParams {
  textQuery: string;
  locationBias?: LatLng | Circle;
  includedType?: string;
  openNow?: boolean;
  minRating?: number;
  priceLevels?: string[];
  maxResultCount?: number;
  rankPreference?: 'DISTANCE' | 'RELEVANCE';
  languageCode?: string;
}

export interface PlaceDetailsParams {
  placeId: string;
  fields: string[];
  languageCode?: string;
}

export interface ComputeRoutesParams {
  origin: LatLng | { placeId: string } | { address: string };
  destination: LatLng | { placeId: string } | { address: string };
  intermediates?: Array<LatLng | { placeId: string } | { address: string }>;
  travelMode: 'WALK' | 'DRIVE' | 'BICYCLE' | 'TRANSIT' | 'TWO_WHEELER';
  departureTime?: string;
  computeAlternativeRoutes?: boolean;
  routeModifiers?: {
    avoidTolls?: boolean;
    avoidHighways?: boolean;
    avoidFerries?: boolean;
  };
  languageCode?: string;
}

export interface ComputeRouteMatrixParams {
  origins: Array<LatLng | { placeId: string } | { address: string }>;
  destinations: Array<LatLng | { placeId: string } | { address: string }>;
  travelMode: 'WALK' | 'DRIVE' | 'BICYCLE' | 'TRANSIT' | 'TWO_WHEELER';
  departureTime?: string;
  languageCode?: string;
}

// ============================================================================
// Field Masks
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
  contact: [
    'nationalPhoneNumber',
    'internationalPhoneNumber',
    'websiteUri',
    'googleMapsUri',
  ],
  hours: ['regularOpeningHours', 'currentOpeningHours', 'businessStatus'],
  reviews: ['reviews'],
  photos: ['photos'],
  editorial: ['editorialSummary'],
  address: ['addressComponents', 'plusCode'],
} as const;

export function buildFieldMask(categories: string[]): string {
  const fields = new Set<string>();
  for (const cat of categories) {
    const categoryFields = PLACE_FIELDS[cat as keyof typeof PLACE_FIELDS];
    if (categoryFields) {
      for (const field of categoryFields) {
        fields.add(`places.${field}`);
      }
    }
  }
  return Array.from(fields).join(',');
}

// ============================================================================
// Client
// ============================================================================

export class GoogleMapsClient {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  private async request<T>(
    baseUrl: string,
    path: string,
    options: RequestInit & { fieldMask?: string } = {},
  ): Promise<T> {
    const url = `${baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': this.apiKey,
      ...(options.headers as Record<string, string>),
    };

    if (options.fieldMask) {
      headers['X-Goog-FieldMask'] = options.fieldMask;
    }

    try {
      const response = await fetch(url, {
        ...options,
        headers,
      });

      if (!response.ok) {
        let errorMessage = `Google Maps API error: ${response.status} ${response.statusText}`;
        try {
          const errorData = (await response.json()) as {
            error?: { message?: string; status?: string };
          };
          if (errorData.error?.message) {
            errorMessage += ` - ${errorData.error.message}`;
          }
        } catch {
          // Ignore JSON parse error
        }
        throw new Error(errorMessage);
      }

      return (await response.json()) as T;
    } catch (error) {
      logger.error('google-maps-client', {
        message: 'Request failed',
        url,
        error: (error as Error).message,
      });
      throw error;
    }
  }

  // --------------------------------------------------------------------------
  // Places - Search Nearby
  // --------------------------------------------------------------------------

  async searchNearby(params: SearchNearbyParams): Promise<{ places: Place[] }> {
    const body: Record<string, unknown> = {
      locationRestriction: {
        circle: {
          center: params.location,
          radius: params.radius,
        },
      },
      maxResultCount: params.maxResultCount ?? 10,
      rankPreference: params.rankPreference ?? 'DISTANCE',
      languageCode: params.languageCode ?? 'en',
    };

    if (params.includedTypes?.length) {
      body.includedTypes = params.includedTypes;
    }
    if (params.excludedTypes?.length) {
      body.excludedTypes = params.excludedTypes;
    }

    const fieldMask = buildFieldMask(['basic', 'rating', 'hours']);

    return this.request(PLACES_API_BASE, '/places:searchNearby', {
      method: 'POST',
      body: JSON.stringify(body),
      fieldMask,
    });
  }

  // --------------------------------------------------------------------------
  // Places - Text Search
  // --------------------------------------------------------------------------

  async textSearch(params: TextSearchParams): Promise<{ places: Place[] }> {
    const body: Record<string, unknown> = {
      textQuery: params.textQuery,
      maxResultCount: params.maxResultCount ?? 10,
      languageCode: params.languageCode ?? 'en',
    };

    if (params.locationBias) {
      if ('radius' in params.locationBias) {
        body.locationBias = { circle: params.locationBias };
      } else {
        body.locationBias = {
          circle: {
            center: params.locationBias,
            radius: 5000, // Default 5km bias
          },
        };
      }
    }

    if (params.includedType) {
      body.includedType = params.includedType;
    }
    if (params.openNow !== undefined) {
      body.openNow = params.openNow;
    }
    if (params.minRating !== undefined) {
      body.minRating = params.minRating;
    }
    if (params.priceLevels?.length) {
      body.priceLevels = params.priceLevels;
    }
    if (params.rankPreference) {
      body.rankPreference = params.rankPreference;
    }

    const fieldMask = buildFieldMask(['basic', 'rating', 'hours']);

    return this.request(PLACES_API_BASE, '/places:searchText', {
      method: 'POST',
      body: JSON.stringify(body),
      fieldMask,
    });
  }

  // --------------------------------------------------------------------------
  // Places - Get Details
  // --------------------------------------------------------------------------

  async getPlaceDetails(params: PlaceDetailsParams): Promise<Place> {
    const fieldMask = params.fields.map((f) => `${f}`).join(',');

    return this.request(PLACES_API_BASE, `/places/${params.placeId}`, {
      method: 'GET',
      fieldMask,
    });
  }

  // --------------------------------------------------------------------------
  // Places - Get Photo URI
  // --------------------------------------------------------------------------

  getPhotoUri(photoName: string, maxWidth: number = 400, maxHeight?: number): string {
    const params = new URLSearchParams({
      key: this.apiKey,
      maxWidthPx: String(maxWidth),
    });
    if (maxHeight) {
      params.set('maxHeightPx', String(maxHeight));
    }
    return `${PLACES_API_BASE}/${photoName}/media?${params.toString()}`;
  }

  // --------------------------------------------------------------------------
  // Routes - Compute Routes
  // --------------------------------------------------------------------------

  async computeRoutes(params: ComputeRoutesParams): Promise<{ routes: Route[] }> {
    const formatWaypoint = (wp: LatLng | { placeId: string } | { address: string }) => {
      if ('latitude' in wp) {
        return { location: { latLng: wp } };
      }
      if ('placeId' in wp) {
        return { placeId: wp.placeId };
      }
      return { address: wp.address };
    };

    const body: Record<string, unknown> = {
      origin: formatWaypoint(params.origin),
      destination: formatWaypoint(params.destination),
      travelMode: params.travelMode,
      languageCode: params.languageCode ?? 'en',
    };

    if (params.intermediates?.length) {
      body.intermediates = params.intermediates.map(formatWaypoint);
    }

    // When departureTime is set, use TRAFFIC_AWARE routing (required by API)
    // Transit doesn't use routingPreference
    if (params.departureTime) {
      body.departureTime = params.departureTime;
      if (params.travelMode !== 'TRANSIT') {
        body.routingPreference = 'TRAFFIC_AWARE_OPTIMAL';
      }
    }

    if (params.computeAlternativeRoutes) {
      body.computeAlternativeRoutes = params.computeAlternativeRoutes;
    }
    if (params.routeModifiers) {
      body.routeModifiers = params.routeModifiers;
    }

    const fieldMask = [
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

    return this.request(ROUTES_COMPUTE_URL, '', {
      method: 'POST',
      body: JSON.stringify(body),
      fieldMask,
    });
  }

  // --------------------------------------------------------------------------
  // Routes - Compute Route Matrix
  // --------------------------------------------------------------------------

  async computeRouteMatrix(
    params: ComputeRouteMatrixParams,
  ): Promise<RouteMatrixElement[]> {
    const formatWaypoint = (wp: LatLng | { placeId: string } | { address: string }) => {
      if ('latitude' in wp) {
        return { waypoint: { location: { latLng: wp } } };
      }
      if ('placeId' in wp) {
        return { waypoint: { placeId: wp.placeId } };
      }
      return { waypoint: { address: wp.address } };
    };

    const body: Record<string, unknown> = {
      origins: params.origins.map(formatWaypoint),
      destinations: params.destinations.map(formatWaypoint),
      travelMode: params.travelMode,
      languageCode: params.languageCode ?? 'en',
    };

    // When departureTime is set, use TRAFFIC_AWARE routing (required by API)
    if (params.departureTime) {
      body.departureTime = params.departureTime;
      if (params.travelMode !== 'TRANSIT') {
        body.routingPreference = 'TRAFFIC_AWARE_OPTIMAL';
      }
    }

    // Route Matrix API returns array directly (streaming format)
    // For simplicity, we use the non-streaming approach
    return this.request(ROUTES_MATRIX_URL, '', {
      method: 'POST',
      body: JSON.stringify(body),
      fieldMask:
        'originIndex,destinationIndex,status,condition,distanceMeters,duration,staticDuration,localizedValues',
    });
  }
}
