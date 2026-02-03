import { z } from 'zod';

// --- Explanation ---

export const ExplanationStepSchema = z.object({
  action: z.string(),
  result: z.string(),
  data: z.record(z.string(), z.unknown()).optional(),
});
export type ExplanationStep = z.infer<typeof ExplanationStepSchema>;

export const ReferenceSchema = z.object({
  type: z.enum(['regulation', 'gsr', 'document', 'calculation']),
  id: z.string(),
  title: z.string().optional(),
  excerpt: z.string().optional(),
});
export type Reference = z.infer<typeof ReferenceSchema>;

export const ExplanationSchema = z.object({
  summary: z.string(),
  steps: z.array(ExplanationStepSchema),
  references: z.array(ReferenceSchema).optional(),
});
export type Explanation = z.infer<typeof ExplanationSchema>;

// --- Warning ---

export const WarningSchema = z.object({
  code: z.string(),
  message: z.string(),
  path: z.string().optional(),
});
export type Warning = z.infer<typeof WarningSchema>;

// --- Execution Trace ---

export interface ExecutionTrace {
  handler_id: string;
  handler_version: string;
  duration_ms: number;
  input: unknown;
  output: unknown;
  child_traces?: ExecutionTrace[];
  execution_path: string;
  status: 'success' | 'failed' | 'error';
  error?: { message: string; stack?: string };
}

export const ExecutionTraceSchema: z.ZodType<ExecutionTrace> = z.lazy(() =>
  z.object({
    handler_id: z.string(),
    handler_version: z.string(),
    duration_ms: z.number(),
    input: z.unknown(),
    output: z.unknown(),
    child_traces: z.array(ExecutionTraceSchema).optional(),
    execution_path: z.string(),
    status: z.enum(['success', 'failed', 'error']),
    error: z.object({
      message: z.string(),
      stack: z.string().optional(),
    }).optional(),
  })
);

// --- Handler Result ---

export const HandlerResultSchema = z.object({
  success: z.boolean(),
  value: z.unknown(),
  explanation: ExplanationSchema,
  trace: ExecutionTraceSchema,
  warnings: z.array(WarningSchema).optional(),
});

export interface HandlerResult<T = unknown> {
  success: boolean;
  value: T;
  explanation: Explanation;
  trace: ExecutionTrace;
  warnings?: Warning[];
}
