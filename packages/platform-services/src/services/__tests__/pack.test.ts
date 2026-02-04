import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PackService } from '../pack.js';
import { AuditLogger } from '../audit.js';
import { PostgresConnectionManager } from '../../db/postgres.js';
import { runMigrations } from '../../db/migrate.js';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { ServiceContext, PackManifest, ComplianceLock } from '@eurocomply/types';

describe('PackService', () => {
  let container: StartedPostgreSqlContainer;
  let db: PostgresConnectionManager;
  let audit: AuditLogger;
  let packs: PackService;

  const ctx: ServiceContext = {
    tenant_id: 'tenant_1',
    principal: { type: 'user', id: 'user_1' },
    correlation_id: 'corr_pack_1',
  };

  const sampleManifest: PackManifest = {
    name: '@test/sample-pack',
    version: '1.0.0',
    type: 'logic',
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
    audit = new AuditLogger(db);
    packs = new PackService(db, audit);
  }, 60_000);

  afterAll(async () => {
    await db.close();
    await container.stop();
  });

  it('should install a pack', async () => {
    const result = await packs.install(ctx, sampleManifest);

    expect(result.success).toBe(true);
    expect(result.data.pack_name).toBe('@test/sample-pack');
    expect(result.data.pack_version).toBe('1.0.0');
    expect(result.data.pack_type).toBe('logic');
    expect(result.data.status).toBe('active');
    expect(result.data.manifest.name).toBe('@test/sample-pack');
    expect(result.data.installed_at).toBeDefined();
  });

  it('should list installed packs', async () => {
    const result = await packs.list(ctx);

    expect(result.success).toBe(true);
    expect(result.data.items.length).toBeGreaterThanOrEqual(1);

    const found = result.data.items.find((p) => p.pack_name === '@test/sample-pack');
    expect(found).toBeDefined();
    expect(found!.pack_version).toBe('1.0.0');
    expect(found!.pack_type).toBe('logic');
  });

  it('should save and retrieve a compliance lock', async () => {
    const lock: ComplianceLock = {
      lock_id: 'lock_001',
      tenant_id: ctx.tenant_id,
      timestamp: new Date().toISOString(),
      handler_vm_exact: '1.0.0',
      root_pack: {
        name: '@test/sample-pack',
        version: '1.0.0',
        cid: 'bafytest123',
      },
      packs: {
        '@test/sample-pack': {
          version: '1.0.0',
          cid: 'bafytest123',
        },
      },
      status: 'active',
    };

    const saveResult = await packs.saveLock(ctx, lock);
    expect(saveResult.success).toBe(true);
    expect(saveResult.data.lock_id).toBe('lock_001');

    const getResult = await packs.getLock(ctx, 'lock_001');
    expect(getResult.success).toBe(true);
    expect(getResult.data.lock_id).toBe('lock_001');
    expect(getResult.data.root_pack.name).toBe('@test/sample-pack');
    expect(getResult.data.handler_vm_exact).toBe('1.0.0');
    expect(Object.keys(getResult.data.packs)).toHaveLength(1);
  });

  it('should update an existing pack on re-install', async () => {
    const updatedManifest: PackManifest = {
      name: '@test/sample-pack',
      version: '2.0.0',
      type: 'logic',
    };

    const result = await packs.install(ctx, updatedManifest);

    expect(result.success).toBe(true);
    expect(result.data.pack_version).toBe('2.0.0');

    const listResult = await packs.list(ctx);
    const matching = listResult.data.items.filter((p) => p.pack_name === '@test/sample-pack');
    expect(matching).toHaveLength(1);
    expect(matching[0].pack_version).toBe('2.0.0');
  });

  it('should return failure for non-existent lock', async () => {
    const result = await packs.getLock(ctx, 'nonexistent_lock');
    expect(result.success).toBe(false);
  });

  it('should list compliance locks', async () => {
    const result = await packs.listLocks(ctx);
    expect(result.success).toBe(true);
    expect(result.data.items.length).toBeGreaterThanOrEqual(1);
    expect(result.data.items[0].lock_id).toBe('lock_001');
  });
});
