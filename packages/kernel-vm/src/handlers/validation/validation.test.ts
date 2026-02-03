import { describe, it, expect } from 'vitest';
import { thresholdCheckHandler } from './threshold-check.js';
import { absenceCheckHandler } from './absence-check.js';
import { listCheckHandler } from './list-check.js';
import { completenessCheckHandler } from './completeness-check.js';
import type { ExecutionContext } from '@eurocomply/types';

const noopEvaluate = () => { throw new Error('should not be called'); };

const ctx: ExecutionContext = {
  entity_type: 'product', entity_id: 'p1',
  entity_data: {
    lead_concentration: 0.0003,
    substances: ['CAS-123', 'CAS-789'],
    name: 'Test Product',
    weight: 100,
  },
  data: {
    svhc_list: ['CAS-456', 'CAS-789'],
    approved_list: ['CAS-123', 'CAS-789', 'CAS-999'],
  },
  compliance_lock_id: 'lock_1', vertical_id: 'cosmetics',
  market: 'EU', timestamp: '2026-01-01T00:00:00Z',
};

describe('core:threshold_check', () => {
  it('passes when value < threshold', () => {
    const result = thresholdCheckHandler.execute(
      { value: { field: 'lead_concentration' }, operator: 'lt', threshold: 0.001 },
      null, ctx, noopEvaluate
    );
    expect(result.success).toBe(true);
  });

  it('fails when value >= threshold', () => {
    const result = thresholdCheckHandler.execute(
      { value: { field: 'lead_concentration' }, operator: 'lt', threshold: 0.0001 },
      null, ctx, noopEvaluate
    );
    expect(result.success).toBe(false);
  });

  it('supports all operators', () => {
    expect(thresholdCheckHandler.execute({ value: 10, operator: 'gt', threshold: 5 }, null, ctx, noopEvaluate).success).toBe(true);
    expect(thresholdCheckHandler.execute({ value: 5, operator: 'gte', threshold: 5 }, null, ctx, noopEvaluate).success).toBe(true);
    expect(thresholdCheckHandler.execute({ value: 5, operator: 'lte', threshold: 5 }, null, ctx, noopEvaluate).success).toBe(true);
    expect(thresholdCheckHandler.execute({ value: 5, operator: 'eq', threshold: 5 }, null, ctx, noopEvaluate).success).toBe(true);
    expect(thresholdCheckHandler.execute({ value: 5, operator: 'ne', threshold: 6 }, null, ctx, noopEvaluate).success).toBe(true);
  });

  it('supports tolerance', () => {
    const result = thresholdCheckHandler.execute(
      { value: 0.001, operator: 'lt', threshold: 0.001, tolerance: 0.0001 },
      null, ctx, noopEvaluate
    );
    expect(result.success).toBe(true);
  });
});

describe('core:absence_check', () => {
  it('passes when no prohibited items found', () => {
    const result = absenceCheckHandler.execute(
      { source: { field: 'substances' }, prohibited: { data_key: 'svhc_list' } },
      null,
      { ...ctx, entity_data: { ...ctx.entity_data, substances: ['CAS-123'] } },
      noopEvaluate
    );
    expect(result.success).toBe(true);
  });

  it('fails when prohibited items found', () => {
    const result = absenceCheckHandler.execute(
      { source: { field: 'substances' }, prohibited: { data_key: 'svhc_list' } },
      null, ctx, noopEvaluate
    );
    expect(result.success).toBe(false);
    expect((result.value as any).found).toContain('CAS-789');
  });
});

describe('core:list_check', () => {
  it('passes when all values in allowlist', () => {
    const result = listCheckHandler.execute(
      { value: { field: 'substances' }, list_source: { data_key: 'approved_list' }, list_type: 'allowlist' },
      null, ctx, noopEvaluate
    );
    expect(result.success).toBe(true);
  });

  it('fails when values in blocklist', () => {
    const result = listCheckHandler.execute(
      { value: { field: 'substances' }, list_source: { data_key: 'svhc_list' }, list_type: 'blocklist' },
      null, ctx, noopEvaluate
    );
    expect(result.success).toBe(false);
  });
});

describe('core:completeness_check', () => {
  it('passes when all required fields present', () => {
    const result = completenessCheckHandler.execute(
      { entity: { field: '' }, required_fields: ['name', 'weight'] },
      null, ctx, noopEvaluate
    );
    expect(result.success).toBe(true);
  });

  it('fails when required fields missing', () => {
    const result = completenessCheckHandler.execute(
      { entity: { field: '' }, required_fields: ['name', 'description', 'category'] },
      null, ctx, noopEvaluate
    );
    expect(result.success).toBe(false);
    expect((result.value as any).missing).toContain('description');
  });

  it('supports minimum_completion percentage', () => {
    const result = completenessCheckHandler.execute(
      { entity: { field: '' }, required_fields: ['name', 'weight', 'description', 'category'], minimum_completion: 0.5 },
      null, ctx, noopEvaluate
    );
    expect(result.success).toBe(true); // 2/4 = 50%
  });
});
