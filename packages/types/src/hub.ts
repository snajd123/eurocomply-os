import { z } from 'zod';

// --- Enums ---

export const SpokeStatusSchema = z.enum([
  'provisioning', 'active', 'suspended', 'decommissioned',
]);
export type SpokeStatus = z.infer<typeof SpokeStatusSchema>;

export const ProvisioningPhaseSchema = z.enum([
  'claim', 'provision', 'boot', 'install', 'handoff',
]);
export type ProvisioningPhase = z.infer<typeof ProvisioningPhaseSchema>;

export const PlanTierSchema = z.enum(['starter', 'growth', 'scale', 'enterprise']);
export type PlanTier = z.infer<typeof PlanTierSchema>;

// --- Product Manifest ---

export const ProductPackRefSchema = z.object({
  name: z.string(),
  version: z.string(),
  type: z.enum(['logic', 'environment', 'driver', 'intelligence']),
  required: z.boolean(),
});
export type ProductPackRef = z.infer<typeof ProductPackRefSchema>;

export const ProductPlanSchema = z.object({
  id: z.string(),
  max_products: z.union([z.number(), z.literal('unlimited')]),
  max_users: z.union([z.number(), z.literal('unlimited')]),
  packs: z.array(z.string()),
  custom_packs: z.boolean().optional(),
});
export type ProductPlan = z.infer<typeof ProductPlanSchema>;

export const ProductManifestSchema = z.object({
  product: z.object({
    id: z.string(),
    name: z.string(),
    version: z.string(),
    description: z.string().optional(),
  }),
  os: z.object({ version: z.string() }),
  packs: z.array(ProductPackRefSchema),
  plans: z.array(ProductPlanSchema),
});
export type ProductManifest = z.infer<typeof ProductManifestSchema>;

// --- Heartbeat ---

export const HeartbeatRequestSchema = z.object({
  spoke_id: z.string(),
  os_version: z.string(),
  status: z.enum(['healthy', 'degraded', 'unhealthy']),
  uptime_seconds: z.number(),
  usage: z.object({
    product_count: z.number(),
    user_count: z.number(),
    evaluation_count_24h: z.number(),
  }),
});
export type HeartbeatRequest = z.infer<typeof HeartbeatRequestSchema>;

export const HeartbeatResponseSchema = z.object({
  acknowledged: z.boolean(),
  license_valid: z.boolean(),
  signals: z.object({
    os_update_available: z.string().nullable(),
    pack_updates_available: z.number(),
    registry_sync_recommended: z.boolean(),
    message: z.string().nullable(),
  }),
});
export type HeartbeatResponse = z.infer<typeof HeartbeatResponseSchema>;

// --- Provisioning ---

export const ProvisionRequestSchema = z.object({
  org_id: z.string(),
  product_id: z.string(),
  plan: PlanTierSchema,
  region: z.string(),
  admin_email: z.string().email(),
});
export type ProvisionRequest = z.infer<typeof ProvisionRequestSchema>;
