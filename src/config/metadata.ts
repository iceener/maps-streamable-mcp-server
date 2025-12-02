/**
 * Centralized tool metadata for the Google Maps MCP server.
 */

export interface ToolMetadata {
  name: string;
  title: string;
  description: string;
}

export const serverMetadata = {
  title: 'Google Maps',
  instructions: `Use these tools to search for places, get location details, and navigate.

QUICK START
- Use 'search_places' to find places nearby or by text query.
- Use 'get_place' to get details about a specific place (hours, reviews, photos).
- Use 'get_route' for directions or to compare distances to multiple destinations.

USER CONTEXT
- The user has a watch with GPS — you have access to their current location.
- Default to WALKING mode for navigation (watch = pedestrian).
- Always pass the user's current coordinates as 'location' or 'origin'.

PLACE SEARCH
- For "X near me" → search_places with types (e.g., types: ["cafe"])
- For "find X" with specific name → search_places with query (e.g., query: "Starbucks")
- Use open_now: true to filter for places currently open.
- Use min_rating to filter by quality.

GETTING PLACE INFO
- After search, use place_id from results with get_place.
- Request only the fields you need: basic, contact, hours, reviews, photos.
- Photos return URLs that can be displayed.

NAVIGATION
- Single destination: get_route returns turn-by-turn directions.
- Multiple destinations: get_route returns distance/duration matrix (useful for "which is closer?").
- For transit, set mode: "transit" and departure_time: "now" or specific time.
- include_steps: true adds turn-by-turn instructions.

CHAINING TOOLS
1. search_places → find candidates
2. get_place → get details if needed
3. get_route → navigate to chosen place

EXAMPLE QUERIES
- "Coffee near me" → search_places(types: ["cafe"], open_now: true)
- "Is Starbucks on Main St open?" → search_places + get_place(fields: ["hours"])
- "Navigate to the nearest pharmacy" → search_places + get_route
- "Which is closer: CVS or Walgreens?" → search_places for each + get_route with both as destinations
`,
} as const;

export const toolsMetadata = {
  search_places: {
    name: 'search_places',
    title: 'Search Places',
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
  },

  get_place: {
    name: 'get_place',
    title: 'Get Place Details',
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
  },

  get_route: {
    name: 'get_route',
    title: 'Get Route',
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
  },
} as const satisfies Record<string, ToolMetadata>;

/**
 * Type-safe helper to get metadata for a tool.
 */
export function getToolMetadata(toolName: keyof typeof toolsMetadata): ToolMetadata {
  return toolsMetadata[toolName];
}

/**
 * Get all registered tool names.
 */
export function getToolNames(): string[] {
  return Object.keys(toolsMetadata);
}
