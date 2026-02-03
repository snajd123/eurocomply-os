import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { AuditLogger } from '../audit.js';
import { PostgresConnectionManager } from '../../db/postgres.js';
import { runMigrations } from '../../db/migrate.js';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { ServiceContext } from '@eurocomply/types';

describe('AuditLogger', () => {
  let container: StartedPostgreSqlContainer;
  let db: PostgresConnectionManager;
  let audit: AuditLogger;

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
  }, 60_000);

  afterAll(async () => {
    await db.close();
    await container.stop();
  });

  it('should log an audit entry', async () => {
    const entry = await audit.log(ctx, {
      action: 'create',
      resource: { entity_type: 'product', entity_id: 'prod_1' },
      success: true,
    });

    expect(entry.audit_entry_id).toBeDefined();
    expect(entry.action).toBe('create');
    expect(entry.tenant_id).toBe('tenant_1');
    expect(entry.actor_type).toBe('user');
    expect(entry.actor_id).toBe('user_1');
  });

  it('should log changes', async () => {
    const entry = await audit.log(ctx, {
      action: 'update',
      resource: { entity_type: 'product', entity_id: 'prod_1' },
      changes: {
        fields_changed: ['name'],
        before: { name: 'Old' },
        after: { name: 'New' },
      },
      success: true,
    });

    expect(entry.changes).toBeDefined();
    expect(entry.changes!.fields_changed).toEqual(['name']);
  });

  it('should query audit entries', async () => {
    const entries = await audit.query(ctx.tenant_id, {
      resource_entity_type: 'product',
      resource_entity_id: 'prod_1',
    });

    expect(entries.length).toBeGreaterThanOrEqual(2);
  });
});
