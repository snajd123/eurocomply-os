import type { HandlerDefinition } from '../../handler.js';
import type { ASTNode, HandlerResult } from '@eurocomply/types';
import { makeSuccess, makeFailure, now } from '../../result.js';

const ID = 'core:or';
const VERSION = '1.0.0';

export const orHandler: HandlerDefinition = {
  id: ID, version: VERSION, category: 'logic',
  description: 'Logical OR — passes when any condition passes',

  execute(config, input, context, evaluate) {
    const start = now();
    const conditions = (config as { conditions: ASTNode[]; short_circuit?: boolean }).conditions;
    const shortCircuit = (config as { short_circuit?: boolean }).short_circuit ?? false;
    const childTraces = [];
    const results: HandlerResult[] = [];

    for (const cond of conditions) {
      const child = evaluate(cond, context, input);
      results.push(child);
      childTraces.push(child.trace);
      if (child.success && shortCircuit) break;
    }

    const passed = results.filter(r => r.success).length;
    const total = conditions.length;
    const success = passed > 0;

    const opts = {
      summary: `OR: ${passed}/${total} conditions passed`,
      steps: results.map((r, i) => ({
        action: `Evaluate condition ${i}`,
        result: r.success ? 'PASS' : 'FAIL',
      })),
      handler_id: ID, handler_version: VERSION,
      input, execution_path: ID, duration_ms: now() - start,
      child_traces: childTraces,
    };

    return success
      ? makeSuccess({ pass: true, passed, total }, opts)
      : makeFailure({ pass: false, passed, total }, opts);
  },
};
