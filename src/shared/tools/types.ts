/**
 * Shared tool types for cross-runtime compatibility.
 * These definitions work in both Node.js (Hono) and Cloudflare Workers.
 *
 * Uses Zod for schema validation (works in both runtimes).
 */

import type { ZodObject, ZodRawShape, z } from 'zod';

/**
 * Auth strategy types.
 */
export type AuthStrategy = 'oauth' | 'bearer' | 'api_key' | 'custom' | 'none';

/**
 * Context passed to every tool handler.
 * Provides access to auth, session, and cancellation.
 */
export interface ToolContext {
  /** Current MCP session ID */
  sessionId: string;
  /** Abort signal for cancellation support */
  signal?: AbortSignal;
  /** Request metadata from MCP */
  meta?: {
    progressToken?: string | number;
    requestId?: string;
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Authentication
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Active auth strategy.
   * - 'bearer': Client must provide Bearer token matching BEARER_TOKEN secret
   * - 'none': No authentication
   */
  authStrategy?: AuthStrategy;

  /**
   * Provider token (if any).
   */
  providerToken?: string;

  /**
   * Provider information.
   */
  provider?: {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: number;
    scopes?: string[];
  };

  /**
   * Resolved headers from request.
   */
  resolvedHeaders?: Record<string, string>;

  /**
   * Raw authorization headers from the request.
   */
  authHeaders?: Record<string, string>;

  /**
   * Environment variables / secrets.
   * For Workers: bindings from wrangler.toml
   * For Node: process.env values
   *
   * Access API_KEY here for Google Maps API calls.
   */
  env?: Record<string, string | undefined>;
}

/**
 * Content block in tool results.
 */
export type ToolContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'resource'; uri: string; mimeType?: string; text?: string };

/**
 * Result returned from tool handlers.
 */
export interface ToolResult {
  content: ToolContentBlock[];
  /** If true, indicates the tool encountered an error */
  isError?: boolean;
  /** Structured output matching outputSchema (if defined) */
  structuredContent?: Record<string, unknown>;
}

/**
 * Framework-agnostic tool definition using Zod schemas.
 * Can be registered with McpServer (Node) or custom dispatcher (Workers).
 */
export interface SharedToolDefinition<TShape extends ZodRawShape = ZodRawShape> {
  /** Unique tool name (lowercase, underscores allowed) */
  name: string;
  /** Human-readable title */
  title?: string;
  /** Tool description for LLM */
  description: string;
  /** Zod schema for input validation */
  inputSchema: ZodObject<TShape>;
  /** Optional Zod schema for structured output */
  outputSchema?: ZodRawShape;
  /** Tool handler function */
  handler: (
    args: z.infer<ZodObject<TShape>>,
    context: ToolContext,
  ) => Promise<ToolResult>;
  /**
   * Tool annotations per MCP specification.
   * These are hints for clients about tool behavior (not enforced by SDK).
   */
  annotations?: {
    /** Human-readable display title */
    title?: string;
    /** Tool does NOT modify environment (default: false) */
    readOnlyHint?: boolean;
    /** Tool may delete/overwrite data (default: true) */
    destructiveHint?: boolean;
    /** Repeated calls have no additional effect (default: false) */
    idempotentHint?: boolean;
    /** Tool interacts with external entities (default: true) */
    openWorldHint?: boolean;
  };
}

/**
 * Helper to create a type-safe tool definition.
 */
export function defineTool<TShape extends ZodRawShape>(
  def: SharedToolDefinition<TShape>,
): SharedToolDefinition<TShape> {
  return def;
}
