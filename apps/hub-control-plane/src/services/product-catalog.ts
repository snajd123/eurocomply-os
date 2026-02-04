import type { HubDb } from '../db/connection.js';
import type { ProductManifest, ProductPackRef } from '@eurocomply/types';

interface ServiceResult<T> {
  success: boolean;
  data: T;
  error?: string;
}

interface StoredProduct {
  product_id: string;
  name: string;
  version: string;
  manifest: ProductManifest;
  active: boolean;
}

export class ProductCatalogService {
  constructor(private db: HubDb) {}

  async register(manifest: ProductManifest): Promise<ServiceResult<StoredProduct>> {
    const result = await this.db.query(
      `INSERT INTO products (product_id, name, version, manifest)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (product_id) DO UPDATE SET name = $2, version = $3, manifest = $4
       RETURNING *`,
      [manifest.product.id, manifest.product.name, manifest.product.version, JSON.stringify(manifest)],
    );
    return { success: true, data: this.toProduct(result.rows[0]) };
  }

  async get(productId: string): Promise<ServiceResult<StoredProduct>> {
    const result = await this.db.query(
      `SELECT * FROM products WHERE product_id = $1`,
      [productId],
    );
    if (result.rows.length === 0) {
      return { success: false, data: null as any, error: `Product not found: ${productId}` };
    }
    return { success: true, data: this.toProduct(result.rows[0]) };
  }

  async resolvePacksForPlan(productId: string, plan: string): Promise<ServiceResult<ProductPackRef[]>> {
    const product = await this.get(productId);
    if (!product.success) return { success: false, data: [], error: product.error };

    const manifest = product.data.manifest;
    const planDef = manifest.plans.find(p => p.id === plan);
    if (!planDef) return { success: false, data: [], error: `Plan not found: ${plan}` };

    const resolved: ProductPackRef[] = [];
    for (const pack of manifest.packs) {
      if (pack.required) {
        resolved.push(pack);
      } else if (planDef.packs.includes(pack.name)) {
        resolved.push(pack);
      } else if (planDef.packs.includes('all')) {
        resolved.push(pack);
      }
    }
    return { success: true, data: resolved };
  }

  async list(): Promise<ServiceResult<{ items: StoredProduct[]; total: number }>> {
    const result = await this.db.query(
      `SELECT * FROM products WHERE active = true ORDER BY name`,
    );
    const items = result.rows.map(r => this.toProduct(r));
    return { success: true, data: { items, total: items.length } };
  }

  private toProduct(row: any): StoredProduct {
    return {
      product_id: row.product_id,
      name: row.name,
      version: row.version,
      manifest: typeof row.manifest === 'string' ? JSON.parse(row.manifest) : row.manifest,
      active: row.active,
    };
  }
}
