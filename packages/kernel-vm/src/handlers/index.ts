import { HandlerRegistry } from '../registry.js';
import { andHandler } from './logic/and.js';
import { orHandler } from './logic/or.js';
import { notHandler } from './logic/not.js';
import { ifThenHandler } from './logic/if-then.js';
import { pipeHandler } from './logic/pipe.js';
import { forEachHandler } from './logic/for-each.js';
import { thresholdCheckHandler } from './validation/threshold-check.js';
import { absenceCheckHandler } from './validation/absence-check.js';
import { listCheckHandler } from './validation/list-check.js';
import { completenessCheckHandler } from './validation/completeness-check.js';
import { bomSumHandler } from './computation/bom-sum.js';
import { unitConvertHandler } from './computation/unit-convert.js';
import { ratioHandler } from './computation/ratio.js';
import { deadlineHandler } from './temporal/deadline.js';

export function createDefaultRegistry(): HandlerRegistry {
  const r = new HandlerRegistry();
  [andHandler, orHandler, notHandler, ifThenHandler, pipeHandler, forEachHandler,
   thresholdCheckHandler, absenceCheckHandler, listCheckHandler, completenessCheckHandler,
   bomSumHandler, unitConvertHandler, ratioHandler, deadlineHandler].forEach(h => r.register(h));
  return r;
}
