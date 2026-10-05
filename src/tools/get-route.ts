import * as z from 'zod/v4';
import { defineTool, toolError } from '../platform/primitives';
import {
  GoogleMapsError,
  type Route,
  type RouteMatrixElement,
  type RouteStep,
  type TravelMode,
  type Waypoint,
} from '../services/google-maps';

const LatLngSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

const WaypointSchema = z.union([
  LatLngSchema,
  z.object({ place_id: z.string() }),
  z.object({ address: z.string() }),
]);

const InputSchema = z.object({
  origin: WaypointSchema.describe('Starting point: coordinates, place_id, or address'),
  destinations: z
    .array(WaypointSchema)
    .min(1)
    .max(25)
    .describe('Destination(s): single destination for route, multiple for distance matrix'),
  mode: z
    .enum(['walk', 'drive', 'transit', 'bicycle'])
    .optional()
    .default('walk')
    .describe('Travel mode (default: walk for watch-based navigation)'),
  include_steps: z
    .boolean()
    .optional()
    .default(false)
    .describe('Include turn-by-turn instructions'),
  include_polyline: z
    .boolean()
    .optional()
    .default(false)
    .describe('Include encoded polyline for map display'),
  departure_time: z
    .string()
    .optional()
    .describe('Departure time (ISO 8601). Use "now" for current time. Required for transit.'),
  avoid: z
    .array(z.enum(['tolls', 'highways', 'ferries']))
    .optional()
    .describe('Route features to avoid'),
  language: z.string().optional().default('en').describe('Language for instructions'),
});

const TRAVEL_MODES: Record<'walk' | 'drive' | 'transit' | 'bicycle', TravelMode> = {
  walk: 'WALK',
  drive: 'DRIVE',
  transit: 'TRANSIT',
  bicycle: 'BICYCLE',
};

/**
 * One destination: Compute Routes, with optional steps and polyline. Several destinations:
 * Compute Route Matrix from the origin, sorted by duration, with the closest one named.
 */
export const getRoute = defineTool(
  'get_route',
  {
    description: `Get directions to one destination OR compare distances to multiple destinations.

INPUTS:
- origin: { latitude, longitude } | { place_id } | { address } (REQUIRED)
- destinations: array of waypoints (REQUIRED) — same format as origin
  - Single destination → full route with optional turn-by-turn
  - Multiple destinations → distance/duration matrix (which is closest?)
- mode?: "walk"|"drive"|"transit"|"bicycle" (default: "walk")
- include_steps?: boolean — turn-by-turn instructions (default: false)
- include_polyline?: boolean — encoded path for map (default: false)
- departure_time?: string — ISO 8601 or "now" (required for transit)
- avoid?: ["tolls"|"highways"|"ferries"]
- language?: string (default: "en")

SINGLE DESTINATION RETURNS:
- duration_seconds, duration_text (e.g., "15 min")
- distance_meters, distance_text (e.g., "1.2 km")
- warnings (if any)
- steps (if include_steps: true): array of { instruction, distance_text, duration_text, maneuver }
  - Transit steps include: line, vehicle_type, departure_stop, arrival_stop, stop_count

MULTIPLE DESTINATIONS RETURNS:
- destinations: array of { index, available, duration_text, distance_text }
- closest_index: index of nearest destination

EXAMPLES:
- Walking directions: { origin: {...}, destinations: [{ place_id: "..." }], mode: "walk", include_steps: true }
- Transit with time: { origin: {...}, destinations: [{...}], mode: "transit", departure_time: "now", include_steps: true }
- Which is closer: { origin: {...}, destinations: [{ place_id: "A" }, { place_id: "B" }] }
- Driving, avoid tolls: { origin: {...}, destinations: [{...}], mode: "drive", avoid: ["tolls"] }`,
    inputSchema: InputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: true },
  },
  async (args, ctx, { maps, logger }) => {
    const { signal } = ctx.mcpReq;
    const travelMode = TRAVEL_MODES[args.mode];
    const origin = toWaypoint(args.origin);
    const destinations = args.destinations.map(toWaypoint);
    // Traffic-aware routing needs a time in the future: "now" is one minute from now, so it
    // is still in the future when Google receives it.
    const departureTime =
      args.departure_time === 'now'
        ? new Date(Date.now() + 60_000).toISOString()
        : args.departure_time;

    try {
      const [destination] = destinations;
      if (destination && destinations.length === 1) {
        const routes = await maps.computeRoutes(
          {
            origin,
            destination,
            travelMode,
            departureTime,
            routeModifiers: args.avoid && {
              avoidTolls: args.avoid.includes('tolls'),
              avoidHighways: args.avoid.includes('highways'),
              avoidFerries: args.avoid.includes('ferries'),
            },
            languageCode: args.language,
          },
          signal,
        );
        return routeResult(routes, args.mode, args.include_steps, args.include_polyline);
      }

      const elements = await maps.computeRouteMatrix(
        { origins: [origin], destinations, travelMode, departureTime, languageCode: args.language },
        signal,
      );
      return matrixResult(elements, args.mode, destinations.length);
    } catch (error) {
      if (error instanceof GoogleMapsError) {
        logger.warning('Google Maps request failed', { tool: 'get_route', error });
        return toolError(`Failed to get route: ${error.message}`);
      }
      throw error;
    }
  },
);

function toWaypoint(point: z.infer<typeof WaypointSchema>): Waypoint {
  if ('latitude' in point) return { latitude: point.latitude, longitude: point.longitude };
  if ('place_id' in point) return { placeId: point.place_id };
  return { address: point.address };
}

function routeResult(
  routes: Route[],
  mode: string,
  includeSteps: boolean,
  includePolyline: boolean,
) {
  const [route] = routes;
  if (!route) {
    return {
      content: [{ type: 'text' as const, text: 'No route found between the specified locations.' }],
      structuredContent: { route: null },
    };
  }

  const formatted = formatRoute(route, includeSteps);
  const { polyline, ...data } = formatted.data;
  return {
    content: [{ type: 'text' as const, text: formatted.text.join('\n') }],
    structuredContent: { ...data, ...(includePolyline && { polyline }), mode },
  };
}

function matrixResult(elements: RouteMatrixElement[], mode: string, destinationCount: number) {
  if (!elements.length) {
    return {
      content: [{ type: 'text' as const, text: 'No routes found.' }],
      structuredContent: { destinations: [] },
    };
  }

  // Google returns matrix elements in any order; each one names its destination.
  const sorted = elements
    .map((element, position) => formatMatrixElement(element, element.destinationIndex ?? position))
    .sort(
      (a, b) =>
        ((a.data.duration_seconds as number | undefined) ?? Number.POSITIVE_INFINITY) -
        ((b.data.duration_seconds as number | undefined) ?? Number.POSITIVE_INFINITY),
    );
  const closest = sorted.find((destination) => destination.data.available);

  const lines = ['**Distance Matrix:**', '', ...sorted.map((destination) => destination.text)];
  if (closest && destinationCount > 1) {
    lines.push('', `✅ Closest: Destination ${closest.data.index + 1}`);
  }

  return {
    content: [{ type: 'text' as const, text: lines.join('\n') }],
    structuredContent: {
      mode,
      destinations: sorted.map((destination) => destination.data),
      closest_index: closest?.data.index,
    },
  };
}

/** Google writes durations as seconds with an "s" suffix, for example "1234s". */
function parseDuration(duration: string): { seconds: number; text: string } {
  const seconds = Number.parseInt(duration.replace('s', ''), 10);
  if (seconds < 60) return { seconds, text: `${seconds} sec` };
  if (seconds < 3600) return { seconds, text: `${Math.round(seconds / 60)} min` };
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return { seconds, text: minutes > 0 ? `${hours} hr ${minutes} min` : `${hours} hr` };
}

function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

function formatStep(step: RouteStep, index: number) {
  const instruction = step.navigationInstruction?.instructions ?? 'Continue';
  const distance = step.localizedValues?.distance?.text ?? formatDistance(step.distanceMeters);
  const duration =
    step.localizedValues?.staticDuration?.text ?? parseDuration(step.staticDuration).text;

  let text = `${index + 1}. ${instruction} (${distance}, ${duration})`;

  const transit = step.transitDetails;
  if (transit) {
    const line = transit.transitLine?.shortName ?? transit.transitLine?.name ?? '';
    const vehicle =
      transit.transitLine?.vehicle?.name?.text ?? transit.transitLine?.vehicle?.type ?? '';
    const stops = transit.stopCount ? `${transit.stopCount} stops` : '';
    const headsign = transit.headsign ? `toward ${transit.headsign}` : '';
    const parts = [vehicle, line, headsign, stops].filter(Boolean);
    if (parts.length > 0) text += `\n   🚌 ${parts.join(' - ')}`;
    if (transit.stopDetails?.departureStop?.name) {
      text += `\n   From: ${transit.stopDetails.departureStop.name}`;
    }
    if (transit.stopDetails?.arrivalStop?.name) {
      text += `\n   To: ${transit.stopDetails.arrivalStop.name}`;
    }
  }

  return {
    text,
    data: {
      instruction,
      distance_meters: step.distanceMeters,
      distance_text: distance,
      duration_text: duration,
      maneuver: step.navigationInstruction?.maneuver,
      travel_mode: step.travelMode,
      transit_details: transit
        ? {
            line: transit.transitLine?.name,
            short_name: transit.transitLine?.shortName,
            vehicle_type: transit.transitLine?.vehicle?.type,
            headsign: transit.headsign,
            stop_count: transit.stopCount,
            departure_stop: transit.stopDetails?.departureStop?.name,
            arrival_stop: transit.stopDetails?.arrivalStop?.name,
          }
        : undefined,
    },
  };
}

function formatRoute(route: Route, includeSteps: boolean) {
  const duration = route.localizedValues?.duration?.text ?? parseDuration(route.duration).text;
  const distance = route.localizedValues?.distance?.text ?? formatDistance(route.distanceMeters);
  const lines = ['📍 **Route Summary**', `⏱️ Duration: ${duration}`, `📏 Distance: ${distance}`];

  if (route.warnings?.length) {
    lines.push('', '⚠️ Warnings:', ...route.warnings.map((warning) => `  - ${warning}`));
  }

  const steps = includeSteps
    ? (route.legs ?? []).flatMap((leg) => leg.steps ?? []).map(formatStep)
    : [];
  if (includeSteps && route.legs?.length) {
    lines.push('', '**Directions:**', ...steps.map((step) => step.text));
  }

  return {
    text: lines,
    data: {
      duration_seconds: parseDuration(route.duration).seconds,
      duration_text: duration,
      distance_meters: route.distanceMeters,
      distance_text: distance,
      warnings: route.warnings,
      steps: includeSteps ? steps.map((step) => step.data) : undefined,
      polyline: route.polyline?.encodedPolyline,
    },
  };
}

function formatMatrixElement(element: RouteMatrixElement, index: number) {
  if (element.condition === 'ROUTE_NOT_FOUND' || !element.distanceMeters) {
    return {
      text: `Destination ${index + 1}: Route not available`,
      data: { index, available: false } as MatrixEntry,
    };
  }

  const parsed = parseDuration(element.duration ?? '0s');
  const duration = element.localizedValues?.duration?.text ?? parsed.text;
  const distance =
    element.localizedValues?.distance?.text ?? formatDistance(element.distanceMeters);
  return {
    text: `Destination ${index + 1}: ${duration} (${distance})`,
    data: {
      index,
      available: true,
      duration_seconds: parsed.seconds,
      duration_text: duration,
      distance_meters: element.distanceMeters,
      distance_text: distance,
    } as MatrixEntry,
  };
}

interface MatrixEntry {
  index: number;
  available: boolean;
  duration_seconds?: number;
  duration_text?: string;
  distance_meters?: number;
  distance_text?: string;
}
