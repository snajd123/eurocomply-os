import { z } from 'zod';

export const FieldReferenceSchema = z.object({
  field: z.string(),
});
export type FieldReference = z.infer<typeof FieldReferenceSchema>;

export const DataReferenceSchema = z.object({
  data_key: z.string(),
});
export type DataReference = z.infer<typeof DataReferenceSchema>;

export const ExecutionContextSchema = z.object({
  entity_type: z.string(),
  entity_id: z.string(),
  entity_data: z.record(z.string(), z.unknown()),
  data: z.record(z.string(), z.unknown()),
  compliance_lock_id: z.string(),
  vertical_id: z.string(),
  market: z.string(),
  timestamp: z.string(),
});
export type ExecutionContext = z.infer<typeof ExecutionContextSchema>;
