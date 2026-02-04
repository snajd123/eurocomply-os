import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { HubDb } from '../connection.js';
import { runHubMigrations } from '../migrate.js';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

describe('Hub Database', () => {
  let container: StartedPostgreSqlContainer;
  let db: HubDb;

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
  }, 60_000);

  afterAll(async () => {
    await db.close();
    await container.stop();
  });

  it('should create all hub tables', async () => {
    const result = await db.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' ORDER BY table_name`,
    );
    const tables = result.rows.map((r: any) => r.table_name);
    expect(tables).toContain('organizations');
    expect(tables).toContain('spokes');
    expect(tables).toContain('products');
    expect(tables).toContain('subscriptions');
    expect(tables).toContain('provisioning_events');
    expect(tables).toContain('network_directory');
  });

  it('should insert and query an organization', async () => {
    await db.query(
      `INSERT INTO organizations (org_id, name, email, created_at)
       VALUES ($1, $2, $3, now())`,
      ['org-1', 'Acme Corp', 'admin@acme.com'],
    );
    const result = await db.query(
      `SELECT * FROM organizations WHERE org_id = $1`,
      ['org-1'],
    );
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].name).toBe('Acme Corp');
  });
});
