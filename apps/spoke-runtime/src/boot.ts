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
import { loadPack } from '@eurocomply/registry-sdk';
import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import type { SpokeConfig } from './config.js';

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

    for (const dir of packDirs) {
      try {
        const pack = await loadPack(dir);
        await packService.install(ctx, pack.manifest);
      } catch (err) {
        console.error(`Failed to load pack from ${dir}:`, err);
      }
    }
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
    async close() {
      if (neo4j) await neo4j.close();
      await db.close();
    },
  };
}
