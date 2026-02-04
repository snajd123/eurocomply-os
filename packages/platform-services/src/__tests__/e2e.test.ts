import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  PostgresConnectionManager,
  Neo4jConnectionManager,
  runMigrations,
  AuditLogger,
  EntityService,
  RelationService,
  FileService,
  JobService,
  ExecutionLoop,
  createMCPToolRouter,
  type StorageBackend,
} from '../index.js';
import { createDefaultRegistry } from '@eurocomply/kernel-vm';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import type { ServiceContext } from '@eurocomply/types';

class MemoryStorageBackend implements StorageBackend {
  private store = new Map<string, Buffer>();
  async put(key: string, data: Buffer): Promise<void> { this.store.set(key, data); }
  async get(key: string): Promise<Buffer | null> { return this.store.get(key) ?? null; }
  async delete(key: string): Promise<void> { this.store.delete(key); }
}

describe('E2E: Full Execution Loop', () => {
  let pgContainer: StartedPostgreSqlContainer;
  let neo4jContainer: StartedTestContainer;
  let db: PostgresConnectionManager;
  let neo4j: Neo4jConnectionManager;
  let entityService: EntityService;
  let relationService: RelationService;
  let executionLoop: ExecutionLoop;
  let audit: AuditLogger;

  const ctx: ServiceContext = {
    tenant_id: 'tenant_e2e',
    principal: { type: 'user', id: 'admin' },
    correlation_id: 'e2e_test',
  };

  beforeAll(async () => {
    pgContainer = await new PostgreSqlContainer('postgres:16-alpine').start();
    db = new PostgresConnectionManager({
      host: pgContainer.getHost(),
      port: pgContainer.getMappedPort(5432),
      database: pgContainer.getDatabase(),
      user: pgContainer.getUsername(),
      password: pgContainer.getPassword(),
    });
    await runMigrations(db);

    neo4jContainer = await new GenericContainer('neo4j:5')
      .withEnvironment({ NEO4J_AUTH: 'neo4j/testpassword' })
      .withExposedPorts(7687)
      .start();

    // Wait for Neo4j to be ready with retry loop
    neo4j = new Neo4jConnectionManager({
      uri: `bolt://${neo4jContainer.getHost()}:${neo4jContainer.getMappedPort(7687)}`,
      username: 'neo4j',
      password: 'testpassword',
    });

    // Retry until Neo4j accepts connections
    for (let attempt = 0; attempt < 30; attempt++) {
      try {
        await neo4j.run('RETURN 1');
        break;
      } catch {
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    audit = new AuditLogger(db);
    entityService = new EntityService(db, audit);
    relationService = new RelationService(db, neo4j, audit);
    const registry = createDefaultRegistry();
    executionLoop = new ExecutionLoop(db, entityService, audit, registry, relationService);
  }, 120_000);

  afterAll(async () => {
    await neo4j.close();
    await db.close();
    await neo4jContainer.stop();
    await pgContainer.stop();
  });

  it('should complete full compliance evaluation lifecycle', async () => {
    // 1. Define entity types
    await entityService.defineType(ctx, {
      entity_type: 'cosmetic_product',
      schema: {
        fields: [
          { name: 'name', type: 'string', required: true },
          { name: 'lead_ppm', type: 'number' },
          { name: 'nickel_ppm', type: 'number' },
        ],
      },
    });

    await entityService.defineType(ctx, {
      entity_type: 'material',
      schema: {
        fields: [
          { name: 'name', type: 'string', required: true },
          { name: 'cas_number', type: 'string' },
        ],
      },
    });

    // 2. Create entities
    const product = await entityService.create(ctx, {
      entity_type: 'cosmetic_product',
      data: { name: 'Hand Cream', lead_ppm: 0.5, nickel_ppm: 0.1 },
    });
    expect(product.success).toBe(true);

    const material = await entityService.create(ctx, {
      entity_type: 'material',
      data: { name: 'Zinc Oxide', cas_number: '1314-13-2' },
    });
    expect(material.success).toBe(true);

    // 3. Define relation type, then create relation
    await relationService.defineType(ctx, {
      relation_type: 'CONTAINS',
      from_entity_type: 'cosmetic_product',
      to_entity_type: 'material',
      cardinality: 'n:n',
    });

    const relation = await relationService.create(ctx, {
      from_entity: { entity_type: 'cosmetic_product', entity_id: product.data.entity_id },
      to_entity: { entity_type: 'material', entity_id: material.data.entity_id },
      relation_type: 'CONTAINS',
      properties: { concentration: 0.05 },
    });
    expect(relation.success).toBe(true);

    // 4. Evaluate compliance rule (lead < 10 ppm)
    const evaluation = await executionLoop.evaluate(ctx, {
      entity_type: 'cosmetic_product',
      entity_id: product.data.entity_id,
      rule: {
        handler: 'core:threshold_check',
        config: {
          value: { field: 'lead_ppm' },
          operator: 'lt',
          threshold: 10,
        },
        label: 'Lead below 10 ppm limit',
      },
      compliance_lock_id: 'lock_e2e_1',
      vertical_id: 'cosmetics',
      market: 'EU',
    });

    expect(evaluation.success).toBe(true);
    expect(evaluation.data.handler_result.success).toBe(true);
    expect(evaluation.data.handler_result.value).toHaveProperty('pass', true);

    // 5. Verify audit trail
    const auditEntries = await audit.query(ctx.tenant_id, {
      resource_entity_id: product.data.entity_id,
    });
    // create + evaluate = at least 2 entries
    expect(auditEntries.length).toBeGreaterThanOrEqual(2);

    // 6. Verify relations in graph
    const relations = await relationService.list(ctx, {
      entity_type: 'cosmetic_product',
      entity_id: product.data.entity_id,
      direction: 'outgoing',
    });
    expect(relations.data.items.length).toBe(1);
    expect(relations.data.items[0].relation_type).toBe('CONTAINS');
  });

  it('should evaluate composed rules (AND gate)', async () => {
    const product = await entityService.create(ctx, {
      entity_type: 'cosmetic_product',
      data: { name: 'Eye Shadow', lead_ppm: 0.3, nickel_ppm: 0.05 },
    });

    const evaluation = await executionLoop.evaluate(ctx, {
      entity_type: 'cosmetic_product',
      entity_id: product.data.entity_id,
      rule: {
        handler: 'core:and',
        config: {
          conditions: [
            {
              handler: 'core:threshold_check',
              config: { value: { field: 'lead_ppm' }, operator: 'lt', threshold: 10 },
              label: 'Lead check',
            },
            {
              handler: 'core:threshold_check',
              config: { value: { field: 'nickel_ppm' }, operator: 'lt', threshold: 1 },
              label: 'Nickel check',
            },
          ],
        },
        label: 'Heavy metals compliance',
      },
      compliance_lock_id: 'lock_e2e_2',
      vertical_id: 'cosmetics',
      market: 'EU',
    });

    expect(evaluation.success).toBe(true);
    expect(evaluation.data.handler_result.value).toHaveProperty('pass', true);
  });
});
