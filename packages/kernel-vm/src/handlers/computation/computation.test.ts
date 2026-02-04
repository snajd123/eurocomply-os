import { describe, it, expect } from 'vitest';
import { collectionSumHandler } from './collection-sum.js';
import { unitConvertHandler } from './unit-convert.js';
import { ratioHandler } from './ratio.js';
import type { ExecutionContext } from '@eurocomply/types';

const noopEvaluate = () => { throw new Error('should not be called'); };
const ctx: ExecutionContext = {
  entity_type: 'product', entity_id: 'p1',
  entity_data: {
    materials: [
      { id: 'm1', lead_ppm: 10, type: 'active' },
      { id: 'm2', lead_ppm: 20, type: 'excipient' },
      { id: 'm3', lead_ppm: 5, type: 'active' },
    ],
    total_weight: 500,
    active_concentration: 0.15,
  },
  data: {}, compliance_lock_id: 'lock_1',
  vertical_id: 'cosmetics', market: 'EU', timestamp: '2026-01-01T00:00:00Z',
};

describe('core:collection_sum', () => {
  it('sums a field across all items', () => {
    const r = collectionSumHandler.execute({ source: { field: 'materials' }, field: 'lead_ppm' }, null, ctx, noopEvaluate);
    expect(r.success).toBe(true);
    expect((r.value as any).sum).toBe(35);
  });
  it('applies filter', () => {
    const r = collectionSumHandler.execute({ source: { field: 'materials' }, field: 'lead_ppm', filter: { field: 'type', equals: 'active' } }, null, ctx, noopEvaluate);
    expect((r.value as any).sum).toBe(15);
  });

  it('returns failure when items have non-numeric field values', () => {
    const ctxWithBadData: ExecutionContext = {
      ...ctx,
      entity_data: {
        ...ctx.entity_data,
        materials: [
          { id: 'm1', lead_ppm: 10, type: 'active' },
          { id: 'm2', lead_ppm: 'not-a-number', type: 'active' },
          { id: 'm3', lead_ppm: 5, type: 'active' },
        ],
      },
    };
    const r = collectionSumHandler.execute({ source: { field: 'materials' }, field: 'lead_ppm' }, null, ctxWithBadData, noopEvaluate);
    expect(r.success).toBe(false);
    expect((r.value as any).nan_indices).toEqual([1]);
  });

  it('returns failure when items have undefined field values', () => {
    const ctxWithMissing: ExecutionContext = {
      ...ctx,
      entity_data: {
        ...ctx.entity_data,
        materials: [
          { id: 'm1', lead_ppm: 10 },
          { id: 'm2' },
          { id: 'm3', lead_ppm: 5 },
        ],
      },
    };
    const r = collectionSumHandler.execute({ source: { field: 'materials' }, field: 'lead_ppm' }, null, ctxWithMissing, noopEvaluate);
    expect(r.success).toBe(false);
    expect((r.value as any).nan_indices).toEqual([1]);
  });
});

describe('core:unit_convert', () => {
  it('converts ppm to percent', () => {
    const r = unitConvertHandler.execute({ source_value: 10000, source_unit: 'ppm', target_unit: 'percent' }, null, ctx, noopEvaluate);
    expect((r.value as any).converted).toBe(1);
  });
  it('converts kg to g', () => {
    const r = unitConvertHandler.execute({ source_value: 2.5, source_unit: 'kg', target_unit: 'g' }, null, ctx, noopEvaluate);
    expect((r.value as any).converted).toBe(2500);
  });
  it('fails on unsupported conversion', () => {
    const r = unitConvertHandler.execute({ source_value: 100, source_unit: 'kg', target_unit: 'ppm' }, null, ctx, noopEvaluate);
    expect(r.success).toBe(false);
  });
  it('resolves field references', () => {
    const r = unitConvertHandler.execute({ source_value: { field: 'total_weight' }, source_unit: 'g', target_unit: 'kg' }, null, ctx, noopEvaluate);
    expect((r.value as any).converted).toBe(0.5);
  });
});

describe('core:ratio', () => {
  it('computes ratio', () => {
    const r = ratioHandler.execute({ numerator: { field: 'active_concentration' }, denominator: 1 }, null, ctx, noopEvaluate);
    expect((r.value as any).ratio).toBe(0.15);
  });
  it('supports multiply_by', () => {
    const r = ratioHandler.execute({ numerator: { field: 'active_concentration' }, denominator: 1, multiply_by: 100 }, null, ctx, noopEvaluate);
    expect((r.value as any).ratio).toBe(15);
  });
  it('fails on division by zero', () => {
    const r = ratioHandler.execute({ numerator: 10, denominator: 0 }, null, ctx, noopEvaluate);
    expect(r.success).toBe(false);
  });
});
