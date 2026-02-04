import { z } from 'zod';

export const LockedPackSchema = z.object({
  version: z.string(),
  cid: z.string(),
  signature: z.string().optional(),
  publisher_did: z.string().optional(),
  trust_tier: z.enum(['community', 'verified', 'certified']).optional(),
});
export type LockedPack = z.infer<typeof LockedPackSchema>;

export const LockedSchemaSchema = z.object({
  version: z.string(),
  cid: z.string(),
});
export type LockedSchema = z.infer<typeof LockedSchemaSchema>;

export const ComplianceLockSchema = z.object({
  lock_id: z.string(),
  tenant_id: z.string(),
  timestamp: z.string(),
  handler_vm_exact: z.string(),
  root_pack: z.object({
    name: z.string(),
    version: z.string(),
    cid: z.string(),
  }),
  packs: z.record(z.string(), LockedPackSchema),
  schemas: z.record(z.string(), LockedSchemaSchema).optional(),
  status: z.enum(['active', 'superseded', 'rolled_back']).optional(),
});
export type ComplianceLock = z.infer<typeof ComplianceLockSchema>;
