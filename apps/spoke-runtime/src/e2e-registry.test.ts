import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { boot, type SpokeInstance } from './boot.js';
import { loadSeedData } from './seed.js';
import { createRegistryAPI, RegistryStore } from '@eurocomply/hub-control-plane';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { ASTNode } from '@eurocomply/types';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('E2E: Phase 4 — Pack Lifecycle', () => {
  let container: StartedPostgreSqlContainer;
  let spoke: SpokeInstance;
  let hubApp: ReturnType<typeof createRegistryAPI>;
  let hubStore: RegistryStore;

  const ctx = {
    tenant_id: 'phase4-e2e',
    principal: { type: 'user' as const, id: 'test-user' },
    correlation_id: 'e2e-phase4',
  };

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    spoke = await boot({
      port: 0,
      postgres: {
        host: container.getHost(),
        port: container.getMappedPort(5432),
        database: container.getDatabase(),
        user: container.getUsername(),
        password: container.getPassword(),
      },
      tenantId: 'phase4-e2e',
    });

    // Seed CLP substance reference data
    const seedFile = join(__dirname, '..', 'fixtures', 'clp-annex-vi-seed.json');
    await loadSeedData(seedFile, spoke.entityService, ctx);

    // Create Hub Registry (in-memory)
    hubStore = new RegistryStore();
    hubApp = createRegistryAPI(hubStore);
  }, 60_000);

  afterAll(async () => {
    await spoke.close();
    await container.stop();
  });

  it('should publish a pack to the Hub Registry', async () => {
    const res = await hubApp.request('/packs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        manifest: {
          name: '@eu/clp-basic',
          version: '1.0.0',
          type: 'logic',
          scope: { verticals: ['cosmetics'], markets: ['EU'] },
        },
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.cid).toBeDefined();
    expect(body.name).toBe('@eu/clp-basic');
  });

  it('should install a pack on the spoke', async () => {
    const result = await spoke.packService.install(ctx, {
      name: '@eu/clp-basic',
      version: '1.0.0',
      type: 'logic',
      scope: { verticals: ['cosmetics'], markets: ['EU'] },
    });
    expect(result.success).toBe(true);
    expect(result.data.pack_name).toBe('@eu/clp-basic');
    expect(result.data.status).toBe('active');
  });

  it('should list installed packs', async () => {
    const result = await spoke.packService.list(ctx);
    expect(result.success).toBe(true);
    expect(result.data.total).toBe(1);
    expect(result.data.items[0].pack_name).toBe('@eu/clp-basic');
  });

  it('should evaluate a product and save a compliance lock', async () => {
    // Create product
    const product = await spoke.entityService.create(ctx, {
      entity_type: 'cosmetic_product',
      data: { name: 'Phase 4 Test Product', lead_ppm: 0.5 },
    });

    const rule: ASTNode = {
      handler: 'core:threshold_check',
      config: { value: { field: 'lead_ppm' }, operator: 'lt', threshold: 10 },
      label: 'Lead < 10 ppm',
    };

    // Evaluate
    const evalResult = await spoke.executionLoop.evaluate(ctx, {
      entity_type: 'cosmetic_product',
      entity_id: product.data.entity_id,
      rule,
      compliance_lock_id: 'clp-basic-v1-lock',
      vertical_id: 'cosmetics',
      market: 'EU',
    });
    expect(evalResult.success).toBe(true);
    expect(evalResult.data.handler_result.value).toHaveProperty('pass', true);

    // Save lock
    const lock = {
      lock_id: 'clp-basic-v1-lock',
      tenant_id: ctx.tenant_id,
      timestamp: new Date().toISOString(),
      handler_vm_exact: '1.0.0',
      root_pack: { name: '@eu/clp-basic', version: '1.0.0', cid: 'test-cid' },
      packs: {
        '@eu/clp-basic@1.0.0': { version: '1.0.0', cid: 'test-cid' },
      },
      status: 'active' as const,
    };
    const lockResult = await spoke.packService.saveLock(ctx, lock);
    expect(lockResult.success).toBe(true);

    // Retrieve lock
    const getLockResult = await spoke.packService.getLock(ctx, 'clp-basic-v1-lock');
    expect(getLockResult.success).toBe(true);
    expect(getLockResult.data.root_pack.name).toBe('@eu/clp-basic');
    expect(getLockResult.data.packs['@eu/clp-basic@1.0.0'].version).toBe('1.0.0');
  });

  it('should serve registry tools via MCP', async () => {
    const res = await spoke.app.request('/mcp/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tool: 'registry:list',
        input: {},
        context: { tenant_id: ctx.tenant_id, principal: ctx.principal },
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(body.data.total).toBe(1);
  });
});
