import { describe, it, expect } from 'vitest';
import { evaluate } from './evaluator.js';
import { createDefaultRegistry } from './handlers/index.js';
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

  it('evaluates pipe: bom_sum → threshold', () => {
    const ast: ASTNode = { handler: 'core:pipe', config: { steps: [
      { handler: 'core:bom_sum', config: { source: { field: 'materials' }, field: 'lead_ppm' } },
      { handler: 'core:threshold_check', config: { value: { input_field: 'sum' }, operator: 'lt', threshold: 100 } },
    ] } };
    const r = evaluate(ast, ctx, createDefaultRegistry());
    expect(r.success).toBe(true);
  });

  it('throws on unknown handler', () => {
    expect(() => evaluate({ handler: 'core:nope', config: {} }, ctx, createDefaultRegistry())).toThrow('Unknown handler');
  });
});
