import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { config } from '../config/env.js';
import { registerTools } from '../tools/index.js';
import { logger } from '../utils/logger.js';
import { buildCapabilities } from './capabilities.js';

export interface ServerOptions {
  name: string;
  version: string;
  instructions?: string;
  /**
   * Called when initialization is complete (after client sends notifications/initialized).
   * Per review finding #3: This fires AFTER transport.onsessioninitialized.
   *
   * Guaranteed ordering:
   * 1. transport.onsessioninitialized(sid) - session ID assigned
   * 2. server.oninitialized() - client confirmed ready
   *
   * At this point, you can safely:
   * - Access client capabilities via server.server.getClientCapabilities()
   * - Send server→client requests (sampling, elicitation, roots)
   */
  oninitialized?: () => void;
}

export function buildServer(options: ServerOptions): McpServer {
  const { name, version, instructions, oninitialized } = options;

  const server = new McpServer(
    { name, version },
    {
      capabilities: buildCapabilities(),
      instructions: instructions ?? config.MCP_INSTRUCTIONS,
    },
  );

  // Set up logging
  logger.setServer(server);

  // Register oninitialized callback
  // Per review finding #3: This fires after onsessioninitialized
  const lowLevel = (server as any).server;
  if (lowLevel && oninitialized) {
    lowLevel.oninitialized = () => {
      logger.info('mcp', {
        message: 'Client initialization complete (notifications/initialized received)',
        clientVersion: lowLevel.getClientVersion?.(),
      });
      oninitialized();
    };
  }

  // Register tools (no prompts/resources for Google Maps MCP)
  registerTools(server);

  // The MCP server will handle initialize and other standard requests automatically
  // Custom handlers can be added using the server.setRequestHandler if available on the underlying server

  return server;
}
