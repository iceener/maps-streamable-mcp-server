import { getPlaceTool } from './get-place.js';
import { getRouteTool } from './get-route.js';
import { searchPlacesTool } from './search-places.js';

export type { SharedToolDefinition, ToolContext, ToolResult } from './types.js';
export { defineTool } from './types.js';

/** Existing Google Maps tool order is part of the tools/list contract. */
export const sharedTools = [searchPlacesTool, getPlaceTool, getRouteTool] as const;
export function getSharedToolNames(): string[] {
  return sharedTools.map((tool) => tool.name);
}
