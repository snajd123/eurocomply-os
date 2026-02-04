import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { loadSeedData } from './seed.js';
import { boot, type SpokeInstance } from './boot.js';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('Seed Data Loader', () => {
  let container: StartedPostgreSqlContainer;
  let spoke: SpokeInstance;

  const ctx = {
    tenant_id: 'test-tenant',
    principal: { type: 'system' as const, id: 'seed' },
    correlation_id: 'seed-test',
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
      tenantId: 'test-tenant',
    });
  }, 60_000);

  afterAll(async () => {
    await spoke.close();
    await container.stop();
  });

  it('should load seed data from fixture file', async () => {
    const seedFile = join(__dirname, '..', 'fixtures', 'clp-annex-vi-seed.json');
    const result = await loadSeedData(seedFile, spoke.entityService, ctx);
    expect(result.typesCreated).toBe(2);
    expect(result.entitiesCreated).toBe(10);
  });

  it('should be queryable after seeding', async () => {
    const substances = await spoke.entityService.list(ctx, { entity_type: 'substance' });
    expect(substances.success).toBe(true);
    expect(substances.data.total).toBe(10);
  });
});
