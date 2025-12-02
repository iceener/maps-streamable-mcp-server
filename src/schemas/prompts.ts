import { z } from 'zod';

// Greeting prompt arguments
export const GreetingPromptArgs = z.object({
  name: z.string().min(1, 'Name is required'),
  language: z.enum(['en', 'es', 'fr', 'de']).optional().default('en'),
});
export type GreetingPromptArgs = z.infer<typeof GreetingPromptArgs>;

// Analysis prompt arguments
export const AnalysisPromptArgs = z.object({
  topic: z.string().min(1, 'Topic is required'),
  depth: z.enum(['basic', 'intermediate', 'advanced']).optional().default('basic'),
  include_examples: z.boolean().optional().default(true),
});
export type AnalysisPromptArgs = z.infer<typeof AnalysisPromptArgs>;

// Multimodal prompt arguments
export const MultimodalPromptArgs = z.object({
  task: z.string().min(1, 'Task is required'),
  include_image: z.boolean().optional().default(false),
  include_audio: z.boolean().optional().default(false),
  include_resource: z.boolean().optional().default(false),
});
export type MultimodalPromptArgs = z.infer<typeof MultimodalPromptArgs>;
