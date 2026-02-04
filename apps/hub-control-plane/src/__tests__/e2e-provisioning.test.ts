import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHubServer } from '../hub-server.js';
import { HubDb } from '../db/connection.js';
import { runHubMigrations } from '../db/migrate.js';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { ProductManifest } from '@eurocomply/types';

describe('E2E: Phase 5 — Provisioning & Billing', () => {
  let container: StartedPostgreSqlContainer;
  let db: HubDb;
  let app: ReturnType<typeof createHubServer>;
  let orgId: string;
  let spokeId: string;

  const cosmeticsManifest: ProductManifest = {
    product: { id: 'eurocomply-cosmetics', name: 'EuroComply Cosmetics', version: '1.0.0' },
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
    app = createHubServer({ db });
  }, 60_000);

  afterAll(async () => {
    await db.close();
    await container.stop();
  });

  it('Step 1: Register the cosmetics product', async () => {
    const res = await app.request('/hub/api/v1/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cosmeticsManifest),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.product_id).toBe('eurocomply-cosmetics');
  });

  it('Step 2: Customer signs up (create org)', async () => {
    const res = await app.request('/hub/api/v1/organizations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Acme Cosmetics GmbH', email: 'compliance@acme.de' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    orgId = body.org_id;
    expect(orgId).toBeDefined();
  });

  it('Step 3: Provision a spoke for the cosmetics product', async () => {
    const res = await app.request('/hub/api/v1/provision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        org_id: orgId,
        product_id: 'eurocomply-cosmetics',
        plan: 'growth',
        region: 'eu-west',
        admin_email: 'compliance@acme.de',
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    spokeId = body.spoke_id;
    expect(spokeId).toBeDefined();
    expect(body.status).toBe('active');
    expect(body.hostname).toContain('.eurocomply.app');
  });

  it('Step 4: Verify provisioning events were recorded', async () => {
    const events = await db.query(
      `SELECT phase, status FROM provisioning_events WHERE spoke_id = $1 ORDER BY created_at`,
      [spokeId],
    );
    expect(events.rows).toHaveLength(5);
    expect(events.rows.map((e: any) => e.phase)).toEqual([
      'claim', 'provision', 'boot', 'install', 'handoff',
    ]);
  });

  it('Step 5: Verify subscription was created', async () => {
    const subs = await db.query(
      `SELECT * FROM subscriptions WHERE spoke_id = $1`,
      [spokeId],
    );
    expect(subs.rows).toHaveLength(1);
    expect(subs.rows[0].plan).toBe('growth');
    expect(subs.rows[0].status).toBe('active');
  });

  it('Step 6: Spoke sends heartbeat', async () => {
    const res = await app.request('/hub/api/v1/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        spoke_id: spokeId,
        os_version: '2.0.0',
        status: 'healthy',
        uptime_seconds: 120,
        usage: { product_count: 0, user_count: 1, evaluation_count_24h: 0 },
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.acknowledged).toBe(true);
    expect(body.license_valid).toBe(true);
  });

  it('Step 7: Spoke registers DID in directory', async () => {
    const res = await app.request('/hub/api/v1/directory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        did: `did:web:${spokeId}.eurocomply.app`,
        spoke_id: spokeId,
        endpoint: `https://${spokeId}.eurocomply.app/mcp`,
        capabilities: ['claims', 'evidence'],
      }),
    });
    expect(res.status).toBe(201);

    // Lookup the DID
    const lookupRes = await app.request(`/hub/api/v1/directory/did:web:${spokeId}.eurocomply.app`);
    expect(lookupRes.status).toBe(200);
    const entry = (await lookupRes.json()) as any;
    expect(entry.endpoint).toContain(spokeId);
    expect(entry.capabilities).toContain('claims');
  });

  it('Step 8: Fleet shows the spoke as healthy', async () => {
    const res = await app.request('/hub/api/v1/fleet/spokes');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    const spoke = body.items.find((s: any) => s.spoke_id === spokeId);
    expect(spoke).toBeDefined();
    expect(spoke.status).toBe('active');
    expect(spoke.os_version).toBe('2.0.0');
  });

  it('Step 9: Payment fails — spoke gets suspended', async () => {
    // Get stripe subscription ID
    const subs = await db.query(`SELECT stripe_subscription_id FROM subscriptions WHERE spoke_id = $1`, [spokeId]);
    const stripeSubId = subs.rows[0].stripe_subscription_id;

    const res = await app.request('/hub/api/v1/billing/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'payment_failed', subscription_id: stripeSubId }),
    });
    expect(res.status).toBe(200);

    // Spoke should be suspended
    const spokeResult = await db.query(`SELECT status FROM spokes WHERE spoke_id = $1`, [spokeId]);
    expect(spokeResult.rows[0].status).toBe('suspended');

    // Heartbeat should report license_valid = false
    const hbRes = await app.request('/hub/api/v1/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        spoke_id: spokeId,
        os_version: '2.0.0',
        status: 'healthy',
        uptime_seconds: 300,
        usage: { product_count: 0, user_count: 1, evaluation_count_24h: 0 },
      }),
    });
    const hbBody = (await hbRes.json()) as any;
    expect(hbBody.license_valid).toBe(false);
  });

  it('Step 10: Payment succeeds — spoke reactivated', async () => {
    const subs = await db.query(`SELECT stripe_subscription_id FROM subscriptions WHERE spoke_id = $1`, [spokeId]);
    const stripeSubId = subs.rows[0].stripe_subscription_id;

    await app.request('/hub/api/v1/billing/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'payment_succeeded', subscription_id: stripeSubId }),
    });

    const spokeResult = await db.query(`SELECT status FROM spokes WHERE spoke_id = $1`, [spokeId]);
    expect(spokeResult.rows[0].status).toBe('active');
  });
});
