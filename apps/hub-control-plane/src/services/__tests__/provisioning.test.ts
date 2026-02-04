import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ProvisioningOrchestrator, type InfrastructureProvider } from '../provisioning.js';
import { OrganizationService } from '../organization.js';
import { ProductCatalogService } from '../product-catalog.js';
import { BillingService, type BillingProvider } from '../billing.js';
import { HubDb } from '../../db/connection.js';
import { runHubMigrations } from '../../db/migrate.js';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { ProductManifest } from '@eurocomply/types';

class MockInfraProvider implements InfrastructureProvider {
  namespaces: string[] = [];
  deployments: string[] = [];
  boots: string[] = [];

  async createNamespace(name: string) { this.namespaces.push(name); }
  async deploySpoke(spokeId: string, _config: any) { this.deployments.push(spokeId); }
  async triggerBoot(spokeId: string) { this.boots.push(spokeId); }
  async destroyNamespace(name: string) {
    this.namespaces = this.namespaces.filter(n => n !== name);
  }
}

class MockBillingProvider implements BillingProvider {
  nextId = 1;
  async createCustomer(_name: string, _email: string) { return `cus_${this.nextId++}`; }
  async createSubscription(_cid: string, _price: string) { return { id: `sub_${this.nextId++}`, status: 'active' }; }
  async cancelSubscription(_sid: string) {}
}

describe('ProvisioningOrchestrator', () => {
  let container: StartedPostgreSqlContainer;
  let db: HubDb;
  let orchestrator: ProvisioningOrchestrator;
  let infra: MockInfraProvider;
  let orgService: OrganizationService;
  let catalog: ProductCatalogService;

  const cosmeticsManifest: ProductManifest = {
    product: { id: 'cosmetics', name: 'EuroComply Cosmetics', version: '1.0.0' },
    os: { version: '^2.0.0' },
    packs: [
      { name: '@eu/cosmetics-vertical', version: '^1.0.0', type: 'environment', required: true },
      { name: '@eu/clp-classification', version: '^3.0.0', type: 'logic', required: true },
    ],
    plans: [
      { id: 'starter', max_products: 50, max_users: 10, packs: ['required_only'] },
    ],
  };

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    db = new HubDb({
      host: container.getHost(),
      port: container.getMappedPort(5432),
      database: container.getDatabase(),
      user: container.getUsername(),
      password: container.getPassword(),
    });
    await runHubMigrations(db);
    orgService = new OrganizationService(db);
    catalog = new ProductCatalogService(db);
    infra = new MockInfraProvider();
    const billingProvider = new MockBillingProvider();
    const billing = new BillingService(db, billingProvider);
    orchestrator = new ProvisioningOrchestrator(db, orgService, catalog, billing, infra);

    // Seed product
    await catalog.register(cosmeticsManifest);
  }, 60_000);

  afterAll(async () => {
    await db.close();
    await container.stop();
  });

  it('should provision a spoke through all 5 phases', async () => {
    const org = await orgService.create({ name: 'Acme', email: 'acme@test.com' });

    const result = await orchestrator.provision({
      org_id: org.data.org_id,
      product_id: 'cosmetics',
      plan: 'starter',
      region: 'eu-west',
      admin_email: 'admin@acme.com',
    });

    expect(result.success).toBe(true);
    expect(result.data.spoke_id).toBeDefined();
    expect(result.data.status).toBe('active');
    expect(result.data.hostname).toContain('.eurocomply.app');

    // Verify infra was called
    expect(infra.namespaces.length).toBe(1);
    expect(infra.deployments.length).toBe(1);
    expect(infra.boots.length).toBe(1);

    // Verify provisioning events were recorded
    const events = await db.query(
      `SELECT * FROM provisioning_events WHERE spoke_id = $1 ORDER BY created_at`,
      [result.data.spoke_id],
    );
    expect(events.rows.length).toBe(5);
    expect(events.rows.map((e: any) => e.phase)).toEqual([
      'claim', 'provision', 'boot', 'install', 'handoff',
    ]);
    expect(events.rows.every((e: any) => e.status === 'completed')).toBe(true);

    // Verify subscription was created
    const subs = await db.query(
      `SELECT * FROM subscriptions WHERE spoke_id = $1`,
      [result.data.spoke_id],
    );
    expect(subs.rows.length).toBe(1);
    expect(subs.rows[0].status).toBe('active');
  });

  it('should be idempotent — re-running skips completed phases', async () => {
    const org = await orgService.create({ name: 'Beta', email: 'beta@test.com' });

    // First run
    const result1 = await orchestrator.provision({
      org_id: org.data.org_id,
      product_id: 'cosmetics',
      plan: 'starter',
      region: 'eu-west',
      admin_email: 'admin@beta.com',
    });

    const prevNamespaceCount = infra.namespaces.length;

    // Second run with same spoke_id should skip completed phases
    const result2 = await orchestrator.resume(result1.data.spoke_id);
    expect(result2.success).toBe(true);
    // No new namespace created (idempotent)
    expect(infra.namespaces.length).toBe(prevNamespaceCount);
  });

  it('should fail if product does not exist', async () => {
    const org = await orgService.create({ name: 'Gamma', email: 'gamma@test.com' });
    const result = await orchestrator.provision({
      org_id: org.data.org_id,
      product_id: 'nonexistent',
      plan: 'starter',
      region: 'eu-west',
      admin_email: 'admin@gamma.com',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Product not found');
  });
});
