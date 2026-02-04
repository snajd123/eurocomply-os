import { v4 as uuid } from 'uuid';
import type { PostgresConnectionManager } from '../db/postgres.js';
import type { PlatformServiceContext } from '../context.js';

export interface AuditLogInput {
  action: string;
  resource: { entity_type: string; entity_id: string };
  changes?: {
    fields_changed: string[];
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
  };
  success: boolean;
  error?: string;
}

export interface AuditQueryFilter {
  resource_entity_type?: string;
  resource_entity_id?: string;
  action?: string;
  actor_id?: string;
  limit?: number;
  offset?: number;
}

interface AuditRow {
  audit_entry_id: string;
  correlation_id: string;
  tenant_id: string;
  actor_type: string;
  actor_id: string;
  action: string;
  resource_entity_type: string;
  resource_entity_id: string;
  changes: { fields_changed: string[]; before?: Record<string, unknown>; after?: Record<string, unknown> } | null;
  success: boolean;
  error: string | null;
  created_at: string;
}

export class AuditLogger {
  constructor(private db: PostgresConnectionManager) {}

  async log(ctx: PlatformServiceContext, input: AuditLogInput): Promise<AuditRow> {
    const id = uuid();
    const db = ctx.tx ?? this.db;
    const result = await db.query(
      `INSERT INTO audit_log (
        audit_entry_id, correlation_id, tenant_id,
        actor_type, actor_id, action,
        resource_entity_type, resource_entity_id,
        changes, success, error
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *`,
      [
        id, ctx.correlation_id, ctx.tenant_id,
        ctx.principal.type, ctx.principal.id, input.action,
        input.resource.entity_type, input.resource.entity_id,
        input.changes ? JSON.stringify(input.changes) : null,
        input.success, input.error ?? null,
      ]
    );
    return result.rows[0] as AuditRow;
  }

  async query(tenantId: string, filter: AuditQueryFilter): Promise<AuditRow[]> {
    const conditions: string[] = ['tenant_id = $1'];
    const params: unknown[] = [tenantId];
    let idx = 2;

    if (filter.resource_entity_type) {
      conditions.push(`resource_entity_type = $${idx++}`);
      params.push(filter.resource_entity_type);
    }
    if (filter.resource_entity_id) {
      conditions.push(`resource_entity_id = $${idx++}`);
      params.push(filter.resource_entity_id);
    }
    if (filter.action) {
      conditions.push(`action = $${idx++}`);
      params.push(filter.action);
    }
    if (filter.actor_id) {
      conditions.push(`actor_id = $${idx++}`);
      params.push(filter.actor_id);
    }

    const limit = filter.limit ?? 100;
    const offset = filter.offset ?? 0;

    const result = await this.db.query(
      `SELECT * FROM audit_log WHERE ${conditions.join(' AND ')}
       ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, limit, offset]
    );
    return result.rows as AuditRow[];
  }
}
