import { Hono } from 'hono';
import type { HubDb } from './db/connection.js';
import { OrganizationService } from './services/organization.js';
import { ProductCatalogService } from './services/product-catalog.js';
import { BillingService, type BillingProvider } from './services/billing.js';
import { ProvisioningOrchestrator, type InfrastructureProvider } from './services/provisioning.js';
import { FleetService } from './services/fleet.js';
import { NetworkDirectoryService } from './services/network-directory.js';
import { HeartbeatRequestSchema, ProductManifestSchema, ProvisionRequestSchema } from '@eurocomply/types';

// No-op providers for testing
class NoOpInfraProvider implements InfrastructureProvider {
  async createNamespace(_name: string) {}
  async deploySpoke(_spokeId: string, _config: any) {}
  async triggerBoot(_spokeId: string) {}
  async destroyNamespace(_name: string) {}
}

class NoOpBillingProvider implements BillingProvider {
  private nextId = 1;
  async createCustomer(_name: string, _email: string) { return `cus_noop_${this.nextId++}`; }
  async createSubscription(_cid: string, _price: string) { return { id: `sub_noop_${this.nextId++}`, status: 'active' }; }
  async cancelSubscription(_sid: string) {}
}

interface HubServerOptions {
  db: HubDb;
  infra?: InfrastructureProvider;
  billingProvider?: BillingProvider;
}

export function createHubServer(options: HubServerOptions) {
  const { db } = options;
  const infra = options.infra ?? new NoOpInfraProvider();
  const billingProvider = options.billingProvider ?? new NoOpBillingProvider();

  // Create services
  const orgService = new OrganizationService(db);
  const catalog = new ProductCatalogService(db);
  const billing = new BillingService(db, billingProvider);
  const orchestrator = new ProvisioningOrchestrator(db, orgService, catalog, billing, infra);
  const fleet = new FleetService(db);
  const directory = new NetworkDirectoryService(db);

  const app = new Hono();

  // Health
  app.get('/hub/health', (c) => c.json({ status: 'ok' }));

  // Organizations
  app.post('/hub/api/v1/organizations', async (c) => {
    const body = await c.req.json();
    const result = await orgService.create(body);
    return result.success
      ? c.json(result.data, 201)
      : c.json({ error: result.error }, 400);
  });

  // Products
  app.get('/hub/api/v1/products', async (c) => {
    const result = await catalog.list();
    return c.json(result.data);
  });

  app.post('/hub/api/v1/products', async (c) => {
    const body = await c.req.json();
    const parsed = ProductManifestSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: 'Invalid manifest', details: parsed.error.issues }, 400);
    const result = await catalog.register(parsed.data);
    return result.success
      ? c.json(result.data, 201)
      : c.json({ error: result.error }, 400);
  });

  app.get('/hub/api/v1/products/:id', async (c) => {
    const result = await catalog.get(c.req.param('id'));
    return result.success
      ? c.json(result.data)
      : c.json({ error: result.error }, 404);
  });

  // Provisioning
  app.post('/hub/api/v1/provision', async (c) => {
    const body = await c.req.json();
    const parsed = ProvisionRequestSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: 'Invalid request', details: parsed.error.issues }, 400);
    const result = await orchestrator.provision(parsed.data);
    return result.success
      ? c.json(result.data, 201)
      : c.json({ error: result.error }, 400);
  });

  // Fleet
  app.get('/hub/api/v1/fleet/spokes', async (c) => {
    const result = await fleet.listSpokes();
    return c.json(result.data);
  });

  app.post('/hub/api/v1/heartbeat', async (c) => {
    const body = await c.req.json();
    const parsed = HeartbeatRequestSchema.safeParse(body);
    if (!parsed.success) return c.json({ error: 'Invalid heartbeat', details: parsed.error.issues }, 400);
    const result = await fleet.processHeartbeat(parsed.data);
    return result.success
      ? c.json(result.data)
      : c.json({ error: result.error }, 400);
  });

  // Directory
  app.post('/hub/api/v1/directory', async (c) => {
    const body = await c.req.json();
    const result = await directory.register(body);
    return result.success
      ? c.json(result.data, 201)
      : c.json({ error: result.error }, 400);
  });

  // IMPORTANT: DID contains colons like did:web:test.eurocomply.app
  // Use a wildcard route pattern to capture the full DID
  app.get('/hub/api/v1/directory/:did{.+}', async (c) => {
    const did = c.req.param('did');
    const result = await directory.lookup(did);
    return result.success
      ? c.json(result.data)
      : c.json({ error: result.error }, 404);
  });

  // Billing webhook
  app.post('/hub/api/v1/billing/webhook', async (c) => {
    const body = await c.req.json();
    const result = await billing.handleWebhookEvent(body);
    return result.success
      ? c.json({ received: true })
      : c.json({ error: result.error }, 400);
  });

  return app;
}
