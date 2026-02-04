import type { ASTNode, ExecutionContext, HandlerResult } from '@eurocomply/types';
import type { HandlerRegistry } from './registry.js';
import type { EvaluateFn } from './handler.js';
import { makeTrace, now } from './result.js';

export interface EvaluateOptions {
  /**
   * Maximum wall-clock milliseconds for the entire evaluation. Default: no limit.
   *
   * LIMITATION: Timeout is checked between handler invocations, not during them.
   * A single handler that blocks the thread (infinite loop, CPU-bound work) will
   * not be interrupted — Node.js is single-threaded and the kernel-vm is synchronous.
   * The timeout catches runaway compositions (deeply nested ASTs, large for_each),
   * not individual handler hangs.
   */
  timeout_ms?: number;
}

export function evaluate(
  ast: ASTNode,
  context: ExecutionContext,
  registry: HandlerRegistry,
  options?: EvaluateOptions,
): HandlerResult {
  const deadline = options?.timeout_ms != null ? now() + options.timeout_ms : undefined;
  return evalNode(ast, context, context.entity_data, registry, 'root', deadline);
}

function makeTimeoutResult(node: ASTNode, path: string, start: number, version: string, phase: string): HandlerResult {
  return {
    success: false,
    value: null,
    explanation: {
      summary: `Evaluation timeout exceeded ${phase} ${node.handler}`,
      steps: [],
    },
    trace: makeTrace({
      handler_id: node.handler,
      handler_version: version,
      input: node.config,
      output: null,
      duration_ms: now() - start,
      execution_path: path,
      status: 'error',
      error: { message: `Evaluation timeout exceeded ${phase} handler ${node.handler}` },
    }),
  };
}

function evalNode(
  node: ASTNode,
  context: ExecutionContext,
  input: unknown,
  registry: HandlerRegistry,
  path: string,
  deadline?: number,
): HandlerResult {
  const start = now();

  // Check timeout before executing this node
  if (deadline != null && now() > deadline) {
    return makeTimeoutResult(node, path, start, '0.0.0', 'at');
  }

  const handler = registry.get(node.handler);
  if (!handler) {
    return {
      success: false,
      value: null,
      explanation: {
        summary: `Unknown handler: ${node.handler}`,
        steps: [],
      },
      trace: makeTrace({
        handler_id: node.handler,
        handler_version: '0.0.0',
        input: node.config,
        output: null,
        duration_ms: now() - start,
        execution_path: path,
        status: 'error',
        error: { message: `Unknown handler: ${node.handler}` },
      }),
    };
  }

  try {
    const evaluateFn: EvaluateFn = (child, ctx, childInput) =>
      evalNode(child, ctx, childInput ?? input, registry, `${path} > ${child.handler}`, deadline);

    const result = handler.execute(node.config, input, context, evaluateFn);

    // Check timeout after handler execution (catches single long-running handlers)
    if (deadline != null && now() > deadline) {
      return makeTimeoutResult(node, path, start, handler.version, 'after');
    }

    return { ...result, trace: { ...result.trace, execution_path: path } };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      value: null,
      explanation: {
        summary: `Handler ${node.handler} threw: ${message}`,
        steps: [],
      },
      trace: makeTrace({
        handler_id: node.handler,
        handler_version: handler.version,
        input: node.config,
        output: null,
        duration_ms: now() - start,
        execution_path: path,
        status: 'error',
        error: { message, ...(err instanceof Error && err.stack ? { stack: err.stack } : {}) },
      }),
    };
  }
}
