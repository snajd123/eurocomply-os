import { describe, it, expect } from 'vitest';
import { portfolioDiff } from './portfolio-diff.js';
import { createDefaultRegistry } from './handlers/index.js';
import type { ASTNode } from '@eurocomply/types';

describe('Portfolio Diff', () => {
  const registry = createDefaultRegistry();

  const oldRule: ASTNode = {
    handler: 'core:threshold_check',
    config: { value: { field: 'lead_ppm' }, operator: 'lt', threshold: 20 },
    label: 'Lead below 20 ppm',
  };

  const newRule: ASTNode = {
    handler: 'core:threshold_check',
    config: { value: { field: 'lead_ppm' }, operator: 'lt', threshold: 10 },
    label: 'Lead below 10 ppm (stricter)',
  };

  const entities = [
    { entity_id: 'p1', entity_type: 'product', data: { lead_ppm: 5 } },
    { entity_id: 'p2', entity_type: 'product', data: { lead_ppm: 15 } },
    { entity_id: 'p3', entity_type: 'product', data: { lead_ppm: 25 } },
  ];

  it('should detect status changes when rule becomes stricter', () => {
    const diff = portfolioDiff({ oldRule, newRule, entities, registry, verticalId: 'test' });
    expect(diff.totalEvaluated).toBe(3);
    // p1: pass->pass, p2: pass->fail (changed), p3: fail->fail
    expect(diff.statusChanges).toHaveLength(1);
    expect(diff.statusChanges[0].entity_id).toBe('p2');
    expect(diff.statusChanges[0].oldStatus).toBe('compliant');
    expect(diff.statusChanges[0].newStatus).toBe('non_compliant');
  });

  it('should report no changes when rules are identical', () => {
    const diff = portfolioDiff({ oldRule, newRule: oldRule, entities, registry, verticalId: 'test' });
    expect(diff.statusChanges).toHaveLength(0);
  });

  it('should handle first-time install (no old rule)', () => {
    const diff = portfolioDiff({ oldRule: null, newRule, entities, registry, verticalId: 'test' });
    expect(diff.totalEvaluated).toBe(3);
    expect(diff.newEvaluations).toBe(3);
  });
});
