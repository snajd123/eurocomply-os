import type { HubDb } from '../db/connection.js';
import type { HeartbeatRequest, HeartbeatResponse } from '@eurocomply/types';

interface ServiceResult<T> {
  success: boolean;
  data: T;
  error?: string;
}

interface SpokeInfo {
  spoke_id: string;
  org_id: string;
  product_id: string;
  plan: string;
  region: string;
  status: string;
  os_version: string | null;
  hostname: string | null;
  last_heartbeat: string | null;
  health: Record<string, unknown> | null;
}

export class FleetService {
  constructor(private db: HubDb) {}

  async processHeartbeat(hb: HeartbeatRequest): Promise<ServiceResult<HeartbeatResponse>> {
    const spokeResult = await this.db.query(
      `SELECT * FROM spokes WHERE spoke_id = $1`,
      [hb.spoke_id],
    );
    if (spokeResult.rows.length === 0) {
      return { success: false, data: null as any, error: `Unknown spoke: ${hb.spoke_id}` };
    }

    const spoke = spokeResult.rows[0];

    // Update spoke health
    await this.db.query(
      `UPDATE spokes SET
         os_version = $1,
         last_heartbeat = now(),
         health = $2,
         updated_at = now()
       WHERE spoke_id = $3`,
      [hb.os_version, JSON.stringify({ status: hb.status, uptime: hb.uptime_seconds, usage: hb.usage }), hb.spoke_id],
    );

    // Compute signals
    const response: HeartbeatResponse = {
      acknowledged: true,
      license_valid: spoke.status === 'active',
      signals: {
        os_update_available: null,
        pack_updates_available: 0,
        registry_sync_recommended: false,
        message: spoke.status === 'suspended' ? 'Spoke is suspended — payment required' : null,
      },
    };

    return { success: true, data: response };
  }

  async listSpokes(): Promise<ServiceResult<{ items: SpokeInfo[]; total: number }>> {
    const result = await this.db.query(
      `SELECT * FROM spokes ORDER BY created_at DESC`,
    );
    const items = result.rows.map((r: any) => this.toSpokeInfo(r));
    return { success: true, data: { items, total: items.length } };
  }

  async getSpoke(spokeId: string): Promise<ServiceResult<SpokeInfo>> {
    const result = await this.db.query(`SELECT * FROM spokes WHERE spoke_id = $1`, [spokeId]);
    if (result.rows.length === 0) {
      return { success: false, data: null as any, error: `Spoke not found: ${spokeId}` };
    }
    return { success: true, data: this.toSpokeInfo(result.rows[0]) };
  }

  async getStaleSpokes(minutesThreshold: number): Promise<ServiceResult<SpokeInfo[]>> {
    const result = await this.db.query(
      `SELECT * FROM spokes
       WHERE status = 'active'
         AND last_heartbeat IS NOT NULL
         AND last_heartbeat < now() - make_interval(mins := $1)`,
      [minutesThreshold],
    );
    return { success: true, data: result.rows.map((r: any) => this.toSpokeInfo(r)) };
  }

  private toSpokeInfo(row: any): SpokeInfo {
    return {
      spoke_id: row.spoke_id,
      org_id: row.org_id,
      product_id: row.product_id,
      plan: row.plan,
      region: row.region,
      status: row.status,
      os_version: row.os_version,
      hostname: row.hostname,
      last_heartbeat: row.last_heartbeat,
      health: typeof row.health === 'string' ? JSON.parse(row.health) : row.health,
    };
  }
}
