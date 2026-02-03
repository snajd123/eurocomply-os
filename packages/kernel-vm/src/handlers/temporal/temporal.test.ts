import { describe, it, expect } from 'vitest';
import { deadlineHandler } from './deadline.js';
import type { ExecutionContext } from '@eurocomply/types';
const noopEvaluate = () => { throw new Error('unused'); };

describe('core:deadline', () => {
  it('within_window when deadline not reached', () => {
    const ctx: ExecutionContext = {
      entity_type: 'product', entity_id: 'p1',
      entity_data: { submitted_at: '2026-01-01T00:00:00Z' },
      data: {}, compliance_lock_id: 'lock_1', vertical_id: 'test', market: 'EU',
      timestamp: '2026-01-15T00:00:00Z',
    };
    const r = deadlineHandler.execute({ window: { duration: { value: 30, unit: 'days' }, started_at: { field: 'submitted_at' } }, on_expired: 'fail' }, null, ctx, noopEvaluate);
    expect(r.success).toBe(true);
    expect((r.value as any).status).toBe('within_window');
  });

  it('expired when deadline passed', () => {
    const ctx: ExecutionContext = {
      entity_type: 'product', entity_id: 'p1',
      entity_data: { submitted_at: '2025-01-01T00:00:00Z' },
      data: {}, compliance_lock_id: 'lock_1', vertical_id: 'test', market: 'EU',
      timestamp: '2026-01-15T00:00:00Z',
    };
    const r = deadlineHandler.execute({ window: { duration: { value: 30, unit: 'days' }, started_at: { field: 'submitted_at' } }, on_expired: 'fail' }, null, ctx, noopEvaluate);
    expect(r.success).toBe(false);
    expect((r.value as any).status).toBe('expired');
  });

  it('uses context.timestamp for determinism', () => {
    const ctx: ExecutionContext = {
      entity_type: 'product', entity_id: 'p1',
      entity_data: { submitted_at: '2026-01-01T00:00:00Z' },
      data: {}, compliance_lock_id: 'lock_1', vertical_id: 'test', market: 'EU',
      timestamp: '2026-02-01T00:00:00Z', // 31 days
    };
    const r = deadlineHandler.execute({ window: { duration: { value: 30, unit: 'days' }, started_at: { field: 'submitted_at' } }, on_expired: 'fail' }, null, ctx, noopEvaluate);
    expect(r.success).toBe(false);
  });
});
