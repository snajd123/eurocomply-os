import type { ExecutionContext, HandlerResult, HandlerCategory, ASTNode } from '@eurocomply/types';

export type EvaluateFn = (
  node: ASTNode,
  context: ExecutionContext,
  input?: unknown
) => HandlerResult;

export interface HandlerDefinition {
  readonly id: string;
  readonly version: string;
  readonly category: HandlerCategory;
  readonly description: string;

  execute(
    config: Record<string, unknown>,
    input: unknown,
    context: ExecutionContext,
    evaluate: EvaluateFn
  ): HandlerResult;
}
