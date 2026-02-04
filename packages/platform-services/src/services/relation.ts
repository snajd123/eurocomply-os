import type { PostgresConnectionManager } from '../db/postgres.js';
import type { Neo4jConnectionManager } from '../db/neo4j.js';
import type { AuditLogger } from './audit.js';
import type { PlatformServiceContext } from '../context.js';
import type { ServiceResult } from '@eurocomply/types';

// --- Input/Output types ---

export interface RelationTypeDefinition {
  relation_type: string;
  from_entity_type: string;
  to_entity_type: string;
  cardinality: '1:1' | '1:n' | 'n:1' | 'n:n';
  constraints?: {
    unique?: boolean;
    acyclic?: boolean;
    max_from?: number;
    max_to?: number;
  };
  inverse_type?: string;
  cascade_delete?: boolean;
}

export interface RelationTypeOutput {
  relation_type: string;
  cardinality: string;
  from_entity_type: string;
  to_entity_type: string;
}

export interface RelationCreateInput {
  from_entity: { entity_type: string; entity_id: string };
  to_entity: { entity_type: string; entity_id: string };
  relation_type: string;
  properties?: Record<string, unknown>;
}

export interface RelationCreateOutput {
  relation_type: string;
  from_entity: { entity_type: string; entity_id: string };
  to_entity: { entity_type: string; entity_id: string };
  properties: Record<string, unknown>;
}

export interface RelationListInput {
  entity_type: string;
  entity_id: string;
  direction: 'outgoing' | 'incoming' | 'both';
  relation_type?: string;
}

export interface RelationListItem {
  relation_type: string;
  other_entity: { entity_type: string; entity_id: string };
  direction: 'outgoing' | 'incoming';
  properties: Record<string, unknown>;
}

export interface RelationListOutput {
  items: RelationListItem[];
}

export class RelationService {
  constructor(
    private db: PostgresConnectionManager,
    private neo4j: Neo4jConnectionManager,
    private audit: AuditLogger,
  ) {}

  async defineType(
    ctx: PlatformServiceContext,
    input: RelationTypeDefinition,
  ): Promise<ServiceResult<RelationTypeOutput>> {
    const db = ctx.tx ?? this.db;
    await db.query(
      `INSERT INTO relation_types (relation_type, tenant_id, from_entity_type, to_entity_type, cardinality, constraints, inverse_type, cascade_delete)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (tenant_id, relation_type) DO UPDATE SET
         from_entity_type = $3, to_entity_type = $4, cardinality = $5,
         constraints = $6, inverse_type = $7, cascade_delete = $8,
         updated_at = now()`,
      [
        input.relation_type, ctx.tenant_id, input.from_entity_type,
        input.to_entity_type, input.cardinality,
        JSON.stringify(input.constraints ?? {}),
        input.inverse_type ?? null, input.cascade_delete ?? false,
      ]
    );

    return {
      success: true,
      data: {
        relation_type: input.relation_type,
        cardinality: input.cardinality,
        from_entity_type: input.from_entity_type,
        to_entity_type: input.to_entity_type,
      },
    };
  }

  async create(
    ctx: PlatformServiceContext,
    input: RelationCreateInput,
  ): Promise<ServiceResult<RelationCreateOutput>> {
    // Verify relation type is defined for this tenant
    const db = ctx.tx ?? this.db;
    const typeCheck = await db.query(
      'SELECT * FROM relation_types WHERE tenant_id = $1 AND relation_type = $2',
      [ctx.tenant_id, input.relation_type]
    );
    if (typeCheck.rows.length === 0) {
      return {
        success: false,
        data: {
          relation_type: input.relation_type,
          from_entity: input.from_entity,
          to_entity: input.to_entity,
          properties: {},
        },
      };
    }

    const relType = typeCheck.rows[0] as {
      cardinality: string; constraints: Record<string, unknown>;
    };

    // Enforce cardinality constraints
    if (relType.cardinality === '1:1' || relType.cardinality === '1:n') {
      // Check if source already has an outgoing relation of this type
      const existing = await this.neo4j.run(
        `MATCH (a:Entity { entity_id: $fromId, tenant_id: $tenantId })-[r:${sanitizeRelationType(input.relation_type)}]->(b:Entity)
         RETURN count(r) as cnt`,
        { fromId: input.from_entity.entity_id, tenantId: ctx.tenant_id }
      );
      const count = (existing.records[0]?.get('cnt') as { toNumber(): number })?.toNumber() ?? 0;
      if (count > 0) {
        return {
          success: false,
          data: {
            relation_type: input.relation_type,
            from_entity: input.from_entity,
            to_entity: input.to_entity,
            properties: {},
          },
        };
      }
    }

    if (relType.cardinality === '1:1' || relType.cardinality === 'n:1') {
      // Check if target already has an incoming relation of this type
      const existing = await this.neo4j.run(
        `MATCH (a:Entity)-[r:${sanitizeRelationType(input.relation_type)}]->(b:Entity { entity_id: $toId, tenant_id: $tenantId })
         RETURN count(r) as cnt`,
        { toId: input.to_entity.entity_id, tenantId: ctx.tenant_id }
      );
      const count = (existing.records[0]?.get('cnt') as { toNumber(): number })?.toNumber() ?? 0;
      if (count > 0) {
        return {
          success: false,
          data: {
            relation_type: input.relation_type,
            from_entity: input.from_entity,
            to_entity: input.to_entity,
            properties: {},
          },
        };
      }
    }

    const props = input.properties ?? {};
    const propsWithMeta = { ...props, tenant_id: ctx.tenant_id };

    await this.neo4j.run(
      `MERGE (a:Entity { entity_id: $fromId, entity_type: $fromType, tenant_id: $tenantId })
       MERGE (b:Entity { entity_id: $toId, entity_type: $toType, tenant_id: $tenantId })
       CREATE (a)-[r:${sanitizeRelationType(input.relation_type)}]->(b)
       SET r = $props
       RETURN r`,
      {
        fromId: input.from_entity.entity_id,
        fromType: input.from_entity.entity_type,
        toId: input.to_entity.entity_id,
        toType: input.to_entity.entity_type,
        tenantId: ctx.tenant_id,
        props: propsWithMeta,
      }
    );

    await this.audit.log(ctx, {
      action: 'create_relation',
      resource: { entity_type: input.from_entity.entity_type, entity_id: input.from_entity.entity_id },
      changes: {
        fields_changed: ['relation'],
        after: { relation_type: input.relation_type, to: input.to_entity, properties: props },
      },
      success: true,
    });

    return {
      success: true,
      data: {
        relation_type: input.relation_type,
        from_entity: input.from_entity,
        to_entity: input.to_entity,
        properties: props,
      },
    };
  }

  async list(
    ctx: PlatformServiceContext,
    input: RelationListInput,
  ): Promise<ServiceResult<RelationListOutput>> {
    const items: RelationListItem[] = [];

    if (input.direction === 'outgoing' || input.direction === 'both') {
      const relFilter = input.relation_type
        ? `:${sanitizeRelationType(input.relation_type)}`
        : '';

      const result = await this.neo4j.run(
        `MATCH (a:Entity { entity_id: $entityId, tenant_id: $tenantId })-[r${relFilter}]->(b:Entity)
         RETURN type(r) as relation_type, properties(r) as props,
                b.entity_type as entity_type, b.entity_id as entity_id`,
        { entityId: input.entity_id, tenantId: ctx.tenant_id }
      );

      for (const record of result.records) {
        const props = record.get('props') as Record<string, unknown>;
        const { tenant_id, ...cleanProps } = props;
        items.push({
          relation_type: record.get('relation_type') as string,
          other_entity: {
            entity_type: record.get('entity_type') as string,
            entity_id: record.get('entity_id') as string,
          },
          direction: 'outgoing',
          properties: cleanProps,
        });
      }
    }

    if (input.direction === 'incoming' || input.direction === 'both') {
      const relFilter = input.relation_type
        ? `:${sanitizeRelationType(input.relation_type)}`
        : '';

      const result = await this.neo4j.run(
        `MATCH (a:Entity { entity_id: $entityId, tenant_id: $tenantId })<-[r${relFilter}]-(b:Entity)
         RETURN type(r) as relation_type, properties(r) as props,
                b.entity_type as entity_type, b.entity_id as entity_id`,
        { entityId: input.entity_id, tenantId: ctx.tenant_id }
      );

      for (const record of result.records) {
        const props = record.get('props') as Record<string, unknown>;
        const { tenant_id, ...cleanProps } = props;
        items.push({
          relation_type: record.get('relation_type') as string,
          other_entity: {
            entity_type: record.get('entity_type') as string,
            entity_id: record.get('entity_id') as string,
          },
          direction: 'incoming',
          properties: cleanProps,
        });
      }
    }

    return { success: true, data: { items } };
  }
}

function sanitizeRelationType(type: string): string {
  // Neo4j relationship types must be alphanumeric + underscore
  return type.replace(/[^A-Za-z0-9_]/g, '_').toUpperCase();
}
