import { z } from 'zod';

export const HandlerCategorySchema = z.enum([
  'computation',
  'validation',
  'logic',
  'graph',
  'resolution',
  'temporal',
  'ai',
]);
export type HandlerCategory = z.infer<typeof HandlerCategorySchema>;

export const HandlerMetadataSchema = z.object({
  id: z.string(),
  version: z.string(),
  category: HandlerCategorySchema,
  description: z.string(),
});
export type HandlerMetadata = z.infer<typeof HandlerMetadataSchema>;
