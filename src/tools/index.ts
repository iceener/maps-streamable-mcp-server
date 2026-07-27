import type { McpServer } from '@modelcontextprotocol/server';
import type { AppConfig } from '../config/env.js';
import { getPlaceTool } from '../shared/tools/get-place.js';
import { getRouteTool } from '../shared/tools/get-route.js';
import { searchPlacesTool } from '../shared/tools/search-places.js';

export function registerTools(server: McpServer, config: AppConfig): void {
  server.registerTool(
    searchPlacesTool.name,
    {
      description: searchPlacesTool.description,
      inputSchema: searchPlacesTool.inputSchema,
      annotations: searchPlacesTool.annotations,
    },
    (args, context) =>
      searchPlacesTool.handler(args, {
        signal: context.mcpReq.signal,
        env: { API_KEY: config.API_KEY },
      }),
  );
  server.registerTool(
    getPlaceTool.name,
    {
      description: getPlaceTool.description,
      inputSchema: getPlaceTool.inputSchema,
      annotations: getPlaceTool.annotations,
    },
    (args, context) =>
      getPlaceTool.handler(args, {
        signal: context.mcpReq.signal,
        env: { API_KEY: config.API_KEY },
      }),
  );
  server.registerTool(
    getRouteTool.name,
    {
      description: getRouteTool.description,
      inputSchema: getRouteTool.inputSchema,
      annotations: getRouteTool.annotations,
    },
    (args, context) =>
      getRouteTool.handler(args, {
        signal: context.mcpReq.signal,
        env: { API_KEY: config.API_KEY },
      }),
  );
}
