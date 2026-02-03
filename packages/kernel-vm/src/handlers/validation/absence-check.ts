import type { HandlerDefinition } from '../../handler.js';
import { resolveValue } from '../../resolve.js';
import { makeSuccess, makeFailure, now } from '../../result.js';

const ID = 'core:absence_check';
const VERSION = '1.0.0';

export const absenceCheckHandler: HandlerDefinition = {
  id: ID, version: VERSION, category: 'validation',
  description: 'Check that no prohibited items appear in source',
  execute(config, input, context, _evaluate) {
    const start = now();
    const cfg = config as { source: unknown; prohibited: unknown };
    const source = resolveValue(cfg.source, context, input);
    const prohibited = resolveValue(cfg.prohibited, context, input);
    const srcArr = Array.isArray(source) ? source : [source];
    const prohibSet = new Set(Array.isArray(prohibited) ? prohibited : [prohibited]);
    const found = srcArr.filter(item => prohibSet.has(item));
    const pass = found.length === 0;
    const opts = {
      summary: pass ? 'No prohibited items found' : `${found.length} prohibited item(s): ${found.join(', ')}`,
      steps: [{ action: 'Check against prohibited list', result: pass ? 'PASS' : 'FAIL', data: { found } }],
      handler_id: ID, handler_version: VERSION, input: cfg, execution_path: ID, duration_ms: now() - start,
    };
    const val = { pass, handler_id: ID, handler_version: VERSION, found, checked: srcArr.length };
    return pass ? makeSuccess(val, opts) : makeFailure(val, opts);
  },
};
