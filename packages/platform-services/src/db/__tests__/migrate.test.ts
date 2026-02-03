import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgresConnectionManager } from '../postgres.js';
import { runMigrations } from '../migrate.js';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

describe('runMigrations', () => {
  let container: StartedPostgreSqlContainer;
  let db: PostgresConnectionManager;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    db = new PostgresConnectionManager({
      host: container.getHost(),
      port: container.getMappedPort(5432),
      database: container.getDatabase(),
      user: container.getUsername(),
      password: container.getPassword(),
    });
  }, 60_000);

  afterAll(async () => {
    await db.close();
    await container.stop();
  });

  it('should apply migrations and create tables', async () => {
    const count = await runMigrations(db);
    expect(count).toBeGreaterThan(0);

    // Verify tables exist
    const tables = await db.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    const tableNames = tables.rows.map((r: { table_name: string }) => r.table_name);
    expect(tableNames).toContain('entities');
    expect(tableNames).toContain('entity_types');
    expect(tableNames).toContain('entity_versions');
    expect(tableNames).toContain('files');
    expect(tableNames).toContain('audit_log');
    expect(tableNames).toContain('jobs');
    expect(tableNames).toContain('relation_types');
  });

  it('should be idempotent', async () => {
    const count = await runMigrations(db);
    expect(count).toBe(0); // already applied
  });
});
