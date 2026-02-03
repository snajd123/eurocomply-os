import { z } from 'zod';

// --- Principal (who is calling) ---

export const PrincipalSchema = z.object({
  type: z.enum(['user', 'group', 'agent', 'system', 'handler_effect']),
  id: z.string(),
});
export type Principal = z.infer<typeof PrincipalSchema>;

// --- Service Context (passed to every service call) ---

export interface ServiceContext {
  tenant_id: string;
  principal: Principal;
  correlation_id: string;
}

// --- Audit Entry ---

export const AuditEntrySchema = z.object({
  audit_entry_id: z.string(),
  correlation_id: z.string(),
  tenant_id: z.string(),
  actor: PrincipalSchema,
  action: z.string(),
  resource: z.object({
    entity_type: z.string(),
    entity_id: z.string(),
  }),
  timestamp: z.string(),
  changes: z.object({
    before: z.record(z.string(), z.unknown()).optional(),
    after: z.record(z.string(), z.unknown()).optional(),
    fields_changed: z.array(z.string()),
  }).optional(),
  success: z.boolean(),
  error: z.string().optional(),
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

// --- Service Result ---

export interface ServiceResult<T> {
  success: boolean;
  data: T;
  audit_entry?: AuditEntry;
  events_emitted?: string[];
}

// --- Filter Expression (for entity:list, search, etc.) ---

export type FilterExpression = {
  and?: FilterExpression[];
  or?: FilterExpression[];
  not?: FilterExpression;
  field?: string;
  operator?: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' |
             'in' | 'not_in' | 'contains' | 'starts_with' |
             'is_null' | 'is_not_null';
  value?: unknown;
};

export const FilterExpressionSchema: z.ZodType<FilterExpression> = z.lazy(() =>
  z.object({
    and: z.array(FilterExpressionSchema).optional(),
    or: z.array(FilterExpressionSchema).optional(),
    not: FilterExpressionSchema.optional(),
    field: z.string().optional(),
    operator: z.enum([
      'eq', 'ne', 'gt', 'gte', 'lt', 'lte',
      'in', 'not_in', 'contains', 'starts_with',
      'is_null', 'is_not_null',
    ]).optional(),
    value: z.unknown().optional(),
  })
);

// --- Platform Service Interface ---

export interface PlatformService<TInput, TOutput> {
  readonly id: string;
  readonly category: string;

  execute(
    input: TInput,
    context: ServiceContext,
  ): Promise<ServiceResult<TOutput>>;
}
