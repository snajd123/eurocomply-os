import type { ASTNode, ExecutionContext, HandlerResult } from '@eurocomply/types';
import type { HandlerRegistry } from './registry.js';
import type { EvaluateFn } from './handler.js';

export function evaluate(ast: ASTNode, context: ExecutionContext, registry: HandlerRegistry): HandlerResult {
  return evalNode(ast, context, context.entity_data, registry, 'root');
}

function evalNode(node: ASTNode, context: ExecutionContext, input: unknown, registry: HandlerRegistry, path: string): HandlerResult {
  const handler = registry.get(node.handler);
  if (!handler) throw new Error(`Unknown handler: ${node.handler}`);

  const evaluateFn: EvaluateFn = (child, ctx, childInput) =>
    evalNode(child, ctx, childInput ?? input, registry, `${path} > ${child.handler}`);

  const result = handler.execute(node.config, input, context, evaluateFn);
  return { ...result, trace: { ...result.trace, execution_path: path } };
}
