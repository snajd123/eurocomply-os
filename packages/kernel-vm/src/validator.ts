import type { ASTNode, ASTValidationResult, ASTValidationError } from '@eurocomply/types';
import type { HandlerRegistry } from './registry.js';

const MAX_DEPTH = 50;

// Known composition handlers and which config keys contain child AST nodes
const CHILD_NODE_KEYS: Record<string, string[]> = {
  'core:and': ['conditions'],
  'core:or': ['conditions'],
  'core:not': ['condition'],
  'core:if_then': ['if', 'then', 'else'],
  'core:pipe': ['steps'],
  'core:for_each': ['validation'],
};

export function validateAST(
  ast: ASTNode,
  registry: HandlerRegistry
): ASTValidationResult {
  const errors: ASTValidationError[] = [];
  const handlersUsed = new Set<string>();
  let complexity = 0;

  function walk(node: ASTNode, path: string, depth: number): void {
    if (depth > MAX_DEPTH) {
      errors.push({
        path,
        error: `Maximum AST depth (${MAX_DEPTH}) exceeded — possible circular reference`,
      });
      return;
    }

    complexity++;

    // Check handler exists
    if (!registry.has(node.handler)) {
      errors.push({
        path,
        error: `Unknown handler: ${node.handler}`,
      });
      return;
    }

    handlersUsed.add(node.handler);

    // Walk child nodes for known composition handlers
    const childKeys = CHILD_NODE_KEYS[node.handler];
    if (childKeys) {
      for (const key of childKeys) {
        const child = node.config[key];
        if (child == null) continue;

        if (Array.isArray(child)) {
          for (let i = 0; i < child.length; i++) {
            if (isASTNode(child[i])) {
              walk(child[i] as ASTNode, `${path}.${key}[${i}]`, depth + 1);
            }
          }
        } else if (isASTNode(child)) {
          walk(child as ASTNode, `${path}.${key}`, depth + 1);
        }
      }
    }
  }

  walk(ast, 'root', 0);

  return {
    valid: errors.length === 0,
    errors,
    handlers_used: Array.from(handlersUsed),
    estimated_complexity: complexity,
  };
}

function isASTNode(value: unknown): value is ASTNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    'handler' in value &&
    typeof (value as Record<string, unknown>).handler === 'string' &&
    'config' in value
  );
}
