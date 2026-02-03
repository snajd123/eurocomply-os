import { describe, it, expect } from 'vitest';
import { resolveValue, getNestedValue, isFieldReference, isDataReference } from './resolve.js';
import type { ExecutionContext } from '@eurocomply/types';

const ctx: ExecutionContext = {
  entity_type: 'product',
  entity_id: 'prod_1',
  entity_data: {
    name: 'Test Product',
    concentration: 0.05,
    materials: [
      { id: 'm1', name: 'Water', concentration: 0.8 },
      { id: 'm2', name: 'Ethanol', concentration: 0.15 },
    ],
  },
  data: {
    reach_svhc_list: ['CAS-123', 'CAS-456'],
  },
  compliance_lock_id: 'lock_1',
  vertical_id: 'cosmetics',
  market: 'EU',
  timestamp: '2026-01-01T00:00:00Z',
};

describe('getNestedValue', () => {
  it('gets top-level field', () => {
    expect(getNestedValue({ a: 1 }, 'a')).toBe(1);
  });
  it('gets nested field with dot notation', () => {
    expect(getNestedValue({ a: { b: { c: 3 } } }, 'a.b.c')).toBe(3);
  });
  it('gets array element by index', () => {
    expect(getNestedValue({ items: [10, 20] }, 'items.1')).toBe(20);
  });
  it('returns undefined for missing path', () => {
    expect(getNestedValue({ a: 1 }, 'b.c')).toBeUndefined();
  });
});

describe('isFieldReference / isDataReference', () => {
  it('detects field reference', () => {
    expect(isFieldReference({ field: 'name' })).toBe(true);
    expect(isFieldReference('literal')).toBe(false);
    expect(isFieldReference(42)).toBe(false);
  });
  it('detects data reference', () => {
    expect(isDataReference({ data_key: 'svhc' })).toBe(true);
    expect(isDataReference({ field: 'name' })).toBe(false);
  });
});

describe('resolveValue', () => {
  it('resolves field reference from entity_data', () => {
    expect(resolveValue({ field: 'concentration' }, ctx)).toBe(0.05);
  });
  it('resolves nested field reference', () => {
    expect(resolveValue({ field: 'materials.0.name' }, ctx)).toBe('Water');
  });
  it('resolves data reference from context.data', () => {
    expect(resolveValue({ data_key: 'reach_svhc_list' }, ctx)).toEqual(['CAS-123', 'CAS-456']);
  });
  it('returns literal values unchanged', () => {
    expect(resolveValue(42, ctx)).toBe(42);
    expect(resolveValue('hello', ctx)).toBe('hello');
  });
  it('resolves from input when input_field reference', () => {
    expect(resolveValue({ input_field: 'result' }, ctx, { result: 99 })).toBe(99);
  });
});
