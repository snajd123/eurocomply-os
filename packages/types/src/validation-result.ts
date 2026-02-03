import { z } from 'zod';
import { ExplanationSchema, ExecutionTraceSchema, WarningSchema } from './handler-result.js';

export const ValidationResultSchema = z.object({
  pass: z.boolean(),
  handler_id: z.string(),
  handler_version: z.string(),
  explanation: ExplanationSchema,
  trace: ExecutionTraceSchema,
  details: z.record(z.string(), z.unknown()),
  confidence: z.number().min(0).max(1).optional(),
  warnings: z.array(WarningSchema).optional(),
});
export type ValidationResult = z.infer<typeof ValidationResultSchema>;
