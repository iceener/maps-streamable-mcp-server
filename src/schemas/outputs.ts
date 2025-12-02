import { z } from 'zod';

// Health check tool output
export const HealthOutput = z.object({
  status: z.literal('ok'),
  timestamp: z.number(),
  uptime: z.number().optional(),
});
export type HealthOutput = z.infer<typeof HealthOutput>;

// Example API call tool output
export const ExampleOutput = z.object({
  query: z.string(),
  results: z.array(z.string()),
  count: z.number(),
  processed_at: z.string(),
});
export type ExampleOutput = z.infer<typeof ExampleOutput>;

// Echo tool output
export const EchoOutput = z.object({
  message: z.string(),
  repeated: z.number(),
  timestamp: z.string(),
});
export type EchoOutput = z.infer<typeof EchoOutput>;
