import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHubServer } from './hub-server.js';
import { HubDb } from './db/connection.js';
import { runHubMigrations } from './db/migrate.js';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { ProductManifest } from '@eurocomply/types';

describe('Hub HTTP Server', () => {
  let container: StartedPostgreSqlContainer;
  let db: HubDb;
  let app: ReturnType<typeof createHubServer>;

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

    // Seed a product
    const manifest: ProductManifest = {
      product: { id: 'test-product', name: 'Test Product', version: '1.0.0' },
      os: { version: '^1.0.0' },
      packs: [{ name: '@test/pack', version: '^1.0.0', type: 'logic', required: true }],
      plans: [{ id: 'starter', max_products: 10, max_users: 5, packs: ['required_only'] }],
    };
    await app.request('/hub/api/v1/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(manifest),
    });
  }, 60_000);

  afterAll(async () => {
    await db.close();
    await container.stop();
  });

  it('should serve health endpoint', async () => {
    const res = await app.request('/hub/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
  });

  it('should list products', async () => {
    const res = await app.request('/hub/api/v1/products');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.total).toBeGreaterThanOrEqual(1);
  });

  it('should provision a spoke', async () => {
    // Create org first
    const orgRes = await app.request('/hub/api/v1/organizations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'HTTP Test Org', email: 'http@test.com' }),
    });
    expect(orgRes.status).toBe(201);
    const org = (await orgRes.json()) as any;

    // Provision
    const res = await app.request('/hub/api/v1/provision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        org_id: org.org_id,
        product_id: 'test-product',
        plan: 'starter',
        region: 'eu-west',
        admin_email: 'admin@test.com',
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.spoke_id).toBeDefined();
    expect(body.status).toBe('active');
  });

  it('should process heartbeat', async () => {
    // Get a spoke from fleet
    const spokesRes = await app.request('/hub/api/v1/fleet/spokes');
    const spokes = (await spokesRes.json()) as any;
    const spokeId = spokes.items[0].spoke_id;

    const res = await app.request('/hub/api/v1/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        spoke_id: spokeId,
        os_version: '2.0.0',
        status: 'healthy',
        uptime_seconds: 100,
        usage: { product_count: 5, user_count: 1, evaluation_count_24h: 10 },
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.acknowledged).toBe(true);
  });

  it('should register and lookup DID in directory', async () => {
    // Get spoke for FK
    const spokesRes = await app.request('/hub/api/v1/fleet/spokes');
    const spokes = (await spokesRes.json()) as any;
    const spokeId = spokes.items[0].spoke_id;

    // Register
    const regRes = await app.request('/hub/api/v1/directory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        did: 'did:web:test.eurocomply.app',
        spoke_id: spokeId,
        endpoint: 'https://test.eurocomply.app/mcp',
        capabilities: ['claims'],
      }),
    });
    expect(regRes.status).toBe(201);

    // Lookup
    const lookupRes = await app.request('/hub/api/v1/directory/did:web:test.eurocomply.app');
    expect(lookupRes.status).toBe(200);
    const entry = (await lookupRes.json()) as any;
    expect(entry.endpoint).toBe('https://test.eurocomply.app/mcp');
  });
});
