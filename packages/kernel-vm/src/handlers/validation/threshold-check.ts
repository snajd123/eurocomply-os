import type { HandlerDefinition } from '../../handler.js';
import { resolveValue } from '../../resolve.js';
import { makeSuccess, makeFailure, now } from '../../result.js';

const ID = 'core:threshold_check';
const VERSION = '1.0.0';
type Op = 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'ne';

function compare(v: number, op: Op, t: number, tol = 0): boolean {
  switch (op) {
    case 'gt':  return v > t - tol;
    case 'gte': return v >= t - tol;
    case 'lt':  return v < t + tol;
    case 'lte': return v <= t + tol;
    case 'eq':  return Math.abs(v - t) <= tol;
    case 'ne':  return Math.abs(v - t) > tol;
  }
}

export const thresholdCheckHandler: HandlerDefinition = {
  id: ID, version: VERSION, category: 'validation',
  description: 'Check if a numeric value meets a threshold condition',
  execute(config, input, context, _evaluate) {
    const start = now();
    const cfg = config as { value: unknown; operator: Op; threshold: number; tolerance?: number };
    const resolved = resolveValue(cfg.value, context, input);
    const value = typeof resolved === 'number' ? resolved : Number(resolved);
    const pass = compare(value, cfg.operator, cfg.threshold, cfg.tolerance);
    const opts = {
      summary: `${value} ${cfg.operator} ${cfg.threshold} → ${pass ? 'PASS' : 'FAIL'}`,
      steps: [{ action: 'Compare value to threshold', result: `${value} ${cfg.operator} ${cfg.threshold}` }],
      handler_id: ID, handler_version: VERSION,
      input: cfg, execution_path: ID, duration_ms: now() - start,
    };
    const val = { pass, handler_id: ID, handler_version: VERSION, value, threshold: cfg.threshold, operator: cfg.operator };
    return pass ? makeSuccess(val, opts) : makeFailure(val, opts);
  },
};
