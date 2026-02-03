import { describe, it, expect } from 'vitest';
import { andHandler } from './and.js';
import { orHandler } from './or.js';
import { notHandler } from './not.js';
import { ifThenHandler } from './if-then.js';
import type { ExecutionContext, HandlerResult, ASTNode } from '@eurocomply/types';
import type { EvaluateFn } from '../../handler.js';

const ctx: ExecutionContext = {
  entity_type: 'product', entity_id: 'p1',
  entity_data: {}, data: {},
  compliance_lock_id: 'lock_1', vertical_id: 'test', market: 'EU',
  timestamp: '2026-01-01T00:00:00Z',
};

function makeEvaluate(results: Map<string, boolean>): EvaluateFn {
  return (node: ASTNode, _ctx: ExecutionContext, _input?: unknown): HandlerResult => ({
    success: results.get(node.handler) ?? false,
    value: { pass: results.get(node.handler) ?? false },
    explanation: { summary: `${node.handler} result`, steps: [] },
    trace: {
      handler_id: node.handler, handler_version: '1.0.0',
      duration_ms: 0, input: null, output: null,
      execution_path: node.handler, status: 'success',
    },
  });
}

describe('core:and', () => {
  it('passes when all conditions pass', () => {
    const evaluate = makeEvaluate(new Map([['a', true], ['b', true]]));
    const result = andHandler.execute(
      { conditions: [{ handler: 'a', config: {} }, { handler: 'b', config: {} }] },
      null, ctx, evaluate
    );
    expect(result.success).toBe(true);
  });

  it('fails when any condition fails', () => {
    const evaluate = makeEvaluate(new Map([['a', true], ['b', false]]));
    const result = andHandler.execute(
      { conditions: [{ handler: 'a', config: {} }, { handler: 'b', config: {} }] },
      null, ctx, evaluate
    );
    expect(result.success).toBe(false);
  });

  it('supports short_circuit option', () => {
    let callCount = 0;
    const evaluate: EvaluateFn = (node, _ctx, _input) => {
      callCount++;
      return {
        success: false, value: { pass: false },
        explanation: { summary: 'fail', steps: [] },
        trace: { handler_id: node.handler, handler_version: '1.0.0', duration_ms: 0, input: null, output: null, execution_path: node.handler, status: 'success' },
      };
    };
    andHandler.execute(
      { conditions: [{ handler: 'a', config: {} }, { handler: 'b', config: {} }], short_circuit: true },
      null, ctx, evaluate
    );
    expect(callCount).toBe(1);
  });
});

describe('core:or', () => {
  it('passes when any condition passes', () => {
    const evaluate = makeEvaluate(new Map([['a', false], ['b', true]]));
    const result = orHandler.execute(
      { conditions: [{ handler: 'a', config: {} }, { handler: 'b', config: {} }] },
      null, ctx, evaluate
    );
    expect(result.success).toBe(true);
  });

  it('fails when all conditions fail', () => {
    const evaluate = makeEvaluate(new Map([['a', false], ['b', false]]));
    const result = orHandler.execute(
      { conditions: [{ handler: 'a', config: {} }, { handler: 'b', config: {} }] },
      null, ctx, evaluate
    );
    expect(result.success).toBe(false);
  });
});

describe('core:not', () => {
  it('negates a passing condition', () => {
    const evaluate = makeEvaluate(new Map([['a', true]]));
    const result = notHandler.execute(
      { condition: { handler: 'a', config: {} } },
      null, ctx, evaluate
    );
    expect(result.success).toBe(false);
  });

  it('negates a failing condition', () => {
    const evaluate = makeEvaluate(new Map([['a', false]]));
    const result = notHandler.execute(
      { condition: { handler: 'a', config: {} } },
      null, ctx, evaluate
    );
    expect(result.success).toBe(true);
  });
});

describe('core:if_then', () => {
  it('runs then branch when if passes', () => {
    const evaluate: EvaluateFn = (node, _ctx, _input) => ({
      success: node.handler === 'cond' || node.handler === 'then_branch',
      value: { pass: node.handler === 'cond' || node.handler === 'then_branch' },
      explanation: { summary: node.handler, steps: [] },
      trace: { handler_id: node.handler, handler_version: '1.0.0', duration_ms: 0, input: null, output: null, execution_path: node.handler, status: 'success' },
    });
    const result = ifThenHandler.execute(
      {
        if: { handler: 'cond', config: {} },
        then: { handler: 'then_branch', config: {} },
      },
      null, ctx, evaluate
    );
    expect(result.success).toBe(true);
  });

  it('runs else branch when if fails', () => {
    const evaluate: EvaluateFn = (node, _ctx, _input) => ({
      success: node.handler !== 'cond',
      value: { pass: node.handler !== 'cond' },
      explanation: { summary: node.handler, steps: [] },
      trace: { handler_id: node.handler, handler_version: '1.0.0', duration_ms: 0, input: null, output: null, execution_path: node.handler, status: 'success' },
    });
    const result = ifThenHandler.execute(
      {
        if: { handler: 'cond', config: {} },
        then: { handler: 'then_branch', config: {} },
        else: { handler: 'else_branch', config: {} },
      },
      null, ctx, evaluate
    );
    expect(result.success).toBe(true);
  });

  it('uses default_when_skipped when no else branch', () => {
    const evaluate = makeEvaluate(new Map([['cond', false]]));
    const result = ifThenHandler.execute(
      { if: { handler: 'cond', config: {} }, then: { handler: 'then_branch', config: {} }, default_when_skipped: true },
      null, ctx, evaluate
    );
    expect(result.success).toBe(true);
  });
});
