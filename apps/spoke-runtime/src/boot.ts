import {
  PostgresConnectionManager,
  Neo4jConnectionManager,
  runMigrations,
  AuditLogger,
  EntityService,
  RelationService,
  JobService,
  FileService,
  ExecutionLoop,
  PackService,
  createMCPToolRouter,
  createMCPServer,
  type StorageBackend,
} from '@eurocomply/platform-services';
import { createDefaultRegistry } from '@eurocomply/kernel-vm';
import { loadPack, createInstallPlan, type LoadedPack } from '@eurocomply/registry-sdk';
import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import type { SpokeConfig } from './config.js';
import { SpokeAgent } from './spoke-agent.js';
import { HubClient } from './hub-client.js';

class MemoryStorageBackend implements StorageBackend {
  private store = new Map<string, Buffer>();
  async put(key: string, data: Buffer): Promise<void> { this.store.set(key, data); }
  async get(key: string): Promise<Buffer | null> { return this.store.get(key) ?? null; }
  async delete(key: string): Promise<void> { this.store.delete(key); }
}

export interface SpokeInstance {
  app: ReturnType<typeof createMCPServer>;
  db: PostgresConnectionManager;
  neo4j?: Neo4jConnectionManager;
  entityService: EntityService;
  audit: AuditLogger;
  executionLoop: ExecutionLoop;
  packService: PackService;
  relationService?: RelationService;
  agent?: SpokeAgent;
  close(): Promise<void>;
}

export async function boot(config: SpokeConfig): Promise<SpokeInstance> {
  // Connect to PostgreSQL
  const db = new PostgresConnectionManager(config.postgres);
  await runMigrations(db);

  // Optionally connect to Neo4j
  let neo4j: Neo4jConnectionManager | undefined;
  if (config.neo4j) {
    neo4j = new Neo4jConnectionManager(config.neo4j);
  }

  // Create services
  const audit = new AuditLogger(db);
  const entityService = new EntityService(db, audit);
  const jobService = new JobService(db);
  const fileService = new FileService(db, audit, new MemoryStorageBackend());
  const registry = createDefaultRegistry();
  const executionLoop = new ExecutionLoop(db, entityService, audit, registry);
  const packService = new PackService(db, audit);

  let relationService: RelationService | undefined;
  if (neo4j) {
    relationService = new RelationService(db, neo4j, audit);
  }

  // Create MCP tool router and HTTP server
  const router = createMCPToolRouter({
    entityService,
    audit,
    jobService,
    fileService,
    executionLoop,
    packService,
  });
  const app = createMCPServer(router);

  // Load packs from directory if configured
  if (config.packsDir) {
    const packDirs = readdirSync(config.packsDir)
      .map(name => join(config.packsDir!, name))
      .filter(path => statSync(path).isDirectory());

    const ctx = {
      tenant_id: config.tenantId,
      principal: { type: 'system' as const, id: 'boot' },
      correlation_id: 'boot-pack-install',
    };

    // Load all packs first
    const loadedPacks: LoadedPack[] = [];
    const loadErrors: Array<{ dir: string; error: unknown }> = [];

    for (const dir of packDirs) {
      try {
        loadedPacks.push(await loadPack(dir));
      } catch (err) {
        loadErrors.push({ dir, error: err });
        console.error(`Failed to load pack from ${dir}:`, err);
      }
    }

    // Fail fast if required packs failed to load
    if (config.requirePacks && loadErrors.length > 0) {
      await db.close();
      if (neo4j) await neo4j.close();
      const dirs = loadErrors.map(e => e.dir).join(', ');
      throw new Error(`Boot aborted: failed to load required packs from: ${dirs}`);
    }

    // Build available packs map for dependency resolution
    const availablePacks: Record<string, LoadedPack> = {};
    for (const pack of loadedPacks) {
      availablePacks[pack.manifest.name] = pack;
    }

    // Wrap all pack installations in a single transaction for atomicity
    const uow = await db.beginTransaction();
    const txCtx = { ...ctx, tx: uow };

    try {
      for (const pack of loadedPacks) {
        const plan = await createInstallPlan(pack, {
          availablePacks,
          registry,
          handlerVmVersion: '1.0.0',
          tenantId: config.tenantId,
        });

        if (!plan.valid) {
          const msg = `Install plan invalid for ${pack.manifest.name}: ${plan.errors.join(', ')}`;
          if (config.requirePacks) {
            await uow.rollback();
            await db.close();
            if (neo4j) await neo4j.close();
            throw new Error(`Boot aborted: ${msg}`);
          }
          console.error(msg);
          continue;
        }

        for (const p of plan.packsToInstall) {
          await packService.install(txCtx, p.manifest);
        }

        await packService.saveLock(txCtx, plan.lock);
      }

      await uow.commit();
    } catch (err) {
      // Safe to call even if rollback was already called (UnitOfWork is idempotent)
      await uow.rollback();
      if (config.requirePacks) {
        await db.close();
        if (neo4j) await neo4j.close();
        throw err instanceof Error ? err : new Error('Boot aborted: pack installation failed');
      }
      console.error('Pack installation failed, continuing without packs:', err);
    }
  }

  // Start spoke agent if Hub URL is configured
  let agent: SpokeAgent | undefined;
  if (config.hubUrl) {
    const hubClient = new HubClient(config.hubUrl, config.apiKey ?? '');
    agent = new SpokeAgent(hubClient, {
      spokeId: config.spokeId ?? config.tenantId,
      osVersion: '2.0.0',
    });
    agent.start();
  }

  return {
    app,
    db,
    neo4j,
    entityService,
    audit,
    executionLoop,
    packService,
    relationService,
    agent,
    async close() {
      if (agent) agent.stop();
      if (neo4j) await neo4j.close();
      await db.close();
    },
  };
}
