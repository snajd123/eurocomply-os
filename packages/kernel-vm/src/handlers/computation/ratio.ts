import type { HandlerDefinition } from '../../handler.js';
import { resolveValue } from '../../resolve.js';
import { makeSuccess, makeFailure, now } from '../../result.js';

const ID = 'core:ratio';
const VERSION = '1.0.0';

export const ratioHandler: HandlerDefinition = {
  id: ID,
  version: VERSION,
  category: 'computation',
  description: 'Compute ratio between two values',

  execute(config, input, context, _evaluate) {
    const start = now();
    const cfg = config as {
      numerator: unknown;
      denominator: unknown;
      multiply_by?: number;
    };

    const num = Number(resolveValue(cfg.numerator, context, input));
    const den = Number(resolveValue(cfg.denominator, context, input));

    if (den === 0) {
      return makeFailure(
        { ratio: null },
        {
          summary: 'Division by zero',
          handler_id: ID,
          handler_version: VERSION,
          input: cfg,
          execution_path: ID,
          duration_ms: now() - start,
          error: { message: 'zero denominator' },
        },
      );
    }

    const ratio = (num / den) * (cfg.multiply_by ?? 1);
    return makeSuccess(
      { ratio, numerator: num, denominator: den },
      {
        summary: `${num}/${den}${cfg.multiply_by ? ` \u00d7 ${cfg.multiply_by}` : ''} = ${ratio}`,
        handler_id: ID,
        handler_version: VERSION,
        input: cfg,
        execution_path: ID,
        duration_ms: now() - start,
      },
    );
  },
};
