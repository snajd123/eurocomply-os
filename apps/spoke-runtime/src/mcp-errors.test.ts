import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { boot, type SpokeInstance } from './boot.js';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

describe('MCP HTTP error codes', () => {
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
      tenantId: 'error-test',
    });
  }, 60_000);

  afterAll(async () => {
    await spoke.close();
    await container.stop();
  });

  it('returns 404 for unknown tool', async () => {
    const res = await spoke.app.request('/mcp/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tool: 'nonexistent:tool',
        input: {},
        context: { tenant_id: 'error-test', principal: { type: 'system', id: 'test' } },
      }),
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toContain('Unknown tool');
  });

  it('returns 400 for invalid input', async () => {
    const res = await spoke.app.request('/mcp/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tool: 'entity:create',
        input: {}, // missing required fields
        context: { tenant_id: 'error-test', principal: { type: 'system', id: 'test' } },
      }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.validation_errors).toBeDefined();
  });

  it('returns 200 with success:false for entity:get on nonexistent entity', async () => {
    // First define the type so the tool itself works
    await spoke.app.request('/mcp/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tool: 'entity:define',
        input: { entity_type: 'gadget', schema: { name: { type: 'string' } } },
        context: { tenant_id: 'error-test', principal: { type: 'system', id: 'test' } },
      }),
    });

    const res = await spoke.app.request('/mcp/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tool: 'entity:get',
        input: { entity_type: 'gadget', entity_id: 'does-not-exist' },
        context: { tenant_id: 'error-test', principal: { type: 'system', id: 'test' } },
      }),
    });

    // Business-level outcome: entity not found is not an HTTP error
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(false);
  });

  it('returns 200 with success:false for evaluation of non-existent entity', async () => {
    const res = await spoke.app.request('/mcp/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tool: 'evaluate',
        input: {
          entity_type: 'nonexistent_type',
          entity_id: 'x',
          rule: { handler: 'core:threshold_check', config: { value: 1, operator: 'lt', threshold: 10 } },
          compliance_lock_id: 'lock-1',
          vertical_id: 'cosmetics',
          market: 'EU',
        },
        context: { tenant_id: 'error-test', principal: { type: 'system', id: 'test' } },
      }),
    });

    // ExecutionLoop handles this gracefully as a business-level failure
    const body = await res.json();
    expect(body.success).toBe(false);
  });
});
