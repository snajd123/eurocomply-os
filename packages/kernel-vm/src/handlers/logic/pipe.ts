import type { HandlerDefinition } from '../../handler.js';
import type { ASTNode } from '@eurocomply/types';
import { makeSuccess, makeFailure, now } from '../../result.js';

const ID = 'core:pipe';
const VERSION = '1.0.0';

export const pipeHandler: HandlerDefinition = {
  id: ID, version: VERSION, category: 'logic',
  description: 'Sequential pipeline — output of each step feeds as input to the next',

  execute(config, input, context, evaluate) {
    const start = now();
    const steps = (config as { steps: ASTNode[] }).steps;
    const childTraces = [];
    let currentInput = input;

    for (let i = 0; i < steps.length; i++) {
      const stepResult = evaluate(steps[i], context, currentInput);
      childTraces.push(stepResult.trace);

      if (!stepResult.success) {
        return makeFailure(stepResult.value, {
          summary: `Pipe failed at step ${i + 1}/${steps.length}`,
          steps: [{ action: `Step ${i + 1}`, result: 'FAIL', data: { summary: stepResult.explanation.summary } }],
          handler_id: ID, handler_version: VERSION,
          input, execution_path: ID, duration_ms: now() - start,
          child_traces: childTraces,
        });
      }

      currentInput = stepResult.value;
    }

    return makeSuccess(currentInput, {
      summary: `Pipe completed ${steps.length} steps`,
      steps: childTraces.map((t, i) => ({ action: `Step ${i + 1}`, result: 'PASS' })),
      handler_id: ID, handler_version: VERSION,
      input, execution_path: ID, duration_ms: now() - start,
      child_traces: childTraces,
    });
  },
};
