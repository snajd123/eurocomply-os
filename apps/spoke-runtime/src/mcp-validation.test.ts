import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { boot, type SpokeInstance } from './boot.js';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

describe('MCP input validation', () => {
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
      tenantId: 'validation-test',
    });
  }, 60_000);

  afterAll(async () => {
    await spoke.close();
    await container.stop();
  });

  it('rejects entity:create with missing entity_type', async () => {
    const res = await spoke.app.request('/mcp/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tool: 'entity:create',
        input: { data: { name: 'Widget' } },
        context: { tenant_id: 'validation-test', principal: { type: 'system', id: 'test' } },
      }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBeDefined();
    expect(body.validation_errors).toBeDefined();
    expect(body.validation_errors.length).toBeGreaterThan(0);
    expect(body.validation_errors[0].path).toContain('entity_type');
  });

  it('rejects evaluate with missing rule', async () => {
    const res = await spoke.app.request('/mcp/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tool: 'evaluate',
        input: {
          entity_type: 'product',
          entity_id: 'p-1',
          compliance_lock_id: 'lock-1',
          vertical_id: 'cosmetics',
          market: 'EU',
        },
        context: { tenant_id: 'validation-test', principal: { type: 'system', id: 'test' } },
      }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.validation_errors).toBeDefined();
  });

  it('accepts valid entity:create input', async () => {
    // First define the type
    await spoke.app.request('/mcp/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tool: 'entity:define',
        input: { entity_type: 'widget', schema: { name: { type: 'string' } } },
        context: { tenant_id: 'validation-test', principal: { type: 'system', id: 'test' } },
      }),
    });

    const res = await spoke.app.request('/mcp/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tool: 'entity:create',
        input: { entity_type: 'widget', data: { name: 'Valid Widget' } },
        context: { tenant_id: 'validation-test', principal: { type: 'system', id: 'test' } },
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });
});
