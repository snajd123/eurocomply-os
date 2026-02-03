import { describe, it, expect } from 'vitest';
import { Simulator } from './simulator.js';
import { createDefaultRegistry } from './handlers/index.js';
import type { ASTNode } from '@eurocomply/types';

const registry = createDefaultRegistry();
const rule: ASTNode = { handler: 'core:and', config: { conditions: [
  { handler: 'core:threshold_check', config: { value: { field: 'lead_ppm' }, operator: 'lt', threshold: 100 } },
  { handler: 'core:absence_check', config: { source: { field: 'substances' }, prohibited: { data_key: 'banned' } } },
] } };

describe('Simulator', () => {
  it('runs suite and reports all pass', () => {
    const sim = new Simulator(registry);
    const report = sim.run(rule, { vertical_id: 'test', test_cases: [
      { id: 'tc1', description: 'clean', entity_data: { lead_ppm: 5, substances: ['A'] }, context_data: { banned: ['Z'] }, expected_status: 'compliant' },
      { id: 'tc2', description: 'dirty', entity_data: { lead_ppm: 200, substances: ['A'] }, context_data: { banned: ['Z'] }, expected_status: 'non_compliant' },
    ] });
    expect(report.passed).toBe(2);
    expect(report.failed).toBe(0);
  });

  it('reports mismatch', () => {
    const sim = new Simulator(registry);
    const report = sim.run(rule, { vertical_id: 'test', test_cases: [
      { id: 'tc1', description: 'wrong expectation', entity_data: { lead_ppm: 200, substances: [] }, context_data: { banned: [] }, expected_status: 'compliant' },
    ] });
    expect(report.failed).toBe(1);
    expect(report.results[0].match).toBe(false);
  });

  it('validates AST before running', () => {
    const sim = new Simulator(registry);
    const report = sim.run({ handler: 'core:nope', config: {} }, { vertical_id: 'test', test_cases: [] });
    expect(report.ast_valid).toBe(false);
  });

  it('includes traces', () => {
    const sim = new Simulator(registry);
    const report = sim.run(rule, { vertical_id: 'test', test_cases: [
      { id: 'tc1', description: 'basic', entity_data: { lead_ppm: 5, substances: [] }, context_data: { banned: [] }, expected_status: 'compliant' },
    ] });
    expect(report.results[0].trace.handler_id).toBe('core:and');
  });
});
