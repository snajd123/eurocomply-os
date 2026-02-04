import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { boot, type SpokeInstance } from './boot.js';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

describe('Spoke Boot', () => {
  let container: StartedPostgreSqlContainer;
  let spoke: SpokeInstance;

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

  it('should boot successfully with database connection', () => {
    expect(spoke.app).toBeDefined();
    expect(spoke.entityService).toBeDefined();
    expect(spoke.executionLoop).toBeDefined();
  });

  it('should serve health endpoint', async () => {
    const res = await spoke.app.request('/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
  });

  it('should list MCP tools', async () => {
    const res = await spoke.app.request('/mcp/tools');
    expect(res.status).toBe(200);
    const tools = await res.json();
    expect(tools.length).toBeGreaterThan(0);
  });
});
