import type { HandlerDefinition } from '../../handler.js';
import type { ASTNode } from '@eurocomply/types';
import { makeSuccess, makeFailure, now } from '../../result.js';

const ID = 'core:not';
const VERSION = '1.0.0';

export const notHandler: HandlerDefinition = {
  id: ID, version: VERSION, category: 'logic',
  description: 'Logical NOT — negates the result of a condition',

  execute(config, input, context, evaluate) {
    const start = now();
    const condition = (config as { condition: ASTNode }).condition;
    const child = evaluate(condition, context, input);
    const success = !child.success;

    const opts = {
      summary: `NOT: ${child.success ? 'PASS->FAIL' : 'FAIL->PASS'}`,
      steps: [{ action: 'Negate condition', result: success ? 'PASS' : 'FAIL' }],
      handler_id: ID, handler_version: VERSION,
      input, execution_path: ID, duration_ms: now() - start,
      child_traces: [child.trace],
    };

    return success
      ? makeSuccess({ pass: true, negated: true }, opts)
      : makeFailure({ pass: false, negated: true }, opts);
  },
};
