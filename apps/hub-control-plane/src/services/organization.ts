import { randomUUID } from 'crypto';
import type { HubDb } from '../db/connection.js';

export interface Organization {
  org_id: string;
  name: string;
  email: string;
  stripe_customer_id: string | null;
  status: string;
  created_at: string;
}

interface ServiceResult<T> {
  success: boolean;
  data: T;
  error?: string;
}

export class OrganizationService {
  constructor(private db: HubDb) {}

  async create(input: { name: string; email: string }): Promise<ServiceResult<Organization>> {
    const org_id = `org-${randomUUID().slice(0, 8)}`;
    const result = await this.db.query(
      `INSERT INTO organizations (org_id, name, email) VALUES ($1, $2, $3) RETURNING *`,
      [org_id, input.name, input.email],
    );
    return { success: true, data: this.toOrg(result.rows[0]) };
  }

  async get(org_id: string): Promise<ServiceResult<Organization>> {
    const result = await this.db.query(
      `SELECT * FROM organizations WHERE org_id = $1`,
      [org_id],
    );
    if (result.rows.length === 0) {
      return { success: false, data: null as any, error: `Organization not found: ${org_id}` };
    }
    return { success: true, data: this.toOrg(result.rows[0]) };
  }

  async update(org_id: string, updates: Partial<Pick<Organization, 'name' | 'email' | 'stripe_customer_id' | 'status'>>): Promise<ServiceResult<Organization>> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    for (const [key, value] of Object.entries(updates)) {
      sets.push(`${key} = $${idx}`);
      values.push(value);
      idx++;
    }
    sets.push(`updated_at = now()`);
    values.push(org_id);

    const result = await this.db.query(
      `UPDATE organizations SET ${sets.join(', ')} WHERE org_id = $${idx} RETURNING *`,
      values,
    );
    if (result.rows.length === 0) {
      return { success: false, data: null as any, error: `Organization not found: ${org_id}` };
    }
    return { success: true, data: this.toOrg(result.rows[0]) };
  }

  async list(): Promise<ServiceResult<{ items: Organization[]; total: number }>> {
    const result = await this.db.query(
      `SELECT * FROM organizations ORDER BY created_at DESC`,
    );
    return { success: true, data: { items: result.rows.map(r => this.toOrg(r)), total: result.rows.length } };
  }

  private toOrg(row: any): Organization {
    return {
      org_id: row.org_id,
      name: row.name,
      email: row.email,
      stripe_customer_id: row.stripe_customer_id,
      status: row.status,
      created_at: row.created_at,
    };
  }
}
