import type { HandlerDefinition } from '../../handler.js';
import { resolveValue } from '../../resolve.js';
import { makeSuccess, makeFailure, now as perfNow } from '../../result.js';

const ID = 'core:deadline';
const VERSION = '1.0.0';
const MS: Record<string, number> = { hours: 36e5, days: 864e5, weeks: 6048e5, months: 2592e6, years: 31536e6 };

export const deadlineHandler: HandlerDefinition = {
  id: ID, version: VERSION, category: 'temporal',
  description: 'Check if a deadline has been reached',
  execute(config, input, context, _evaluate) {
    const start = perfNow();
    const cfg = config as {
      window: { duration: { value: number; unit: string }; started_at: unknown };
      on_expired: 'fail' | 'escalate';
    };
    const startedAt = new Date(String(resolveValue(cfg.window.started_at, context, input))).getTime();
    const currentTime = new Date(context.timestamp).getTime();
    const deadlineMs = startedAt + cfg.window.duration.value * (MS[cfg.window.duration.unit] ?? 0);
    const remainingMs = deadlineMs - currentTime;
    const expired = remainingMs <= 0;
    const days = Math.ceil(Math.abs(remainingMs) / 864e5);
    const status = expired ? 'expired' : 'within_window';
    const value = {
      status,
      time_remaining: expired ? undefined : { value: days, unit: 'days' },
      time_overdue: expired ? { value: days, unit: 'days' } : undefined,
    };
    const opts = {
      summary: expired ? `Expired ${days}d ago` : `${days}d remaining`,
      steps: [{ action: 'Check deadline', result: status }],
      handler_id: ID,
      handler_version: VERSION,
      input: cfg,
      execution_path: ID,
      duration_ms: perfNow() - start,
    };
    return expired && cfg.on_expired === 'fail'
      ? makeFailure(value, opts)
      : makeSuccess(value, opts);
  },
};
