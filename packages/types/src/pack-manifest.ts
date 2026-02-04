import { z } from 'zod';

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
});

export type PackManifest = z.infer<typeof PackManifestSchema>;
