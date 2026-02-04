import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { boot, type SpokeInstance } from './boot.js';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

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

  it('should install packs from directory on boot', async () => {
    const packsDir = join(tmpdir(), `boot-packs-${Date.now()}`);
    mkdirSync(join(packsDir, 'test-pack'), { recursive: true });
    writeFileSync(join(packsDir, 'test-pack', 'pack.json'), JSON.stringify({
      name: '@test/boot-pack',
      version: '1.0.0',
      type: 'logic',
    }));

    const spokeWithPacks = await boot({
      port: 0,
      postgres: {
        host: container.getHost(),
        port: container.getMappedPort(5432),
        database: container.getDatabase(),
        user: container.getUsername(),
        password: container.getPassword(),
      },
      tenantId: 'test-tenant-packs',
      packsDir,
    });

    const packs = await spokeWithPacks.packService.list({
      tenant_id: 'test-tenant-packs',
      principal: { type: 'system', id: 'test' },
      correlation_id: 'test',
    });

    expect(packs.data.total).toBe(1);
    expect(packs.data.items[0].pack_name).toBe('@test/boot-pack');

    await spokeWithPacks.close();
    rmSync(packsDir, { recursive: true, force: true });
  });
});
