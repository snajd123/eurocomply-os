import { v4 as uuid } from 'uuid';
import type { PostgresConnectionManager } from '../db/postgres.js';
import type { AuditLogger } from './audit.js';
import type { ServiceContext, ServiceResult, FilterExpression } from '@eurocomply/types';

// --- Input/Output types ---

export interface EntityTypeDefinition {
  entity_type: string;
  schema: {
    fields: Array<{
      name: string;
      type: string;
      required?: boolean;
      [key: string]: unknown;
    }>;
  };
}

export interface EntityCreateInput {
  entity_type: string;
  data: Record<string, unknown>;
}

export interface EntityCreateOutput {
  entity_id: string;
  entity_type: string;
  version: number;
  data: Record<string, unknown>;
}

export interface EntityGetInput {
  entity_type: string;
  entity_id: string;
}

export interface EntityGetOutput {
  entity_id: string;
  entity_type: string;
  version: number;
  data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface EntityUpdateInput {
  entity_type: string;
  entity_id: string;
  data: Record<string, unknown>;
}

export interface EntityListInput {
  entity_type: string;
  filter?: FilterExpression;
  limit?: number;
  offset?: number;
}

export interface EntityListOutput {
  items: EntityGetOutput[];
  total: number;
  limit: number;
  offset: number;
}

// --- FilterExpression → SQL translator ---

function buildFilterSQL(
  filter: FilterExpression,
  params: unknown[],
  paramOffset: number,
): { sql: string; params: unknown[]; nextOffset: number } {
  if (filter.and) {
    const parts: string[] = [];
    let offset = paramOffset;
    for (const child of filter.and) {
      const result = buildFilterSQL(child, params, offset);
      parts.push(result.sql);
      offset = result.nextOffset;
    }
    return { sql: `(${parts.join(' AND ')})`, params, nextOffset: offset };
  }
  if (filter.or) {
    const parts: string[] = [];
    let offset = paramOffset;
    for (const child of filter.or) {
      const result = buildFilterSQL(child, params, offset);
      parts.push(result.sql);
      offset = result.nextOffset;
    }
    return { sql: `(${parts.join(' OR ')})`, params, nextOffset: offset };
  }
  if (filter.not) {
    const result = buildFilterSQL(filter.not, params, paramOffset);
    return { sql: `NOT ${result.sql}`, params, nextOffset: result.nextOffset };
  }
  if (filter.field && filter.operator) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(filter.field)) {
      throw new Error(`Invalid field name: ${filter.field}`);
    }
    const jsonPath = `data->>'${filter.field}'`;
    const idx = paramOffset;
    switch (filter.operator) {
      case 'eq': params.push(filter.value); return { sql: `${jsonPath} = $${idx}`, params, nextOffset: idx + 1 };
      case 'ne': params.push(filter.value); return { sql: `${jsonPath} != $${idx}`, params, nextOffset: idx + 1 };
      case 'gt': params.push(filter.value); return { sql: `(${jsonPath})::numeric > $${idx}`, params, nextOffset: idx + 1 };
      case 'gte': params.push(filter.value); return { sql: `(${jsonPath})::numeric >= $${idx}`, params, nextOffset: idx + 1 };
      case 'lt': params.push(filter.value); return { sql: `(${jsonPath})::numeric < $${idx}`, params, nextOffset: idx + 1 };
      case 'lte': params.push(filter.value); return { sql: `(${jsonPath})::numeric <= $${idx}`, params, nextOffset: idx + 1 };
      case 'contains': params.push(`%${filter.value}%`); return { sql: `${jsonPath} LIKE $${idx}`, params, nextOffset: idx + 1 };
      case 'starts_with': params.push(`${filter.value}%`); return { sql: `${jsonPath} LIKE $${idx}`, params, nextOffset: idx + 1 };
      case 'is_null': return { sql: `${jsonPath} IS NULL`, params, nextOffset: idx };
      case 'is_not_null': return { sql: `${jsonPath} IS NOT NULL`, params, nextOffset: idx };
      case 'in': params.push(filter.value); return { sql: `${jsonPath} = ANY($${idx})`, params, nextOffset: idx + 1 };
      case 'not_in': params.push(filter.value); return { sql: `${jsonPath} != ALL($${idx})`, params, nextOffset: idx + 1 };
      default: return { sql: 'TRUE', params, nextOffset: idx };
    }
  }
  return { sql: 'TRUE', params, nextOffset: paramOffset };
}

// --- Service ---

export class EntityService {
  constructor(
    private db: PostgresConnectionManager,
    private audit: AuditLogger,
  ) {}

  async defineType(
    ctx: ServiceContext,
    input: EntityTypeDefinition,
  ): Promise<ServiceResult<{ entity_type: string }>> {
    await this.db.query(
      `INSERT INTO entity_types (entity_type, tenant_id, schema)
       VALUES ($1, $2, $3)
       ON CONFLICT (entity_type) DO UPDATE SET schema = $3, updated_at = now()`,
      [input.entity_type, ctx.tenant_id, JSON.stringify(input.schema)]
    );

    return { success: true, data: { entity_type: input.entity_type } };
  }

  async create(
    ctx: ServiceContext,
    input: EntityCreateInput,
  ): Promise<ServiceResult<EntityCreateOutput>> {
    // Verify entity type exists
    const typeCheck = await this.db.query(
      'SELECT entity_type FROM entity_types WHERE entity_type = $1',
      [input.entity_type]
    );
    if (typeCheck.rows.length === 0) {
      return { success: false, data: { entity_id: '', entity_type: input.entity_type, version: 0, data: {} } };
    }

    const entityId = uuid();

    await this.db.query(
      `INSERT INTO entities (entity_id, entity_type, tenant_id, data, version)
       VALUES ($1, $2, $3, $4, 1)`,
      [entityId, input.entity_type, ctx.tenant_id, JSON.stringify(input.data)]
    );

    const auditEntry = await this.audit.log(ctx, {
      action: 'create',
      resource: { entity_type: input.entity_type, entity_id: entityId },
      changes: { fields_changed: Object.keys(input.data), after: input.data },
      success: true,
    });

    return {
      success: true,
      data: {
        entity_id: entityId,
        entity_type: input.entity_type,
        version: 1,
        data: input.data,
      },
      audit_entry: auditEntry as any,
    };
  }

  async get(
    ctx: ServiceContext,
    input: EntityGetInput,
  ): Promise<ServiceResult<EntityGetOutput>> {
    const result = await this.db.query(
      `SELECT * FROM entities WHERE entity_id = $1 AND tenant_id = $2`,
      [input.entity_id, ctx.tenant_id]
    );

    if (result.rows.length === 0) {
      return {
        success: false,
        data: {
          entity_id: input.entity_id,
          entity_type: input.entity_type,
          version: 0,
          data: {},
          created_at: '',
          updated_at: '',
        },
      };
    }

    const row = result.rows[0] as {
      entity_id: string;
      entity_type: string;
      version: number;
      data: Record<string, unknown>;
      created_at: string;
      updated_at: string;
    };
    return {
      success: true,
      data: {
        entity_id: row.entity_id,
        entity_type: row.entity_type,
        version: row.version,
        data: row.data,
        created_at: row.created_at,
        updated_at: row.updated_at,
      },
    };
  }

  async update(
    ctx: ServiceContext,
    input: EntityUpdateInput,
  ): Promise<ServiceResult<EntityCreateOutput>> {
    return await this.db.transaction(async (client) => {
      // Get current state
      const current = await client.query(
        'SELECT * FROM entities WHERE entity_id = $1 AND tenant_id = $2 FOR UPDATE',
        [input.entity_id, ctx.tenant_id]
      );

      if (current.rows.length === 0) {
        return { success: false, data: { entity_id: input.entity_id, entity_type: input.entity_type, version: 0, data: {} } };
      }

      const row = current.rows[0] as { entity_id: string; entity_type: string; version: number; data: Record<string, unknown> };
      const oldData = row.data;
      const newVersion = row.version + 1;
      const mergedData = { ...oldData, ...input.data };

      // Store version snapshot
      await client.query(
        `INSERT INTO entity_versions (version_id, entity_id, version, data, changed_by)
         VALUES ($1, $2, $3, $4, $5)`,
        [uuid(), row.entity_id, row.version, JSON.stringify(oldData), ctx.principal.id]
      );

      // Update entity
      await client.query(
        `UPDATE entities SET data = $1, version = $2, updated_at = now()
         WHERE entity_id = $3`,
        [JSON.stringify(mergedData), newVersion, input.entity_id]
      );

      const changedFields = Object.keys(input.data).filter(
        k => JSON.stringify(oldData[k]) !== JSON.stringify(input.data[k])
      );

      const auditEntry = await this.audit.log(ctx, {
        action: 'update',
        resource: { entity_type: row.entity_type, entity_id: input.entity_id },
        changes: { fields_changed: changedFields, before: oldData, after: mergedData },
        success: true,
      });

      return {
        success: true,
        data: {
          entity_id: input.entity_id,
          entity_type: row.entity_type,
          version: newVersion,
          data: mergedData,
        },
        audit_entry: auditEntry as any,
      };
    });
  }

  async list(
    ctx: ServiceContext,
    input: EntityListInput,
  ): Promise<ServiceResult<EntityListOutput>> {
    const limit = input.limit ?? 50;
    const offset = input.offset ?? 0;

    // Build filter SQL if provided
    let filterClause = '';
    const baseParams: unknown[] = [input.entity_type, ctx.tenant_id];
    let paramOffset = 3; // $1 and $2 are entity_type and tenant_id

    if (input.filter) {
      const filterResult = buildFilterSQL(input.filter, baseParams, paramOffset);
      filterClause = ` AND ${filterResult.sql}`;
      paramOffset = filterResult.nextOffset;
    }

    const countResult = await this.db.query(
      `SELECT count(*)::int as total FROM entities WHERE entity_type = $1 AND tenant_id = $2${filterClause}`,
      baseParams.slice() // copy to avoid mutation between queries
    );

    const listParams = [...baseParams, limit, offset];
    const result = await this.db.query(
      `SELECT * FROM entities WHERE entity_type = $1 AND tenant_id = $2${filterClause}
       ORDER BY created_at DESC LIMIT $${paramOffset} OFFSET $${paramOffset + 1}`,
      listParams
    );

    const items = result.rows.map((row: {
      entity_id: string; entity_type: string; version: number;
      data: Record<string, unknown>; created_at: string; updated_at: string;
    }) => ({
      entity_id: row.entity_id,
      entity_type: row.entity_type,
      version: row.version,
      data: row.data,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));

    return {
      success: true,
      data: { items, total: countResult.rows[0].total, limit, offset },
    };
  }
}
