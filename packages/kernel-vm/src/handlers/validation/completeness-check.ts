import type { HandlerDefinition } from '../../handler.js';
import { resolveValue, getNestedValue } from '../../resolve.js';
import { makeSuccess, makeFailure, now } from '../../result.js';

const ID = 'core:completeness_check';
const VERSION = '1.0.0';

export const completenessCheckHandler: HandlerDefinition = {
  id: ID, version: VERSION, category: 'validation',
  description: 'Check that required fields are present and non-empty',
  execute(config, input, context, _evaluate) {
    const start = now();
    const cfg = config as { entity: unknown; required_fields: string[]; minimum_completion?: number };
    let entity: unknown;
    if (typeof cfg.entity === 'object' && cfg.entity !== null && 'field' in cfg.entity) {
      const ref = cfg.entity as { field: string };
      entity = ref.field === '' ? context.entity_data : resolveValue(cfg.entity, context, input);
    } else {
      entity = resolveValue(cfg.entity, context, input);
    }
    const present: string[] = [];
    const missing: string[] = [];
    for (const f of cfg.required_fields) {
      const v = getNestedValue(entity, f);
      if (v != null && v !== '' && !(Array.isArray(v) && v.length === 0)) present.push(f);
      else missing.push(f);
    }
    const completion = cfg.required_fields.length > 0 ? present.length / cfg.required_fields.length : 1;
    const pass = completion >= (cfg.minimum_completion ?? 1.0);
    const opts = {
      summary: `Completeness: ${present.length}/${cfg.required_fields.length} (${(completion * 100).toFixed(0)}%) → ${pass ? 'PASS' : 'FAIL'}`,
      steps: [{ action: 'Check required fields', result: pass ? 'PASS' : 'FAIL', data: { present, missing } }],
      handler_id: ID, handler_version: VERSION, input: cfg, execution_path: ID, duration_ms: now() - start,
    };
    const val = { pass, handler_id: ID, handler_version: VERSION, present, missing, completion };
    return pass ? makeSuccess(val, opts) : makeFailure(val, opts);
  },
};
