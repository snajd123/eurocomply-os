import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ExecutionLoop } from '../../execution-loop.js';
import { EntityService } from '../entity.js';
import { AuditLogger } from '../audit.js';
import { PostgresConnectionManager } from '../../db/postgres.js';
import { runMigrations } from '../../db/migrate.js';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import {
  HandlerRegistry, createDefaultRegistry, evaluate,
} from '@eurocomply/kernel-vm';
import type { ServiceContext } from '@eurocomply/types';

describe('ExecutionLoop', () => {
  let container: StartedPostgreSqlContainer;
  let db: PostgresConnectionManager;
  let audit: AuditLogger;
  let entityService: EntityService;
  let registry: HandlerRegistry;
  let loop: ExecutionLoop;

  const ctx: ServiceContext = {
    tenant_id: 'tenant_1',
    principal: { type: 'user', id: 'user_1' },
    correlation_id: 'corr_1',
  };

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    db = new PostgresConnectionManager({
      host: container.getHost(),
      port: container.getMappedPort(5432),
      database: container.getDatabase(),
      user: container.getUsername(),
      password: container.getPassword(),
    });
    await runMigrations(db);
    audit = new AuditLogger(db);
    entityService = new EntityService(db, audit);
    registry = createDefaultRegistry();
    loop = new ExecutionLoop(entityService, audit, registry);

    // Set up test data
    await entityService.defineType(ctx, {
      entity_type: 'product',
      schema: {
        fields: [
          { name: 'name', type: 'string', required: true },
          { name: 'lead_concentration', type: 'number' },
        ],
      },
    });
  }, 60_000);

  afterAll(async () => {
    await db.close();
    await container.stop();
  });

  it('should assemble context and evaluate a rule', async () => {
    const created = await entityService.create(ctx, {
      entity_type: 'product',
      data: { name: 'Test Product', lead_concentration: 0.0005 },
    });

    const result = await loop.evaluate(ctx, {
      entity_type: 'product',
      entity_id: created.data.entity_id,
      rule: {
        handler: 'core:threshold_check',
        config: {
          value: { field: 'lead_concentration' },
          operator: 'lt',
          threshold: 0.001,
        },
        label: 'Lead concentration below 0.1%',
      },
      compliance_lock_id: 'lock_test_1',
      vertical_id: 'cosmetics',
      market: 'EU',
    });

    expect(result.success).toBe(true);
    expect(result.data.handler_result.success).toBe(true);
    expect(result.data.handler_result.value).toHaveProperty('pass', true);
  });

  it('should fail evaluation for non-compliant entity', async () => {
    const created = await entityService.create(ctx, {
      entity_type: 'product',
      data: { name: 'Bad Product', lead_concentration: 0.05 },
    });

    const result = await loop.evaluate(ctx, {
      entity_type: 'product',
      entity_id: created.data.entity_id,
      rule: {
        handler: 'core:threshold_check',
        config: {
          value: { field: 'lead_concentration' },
          operator: 'lt',
          threshold: 0.001,
        },
      },
      compliance_lock_id: 'lock_test_2',
      vertical_id: 'cosmetics',
      market: 'EU',
    });

    expect(result.success).toBe(true);
    expect(result.data.handler_result.success).toBe(true);
    expect(result.data.handler_result.value).toHaveProperty('pass', false);
  });

  it('should log evaluation in audit', async () => {
    const created = await entityService.create(ctx, {
      entity_type: 'product',
      data: { name: 'Audited Product', lead_concentration: 0.0001 },
    });

    await loop.evaluate(ctx, {
      entity_type: 'product',
      entity_id: created.data.entity_id,
      rule: {
        handler: 'core:threshold_check',
        config: {
          value: { field: 'lead_concentration' },
          operator: 'lt',
          threshold: 0.001,
        },
      },
      compliance_lock_id: 'lock_test_3',
      vertical_id: 'cosmetics',
      market: 'EU',
    });

    const entries = await audit.query(ctx.tenant_id, {
      resource_entity_id: created.data.entity_id,
      action: 'evaluate',
    });
    expect(entries.length).toBe(1);
  });
});
