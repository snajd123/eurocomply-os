import { z } from 'zod';
import { ASTNodeSchema } from '@eurocomply/types';

// --- Entity Tools ---

export const EntityDefineInputSchema = z.object({
  entity_type: z.string().min(1),
  schema: z.record(z.string(), z.unknown()),
});

export const EntityCreateInputSchema = z.object({
  entity_type: z.string().min(1),
  data: z.record(z.string(), z.unknown()),
});

export const EntityGetInputSchema = z.object({
  entity_type: z.string().min(1),
  entity_id: z.string().min(1),
});

export const EntityUpdateInputSchema = z.object({
  entity_type: z.string().min(1),
  entity_id: z.string().min(1),
  data: z.record(z.string(), z.unknown()),
});

export const EntityListInputSchema = z.object({
  entity_type: z.string().min(1),
  limit: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().optional(),
  filter: z.record(z.string(), z.unknown()).optional(),
});

// --- File Tools ---

export const FileUploadInputSchema = z.object({
  filename: z.string().min(1),
  content_type: z.string().min(1),
  content: z.string().min(1), // base64-encoded
  entity_type: z.string().optional(),
  entity_id: z.string().optional(),
});

export const FileGetInputSchema = z.object({
  file_id: z.string().min(1),
});

// --- Job Tools ---

export const JobSubmitInputSchema = z.object({
  job_type: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
  priority: z.number().int().optional(),
});

export const JobStatusInputSchema = z.object({
  job_id: z.string().min(1),
});

// --- Audit Tools ---

export const AuditQueryInputSchema = z.object({
  action: z.string().optional(),
  resource_entity_type: z.string().optional(),
  resource_entity_id: z.string().optional(),
  actor_id: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  limit: z.number().int().positive().optional(),
  offset: z.number().int().nonnegative().optional(),
});

// --- Evaluate Tool ---

// NOTE: ASTNodeSchema validates the top-level node (handler: string, config: record)
// but does NOT recursively validate nested children inside config.conditions,
// config.steps, or config.then — those are z.unknown(). This is intentional:
// the evaluator validates handler existence at runtime and returns structured errors.
// Deep config validation requires per-handler schemas (Phase 5.2 scope).
export const EvaluateInputSchema = z.object({
  entity_type: z.string().min(1),
  entity_id: z.string().min(1),
  rule: ASTNodeSchema,
  compliance_lock_id: z.string().min(1),
  vertical_id: z.string().min(1),
  market: z.string().min(1),
  data: z.record(z.string(), z.unknown()).optional(),
});

// --- Registry Tools ---

export const RegistryInstallInputSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  type: z.string().min(1),
  handler_vm_version: z.string().optional(),
  scope: z.object({
    verticals: z.array(z.string()).optional(),
    markets: z.array(z.string()).optional(),
    entity_types: z.array(z.string()).optional(),
  }).optional(),
  regulation_ref: z.string().optional(),
  logic_root: z.string().optional(),
  validation_suite: z.string().optional(),
  validation_hash: z.string().optional(),
  author: z.union([z.string(), z.object({ name: z.string(), did: z.string().optional() })]).optional(),
  trust_tier: z.string().optional(),
  dependencies: z.record(z.string(), z.string()).optional(),
  required_schemas: z.array(z.object({ id: z.string(), version: z.string() })).optional(),
  documentation_root: z.string().optional(),
  conflict_resolution: z.object({
    strategy: z.string(),
    overridable: z.boolean().optional(),
  }).optional(),
  description: z.string().optional(),
}).strip();

export const RegistryListInputSchema = z.object({});

export const RegistryLockInputSchema = z.object({
  lock_id: z.string().min(1),
});

export const RegistryLocksInputSchema = z.object({});

export const RegistrySaveLockInputSchema = z.object({
  lock_id: z.string().min(1),
  packs: z.array(z.unknown()),
  handler_vm_version: z.string().min(1),
  created_at: z.string(),
  tenant_id: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strip();

// --- Schema Map (tool name → Zod schema) ---

export const toolInputSchemas: Record<string, z.ZodTypeAny> = {
  'entity:define': EntityDefineInputSchema,
  'entity:create': EntityCreateInputSchema,
  'entity:get': EntityGetInputSchema,
  'entity:update': EntityUpdateInputSchema,
  'entity:list': EntityListInputSchema,
  'file:upload': FileUploadInputSchema,
  'file:get': FileGetInputSchema,
  'job:submit': JobSubmitInputSchema,
  'job:status': JobStatusInputSchema,
  'audit:query': AuditQueryInputSchema,
  'evaluate': EvaluateInputSchema,
  'registry:install': RegistryInstallInputSchema,
  'registry:list': RegistryListInputSchema,
  'registry:lock': RegistryLockInputSchema,
  'registry:locks': RegistryLocksInputSchema,
  'registry:save-lock': RegistrySaveLockInputSchema,
};
