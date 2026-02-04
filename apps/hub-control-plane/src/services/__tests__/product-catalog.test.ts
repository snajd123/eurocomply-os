import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ProductCatalogService } from '../product-catalog.js';
import { HubDb } from '../../db/connection.js';
import { runHubMigrations } from '../../db/migrate.js';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { ProductManifest } from '@eurocomply/types';

describe('ProductCatalogService', () => {
  let container: StartedPostgreSqlContainer;
  let db: HubDb;
  let catalog: ProductCatalogService;

  const cosmetics: ProductManifest = {
    product: { id: 'eurocomply-cosmetics', name: 'EuroComply Cosmetics', version: '1.0.0' },
    os: { version: '^2.0.0' },
    packs: [
      { name: '@eu/cosmetics-vertical', version: '^1.0.0', type: 'environment', required: true },
      { name: '@eu/clp-classification', version: '^3.0.0', type: 'logic', required: true },
      { name: '@connectors/cpnp', version: '^1.0.0', type: 'driver', required: false },
    ],
    plans: [
      { id: 'starter', max_products: 50, max_users: 10, packs: ['required_only'] },
      { id: 'growth', max_products: 200, max_users: 30, packs: ['required', '@connectors/cpnp'] },
    ],
  };

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    db = new HubDb({
      host: container.getHost(),
      port: container.getMappedPort(5432),
      database: container.getDatabase(),
      user: container.getUsername(),
      password: container.getPassword(),
    });
    await runHubMigrations(db);
    catalog = new ProductCatalogService(db);
  }, 60_000);

  afterAll(async () => {
    await db.close();
    await container.stop();
  });

  it('should register a product from manifest', async () => {
    const result = await catalog.register(cosmetics);
    expect(result.success).toBe(true);
    expect(result.data.product_id).toBe('eurocomply-cosmetics');
  });

  it('should get a product by ID', async () => {
    const result = await catalog.get('eurocomply-cosmetics');
    expect(result.success).toBe(true);
    expect(result.data.manifest.product.name).toBe('EuroComply Cosmetics');
  });

  it('should resolve packs for a plan tier', async () => {
    const starterPacks = await catalog.resolvePacksForPlan('eurocomply-cosmetics', 'starter');
    expect(starterPacks.success).toBe(true);
    // starter gets required_only packs
    expect(starterPacks.data.every(p => p.required)).toBe(true);
    expect(starterPacks.data.length).toBe(2);

    const growthPacks = await catalog.resolvePacksForPlan('eurocomply-cosmetics', 'growth');
    expect(growthPacks.success).toBe(true);
    // growth gets required + cpnp
    expect(growthPacks.data.length).toBe(3);
  });

  it('should list active products', async () => {
    const result = await catalog.list();
    expect(result.success).toBe(true);
    expect(result.data.total).toBe(1);
  });

  it('should return error for unknown product', async () => {
    const result = await catalog.get('nonexistent');
    expect(result.success).toBe(false);
  });
});
