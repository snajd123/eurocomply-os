import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NetworkDirectoryService } from '../network-directory.js';
import { HubDb } from '../../db/connection.js';
import { runHubMigrations } from '../../db/migrate.js';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

describe('NetworkDirectoryService', () => {
  let container: StartedPostgreSqlContainer;
  let db: HubDb;
  let directory: NetworkDirectoryService;

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
    directory = new NetworkDirectoryService(db);

    // Seed spoke (FK)
    await db.query(`INSERT INTO organizations (org_id, name, email) VALUES ('org-dir', 'Dir Test', 'd@t.com')`);
    await db.query(`INSERT INTO products (product_id, name, version, manifest) VALUES ('prod-dir', 'Test', '1.0.0', '{}')`);
    await db.query(
      `INSERT INTO spokes (spoke_id, org_id, product_id, plan, region, status)
       VALUES ('spoke-dir-1', 'org-dir', 'prod-dir', 'starter', 'eu-west', 'active')`,
    );
  }, 60_000);

  afterAll(async () => {
    await db.close();
    await container.stop();
  });

  it('should register a DID entry', async () => {
    const result = await directory.register({
      did: 'did:web:acme.eurocomply.app',
      spoke_id: 'spoke-dir-1',
      endpoint: 'https://acme.eurocomply.app/mcp',
      capabilities: ['claims', 'evidence'],
    });
    expect(result.success).toBe(true);
  });

  it('should look up by DID', async () => {
    const result = await directory.lookup('did:web:acme.eurocomply.app');
    expect(result.success).toBe(true);
    expect(result.data.endpoint).toBe('https://acme.eurocomply.app/mcp');
    expect(result.data.capabilities).toContain('claims');
  });

  it('should list visible entries', async () => {
    const result = await directory.listVisible();
    expect(result.success).toBe(true);
    expect(result.data.total).toBe(1);
  });

  it('should update visibility', async () => {
    await directory.setVisibility('did:web:acme.eurocomply.app', false);
    const hidden = await directory.listVisible();
    expect(hidden.data.total).toBe(0);

    // Still findable by direct lookup
    const lookup = await directory.lookup('did:web:acme.eurocomply.app');
    expect(lookup.success).toBe(true);
  });

  it('should return error for unknown DID', async () => {
    const result = await directory.lookup('did:web:unknown');
    expect(result.success).toBe(false);
  });
});
