import { describe, it, expect } from 'vitest';
import { pipeHandler } from './pipe.js';
import { forEachHandler } from './for-each.js';
import type { ExecutionContext, ASTNode, HandlerResult } from '@eurocomply/types';
import type { EvaluateFn } from '../../handler.js';

const ctx: ExecutionContext = {
  entity_type: 'product', entity_id: 'p1',
  entity_data: {
    materials: [
      { id: 'm1', name: 'Water', concentration: 0.8 },
      { id: 'm2', name: 'Lead', concentration: 0.002 },
    ],
  },
  data: {}, compliance_lock_id: 'lock_1',
  vertical_id: 'test', market: 'EU', timestamp: '2026-01-01T00:00:00Z',
};

describe('core:pipe', () => {
  it('chains handler outputs — each step receives previous output', () => {
    let callIndex = 0;
    const evaluate: EvaluateFn = (_node, _ctx, input) => {
      callIndex++;
      const val = ((input as number) ?? 0) + 10;
      return {
        success: true, value: val,
        explanation: { summary: `step ${callIndex}`, steps: [] },
        trace: { handler_id: 'step', handler_version: '1.0.0', duration_ms: 0, input, output: val, execution_path: 'step', status: 'success' },
      };
    };
    const result = pipeHandler.execute(
      { steps: [{ handler: 'a', config: {} }, { handler: 'b', config: {} }] },
      0, ctx, evaluate
    );
    expect(result.success).toBe(true);
    expect(result.value).toBe(20); // 0 + 10 + 10
  });

  it('stops on first failure', () => {
    let callCount = 0;
    const evaluate: EvaluateFn = (_node, _ctx, _input) => {
      callCount++;
      return {
        success: false, value: null,
        explanation: { summary: 'fail', steps: [] },
        trace: { handler_id: 'step', handler_version: '1.0.0', duration_ms: 0, input: null, output: null, execution_path: 'step', status: 'failed' },
      };
    };
    const result = pipeHandler.execute(
      { steps: [{ handler: 'a', config: {} }, { handler: 'b', config: {} }] },
      null, ctx, evaluate
    );
    expect(result.success).toBe(false);
    expect(callCount).toBe(1);
  });
});

describe('core:for_each', () => {
  it('passes when all items pass (require: all)', () => {
    const evaluate: EvaluateFn = (_node, _ctx, input) => {
      const item = input as { concentration: number };
      const pass = item.concentration < 1;
      return {
        success: pass, value: { pass },
        explanation: { summary: pass ? 'ok' : 'fail', steps: [] },
        trace: { handler_id: 'check', handler_version: '1.0.0', duration_ms: 0, input, output: { pass }, execution_path: 'check', status: 'success' },
      };
    };
    const result = forEachHandler.execute(
      { source: { field: 'materials' }, validation: { handler: 'check', config: {} }, require: 'all' },
      null, ctx, evaluate
    );
    expect(result.success).toBe(true);
  });

  it('fails when any item fails (require: all)', () => {
    const evaluate: EvaluateFn = (_node, _ctx, input) => {
      const item = input as { concentration: number };
      const pass = item.concentration < 0.5;
      return {
        success: pass, value: { pass },
        explanation: { summary: pass ? 'ok' : 'fail', steps: [] },
        trace: { handler_id: 'check', handler_version: '1.0.0', duration_ms: 0, input, output: { pass }, execution_path: 'check', status: 'success' },
      };
    };
    const result = forEachHandler.execute(
      { source: { field: 'materials' }, validation: { handler: 'check', config: {} }, require: 'all' },
      null, ctx, evaluate
    );
    expect(result.success).toBe(false);
  });

  it('passes when any item passes (require: any)', () => {
    const evaluate: EvaluateFn = (_node, _ctx, input) => {
      const item = input as { concentration: number };
      const pass = item.concentration < 0.5;
      return {
        success: pass, value: { pass },
        explanation: { summary: pass ? 'ok' : 'fail', steps: [] },
        trace: { handler_id: 'check', handler_version: '1.0.0', duration_ms: 0, input, output: { pass }, execution_path: 'check', status: 'success' },
      };
    };
    const result = forEachHandler.execute(
      { source: { field: 'materials' }, validation: { handler: 'check', config: {} }, require: 'any' },
      null, ctx, evaluate
    );
    expect(result.success).toBe(true);
  });
});
