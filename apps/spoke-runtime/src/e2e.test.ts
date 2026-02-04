import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { boot, type SpokeInstance } from './boot.js';
import { loadSeedData } from './seed.js';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { ASTNode } from '@eurocomply/types';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('E2E: Phase 3 Vertical Slice — CLP Restriction Check', () => {
  let container: StartedPostgreSqlContainer;
  let spoke: SpokeInstance;

  const ctx = {
    tenant_id: 'spoke-e2e',
    principal: { type: 'user' as const, id: 'test-user' },
    correlation_id: 'e2e-phase3',
  };

  // The CLP restriction rule — same format as a Logic Pack's rules/main.ast.json
  const clpLeadRule: ASTNode = {
    handler: 'core:threshold_check',
    config: {
      value: { field: 'lead_ppm' },
      operator: 'lt',
      threshold: 10,
    },
    label: 'CLP Annex VI: Lead below 10 ppm limit',
  };

  const clpHeavyMetalsRule: ASTNode = {
    handler: 'core:and',
    config: {
      conditions: [
        {
          handler: 'core:threshold_check',
          config: { value: { field: 'lead_ppm' }, operator: 'lt', threshold: 10 },
          label: 'Lead < 10 ppm',
        },
        {
          handler: 'core:threshold_check',
          config: { value: { field: 'cadmium_ppm' }, operator: 'lt', threshold: 10 },
          label: 'Cadmium < 10 ppm',
        },
        {
          handler: 'core:threshold_check',
          config: { value: { field: 'mercury_ppm' }, operator: 'lt', threshold: 1 },
          label: 'Mercury < 1 ppm',
        },
      ],
    },
    label: 'CLP Annex VI: Heavy metals compliance',
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
      tenantId: 'spoke-e2e',
    });

    // Seed CLP substance reference data
    const seedFile = join(__dirname, '..', 'fixtures', 'clp-annex-vi-seed.json');
    await loadSeedData(seedFile, spoke.entityService, ctx);
  }, 60_000);

  afterAll(async () => {
    await spoke.close();
    await container.stop();
  });

  it('Step 1-3: should ingest seed data and create a compliant product', async () => {
    const product = await spoke.entityService.create(ctx, {
      entity_type: 'cosmetic_product',
      data: {
        name: 'Gentle Face Cream',
        product_type: 'leave-on',
        lead_ppm: 0.5,
        nickel_ppm: 0.05,
        cadmium_ppm: 0.1,
        mercury_ppm: 0.01,
        chromium_vi_ppm: 0.001,
      },
    });
    expect(product.success).toBe(true);
    expect(product.data.entity_id).toBeDefined();
  });

  it('Step 4-5: should evaluate a compliant product and return pass', async () => {
    const product = await spoke.entityService.create(ctx, {
      entity_type: 'cosmetic_product',
      data: {
        name: 'Safe Moisturizer',
        lead_ppm: 0.3,
        cadmium_ppm: 0.1,
        mercury_ppm: 0.01,
      },
    });

    const result = await spoke.executionLoop.evaluate(ctx, {
      entity_type: 'cosmetic_product',
      entity_id: product.data.entity_id,
      rule: clpLeadRule,
      compliance_lock_id: 'clp-basic-v1',
      vertical_id: 'cosmetics',
      market: 'EU',
    });

    expect(result.success).toBe(true);
    expect(result.data.handler_result.success).toBe(true);
    expect(result.data.handler_result.value).toHaveProperty('pass', true);
    expect(result.data.handler_result.trace.status).toBe('success');
    expect(result.data.compliance_lock_id).toBe('clp-basic-v1');
  });

  it('should evaluate a non-compliant product and return fail', async () => {
    const product = await spoke.entityService.create(ctx, {
      entity_type: 'cosmetic_product',
      data: {
        name: 'Contaminated Lipstick',
        lead_ppm: 25,
        cadmium_ppm: 0.1,
        mercury_ppm: 0.01,
      },
    });

    const result = await spoke.executionLoop.evaluate(ctx, {
      entity_type: 'cosmetic_product',
      entity_id: product.data.entity_id,
      rule: clpLeadRule,
      compliance_lock_id: 'clp-basic-v1',
      vertical_id: 'cosmetics',
      market: 'EU',
    });

    expect(result.success).toBe(true);
    expect(result.data.handler_result.value).toHaveProperty('pass', false);
  });

  it('should evaluate composed rule (AND gate) for heavy metals', async () => {
    const product = await spoke.entityService.create(ctx, {
      entity_type: 'cosmetic_product',
      data: {
        name: 'Premium Eye Shadow',
        lead_ppm: 0.5,
        cadmium_ppm: 0.2,
        mercury_ppm: 0.005,
      },
    });

    const result = await spoke.executionLoop.evaluate(ctx, {
      entity_type: 'cosmetic_product',
      entity_id: product.data.entity_id,
      rule: clpHeavyMetalsRule,
      compliance_lock_id: 'clp-basic-v1',
      vertical_id: 'cosmetics',
      market: 'EU',
    });

    expect(result.success).toBe(true);
    expect(result.data.handler_result.value).toHaveProperty('pass', true);
  });

  it('should produce audit trail for evaluation', async () => {
    const product = await spoke.entityService.create(ctx, {
      entity_type: 'cosmetic_product',
      data: { name: 'Audit Trail Product', lead_ppm: 2 },
    });

    await spoke.executionLoop.evaluate(ctx, {
      entity_type: 'cosmetic_product',
      entity_id: product.data.entity_id,
      rule: clpLeadRule,
      compliance_lock_id: 'clp-basic-v1',
      vertical_id: 'cosmetics',
      market: 'EU',
    });

    const entries = await spoke.audit.query(ctx.tenant_id, {
      resource_entity_id: product.data.entity_id,
      action: 'evaluate',
    });
    expect(entries.length).toBe(1);
    expect(entries[0].action).toBe('evaluate');
  });

  it('should serve evaluation via MCP HTTP endpoint', async () => {
    // Create product via MCP
    const defineRes = await spoke.app.request('/mcp/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tool: 'entity:create',
        input: {
          entity_type: 'cosmetic_product',
          data: { name: 'MCP Product', lead_ppm: 1.5 },
        },
        context: { tenant_id: ctx.tenant_id, principal: ctx.principal, correlation_id: 'mcp-test' },
      }),
    });

    expect(defineRes.status).toBe(200);
    const createResult = await defineRes.json() as { success: boolean; data: { entity_id: string } };
    expect(createResult.success).toBe(true);

    // Evaluate via MCP
    const evalRes = await spoke.app.request('/mcp/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tool: 'evaluate',
        input: {
          entity_type: 'cosmetic_product',
          entity_id: createResult.data.entity_id,
          rule: clpLeadRule,
          compliance_lock_id: 'clp-basic-v1',
          vertical_id: 'cosmetics',
          market: 'EU',
        },
        context: { tenant_id: ctx.tenant_id, principal: ctx.principal, correlation_id: 'mcp-eval' },
      }),
    });

    expect(evalRes.status).toBe(200);
    const evalResult = await evalRes.json() as { success: boolean; data: { handler_result: { value: { pass: boolean } } } };
    expect(evalResult.success).toBe(true);
    expect(evalResult.data.handler_result.value.pass).toBe(true);
  });
});
