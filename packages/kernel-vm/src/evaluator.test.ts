import { describe, it, expect } from 'vitest';
import { evaluate } from './evaluator.js';
import { createDefaultRegistry } from './handlers/index.js';
import { HandlerRegistry } from './registry.js';
import type { ExecutionContext, ASTNode } from '@eurocomply/types';

const ctx: ExecutionContext = {
  entity_type: 'product', entity_id: 'p1',
  entity_data: {
    lead_concentration: 0.0003,
    cadmium_concentration: 0.002,
    substances: ['CAS-123', 'CAS-456'],
    materials: [
      { id: 'm1', lead_ppm: 10, type: 'active' },
      { id: 'm2', lead_ppm: 5, type: 'active' },
    ],
  },
  data: { svhc_list: ['CAS-789', 'CAS-999'] },
  compliance_lock_id: 'lock_1', vertical_id: 'cosmetics', market: 'EU', timestamp: '2026-01-01T00:00:00Z',
};

describe('evaluate', () => {
  it('evaluates single threshold_check', () => {
    const ast: ASTNode = { handler: 'core:threshold_check', config: { value: { field: 'lead_concentration' }, operator: 'lt', threshold: 0.001 } };
    const r = evaluate(ast, ctx, createDefaultRegistry());
    expect(r.success).toBe(true);
  });

  it('evaluates AND of two checks', () => {
    const ast: ASTNode = { handler: 'core:and', config: { conditions: [
      { handler: 'core:threshold_check', config: { value: { field: 'lead_concentration' }, operator: 'lt', threshold: 0.001 } },
      { handler: 'core:threshold_check', config: { value: { field: 'cadmium_concentration' }, operator: 'lt', threshold: 0.01 } },
    ] } };
    const r = evaluate(ast, ctx, createDefaultRegistry());
    expect(r.success).toBe(true);
    expect(r.trace.child_traces).toHaveLength(2);
  });

  it('evaluates pipe: collection_sum → threshold', () => {
    const ast: ASTNode = { handler: 'core:pipe', config: { steps: [
      { handler: 'core:collection_sum', config: { source: { field: 'materials' }, field: 'lead_ppm' } },
      { handler: 'core:threshold_check', config: { value: { input_field: 'sum' }, operator: 'lt', threshold: 100 } },
    ] } };
    const r = evaluate(ast, ctx, createDefaultRegistry());
    expect(r.success).toBe(true);
  });

  it('returns structured error when handler throws', () => {
    const badRegistry = new HandlerRegistry();
    badRegistry.register({
      id: 'core:exploder',
      version: '1.0.0',
      category: 'computation',
      description: 'Always throws',
      execute() { throw new Error('kaboom'); },
    });

    const ast: ASTNode = { handler: 'core:exploder', config: {} };
    const r = evaluate(ast, ctx, badRegistry);
    expect(r.success).toBe(false);
    expect(r.trace.status).toBe('error');
    expect(r.trace.error?.message).toBe('kaboom');
    expect(r.explanation.summary).toContain('kaboom');
  });

  it('returns structured error for unknown handler instead of throwing', () => {
    const ast: ASTNode = { handler: 'core:nonexistent', config: {} };
    const r = evaluate(ast, ctx, createDefaultRegistry());
    expect(r.success).toBe(false);
    expect(r.trace.status).toBe('error');
    expect(r.trace.error?.message).toContain('Unknown handler');
  });

  it('returns timeout error when evaluation exceeds time limit', () => {
    const slowRegistry = new HandlerRegistry();
    slowRegistry.register({
      id: 'core:slow',
      version: '1.0.0',
      category: 'computation',
      description: 'Simulates a long-running handler',
      execute() {
        const end = Date.now() + 100;
        while (Date.now() < end) { /* spin */ }
        return { success: true, value: 'done', explanation: { summary: 'done', steps: [] }, trace: { handler_id: 'core:slow', handler_version: '1.0.0', duration_ms: 100, input: {}, output: 'done', execution_path: 'root', status: 'success' as const } };
      },
    });

    const ast: ASTNode = { handler: 'core:slow', config: {} };
    const r = evaluate(ast, ctx, slowRegistry, { timeout_ms: 10 });
    expect(r.success).toBe(false);
    expect(r.trace.status).toBe('error');
    expect(r.trace.error?.message).toContain('timeout');
  });

  it('succeeds when evaluation completes within time limit', () => {
    const ast: ASTNode = { handler: 'core:threshold_check', config: { value: { field: 'lead_concentration' }, operator: 'lt', threshold: 0.001 } };
    const r = evaluate(ast, ctx, createDefaultRegistry(), { timeout_ms: 5000 });
    expect(r.success).toBe(true);
  });
});
