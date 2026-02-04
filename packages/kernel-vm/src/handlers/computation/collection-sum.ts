import type { HandlerDefinition } from '../../handler.js';
import { resolveValue, getNestedValue } from '../../resolve.js';
import { makeSuccess, makeFailure, now } from '../../result.js';

const ID = 'core:collection_sum';
const VERSION = '1.0.0';

export const collectionSumHandler: HandlerDefinition = {
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

    let sum = 0;
    const nanIndices: number[] = [];
    for (let i = 0; i < items.length; i++) {
      const raw = getNestedValue(items[i], cfg.field);
      const num = Number(raw);
      if (Number.isNaN(num)) {
        nanIndices.push(i);
      } else {
        sum += num;
      }
    }

    if (nanIndices.length > 0) {
      return makeFailure(
        { sum, items_counted: items.length, nan_indices: nanIndices },
        {
          summary: `Non-numeric values at indices [${nanIndices.join(', ')}] for field '${cfg.field}'`,
          handler_id: ID,
          handler_version: VERSION,
          input: cfg,
          execution_path: ID,
          duration_ms: now() - start,
          error: { message: `${nanIndices.length} item(s) had non-numeric '${cfg.field}' values` },
        },
      );
    }

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
