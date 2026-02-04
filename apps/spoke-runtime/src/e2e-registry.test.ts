import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { boot, type SpokeInstance } from './boot.js';
import { loadSeedData } from './seed.js';
import { createRegistryAPI, RegistryStore } from '@eurocomply/hub-control-plane';
import { createInstallPlan, type LoadedPack } from '@eurocomply/registry-sdk';
import { createDefaultRegistry } from '@eurocomply/kernel-vm';
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
  let generatedLockId: string;

  const ctx = {
    tenant_id: 'phase4-e2e',
    principal: { type: 'user' as const, id: 'test-user' },
    correlation_id: 'e2e-phase4',
  };

  const ruleAST: ASTNode = {
    handler: 'core:threshold_check',
    config: { value: { field: 'lead_ppm' }, operator: 'lt', threshold: 10 },
    label: 'Lead < 10 ppm',
  };

  const validationSuite = {
    vertical_id: 'cosmetics',
    test_cases: [
      {
        id: 'below-limit',
        description: 'Lead below 10 ppm passes',
        entity_data: { name: 'Safe Product', lead_ppm: 0.5 },
        expected_status: 'compliant',
      },
    ],
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

  it('should publish a pack with content to the Hub Registry', async () => {
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
        content: {
          ruleAST,
          validationSuite,
        },
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.cid).toBeDefined();
    expect(body.name).toBe('@eu/clp-basic');
  });

  it('should fetch pack from Hub and install via createInstallPlan', async () => {
    // Fetch the published pack from Hub
    const fetchRes = await hubApp.request('/packs/@eu/clp-basic/1.0.0');
    expect(fetchRes.status).toBe(200);
    const hubPack = (await fetchRes.json()) as any;
    expect(hubPack.manifest.name).toBe('@eu/clp-basic');
    expect(hubPack.content.ruleAST).toBeDefined();

    // Construct LoadedPack from Hub response
    const loadedPack: LoadedPack = {
      manifest: hubPack.manifest,
      ruleAST: hubPack.content.ruleAST,
      validationSuite: hubPack.content.validationSuite,
      directory: '',
    };

    // Create install plan with real dependency resolution and simulator validation
    const registry = createDefaultRegistry();
    const plan = await createInstallPlan(loadedPack, {
      availablePacks: { '@eu/clp-basic': loadedPack },
      registry,
      handlerVmVersion: '1.0.0',
      tenantId: ctx.tenant_id,
    });

    expect(plan.valid).toBe(true);
    expect(plan.errors).toHaveLength(0);
    expect(plan.packsToInstall).toHaveLength(1);
    expect(plan.simulationResults[0].allPassed).toBe(true);
    expect(plan.lock.root_pack.name).toBe('@eu/clp-basic');
    expect(plan.lock.packs['@eu/clp-basic@1.0.0']).toBeDefined();

    // Install packs from the plan
    for (const p of plan.packsToInstall) {
      const installResult = await spoke.packService.install(ctx, p.manifest);
      expect(installResult.success).toBe(true);
    }

    // Save the generated ComplianceLock
    const lockResult = await spoke.packService.saveLock(ctx, plan.lock);
    expect(lockResult.success).toBe(true);
    generatedLockId = plan.lock.lock_id;
  });

  it('should list installed packs', async () => {
    const result = await spoke.packService.list(ctx);
    expect(result.success).toBe(true);
    expect(result.data.total).toBe(1);
    expect(result.data.items[0].pack_name).toBe('@eu/clp-basic');
  });

  it('should evaluate a product using the generated lock', async () => {
    // Create product
    const product = await spoke.entityService.create(ctx, {
      entity_type: 'cosmetic_product',
      data: { name: 'Phase 4 Test Product', lead_ppm: 0.5 },
    });

    // Evaluate using the lock generated by createInstallPlan
    const evalResult = await spoke.executionLoop.evaluate(ctx, {
      entity_type: 'cosmetic_product',
      entity_id: product.data.entity_id,
      rule: ruleAST,
      compliance_lock_id: generatedLockId,
      vertical_id: 'cosmetics',
      market: 'EU',
    });
    expect(evalResult.success).toBe(true);
    expect(evalResult.data.handler_result.value).toHaveProperty('pass', true);

    // Retrieve the lock and verify it has real CIDs (not hand-crafted)
    const getLockResult = await spoke.packService.getLock(ctx, generatedLockId);
    expect(getLockResult.success).toBe(true);
    expect(getLockResult.data.root_pack.name).toBe('@eu/clp-basic');
    expect(getLockResult.data.root_pack.cid).toMatch(/^[a-f0-9]{64}$/); // Real SHA-256 hash
    expect(getLockResult.data.packs['@eu/clp-basic@1.0.0'].version).toBe('1.0.0');
    expect(getLockResult.data.packs['@eu/clp-basic@1.0.0'].cid).toMatch(/^[a-f0-9]{64}$/);
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
