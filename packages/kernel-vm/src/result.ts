import type { HandlerResult, ExecutionTrace, ExplanationStep, Reference, Warning } from '@eurocomply/types';

export function makeTrace(opts: {
  handler_id: string;
  handler_version: string;
  input: unknown;
  output: unknown;
  duration_ms: number;
  execution_path: string;
  status: 'success' | 'failed' | 'error';
  child_traces?: ExecutionTrace[];
  error?: { message: string };
}): ExecutionTrace {
  return {
    handler_id: opts.handler_id,
    handler_version: opts.handler_version,
    duration_ms: opts.duration_ms,
    input: opts.input,
    output: opts.output,
    execution_path: opts.execution_path,
    status: opts.status,
    child_traces: opts.child_traces,
    error: opts.error,
  };
}

export function makeSuccess<T>(
  value: T,
  opts: {
    summary: string;
    steps?: ExplanationStep[];
    references?: Reference[];
    handler_id: string;
    handler_version: string;
    input: unknown;
    execution_path: string;
    duration_ms: number;
    child_traces?: ExecutionTrace[];
    warnings?: Warning[];
  }
): HandlerResult<T> {
  return {
    success: true,
    value,
    explanation: {
      summary: opts.summary,
      steps: opts.steps ?? [],
      references: opts.references,
    },
    trace: makeTrace({
      handler_id: opts.handler_id,
      handler_version: opts.handler_version,
      input: opts.input,
      output: value,
      duration_ms: opts.duration_ms,
      execution_path: opts.execution_path,
      status: 'success',
      child_traces: opts.child_traces,
    }),
    warnings: opts.warnings,
  };
}

export function makeFailure<T>(
  value: T,
  opts: {
    summary: string;
    steps?: ExplanationStep[];
    references?: Reference[];
    handler_id: string;
    handler_version: string;
    input: unknown;
    execution_path: string;
    duration_ms: number;
    child_traces?: ExecutionTrace[];
    error?: { message: string };
    warnings?: Warning[];
  }
): HandlerResult<T> {
  return {
    success: false,
    value,
    explanation: {
      summary: opts.summary,
      steps: opts.steps ?? [],
      references: opts.references,
    },
    trace: makeTrace({
      handler_id: opts.handler_id,
      handler_version: opts.handler_version,
      input: opts.input,
      output: value,
      duration_ms: opts.duration_ms,
      execution_path: opts.execution_path,
      status: 'failed',
      child_traces: opts.child_traces,
      error: opts.error,
    }),
    warnings: opts.warnings,
  };
}

/** Measure execution duration in ms using performance.now() if available, Date.now() otherwise. */
export function now(): number {
  if (typeof performance !== 'undefined' && performance.now) {
    return performance.now();
  }
  return Date.now();
}
