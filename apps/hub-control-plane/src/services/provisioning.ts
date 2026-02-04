import { randomUUID } from 'crypto';
import type { HubDb } from '../db/connection.js';
import type { OrganizationService } from './organization.js';
import type { ProductCatalogService } from './product-catalog.js';
import type { BillingService } from './billing.js';

export interface InfrastructureProvider {
  createNamespace(name: string): Promise<void>;
  deploySpoke(spokeId: string, config: SpokeDeployConfig): Promise<void>;
  triggerBoot(spokeId: string): Promise<void>;
  destroyNamespace(name: string): Promise<void>;
}

export interface SpokeDeployConfig {
  spokeId: string;
  region: string;
  plan: string;
  productId: string;
  hostname: string;
}

interface ServiceResult<T> {
  success: boolean;
  data: T;
  error?: string;
}

interface ProvisionedSpoke {
  spoke_id: string;
  status: string;
  hostname: string;
}

type Phase = 'claim' | 'provision' | 'boot' | 'install' | 'handoff';

export class ProvisioningOrchestrator {
  constructor(
    private db: HubDb,
    private orgService: OrganizationService,
    private catalog: ProductCatalogService,
    private billing: BillingService,
    private infra: InfrastructureProvider,
  ) {}

  async provision(input: {
    org_id: string;
    product_id: string;
    plan: string;
    region: string;
    admin_email: string;
  }): Promise<ServiceResult<ProvisionedSpoke>> {
    // --- PHASE 1: CLAIM ---
    const org = await this.orgService.get(input.org_id);
    if (!org.success) return { success: false, data: null as any, error: org.error };

    const product = await this.catalog.get(input.product_id);
    if (!product.success) return { success: false, data: null as any, error: product.error };

    const spokeId = `spoke-${randomUUID().slice(0, 12)}`;
    const hostname = `${spokeId}.eurocomply.app`;

    await this.db.query(
      `INSERT INTO spokes (spoke_id, org_id, product_id, plan, region, status, hostname)
       VALUES ($1, $2, $3, $4, $5, 'provisioning', $6)`,
      [spokeId, input.org_id, input.product_id, input.plan, input.region, hostname],
    );
    await this.recordEvent(spokeId, 'claim', 'completed', { product_id: input.product_id, plan: input.plan });

    // --- PHASE 2: PROVISION ---
    await this.infra.createNamespace(spokeId);
    await this.infra.deploySpoke(spokeId, {
      spokeId,
      region: input.region,
      plan: input.plan,
      productId: input.product_id,
      hostname,
    });
    await this.recordEvent(spokeId, 'provision', 'completed', { region: input.region });

    // --- PHASE 3: BOOT ---
    await this.infra.triggerBoot(spokeId);
    await this.recordEvent(spokeId, 'boot', 'completed', {});

    // --- PHASE 4: INSTALL ---
    const packs = await this.catalog.resolvePacksForPlan(input.product_id, input.plan);
    await this.recordEvent(spokeId, 'install', 'completed', {
      packs_count: packs.data.length,
      packs: packs.data.map(p => p.name),
    });

    // --- PHASE 5: HANDOFF ---
    await this.billing.setupSubscription({
      org_id: input.org_id,
      spoke_id: spokeId,
      plan: input.plan,
    });

    await this.db.query(
      `UPDATE spokes SET status = 'active', updated_at = now() WHERE spoke_id = $1`,
      [spokeId],
    );
    await this.recordEvent(spokeId, 'handoff', 'completed', { admin_email: input.admin_email });

    return { success: true, data: { spoke_id: spokeId, status: 'active', hostname } };
  }

  async resume(spokeId: string): Promise<ServiceResult<ProvisionedSpoke>> {
    const spoke = await this.db.query(`SELECT * FROM spokes WHERE spoke_id = $1`, [spokeId]);
    if (spoke.rows.length === 0) {
      return { success: false, data: null as any, error: 'Spoke not found' };
    }

    if (spoke.rows[0].status === 'active') {
      return {
        success: true,
        data: { spoke_id: spokeId, status: 'active', hostname: spoke.rows[0].hostname },
      };
    }

    // Check which phases are completed
    const events = await this.db.query(
      `SELECT phase FROM provisioning_events WHERE spoke_id = $1 AND status = 'completed'`,
      [spokeId],
    );
    const completed = new Set(events.rows.map((e: any) => e.phase));
    const row = spoke.rows[0];

    if (!completed.has('provision')) {
      await this.infra.createNamespace(spokeId);
      await this.infra.deploySpoke(spokeId, {
        spokeId,
        region: row.region,
        plan: row.plan,
        productId: row.product_id,
        hostname: row.hostname,
      });
      await this.recordEvent(spokeId, 'provision', 'completed', { region: row.region });
    }

    if (!completed.has('boot')) {
      await this.infra.triggerBoot(spokeId);
      await this.recordEvent(spokeId, 'boot', 'completed', {});
    }

    if (!completed.has('install')) {
      const packs = await this.catalog.resolvePacksForPlan(row.product_id, row.plan);
      await this.recordEvent(spokeId, 'install', 'completed', { packs_count: packs.data.length });
    }

    if (!completed.has('handoff')) {
      await this.billing.setupSubscription({
        org_id: row.org_id,
        spoke_id: spokeId,
        plan: row.plan,
      });
      await this.db.query(`UPDATE spokes SET status = 'active', updated_at = now() WHERE spoke_id = $1`, [spokeId]);
      await this.recordEvent(spokeId, 'handoff', 'completed', {});
    }

    return { success: true, data: { spoke_id: spokeId, status: 'active', hostname: row.hostname } };
  }

  private async recordEvent(spokeId: string, phase: Phase, status: string, detail: Record<string, unknown>): Promise<void> {
    await this.db.query(
      `INSERT INTO provisioning_events (spoke_id, phase, status, detail) VALUES ($1, $2, $3, $4)`,
      [spokeId, phase, status, JSON.stringify(detail)],
    );
  }
}
