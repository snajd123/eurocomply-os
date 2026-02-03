import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RelationService } from '../relation.js';
import { AuditLogger } from '../audit.js';
import { PostgresConnectionManager } from '../../db/postgres.js';
import { Neo4jConnectionManager } from '../../db/neo4j.js';
import { runMigrations } from '../../db/migrate.js';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import type { ServiceContext } from '@eurocomply/types';

describe('RelationService', () => {
  let pgContainer: StartedPostgreSqlContainer;
  let neo4jContainer: StartedTestContainer;
  let db: PostgresConnectionManager;
  let neo4j: Neo4jConnectionManager;
  let audit: AuditLogger;
  let relations: RelationService;

  const ctx: ServiceContext = {
    tenant_id: 'tenant_1',
    principal: { type: 'user', id: 'user_1' },
    correlation_id: 'corr_1',
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

    // Insert required entity types for FK constraints on relation_types table
    await db.query(
      `INSERT INTO entity_types (entity_type, tenant_id, schema) VALUES ($1, $2, $3)`,
      ['product', 'tenant_1', JSON.stringify({ fields: [] })]
    );
    await db.query(
      `INSERT INTO entity_types (entity_type, tenant_id, schema) VALUES ($1, $2, $3)`,
      ['material', 'tenant_1', JSON.stringify({ fields: [] })]
    );

    neo4jContainer = await new GenericContainer('neo4j:5')
      .withEnvironment({ NEO4J_AUTH: 'neo4j/testpassword' })
      .withExposedPorts(7687)
      .withWaitStrategy(Wait.forLogMessage(/Started/))
      .start();

    neo4j = new Neo4jConnectionManager({
      uri: `bolt://${neo4jContainer.getHost()}:${neo4jContainer.getMappedPort(7687)}`,
      username: 'neo4j',
      password: 'testpassword',
    });

    // Wait for Neo4j to be fully ready by retrying a simple query
    for (let i = 0; i < 30; i++) {
      try {
        await neo4j.run('RETURN 1');
        break;
      } catch {
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    audit = new AuditLogger(db);
    relations = new RelationService(db, neo4j, audit);
  }, 120_000);

  afterAll(async () => {
    await neo4j.close();
    await db.close();
    await neo4jContainer.stop();
    await pgContainer.stop();
  });

  it('should define a relation type with cardinality', async () => {
    const result = await relations.defineType(ctx, {
      relation_type: 'CONTAINS',
      from_entity_type: 'product',
      to_entity_type: 'material',
      cardinality: 'n:n',
      constraints: { unique: true },
    });

    expect(result.success).toBe(true);
    expect(result.data.relation_type).toBe('CONTAINS');
    expect(result.data.cardinality).toBe('n:n');
  });

  it('should create a relation between entities', async () => {
    const result = await relations.create(ctx, {
      from_entity: { entity_type: 'product', entity_id: 'prod_1' },
      to_entity: { entity_type: 'material', entity_id: 'mat_1' },
      relation_type: 'CONTAINS',
      properties: { concentration: 0.05 },
    });

    expect(result.success).toBe(true);
    expect(result.data.relation_type).toBe('CONTAINS');
  });

  it('should enforce 1:1 cardinality', async () => {
    // Define a 1:1 relation type
    await relations.defineType(ctx, {
      relation_type: 'PRIMARY_SUPPLIER',
      from_entity_type: 'product',
      to_entity_type: 'material',
      cardinality: '1:1',
    });

    // First relation should succeed
    const first = await relations.create(ctx, {
      from_entity: { entity_type: 'product', entity_id: 'prod_card' },
      to_entity: { entity_type: 'material', entity_id: 'mat_card_1' },
      relation_type: 'PRIMARY_SUPPLIER',
    });
    expect(first.success).toBe(true);

    // Second relation from same source should fail (1:1)
    const second = await relations.create(ctx, {
      from_entity: { entity_type: 'product', entity_id: 'prod_card' },
      to_entity: { entity_type: 'material', entity_id: 'mat_card_2' },
      relation_type: 'PRIMARY_SUPPLIER',
    });
    expect(second.success).toBe(false);
  });

  it('should list relations for an entity', async () => {
    // Add another relation
    await relations.create(ctx, {
      from_entity: { entity_type: 'product', entity_id: 'prod_1' },
      to_entity: { entity_type: 'material', entity_id: 'mat_2' },
      relation_type: 'CONTAINS',
      properties: { concentration: 0.02 },
    });

    const result = await relations.list(ctx, {
      entity_type: 'product',
      entity_id: 'prod_1',
      direction: 'outgoing',
    });

    expect(result.success).toBe(true);
    expect(result.data.items.length).toBe(2);
  });

  it('should list incoming relations', async () => {
    const result = await relations.list(ctx, {
      entity_type: 'material',
      entity_id: 'mat_1',
      direction: 'incoming',
    });

    expect(result.success).toBe(true);
    expect(result.data.items.length).toBe(1);
    expect(result.data.items[0].relation_type).toBe('CONTAINS');
  });

  it('should reject relation with undefined type', async () => {
    const result = await relations.create(ctx, {
      from_entity: { entity_type: 'product', entity_id: 'prod_1' },
      to_entity: { entity_type: 'material', entity_id: 'mat_1' },
      relation_type: 'UNDEFINED_TYPE',
    });

    expect(result.success).toBe(false);
  });
});
