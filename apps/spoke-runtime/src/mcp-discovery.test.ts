import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { boot, type SpokeInstance } from './boot.js';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

describe('MCP tool discovery', () => {
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
      tenantId: 'discovery-test',
    });
  }, 60_000);

  afterAll(async () => {
    await spoke.close();
    await container.stop();
  });

  it('returns tool list with input_schema for each tool', async () => {
    const res = await spoke.app.request('/mcp/tools');
    expect(res.status).toBe(200);

    const tools = await res.json() as Array<{ name: string; description: string; input_schema?: unknown }>;
    expect(tools.length).toBeGreaterThan(0);

    // Every tool should have an input_schema
    for (const tool of tools) {
      expect(tool.name).toBeDefined();
      expect(tool.description).toBeDefined();
      expect(tool.input_schema).toBeDefined();
      expect(typeof tool.input_schema).toBe('object');
    }
  });

  it('entity:create schema has required fields', async () => {
    const res = await spoke.app.request('/mcp/tools');
    const tools = await res.json() as Array<{ name: string; input_schema: { type: string; required?: string[]; properties?: Record<string, unknown> } }>;

    const entityCreate = tools.find(t => t.name === 'entity:create');
    expect(entityCreate).toBeDefined();
    expect(entityCreate!.input_schema.type).toBe('object');
    expect(entityCreate!.input_schema.required).toContain('entity_type');
    expect(entityCreate!.input_schema.required).toContain('data');
    expect(entityCreate!.input_schema.properties).toHaveProperty('entity_type');
    expect(entityCreate!.input_schema.properties).toHaveProperty('data');
  });

  it('evaluate schema has required fields', async () => {
    const res = await spoke.app.request('/mcp/tools');
    const tools = await res.json() as Array<{ name: string; input_schema: { required?: string[] } }>;

    const evaluate = tools.find(t => t.name === 'evaluate');
    expect(evaluate).toBeDefined();
    expect(evaluate!.input_schema.required).toContain('entity_type');
    expect(evaluate!.input_schema.required).toContain('entity_id');
    expect(evaluate!.input_schema.required).toContain('rule');
  });
});
