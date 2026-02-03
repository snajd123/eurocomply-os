import { describe, it, expect } from 'vitest';
import { validateAST } from './validator.js';
import { HandlerRegistry } from './registry.js';
import type { HandlerDefinition } from './handler.js';
import type { ASTNode } from '@eurocomply/types';

function stubHandler(id: string, version = '1.0.0'): HandlerDefinition {
  return {
    id, version, category: 'validation', description: `Stub ${id}`,
    execute: () => ({
      success: true, value: null,
      explanation: { summary: '', steps: [] },
      trace: { handler_id: id, handler_version: version, duration_ms: 0, input: null, output: null, execution_path: id, status: 'success' as const },
    }),
  };
}

function makeRegistry(): HandlerRegistry {
  const reg = new HandlerRegistry();
  reg.register(stubHandler('core:threshold_check'));
  reg.register(stubHandler('core:and'));
  reg.register(stubHandler('core:or'));
  reg.register(stubHandler('core:pipe'));
  reg.register(stubHandler('core:for_each'));
  return reg;
}

describe('validateAST', () => {
  it('validates a simple leaf node', () => {
    const ast: ASTNode = { handler: 'core:threshold_check', config: { value: 1, threshold: 0.5, operator: 'lt' } };
    const result = validateAST(ast, makeRegistry());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.handlers_used).toContain('core:threshold_check');
  });

  it('reports unknown handler', () => {
    const ast: ASTNode = { handler: 'core:nonexistent', config: {} };
    const result = validateAST(ast, makeRegistry());
    expect(result.valid).toBe(false);
    expect(result.errors[0].error).toContain('Unknown handler');
  });

  it('validates nested AND conditions', () => {
    const ast: ASTNode = {
      handler: 'core:and',
      config: {
        conditions: [
          { handler: 'core:threshold_check', config: { value: 1, threshold: 0.5, operator: 'lt' } },
          { handler: 'core:threshold_check', config: { value: 2, threshold: 1, operator: 'gt' } },
        ],
      },
    };
    const result = validateAST(ast, makeRegistry());
    expect(result.valid).toBe(true);
    expect(result.handlers_used).toContain('core:and');
    expect(result.handlers_used).toContain('core:threshold_check');
  });

  it('reports error in nested child', () => {
    const ast: ASTNode = {
      handler: 'core:and',
      config: {
        conditions: [
          { handler: 'core:missing_handler', config: {} },
        ],
      },
    };
    const result = validateAST(ast, makeRegistry());
    expect(result.valid).toBe(false);
    expect(result.errors[0].path).toContain('conditions[0]');
  });

  it('validates pipe steps', () => {
    const ast: ASTNode = {
      handler: 'core:pipe',
      config: {
        steps: [
          { handler: 'core:threshold_check', config: {} },
          { handler: 'core:threshold_check', config: {} },
        ],
      },
    };
    const result = validateAST(ast, makeRegistry());
    expect(result.valid).toBe(true);
  });

  it('validates for_each validation child', () => {
    const ast: ASTNode = {
      handler: 'core:for_each',
      config: {
        source: { field: 'materials' },
        validation: { handler: 'core:threshold_check', config: {} },
        require: 'all',
      },
    };
    const result = validateAST(ast, makeRegistry());
    expect(result.valid).toBe(true);
  });

  it('computes estimated complexity', () => {
    const ast: ASTNode = {
      handler: 'core:and',
      config: {
        conditions: [
          { handler: 'core:threshold_check', config: {} },
          { handler: 'core:threshold_check', config: {} },
          { handler: 'core:threshold_check', config: {} },
        ],
      },
    };
    const result = validateAST(ast, makeRegistry());
    expect(result.estimated_complexity).toBeGreaterThan(1);
  });

  it('detects circular references via depth limit', () => {
    // Build a deeply nested AST that exceeds max depth
    let current: ASTNode = { handler: 'core:threshold_check', config: {} };
    for (let i = 0; i < 60; i++) {
      current = { handler: 'core:and', config: { conditions: [current] } };
    }
    const result = validateAST(current, makeRegistry());
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.error.includes('depth'))).toBe(true);
  });
});
