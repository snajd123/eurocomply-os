import type { HubDb } from '../db/connection.js';

interface ServiceResult<T> {
  success: boolean;
  data: T;
  error?: string;
}

export interface DirectoryEntry {
  did: string;
  spoke_id: string;
  endpoint: string;
  capabilities: string[];
  visible: boolean;
}

export class NetworkDirectoryService {
  constructor(private db: HubDb) {}

  async register(entry: {
    did: string;
    spoke_id: string;
    endpoint: string;
    capabilities: string[];
  }): Promise<ServiceResult<DirectoryEntry>> {
    await this.db.query(
      `INSERT INTO network_directory (did, spoke_id, endpoint, capabilities)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (did) DO UPDATE SET
         endpoint = $3, capabilities = $4, updated_at = now()`,
      [entry.did, entry.spoke_id, entry.endpoint, entry.capabilities],
    );
    return {
      success: true,
      data: { ...entry, visible: true },
    };
  }

  async lookup(did: string): Promise<ServiceResult<DirectoryEntry>> {
    const result = await this.db.query(
      `SELECT * FROM network_directory WHERE did = $1`,
      [did],
    );
    if (result.rows.length === 0) {
      return { success: false, data: null as any, error: `DID not found: ${did}` };
    }
    return { success: true, data: this.toEntry(result.rows[0]) };
  }

  async listVisible(): Promise<ServiceResult<{ items: DirectoryEntry[]; total: number }>> {
    const result = await this.db.query(
      `SELECT * FROM network_directory WHERE visible = true`,
    );
    const items = result.rows.map((r: any) => this.toEntry(r));
    return { success: true, data: { items, total: items.length } };
  }

  async setVisibility(did: string, visible: boolean): Promise<ServiceResult<void>> {
    await this.db.query(
      `UPDATE network_directory SET visible = $1, updated_at = now() WHERE did = $2`,
      [visible, did],
    );
    return { success: true, data: undefined as any };
  }

  private toEntry(row: any): DirectoryEntry {
    return {
      did: row.did,
      spoke_id: row.spoke_id,
      endpoint: row.endpoint,
      capabilities: row.capabilities,
      visible: row.visible,
    };
  }
}
