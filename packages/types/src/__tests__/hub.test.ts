import { describe, it, expect } from 'vitest';
import {
  ProductManifestSchema,
  HeartbeatRequestSchema,
  HeartbeatResponseSchema,
  SpokeStatusSchema,
  ProvisioningPhaseSchema,
  PlanTierSchema,
} from '../hub.js';

describe('Hub types', () => {
  it('should validate a product manifest', () => {
    const manifest = {
      product: {
        id: 'eurocomply-cosmetics',
        name: 'EuroComply Cosmetics',
        version: '1.0.0',
      },
      os: { version: '^2.0.0' },
      packs: [
        { name: '@eu/cosmetics-vertical', version: '^1.0.0', type: 'environment', required: true },
        { name: '@eu/clp-classification', version: '^3.0.0', type: 'logic', required: true },
        { name: '@connectors/cpnp', version: '^1.0.0', type: 'driver', required: false },
      ],
      plans: [
        { id: 'starter', max_products: 50, max_users: 10, packs: ['required_only'] },
        { id: 'growth', max_products: 200, max_users: 30, packs: ['required', '@connectors/cpnp'] },
      ],
    };
    const result = ProductManifestSchema.safeParse(manifest);
    expect(result.success).toBe(true);
  });

  it('should validate a heartbeat request', () => {
    const hb = {
      spoke_id: 'spoke-acme-eu-west',
      os_version: '2.0.3',
      status: 'healthy',
      uptime_seconds: 864000,
      usage: { product_count: 142, user_count: 12, evaluation_count_24h: 847 },
    };
    const result = HeartbeatRequestSchema.safeParse(hb);
    expect(result.success).toBe(true);
  });

  it('should validate a heartbeat response', () => {
    const resp = {
      acknowledged: true,
      license_valid: true,
      signals: {
        os_update_available: null,
        pack_updates_available: 0,
        registry_sync_recommended: false,
        message: null,
      },
    };
    const result = HeartbeatResponseSchema.safeParse(resp);
    expect(result.success).toBe(true);
  });

  it('should validate spoke status enum', () => {
    expect(SpokeStatusSchema.safeParse('provisioning').success).toBe(true);
    expect(SpokeStatusSchema.safeParse('active').success).toBe(true);
    expect(SpokeStatusSchema.safeParse('suspended').success).toBe(true);
    expect(SpokeStatusSchema.safeParse('decommissioned').success).toBe(true);
    expect(SpokeStatusSchema.safeParse('invalid').success).toBe(false);
  });

  it('should validate provisioning phases', () => {
    expect(ProvisioningPhaseSchema.safeParse('claim').success).toBe(true);
    expect(ProvisioningPhaseSchema.safeParse('provision').success).toBe(true);
    expect(ProvisioningPhaseSchema.safeParse('boot').success).toBe(true);
    expect(ProvisioningPhaseSchema.safeParse('install').success).toBe(true);
    expect(ProvisioningPhaseSchema.safeParse('handoff').success).toBe(true);
  });

  it('should validate plan tiers', () => {
    expect(PlanTierSchema.safeParse('starter').success).toBe(true);
    expect(PlanTierSchema.safeParse('growth').success).toBe(true);
    expect(PlanTierSchema.safeParse('scale').success).toBe(true);
    expect(PlanTierSchema.safeParse('enterprise').success).toBe(true);
  });
});
