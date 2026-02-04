import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { OrganizationService } from '../organization.js';
import { HubDb } from '../../db/connection.js';
import { runHubMigrations } from '../../db/migrate.js';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

describe('OrganizationService', () => {
  let container: StartedPostgreSqlContainer;
  let db: HubDb;
  let orgService: OrganizationService;

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
    orgService = new OrganizationService(db);
  }, 60_000);

  afterAll(async () => {
    await db.close();
    await container.stop();
  });

  it('should create an organization', async () => {
    const result = await orgService.create({ name: 'Acme Corp', email: 'admin@acme.com' });
    expect(result.success).toBe(true);
    expect(result.data.name).toBe('Acme Corp');
    expect(result.data.org_id).toBeDefined();
    expect(result.data.status).toBe('active');
  });

  it('should get an organization by ID', async () => {
    const created = await orgService.create({ name: 'Beta Inc', email: 'beta@inc.com' });
    const result = await orgService.get(created.data.org_id);
    expect(result.success).toBe(true);
    expect(result.data.name).toBe('Beta Inc');
  });

  it('should update stripe customer ID', async () => {
    const created = await orgService.create({ name: 'Gamma Ltd', email: 'g@gamma.com' });
    const result = await orgService.update(created.data.org_id, { stripe_customer_id: 'cus_123' });
    expect(result.success).toBe(true);
    expect(result.data.stripe_customer_id).toBe('cus_123');
  });

  it('should list organizations', async () => {
    const result = await orgService.list();
    expect(result.success).toBe(true);
    expect(result.data.total).toBeGreaterThanOrEqual(3);
  });

  it('should return error for non-existent org', async () => {
    const result = await orgService.get('nonexistent');
    expect(result.success).toBe(false);
  });
});
