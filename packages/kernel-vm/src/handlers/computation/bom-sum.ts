import type { HandlerDefinition } from '../../handler.js';
import { resolveValue, getNestedValue } from '../../resolve.js';
import { makeSuccess, makeFailure, now } from '../../result.js';

const ID = 'core:bom_sum';
const VERSION = '1.0.0';

export const bomSumHandler: HandlerDefinition = {
  id: ID,
  version: VERSION,
  category: 'computation',
  description: 'Sum a numeric field across items in a collection',

  execute(config, input, context, _evaluate) {
    const start = now();
    const cfg = config as {
      source: unknown;
      field: string;
      filter?: { field: string; equals: unknown };
    };

    const source = resolveValue(cfg.source, context, input);
    if (!Array.isArray(source)) {
      return makeFailure(
        { sum: 0 },
        {
          summary: 'source is not array',
          handler_id: ID,
          handler_version: VERSION,
          input: cfg,
          execution_path: ID,
          duration_ms: now() - start,
          error: { message: 'not array' },
        },
      );
    }

    let items = source;
    if (cfg.filter) {
      items = items.filter(
        (item) => getNestedValue(item, cfg.filter!.field) === cfg.filter!.equals,
      );
    }

    const sum = items.reduce(
      (a, item) => a + (Number(getNestedValue(item, cfg.field)) || 0),
      0,
    );

    return makeSuccess(
      { sum, items_counted: items.length },
      {
        summary: `Sum '${cfg.field}': ${sum} (${items.length} items)`,
        handler_id: ID,
        handler_version: VERSION,
        input: cfg,
        execution_path: ID,
        duration_ms: now() - start,
      },
    );
  },
};
