import type { HandlerDefinition } from '../../handler.js';
import type { ASTNode } from '@eurocomply/types';
import { makeSuccess, makeFailure, now } from '../../result.js';

const ID = 'core:if_then';
const VERSION = '1.0.0';

export const ifThenHandler: HandlerDefinition = {
  id: ID, version: VERSION, category: 'logic',
  description: 'Conditional branching — evaluates then or else based on if condition',

  execute(config, input, context, evaluate) {
    const start = now();
    const cfg = config as {
      if: ASTNode;
      then: ASTNode;
      else?: ASTNode;
      default_when_skipped?: boolean;
    };

    const condResult = evaluate(cfg.if, context, input);
    const childTraces = [condResult.trace];

    if (condResult.success) {
      const thenResult = evaluate(cfg.then, context, input);
      childTraces.push(thenResult.trace);
      const opts = {
        summary: `IF passed -> THEN ${thenResult.success ? 'PASS' : 'FAIL'}`,
        steps: [
          { action: 'Evaluate IF condition', result: 'PASS' },
          { action: 'Evaluate THEN branch', result: thenResult.success ? 'PASS' : 'FAIL' },
        ],
        handler_id: ID, handler_version: VERSION,
        input, execution_path: ID, duration_ms: now() - start,
        child_traces: childTraces,
      };
      return thenResult.success
        ? makeSuccess({ pass: true, branch: 'then' }, opts)
        : makeFailure({ pass: false, branch: 'then' }, opts);
    }

    if (cfg.else) {
      const elseResult = evaluate(cfg.else, context, input);
      childTraces.push(elseResult.trace);
      const opts = {
        summary: `IF failed -> ELSE ${elseResult.success ? 'PASS' : 'FAIL'}`,
        steps: [
          { action: 'Evaluate IF condition', result: 'FAIL' },
          { action: 'Evaluate ELSE branch', result: elseResult.success ? 'PASS' : 'FAIL' },
        ],
        handler_id: ID, handler_version: VERSION,
        input, execution_path: ID, duration_ms: now() - start,
        child_traces: childTraces,
      };
      return elseResult.success
        ? makeSuccess({ pass: true, branch: 'else' }, opts)
        : makeFailure({ pass: false, branch: 'else' }, opts);
    }

    const defaultResult = cfg.default_when_skipped ?? false;
    const opts = {
      summary: `IF failed -> skipped (default: ${defaultResult})`,
      steps: [{ action: 'Evaluate IF condition', result: 'FAIL' }, { action: 'No ELSE branch', result: 'SKIPPED' }],
      handler_id: ID, handler_version: VERSION,
      input, execution_path: ID, duration_ms: now() - start,
      child_traces: childTraces,
    };
    return defaultResult
      ? makeSuccess({ pass: true, branch: 'skipped' }, opts)
      : makeFailure({ pass: false, branch: 'skipped' }, opts);
  },
};
