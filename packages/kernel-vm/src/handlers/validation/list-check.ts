import type { HandlerDefinition } from '../../handler.js';
import { resolveValue } from '../../resolve.js';
import { makeSuccess, makeFailure, now } from '../../result.js';

const ID = 'core:list_check';
const VERSION = '1.0.0';

export const listCheckHandler: HandlerDefinition = {
  id: ID, version: VERSION, category: 'validation',
  description: 'Check if values appear in an allowlist or blocklist',
  execute(config, input, context, _evaluate) {
    const start = now();
    const cfg = config as { value: unknown; list_source: unknown; list_type: 'allowlist' | 'blocklist' };
    const values = resolveValue(cfg.value, context, input);
    const list = resolveValue(cfg.list_source, context, input);
    const vArr = Array.isArray(values) ? values : [values];
    const lSet = new Set(Array.isArray(list) ? list : [list]);
    const inList = vArr.filter(v => lSet.has(v));
    const notInList = vArr.filter(v => !lSet.has(v));
    const pass = cfg.list_type === 'allowlist' ? notInList.length === 0 : inList.length === 0;
    const opts = {
      summary: `${cfg.list_type}: ${inList.length}/${vArr.length} in list → ${pass ? 'PASS' : 'FAIL'}`,
      steps: [{ action: `Check ${cfg.list_type}`, result: pass ? 'PASS' : 'FAIL', data: { in_list: inList, not_in_list: notInList } }],
      handler_id: ID, handler_version: VERSION, input: cfg, execution_path: ID, duration_ms: now() - start,
    };
    const val = { pass, handler_id: ID, handler_version: VERSION, list_type: cfg.list_type, in_list: inList, not_in_list: notInList };
    return pass ? makeSuccess(val, opts) : makeFailure(val, opts);
  },
};
