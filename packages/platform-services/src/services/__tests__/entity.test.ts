import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { EntityService } from '../entity.js';
import { AuditLogger } from '../audit.js';
import { PostgresConnectionManager } from '../../db/postgres.js';
import { runMigrations } from '../../db/migrate.js';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { ServiceContext } from '@eurocomply/types';

describe('EntityService', () => {
  let container: StartedPostgreSqlContainer;
  let db: PostgresConnectionManager;
  let audit: AuditLogger;
  let entities: EntityService;

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
    entities = new EntityService(db, audit);
  }, 60_000);

  afterAll(async () => {
    await db.close();
    await container.stop();
  });

  it('should define an entity type', async () => {
    const result = await entities.defineType(ctx, {
      entity_type: 'product',
      schema: {
        fields: [
          { name: 'name', type: 'string', required: true },
          { name: 'concentration', type: 'number' },
          { name: 'status', type: 'string' },
        ],
      },
    });

    expect(result.success).toBe(true);
  });

  it('should create an entity', async () => {
    const result = await entities.create(ctx, {
      entity_type: 'product',
      data: { name: 'Hand Cream', concentration: 0.05, status: 'draft' },
    });

    expect(result.success).toBe(true);
    expect(result.data.entity_id).toBeDefined();
    expect(result.data.entity_type).toBe('product');
    expect(result.data.version).toBe(1);
    expect(result.audit_entry).toBeDefined();
  });

  it('should get an entity', async () => {
    const created = await entities.create(ctx, {
      entity_type: 'product',
      data: { name: 'Shampoo', concentration: 0.02 },
    });

    const result = await entities.get(ctx, {
      entity_type: 'product',
      entity_id: created.data.entity_id,
    });

    expect(result.success).toBe(true);
    expect(result.data.data.name).toBe('Shampoo');
  });

  it('should update an entity', async () => {
    const created = await entities.create(ctx, {
      entity_type: 'product',
      data: { name: 'Body Lotion', concentration: 0.01 },
    });

    const result = await entities.update(ctx, {
      entity_type: 'product',
      entity_id: created.data.entity_id,
      data: { name: 'Body Lotion Pro', concentration: 0.005 },
    });

    expect(result.success).toBe(true);
    expect(result.data.version).toBe(2);
    expect(result.audit_entry).toBeDefined();
    expect(result.audit_entry!.changes).toBeDefined();
  });

  it('should list entities with filters', async () => {
    const result = await entities.list(ctx, {
      entity_type: 'product',
    });

    expect(result.success).toBe(true);
    expect(result.data.items.length).toBeGreaterThanOrEqual(3);
    expect(result.data.total).toBeGreaterThanOrEqual(3);
  });

  it('should store version history on update', async () => {
    const created = await entities.create(ctx, {
      entity_type: 'product',
      data: { name: 'Gel', concentration: 0.1 },
    });

    await entities.update(ctx, {
      entity_type: 'product',
      entity_id: created.data.entity_id,
      data: { concentration: 0.05 },
    });

    // Check version history exists
    const versions = await db.query(
      'SELECT * FROM entity_versions WHERE entity_id = $1 ORDER BY version',
      [created.data.entity_id]
    );
    expect(versions.rows.length).toBe(1); // version 1 snapshot stored on update
  });

  it('should list entities with FilterExpression', async () => {
    const result = await entities.list(ctx, {
      entity_type: 'product',
      filter: {
        field: 'status',
        operator: 'eq',
        value: 'draft',
      },
    });

    expect(result.success).toBe(true);
    for (const item of result.data.items) {
      expect(item.data.status).toBe('draft');
    }
  });

  it('should list entities with compound filter (AND)', async () => {
    const result = await entities.list(ctx, {
      entity_type: 'product',
      filter: {
        and: [
          { field: 'status', operator: 'eq', value: 'draft' },
          { field: 'concentration', operator: 'lt', value: 0.03 },
        ],
      },
    });

    expect(result.success).toBe(true);
    for (const item of result.data.items) {
      expect(item.data.status).toBe('draft');
      expect(Number(item.data.concentration)).toBeLessThan(0.03);
    }
  });

  it('should fail to create entity with unknown type', async () => {
    const result = await entities.create(ctx, {
      entity_type: 'nonexistent',
      data: { name: 'Test' },
    });

    expect(result.success).toBe(false);
  });
});
