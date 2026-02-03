import type { HandlerDefinition } from '../../handler.js';
import type { ASTNode } from '@eurocomply/types';
import { resolveValue } from '../../resolve.js';
import { makeSuccess, makeFailure, now } from '../../result.js';

const ID = 'core:for_each';
const VERSION = '1.0.0';

export const forEachHandler: HandlerDefinition = {
  id: ID, version: VERSION, category: 'logic',
  description: 'Iterate over a collection and apply validation to each item',

  execute(config, input, context, evaluate) {
    const start = now();
    const cfg = config as {
      source: unknown;
      validation: ASTNode;
      require: 'all' | 'any' | 'none';
    };

    const items = resolveValue(cfg.source, context, input);
    if (!Array.isArray(items)) {
      return makeFailure({ pass: false, error: 'source is not an array' }, {
        summary: 'for_each: source did not resolve to an array',
        handler_id: ID, handler_version: VERSION,
        input, execution_path: ID, duration_ms: now() - start,
        error: { message: 'source is not an array' },
      });
    }

    const childTraces = [];
    const results: { index: number; success: boolean; item: unknown }[] = [];

    for (let i = 0; i < items.length; i++) {
      const itemResult = evaluate(cfg.validation, context, items[i]);
      childTraces.push(itemResult.trace);
      results.push({ index: i, success: itemResult.success, item: items[i] });
    }

    const passed = results.filter(r => r.success).length;
    const total = results.length;

    let success: boolean;
    switch (cfg.require) {
      case 'all': success = passed === total; break;
      case 'any': success = passed > 0; break;
      case 'none': success = passed === 0; break;
      default: success = passed === total;
    }

    const failures = results.filter(r => !r.success);
    const opts = {
      summary: `for_each (${cfg.require}): ${passed}/${total} passed`,
      steps: results.map((r) => ({
        action: `Item ${r.index}`,
        result: r.success ? 'PASS' : 'FAIL',
      })),
      handler_id: ID, handler_version: VERSION,
      input, execution_path: ID, duration_ms: now() - start,
      child_traces: childTraces,
    };

    const value = { pass: success, passed, total, failures: failures.map(f => ({ index: f.index, item: f.item })) };
    return success ? makeSuccess(value, opts) : makeFailure(value, opts);
  },
};
