import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BillingService, type BillingProvider } from '../billing.js';
import { OrganizationService } from '../organization.js';
import { HubDb } from '../../db/connection.js';
import { runHubMigrations } from '../../db/migrate.js';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

// In-memory mock billing provider
class MockBillingProvider implements BillingProvider {
  customers = new Map<string, string>();
  subscriptions = new Map<string, { status: string; plan: string }>();
  nextId = 1;

  async createCustomer(name: string, email: string): Promise<string> {
    const id = `cus_mock_${this.nextId++}`;
    this.customers.set(id, email);
    return id;
  }

  async createSubscription(customerId: string, priceId: string): Promise<{ id: string; status: string }> {
    const id = `sub_mock_${this.nextId++}`;
    this.subscriptions.set(id, { status: 'active', plan: priceId });
    return { id, status: 'active' };
  }

  async cancelSubscription(subscriptionId: string): Promise<void> {
    const sub = this.subscriptions.get(subscriptionId);
    if (sub) sub.status = 'cancelled';
  }
}

describe('BillingService', () => {
  let container: StartedPostgreSqlContainer;
  let db: HubDb;
  let billing: BillingService;
  let orgService: OrganizationService;
  let provider: MockBillingProvider;

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
    provider = new MockBillingProvider();
    billing = new BillingService(db, provider);
  }, 60_000);

  afterAll(async () => {
    await db.close();
    await container.stop();
  });

  it('should create a customer and subscription', async () => {
    // Create org and a spoke row first (FK constraint)
    const org = await orgService.create({ name: 'Billing Test', email: 'bill@test.com' });
    await db.query(
      `INSERT INTO products (product_id, name, version, manifest) VALUES ('test-product', 'Test', '1.0.0', '{}')`,
    );
    await db.query(
      `INSERT INTO spokes (spoke_id, org_id, product_id, plan, region) VALUES ($1, $2, 'test-product', 'growth', 'eu-west')`,
      ['spoke-billing-1', org.data.org_id],
    );

    const result = await billing.setupSubscription({
      org_id: org.data.org_id,
      spoke_id: 'spoke-billing-1',
      plan: 'growth',
    });

    expect(result.success).toBe(true);
    expect(result.data.stripe_subscription_id).toContain('sub_mock_');
    expect(result.data.status).toBe('active');

    // Verify org got stripe_customer_id
    const updatedOrg = await orgService.get(org.data.org_id);
    expect(updatedOrg.data.stripe_customer_id).toContain('cus_mock_');
  });

  it('should cancel a subscription', async () => {
    const sub = await db.query(
      `SELECT * FROM subscriptions LIMIT 1`,
    );
    const subId = sub.rows[0].subscription_id;

    const result = await billing.cancelSubscription(subId);
    expect(result.success).toBe(true);

    const cancelled = await db.query(
      `SELECT status FROM subscriptions WHERE subscription_id = $1`,
      [subId],
    );
    expect(cancelled.rows[0].status).toBe('cancelled');
  });

  it('should handle payment_failed webhook', async () => {
    // Create a new active subscription
    const org = await orgService.create({ name: 'Webhook Test', email: 'wh@test.com' });
    await db.query(
      `INSERT INTO spokes (spoke_id, org_id, product_id, plan, region) VALUES ($1, $2, 'test-product', 'starter', 'eu-west')`,
      ['spoke-billing-2', org.data.org_id],
    );
    const sub = await billing.setupSubscription({
      org_id: org.data.org_id,
      spoke_id: 'spoke-billing-2',
      plan: 'starter',
    });

    const result = await billing.handleWebhookEvent({
      type: 'payment_failed',
      subscription_id: sub.data.stripe_subscription_id!,
    });
    expect(result.success).toBe(true);

    // Spoke should be suspended
    const spoke = await db.query(`SELECT status FROM spokes WHERE spoke_id = 'spoke-billing-2'`);
    expect(spoke.rows[0].status).toBe('suspended');
  });
});
