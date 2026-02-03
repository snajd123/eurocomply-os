import { z } from 'zod';

export interface ASTNode {
  handler: string;
  config: Record<string, unknown>;
  label?: string;
}

export const ASTNodeSchema: z.ZodType<ASTNode> = z.lazy(() =>
  z.object({
    handler: z.string(),
    config: z.record(z.string(), z.unknown()),
    label: z.string().optional(),
  })
);

export const ASTValidationErrorSchema = z.object({
  path: z.string(),
  error: z.string(),
  suggestion: z.string().optional(),
});
export type ASTValidationError = z.infer<typeof ASTValidationErrorSchema>;

export const ASTValidationResultSchema = z.object({
  valid: z.boolean(),
  errors: z.array(ASTValidationErrorSchema),
  handlers_used: z.array(z.string()),
  estimated_complexity: z.number(),
});
export type ASTValidationResult = z.infer<typeof ASTValidationResultSchema>;
