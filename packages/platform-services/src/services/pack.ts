import type { PostgresConnectionManager, Queryable } from '../db/postgres.js';
import type { AuditLogger } from './audit.js';
import type { PlatformServiceContext } from '../context.js';
import type { ComplianceLock, PackManifest, ServiceResult } from '@eurocomply/types';

export interface InstalledPack {
  pack_name: string;
  pack_version: string;
  pack_type: string;
  manifest: PackManifest;
  status: 'active' | 'inactive' | 'rolled_back';
  installed_at: string;
}

export class PackService {
  constructor(
    private db: PostgresConnectionManager,
    private audit: AuditLogger,
  ) {}

  async install(
    ctx: PlatformServiceContext,
    manifest: PackManifest,
  ): Promise<ServiceResult<InstalledPack>> {
    const db: Queryable = ctx.tx ?? this.db;
    const result = await db.query(
      `INSERT INTO installed_packs (tenant_id, pack_name, pack_version, pack_type, manifest, status)
       VALUES ($1, $2, $3, $4, $5, 'active')
       ON CONFLICT (tenant_id, pack_name)
       DO UPDATE SET pack_version = $3, pack_type = $4, manifest = $5, status = 'active', installed_at = now()
       RETURNING *`,
      [ctx.tenant_id, manifest.name, manifest.version, manifest.type, JSON.stringify(manifest)],
    );
    const row = result.rows[0] as {
      pack_name: string;
      pack_version: string;
      pack_type: string;
      manifest: string;
      status: 'active' | 'inactive' | 'rolled_back';
      installed_at: string;
    };
    const installed: InstalledPack = {
      pack_name: row.pack_name,
      pack_version: row.pack_version,
      pack_type: row.pack_type,
      manifest: typeof row.manifest === 'string' ? JSON.parse(row.manifest) : row.manifest,
      status: row.status,
      installed_at: row.installed_at,
    };
    await this.audit.log(ctx, {
      action: 'pack:install',
      resource: { entity_type: 'pack', entity_id: manifest.name },
      changes: { fields_changed: ['version', 'type'], after: { version: manifest.version, type: manifest.type } },
      success: true,
    });
    return { success: true, data: installed };
  }

  async list(
    ctx: PlatformServiceContext,
  ): Promise<ServiceResult<{ items: InstalledPack[]; total: number }>> {
    const db: Queryable = ctx.tx ?? this.db;
    const result = await db.query(
      `SELECT * FROM installed_packs WHERE tenant_id = $1 AND status = 'active' ORDER BY installed_at DESC`,
      [ctx.tenant_id],
    );
    const items = result.rows.map((row: any) => ({
      pack_name: row.pack_name,
      pack_version: row.pack_version,
      pack_type: row.pack_type,
      manifest: typeof row.manifest === 'string' ? JSON.parse(row.manifest) : row.manifest,
      status: row.status,
      installed_at: row.installed_at,
    }));
    return { success: true, data: { items, total: items.length } };
  }

  async saveLock(
    ctx: PlatformServiceContext,
    lock: ComplianceLock,
  ): Promise<ServiceResult<{ lock_id: string }>> {
    const db: Queryable = ctx.tx ?? this.db;
    await db.query(
      `INSERT INTO compliance_locks (lock_id, tenant_id, root_pack_name, lock_data, status)
       VALUES ($1, $2, $3, $4, $5)`,
      [lock.lock_id, ctx.tenant_id, lock.root_pack.name, JSON.stringify(lock), lock.status ?? 'active'],
    );
    await this.audit.log(ctx, {
      action: 'lock:create',
      resource: { entity_type: 'compliance_lock', entity_id: lock.lock_id },
      changes: {
        fields_changed: ['root_pack', 'packs_count'],
        after: { root_pack: lock.root_pack.name, packs_count: Object.keys(lock.packs).length },
      },
      success: true,
    });
    return { success: true, data: { lock_id: lock.lock_id } };
  }

  async getLock(
    ctx: PlatformServiceContext,
    lockId: string,
  ): Promise<ServiceResult<ComplianceLock>> {
    const db: Queryable = ctx.tx ?? this.db;
    const result = await db.query(
      `SELECT lock_data FROM compliance_locks WHERE lock_id = $1 AND tenant_id = $2`,
      [lockId, ctx.tenant_id],
    );
    if (result.rows.length === 0) {
      return { success: false, data: null as any, error: `Lock not found: ${lockId}` } as any;
    }
    const lockData = result.rows[0].lock_data;
    return { success: true, data: typeof lockData === 'string' ? JSON.parse(lockData) : lockData };
  }

  async listLocks(
    ctx: PlatformServiceContext,
  ): Promise<ServiceResult<{ items: ComplianceLock[]; total: number }>> {
    const db: Queryable = ctx.tx ?? this.db;
    const result = await db.query(
      `SELECT lock_data FROM compliance_locks WHERE tenant_id = $1 AND status = 'active' ORDER BY created_at DESC`,
      [ctx.tenant_id],
    );
    const items = result.rows.map((row: any) =>
      typeof row.lock_data === 'string' ? JSON.parse(row.lock_data) : row.lock_data,
    );
    return { success: true, data: { items, total: items.length } };
  }
}
