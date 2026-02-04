import type { ServiceContext } from '@eurocomply/types';
import type { Queryable } from './db/postgres.js';

export interface PlatformServiceContext extends ServiceContext {
  tx?: Queryable;
}
