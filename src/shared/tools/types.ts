import type { CallToolResult } from '@modelcontextprotocol/server';
import type * as z from 'zod/v4';

export interface ToolContext {
  signal: AbortSignal;
  env: { API_KEY?: string };
}
export type ToolResult = CallToolResult;
export interface SharedToolDefinition<TInput extends z.ZodObject = z.ZodObject> {
  name: string;
  title?: string;
  description: string;
  inputSchema: TInput;
  handler(args: z.infer<TInput>, context: ToolContext): Promise<ToolResult>;
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}
export function defineTool<TInput extends z.ZodObject>(
  definition: SharedToolDefinition<TInput>,
): SharedToolDefinition<TInput> {
  return definition;
}
