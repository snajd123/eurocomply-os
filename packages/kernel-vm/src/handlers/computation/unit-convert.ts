import type { HandlerDefinition } from '../../handler.js';
import { resolveValue } from '../../resolve.js';
import { makeSuccess, makeFailure, now } from '../../result.js';

const ID = 'core:unit_convert';
const VERSION = '1.0.0';

const CONVERSIONS: Record<string, Record<string, number>> = {
  'ppm': { 'percent': 1e-4, 'ppb': 1e3, 'mg/kg': 1 },
  'ppb': { 'ppm': 1e-3, 'percent': 1e-7, 'mg/kg': 1e-3 },
  'percent': { 'ppm': 1e4, 'ppb': 1e7, 'mg/kg': 1e4 },
  'mg/kg': { 'ppm': 1, 'ppb': 1e3, 'percent': 1e-4 },
  'kg': { 'g': 1e3, 'mg': 1e6 },
  'g': { 'kg': 1e-3, 'mg': 1e3 },
  'mg': { 'kg': 1e-6, 'g': 1e-3 },
  'l': { 'ml': 1e3 },
  'ml': { 'l': 1e-3 },
};

export const unitConvertHandler: HandlerDefinition = {
  id: ID,
  version: VERSION,
  category: 'computation',
  description: 'Convert a value between units',

  execute(config, input, context, _evaluate) {
    const start = now();
    const cfg = config as {
      source_value: unknown;
      source_unit: string;
      target_unit: string;
    };

    const value = Number(resolveValue(cfg.source_value, context, input));

    if (cfg.source_unit === cfg.target_unit) {
      return makeSuccess(
        { converted: value, source_unit: cfg.source_unit, target_unit: cfg.target_unit },
        {
          summary: `${value} ${cfg.source_unit}`,
          handler_id: ID,
          handler_version: VERSION,
          input: cfg,
          execution_path: ID,
          duration_ms: now() - start,
        },
      );
    }

    const factor = CONVERSIONS[cfg.source_unit]?.[cfg.target_unit];
    if (factor == null) {
      return makeFailure(
        { converted: null },
        {
          summary: `Cannot convert ${cfg.source_unit} \u2192 ${cfg.target_unit}`,
          handler_id: ID,
          handler_version: VERSION,
          input: cfg,
          execution_path: ID,
          duration_ms: now() - start,
          error: { message: 'unsupported' },
        },
      );
    }

    const converted = value * factor;
    return makeSuccess(
      { converted, source_unit: cfg.source_unit, target_unit: cfg.target_unit },
      {
        summary: `${value} ${cfg.source_unit} = ${converted} ${cfg.target_unit}`,
        handler_id: ID,
        handler_version: VERSION,
        input: cfg,
        execution_path: ID,
        duration_ms: now() - start,
      },
    );
  },
};
