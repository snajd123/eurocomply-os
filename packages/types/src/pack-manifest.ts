import { z } from 'zod';

export const PackAuthorSchema = z.object({
  name: z.string(),
  did: z.string().optional(),
});
export type PackAuthor = z.infer<typeof PackAuthorSchema>;

export const TrustTierSchema = z.enum(['community', 'verified', 'certified']);
export type TrustTier = z.infer<typeof TrustTierSchema>;

export const PackManifestSchema = z.object({
  name: z.string().regex(/^@[a-z0-9-]+\/[a-z0-9-]+$/, 'Pack name must be scoped: @scope/name'),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'Version must be semver: X.Y.Z'),
  type: z.enum(['logic', 'environment', 'driver', 'intelligence']),

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

  author: PackAuthorSchema.optional(),
  trust_tier: TrustTierSchema.optional(),
  dependencies: z.record(z.string(), z.string()).optional(),
  required_schemas: z.array(z.object({ id: z.string(), version: z.string() })).optional(),
  documentation_root: z.string().optional(),
  conflict_resolution: z.object({
    strategy: z.enum(['most_restrictive', 'explicit_priority', 'merge']),
    overridable: z.boolean().optional(),
  }).optional(),
});

export type PackManifest = z.infer<typeof PackManifestSchema>;
