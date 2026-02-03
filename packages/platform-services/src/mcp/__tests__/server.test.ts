import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createMCPToolRouter, type MCPToolRouter } from '../tools.js';
import { EntityService } from '../../services/entity.js';
import { AuditLogger } from '../../services/audit.js';
import { JobService } from '../../services/job.js';
import { FileService, type StorageBackend } from '../../services/file.js';
import { ExecutionLoop } from '../../execution-loop.js';
import { PostgresConnectionManager } from '../../db/postgres.js';
import { runMigrations } from '../../db/migrate.js';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createDefaultRegistry } from '@eurocomply/kernel-vm';
import type { ServiceContext } from '@eurocomply/types';

class MemoryStorageBackend implements StorageBackend {
  private store = new Map<string, Buffer>();
  async put(key: string, data: Buffer): Promise<void> { this.store.set(key, data); }
  async get(key: string): Promise<Buffer | null> { return this.store.get(key) ?? null; }
  async delete(key: string): Promise<void> { this.store.delete(key); }
}

describe('MCP Tool Router', () => {
  let container: StartedPostgreSqlContainer;
  let db: PostgresConnectionManager;
  let router: MCPToolRouter;

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

    const audit = new AuditLogger(db);
    const entityService = new EntityService(db, audit);
    const jobService = new JobService(db);
    const fileService = new FileService(db, audit, new MemoryStorageBackend());
    const registry = createDefaultRegistry();
    const executionLoop = new ExecutionLoop(entityService, audit, registry);

    router = createMCPToolRouter({
      entityService,
      audit,
      jobService,
      fileService,
      executionLoop,
    });
  }, 60_000);

  afterAll(async () => {
    await db.close();
    await container.stop();
  });

  it('should list available tools', () => {
    const tools = router.listTools();
    expect(tools.length).toBeGreaterThan(0);
    const toolNames = tools.map(t => t.name);
    expect(toolNames).toContain('entity:create');
    expect(toolNames).toContain('entity:get');
    expect(toolNames).toContain('entity:list');
    expect(toolNames).toContain('entity:update');
    expect(toolNames).toContain('file:upload');
    expect(toolNames).toContain('file:get');
    expect(toolNames).toContain('job:submit');
    expect(toolNames).toContain('job:status');
    expect(toolNames).toContain('audit:query');
  });

  it('should call entity:create through router', async () => {
    await router.callTool('entity:define', { entity_type: 'material', schema: { fields: [{ name: 'name', type: 'string' }] } }, ctx);

    const result = await router.callTool(
      'entity:create',
      { entity_type: 'material', data: { name: 'Steel' } },
      ctx,
    );

    expect(result.success).toBe(true);
    expect((result.data as Record<string, unknown>).entity_id).toBeDefined();
  });

  it('should return error for unknown tool', async () => {
    await expect(
      router.callTool('nonexistent:tool', {}, ctx)
    ).rejects.toThrow();
  });
});
