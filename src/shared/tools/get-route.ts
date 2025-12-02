/**
 * Get Route tool - get directions and distance between locations.
 */

import { z } from 'zod';
import { toolsMetadata } from '../../config/metadata.js';
import {
  GoogleMapsClient,
  type LatLng,
  type Route,
  type RouteMatrixElement,
  type RouteStep,
} from '../../services/google-maps.js';
import { defineTool, type ToolResult } from './types.js';

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
    .describe(
      'Destination(s): single destination for route, multiple for distance matrix',
    ),
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
    .describe(
      'Departure time (ISO 8601). Use "now" for current time. Required for transit.',
    ),
  avoid: z
    .array(z.enum(['tolls', 'highways', 'ferries']))
    .optional()
    .describe('Route features to avoid'),
  language: z.string().optional().default('en').describe('Language for instructions'),
});

function parseDuration(durationStr: string): { seconds: number; text: string } {
  // Duration is in format "1234s"
  const seconds = parseInt(durationStr.replace('s', ''), 10);

  if (seconds < 60) {
    return { seconds, text: `${seconds} sec` };
  } else if (seconds < 3600) {
    const mins = Math.round(seconds / 60);
    return { seconds, text: `${mins} min` };
  } else {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.round((seconds % 3600) / 60);
    return { seconds, text: mins > 0 ? `${hours} hr ${mins} min` : `${hours} hr` };
  }
}

function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  return `${(meters / 1000).toFixed(1)} km`;
}

function formatStep(
  step: RouteStep,
  index: number,
): { text: string; data: Record<string, unknown> } {
  const instruction = step.navigationInstruction?.instructions ?? 'Continue';
  const distance =
    step.localizedValues?.distance?.text ?? formatDistance(step.distanceMeters);
  const duration =
    step.localizedValues?.staticDuration?.text ??
    parseDuration(step.staticDuration).text;

  let stepText = `${index + 1}. ${instruction} (${distance}, ${duration})`;

  // Add transit details if present
  if (step.transitDetails) {
    const transit = step.transitDetails;
    const line = transit.transitLine?.shortName ?? transit.transitLine?.name ?? '';
    const vehicle =
      transit.transitLine?.vehicle?.name?.text ??
      transit.transitLine?.vehicle?.type ??
      '';
    const stops = transit.stopCount ? `${transit.stopCount} stops` : '';
    const headsign = transit.headsign ? `toward ${transit.headsign}` : '';

    const transitParts = [vehicle, line, headsign, stops].filter(Boolean);
    if (transitParts.length > 0) {
      stepText += `\n   🚌 ${transitParts.join(' - ')}`;
    }

    if (transit.stopDetails?.departureStop?.name) {
      stepText += `\n   From: ${transit.stopDetails.departureStop.name}`;
    }
    if (transit.stopDetails?.arrivalStop?.name) {
      stepText += `\n   To: ${transit.stopDetails.arrivalStop.name}`;
    }
  }

  return {
    text: stepText,
    data: {
      instruction,
      distance_meters: step.distanceMeters,
      distance_text: distance,
      duration_text: duration,
      maneuver: step.navigationInstruction?.maneuver,
      travel_mode: step.travelMode,
      transit_details: step.transitDetails
        ? {
            line: step.transitDetails.transitLine?.name,
            short_name: step.transitDetails.transitLine?.shortName,
            vehicle_type: step.transitDetails.transitLine?.vehicle?.type,
            headsign: step.transitDetails.headsign,
            stop_count: step.transitDetails.stopCount,
            departure_stop: step.transitDetails.stopDetails?.departureStop?.name,
            arrival_stop: step.transitDetails.stopDetails?.arrivalStop?.name,
          }
        : undefined,
    },
  };
}

function formatRoute(
  route: Route,
  includeSteps: boolean,
): { text: string[]; data: Record<string, unknown> } {
  const lines: string[] = [];
  const duration =
    route.localizedValues?.duration?.text ?? parseDuration(route.duration).text;
  const distance =
    route.localizedValues?.distance?.text ?? formatDistance(route.distanceMeters);

  lines.push(`📍 **Route Summary**`);
  lines.push(`⏱️ Duration: ${duration}`);
  lines.push(`📏 Distance: ${distance}`);

  if (route.warnings?.length) {
    lines.push('');
    lines.push('⚠️ Warnings:');
    route.warnings.forEach((w) => lines.push(`  - ${w}`));
  }

  const stepsData: Record<string, unknown>[] = [];

  if (includeSteps && route.legs?.length) {
    lines.push('');
    lines.push('**Directions:**');

    let stepIndex = 0;
    for (const leg of route.legs) {
      if (leg.steps) {
        for (const step of leg.steps) {
          const formatted = formatStep(step, stepIndex);
          lines.push(formatted.text);
          stepsData.push(formatted.data);
          stepIndex++;
        }
      }
    }
  }

  return {
    text: lines,
    data: {
      duration_seconds: parseDuration(route.duration).seconds,
      duration_text: duration,
      distance_meters: route.distanceMeters,
      distance_text: distance,
      warnings: route.warnings,
      steps: includeSteps ? stepsData : undefined,
      polyline: route.polyline?.encodedPolyline,
    },
  };
}

function formatMatrixElement(
  element: RouteMatrixElement,
  destIndex: number,
): { text: string; data: Record<string, unknown> } {
  if (element.condition === 'ROUTE_NOT_FOUND' || !element.distanceMeters) {
    return {
      text: `Destination ${destIndex + 1}: Route not available`,
      data: {
        index: destIndex,
        available: false,
      },
    };
  }

  const durationParsed = parseDuration(element.duration ?? '0s');
  const duration = element.localizedValues?.duration?.text ?? durationParsed.text;
  const distance =
    element.localizedValues?.distance?.text ?? formatDistance(element.distanceMeters);

  return {
    text: `Destination ${destIndex + 1}: ${duration} (${distance})`,
    data: {
      index: destIndex,
      available: true,
      duration_seconds: durationParsed.seconds,
      duration_text: duration,
      distance_meters: element.distanceMeters,
      distance_text: distance,
    },
  };
}

function convertWaypoint(
  wp: z.infer<typeof WaypointSchema>,
): LatLng | { placeId: string } | { address: string } {
  if ('latitude' in wp) {
    return { latitude: wp.latitude, longitude: wp.longitude };
  }
  if ('place_id' in wp) {
    return { placeId: wp.place_id };
  }
  return { address: wp.address };
}

function getTravelMode(
  mode: string,
): 'WALK' | 'DRIVE' | 'TRANSIT' | 'BICYCLE' | 'TWO_WHEELER' {
  const modeMap: Record<string, 'WALK' | 'DRIVE' | 'TRANSIT' | 'BICYCLE'> = {
    walk: 'WALK',
    drive: 'DRIVE',
    transit: 'TRANSIT',
    bicycle: 'BICYCLE',
  };
  return modeMap[mode] ?? 'WALK';
}

export const getRouteTool = defineTool({
  name: toolsMetadata.get_route.name,
  title: toolsMetadata.get_route.title,
  description: toolsMetadata.get_route.description,
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
    const travelMode = getTravelMode(args.mode);
    const origin = convertWaypoint(args.origin);
    const destinations = args.destinations.map(convertWaypoint);

    // Parse departure time
    // "now" = use current time + small buffer (API requires future timestamp for traffic routing)
    let departureTime: string | undefined;
    if (args.departure_time === 'now') {
      // Add 1 minute buffer to ensure it's in the future when request arrives
      departureTime = new Date(Date.now() + 60_000).toISOString();
    } else if (args.departure_time) {
      departureTime = args.departure_time;
    }

    try {
      // Single destination → Compute Routes
      if (destinations.length === 1) {
        const result = await client.computeRoutes({
          origin,
          destination: destinations[0],
          travelMode,
          departureTime,
          routeModifiers: args.avoid
            ? {
                avoidTolls: args.avoid.includes('tolls'),
                avoidHighways: args.avoid.includes('highways'),
                avoidFerries: args.avoid.includes('ferries'),
              }
            : undefined,
          languageCode: args.language,
        });

        if (!result.routes?.length) {
          return {
            content: [
              { type: 'text', text: 'No route found between the specified locations.' },
            ],
            structuredContent: { route: null },
          };
        }

        const route = result.routes[0];
        const formatted = formatRoute(route, args.include_steps);

        const structuredData: Record<string, unknown> = {
          ...formatted.data,
          mode: args.mode,
        };

        if (!args.include_polyline) {
          delete structuredData.polyline;
        }

        return {
          content: [{ type: 'text', text: formatted.text.join('\n') }],
          structuredContent: structuredData,
        };
      }

      // Multiple destinations → Route Matrix
      const result = await client.computeRouteMatrix({
        origins: [origin],
        destinations,
        travelMode,
        departureTime,
        languageCode: args.language,
      });

      if (!result?.length) {
        return {
          content: [{ type: 'text', text: 'No routes found.' }],
          structuredContent: { destinations: [] },
        };
      }

      const lines: string[] = ['**Distance Matrix:**', ''];

      const formattedDestinations = result.map((el, idx) =>
        formatMatrixElement(el, idx),
      );

      // Sort by duration if available
      const sorted = [...formattedDestinations].sort((a, b) => {
        const aDur = (a.data.duration_seconds as number) ?? Infinity;
        const bDur = (b.data.duration_seconds as number) ?? Infinity;
        return aDur - bDur;
      });

      sorted.forEach((d) => lines.push(d.text));

      // Highlight closest
      const closest = sorted.find((d) => d.data.available);
      if (closest && destinations.length > 1) {
        lines.push('');
        lines.push(`✅ Closest: Destination ${(closest.data.index as number) + 1}`);
      }

      return {
        content: [{ type: 'text', text: lines.join('\n') }],
        structuredContent: {
          mode: args.mode,
          destinations: sorted.map((d) => d.data),
          closest_index: closest?.data.index,
        },
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          { type: 'text', text: `Failed to get route: ${(error as Error).message}` },
        ],
      };
    }
  },
});
