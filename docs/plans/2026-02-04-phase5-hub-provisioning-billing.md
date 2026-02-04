# Phase 5: Hub — Provisioning & Billing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the Hub control plane so a customer can sign up, pay, and get a running Spoke with their vertical's Packs installed — fully automated, no human in the loop.

**Architecture:** The Hub is a Hono HTTP server with its own PostgreSQL database (separate from Spoke databases). It exposes APIs for billing (Stripe), provisioning (5-phase idempotent pipeline), fleet management (heartbeat processing), and network directory (DID → endpoint). External infrastructure (K8s, Helm, cloud databases) is abstracted behind provider interfaces — tests use in-memory mocks, production uses real providers. The Spoke Agent is a module in spoke-runtime that periodically phones home to the Hub.

**Tech Stack:** TypeScript, Hono, PostgreSQL (testcontainers for tests), Zod, Stripe SDK (mocked in tests), `@testcontainers/postgresql`

---

## Dependency Order

```
Task 1: Hub-Spoke shared types
    ↓
Task 2: Hub database layer + migrations
    ↓
Task 3: Organization service
    ↓
Task 4: Product catalog service
    ↓
Task 5: Billing service (Stripe abstraction)
    ↓
Task 6: Provisioning orchestrator (5-phase pipeline)
    ↓
Task 7: Fleet service (heartbeat processing)
    ↓
Task 8: Network directory service
    ↓
Task 9: DID utilities (network-protocol package)
    ↓
Task 10: Spoke agent (heartbeat sender)
    ↓
Task 11: Hub HTTP server (wire all routes)
    ↓
Task 12: E2E integration test
```

Tasks 1–2 are foundational. Tasks 3–5 can partially overlap (independent services sharing only the DB layer). Task 6 depends on 3–5. Tasks 7–9 depend only on 2. Task 10 depends on 7+9. Task 11 depends on all services. Task 12 depends on everything.

---

## Context for the Implementer

### What Already Exists

- **`apps/hub-control-plane/`** — Hono app with in-memory `RegistryStore` + `createRegistryAPI()`. Only pack publish/search/get. No database, no billing, no provisioning.
- **`apps/spoke-runtime/`** — Fully functional. Boots PostgreSQL, creates services, serves MCP + REST. Has pack loading via `createInstallPlan()`. No heartbeat agent.
- **`packages/platform-services/`** — Spoke-side services: Entity, Relation, Audit, File, Job, Pack, ExecutionLoop. Uses `PostgresConnectionManager` (thin `pg.Pool` wrapper). Has `Queryable` interface, `UnitOfWork`, migrations runner.
- **`packages/types/`** — PackManifest, ComplianceLock, HandlerResult, ExecutionContext, ServiceContext, ServiceResult, etc.
- **`packages/network-protocol/`** — Empty (`export {};`).
- **`infra/`** — Directory structure only, no Helm charts or Terraform.

### Key Patterns to Follow

1. **Service constructor:** `constructor(private db: HubDb, ...)` where `HubDb` has `query(text, params?)`.
2. **Method signature:** `async method(input): Promise<ServiceResult<T>>` — always return `{ success, data, error? }`.
3. **Tests:** Use `@testcontainers/postgresql` with real PostgreSQL. No mocks for DB. Mock only external services (Stripe, K8s).
4. **Hono routes:** `app.post('/path', async (c) => { ... return c.json(result, status); })`.
5. **Zod validation:** Parse inputs with `.safeParse()`, return 400 on failure.

### Critical Invariants

- Hub **never** stores compliance data (no entity data, no evaluation results).
- Hub **cannot** reach into Spokes (pull-only model — Spoke phones home).
- Spokes operate independently of Hub availability.
- `tenant_id` is present in all Spoke tables but Hub tables use `org_id` as the tenant concept.

### What's NOT in Scope

- Actual Helm charts or Terraform modules (the orchestrator calls abstract interfaces).
- Web portal UI (just the Hub API — web portal is Phase 5b).
- Telemetry collection (Phase 5b).
- OS update rollout (Phase 5b).
- Decommissioning pipeline / legal hold (operational concern, later).

---

### Task 1: Hub-Spoke Shared Types

**Files:**
- Create: `packages/types/src/hub.ts`
- Modify: `packages/types/src/index.ts`
- Test: `packages/types/src/__tests__/hub.test.ts`

**Context:** These types cross the Hub↔Spoke boundary. The Hub sends/receives them via HTTP. The Spoke Agent uses them to build heartbeat payloads. The Hub uses them to store spoke records and process provisioning.

**Step 1: Write the failing test**

Create `packages/types/src/__tests__/hub.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  ProductManifestSchema,
  HeartbeatRequestSchema,
  HeartbeatResponseSchema,
  SpokeStatusSchema,
  ProvisioningPhaseSchema,
  PlanTierSchema,
} from '../hub.js';

describe('Hub types', () => {
  it('should validate a product manifest', () => {
    const manifest = {
      product: {
        id: 'eurocomply-cosmetics',
        name: 'EuroComply Cosmetics',
        version: '1.0.0',
      },
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
    const result = ProductManifestSchema.safeParse(manifest);
    expect(result.success).toBe(true);
  });

  it('should validate a heartbeat request', () => {
    const hb = {
      spoke_id: 'spoke-acme-eu-west',
      os_version: '2.0.3',
      status: 'healthy',
      uptime_seconds: 864000,
      usage: { product_count: 142, user_count: 12, evaluation_count_24h: 847 },
    };
    const result = HeartbeatRequestSchema.safeParse(hb);
    expect(result.success).toBe(true);
  });

  it('should validate a heartbeat response', () => {
    const resp = {
      acknowledged: true,
      license_valid: true,
      signals: {
        os_update_available: null,
        pack_updates_available: 0,
        registry_sync_recommended: false,
        message: null,
      },
    };
    const result = HeartbeatResponseSchema.safeParse(resp);
    expect(result.success).toBe(true);
  });

  it('should validate spoke status enum', () => {
    expect(SpokeStatusSchema.safeParse('provisioning').success).toBe(true);
    expect(SpokeStatusSchema.safeParse('active').success).toBe(true);
    expect(SpokeStatusSchema.safeParse('suspended').success).toBe(true);
    expect(SpokeStatusSchema.safeParse('decommissioned').success).toBe(true);
    expect(SpokeStatusSchema.safeParse('invalid').success).toBe(false);
  });

  it('should validate provisioning phases', () => {
    expect(ProvisioningPhaseSchema.safeParse('claim').success).toBe(true);
    expect(ProvisioningPhaseSchema.safeParse('provision').success).toBe(true);
    expect(ProvisioningPhaseSchema.safeParse('boot').success).toBe(true);
    expect(ProvisioningPhaseSchema.safeParse('install').success).toBe(true);
    expect(ProvisioningPhaseSchema.safeParse('handoff').success).toBe(true);
  });

  it('should validate plan tiers', () => {
    expect(PlanTierSchema.safeParse('starter').success).toBe(true);
    expect(PlanTierSchema.safeParse('growth').success).toBe(true);
    expect(PlanTierSchema.safeParse('scale').success).toBe(true);
    expect(PlanTierSchema.safeParse('enterprise').success).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter types exec vitest run src/__tests__/hub.test.ts`
Expected: FAIL — cannot import from `../hub.js`

**Step 3: Write the implementation**

Create `packages/types/src/hub.ts`:

```typescript
import { z } from 'zod';

// --- Enums ---

export const SpokeStatusSchema = z.enum([
  'provisioning', 'active', 'suspended', 'decommissioned',
]);
export type SpokeStatus = z.infer<typeof SpokeStatusSchema>;

export const ProvisioningPhaseSchema = z.enum([
  'claim', 'provision', 'boot', 'install', 'handoff',
]);
export type ProvisioningPhase = z.infer<typeof ProvisioningPhaseSchema>;

export const PlanTierSchema = z.enum(['starter', 'growth', 'scale', 'enterprise']);
export type PlanTier = z.infer<typeof PlanTierSchema>;

// --- Product Manifest ---

export const ProductPackRefSchema = z.object({
  name: z.string(),
  version: z.string(),
  type: z.enum(['logic', 'environment', 'driver', 'intelligence']),
  required: z.boolean(),
});
export type ProductPackRef = z.infer<typeof ProductPackRefSchema>;

export const ProductPlanSchema = z.object({
  id: z.string(),
  max_products: z.union([z.number(), z.literal('unlimited')]),
  max_users: z.union([z.number(), z.literal('unlimited')]),
  packs: z.array(z.string()),
  custom_packs: z.boolean().optional(),
});
export type ProductPlan = z.infer<typeof ProductPlanSchema>;

export const ProductManifestSchema = z.object({
  product: z.object({
    id: z.string(),
    name: z.string(),
    version: z.string(),
    description: z.string().optional(),
  }),
  os: z.object({ version: z.string() }),
  packs: z.array(ProductPackRefSchema),
  plans: z.array(ProductPlanSchema),
});
export type ProductManifest = z.infer<typeof ProductManifestSchema>;

// --- Heartbeat ---

export const HeartbeatRequestSchema = z.object({
  spoke_id: z.string(),
  os_version: z.string(),
  status: z.enum(['healthy', 'degraded', 'unhealthy']),
  uptime_seconds: z.number(),
  usage: z.object({
    product_count: z.number(),
    user_count: z.number(),
    evaluation_count_24h: z.number(),
  }),
});
export type HeartbeatRequest = z.infer<typeof HeartbeatRequestSchema>;

export const HeartbeatResponseSchema = z.object({
  acknowledged: z.boolean(),
  license_valid: z.boolean(),
  signals: z.object({
    os_update_available: z.string().nullable(),
    pack_updates_available: z.number(),
    registry_sync_recommended: z.boolean(),
    message: z.string().nullable(),
  }),
});
export type HeartbeatResponse = z.infer<typeof HeartbeatResponseSchema>;

// --- Provisioning ---

export const ProvisionRequestSchema = z.object({
  org_id: z.string(),
  product_id: z.string(),
  plan: PlanTierSchema,
  region: z.string(),
  admin_email: z.string().email(),
});
export type ProvisionRequest = z.infer<typeof ProvisionRequestSchema>;
```

Then add to `packages/types/src/index.ts`:

```typescript
export * from './hub.js';
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter types exec vitest run src/__tests__/hub.test.ts`
Expected: PASS (all 6 tests)

**Step 5: Commit**

```bash
git add packages/types/src/hub.ts packages/types/src/__tests__/hub.test.ts packages/types/src/index.ts
git commit -m "feat(types): add Hub-Spoke shared types — ProductManifest, Heartbeat, SpokeStatus, ProvisioningPhase"
```

---

### Task 2: Hub Database Layer + Migrations

**Files:**
- Create: `apps/hub-control-plane/src/db/connection.ts`
- Create: `apps/hub-control-plane/src/db/migrate.ts`
- Create: `apps/hub-control-plane/src/db/migrations/001-hub-schema.sql`
- Create: `apps/hub-control-plane/src/db/__tests__/connection.test.ts`

**Context:** The Hub needs its own PostgreSQL database, separate from Spoke databases. We reuse the same `pg.Pool` pattern from platform-services but don't import it (Hub shouldn't depend on platform-services). The Hub schema has 7 tables: organizations, spokes, products, subscriptions, provisioning_events, network_directory, pack_registry.

**Step 1: Write the failing test**

Create `apps/hub-control-plane/src/db/__tests__/connection.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { HubDb } from '../connection.js';
import { runHubMigrations } from '../migrate.js';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

describe('Hub Database', () => {
  let container: StartedPostgreSqlContainer;
  let db: HubDb;

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
  }, 60_000);

  afterAll(async () => {
    await db.close();
    await container.stop();
  });

  it('should create all hub tables', async () => {
    const result = await db.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' ORDER BY table_name`,
    );
    const tables = result.rows.map((r: any) => r.table_name);
    expect(tables).toContain('organizations');
    expect(tables).toContain('spokes');
    expect(tables).toContain('products');
    expect(tables).toContain('subscriptions');
    expect(tables).toContain('provisioning_events');
    expect(tables).toContain('network_directory');
  });

  it('should insert and query an organization', async () => {
    await db.query(
      `INSERT INTO organizations (org_id, name, email, created_at)
       VALUES ($1, $2, $3, now())`,
      ['org-1', 'Acme Corp', 'admin@acme.com'],
    );
    const result = await db.query(
      `SELECT * FROM organizations WHERE org_id = $1`,
      ['org-1'],
    );
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].name).toBe('Acme Corp');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter hub-control-plane exec vitest run src/db/__tests__/connection.test.ts`
Expected: FAIL — cannot import `HubDb`

**Step 3: Write the implementation**

Create `apps/hub-control-plane/src/db/connection.ts`:

```typescript
import pg from 'pg';

export interface HubDbConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export class HubDb {
  private pool: pg.Pool;

  constructor(config: HubDbConfig) {
    this.pool = new pg.Pool(config);
  }

  async query(text: string, params?: unknown[]): Promise<pg.QueryResult> {
    return this.pool.query(text, params);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
```

Create `apps/hub-control-plane/src/db/migrate.ts`:

```typescript
import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { HubDb } from './connection.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function runHubMigrations(db: HubDb): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS hub_migrations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ DEFAULT now()
    )
  `);

  const migrationsDir = join(__dirname, 'migrations');
  const files = readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

  for (const file of files) {
    const applied = await db.query('SELECT 1 FROM hub_migrations WHERE name = $1', [file]);
    if (applied.rows.length > 0) continue;

    const sql = readFileSync(join(migrationsDir, file), 'utf-8');
    await db.query(sql);
    await db.query('INSERT INTO hub_migrations (name) VALUES ($1)', [file]);
  }
}
```

Create `apps/hub-control-plane/src/db/migrations/001-hub-schema.sql`:

```sql
-- Organizations (customer accounts)
CREATE TABLE organizations (
  org_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  stripe_customer_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Products (from product manifests)
CREATE TABLE products (
  product_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  manifest JSONB NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Spokes (customer instances)
CREATE TABLE spokes (
  spoke_id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(org_id),
  product_id TEXT NOT NULL REFERENCES products(product_id),
  plan TEXT NOT NULL,
  region TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'provisioning',
  os_version TEXT,
  hostname TEXT,
  api_key_hash TEXT,
  last_heartbeat TIMESTAMPTZ,
  health JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Subscriptions (billing)
CREATE TABLE subscriptions (
  subscription_id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES organizations(org_id),
  spoke_id TEXT NOT NULL REFERENCES spokes(spoke_id),
  stripe_subscription_id TEXT,
  plan TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Provisioning events (pipeline audit trail)
CREATE TABLE provisioning_events (
  event_id SERIAL PRIMARY KEY,
  spoke_id TEXT NOT NULL REFERENCES spokes(spoke_id),
  phase TEXT NOT NULL,
  status TEXT NOT NULL,
  detail JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Network directory (DID → endpoint resolution)
CREATE TABLE network_directory (
  did TEXT PRIMARY KEY,
  spoke_id TEXT NOT NULL REFERENCES spokes(spoke_id),
  endpoint TEXT NOT NULL,
  capabilities TEXT[] NOT NULL DEFAULT '{}',
  visible BOOLEAN NOT NULL DEFAULT true,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Add `pg` and `@testcontainers/postgresql` to hub-control-plane `package.json` dependencies:

```json
"dependencies": {
  "hono": "^4.11.7",
  "pg": "^8.13.0",
  ...
},
"devDependencies": {
  "@testcontainers/postgresql": "^10.0.0",
  "@types/pg": "^8.0.0",
  ...
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter hub-control-plane exec vitest run src/db/__tests__/connection.test.ts`
Expected: PASS (2 tests)

**Step 5: Commit**

```bash
git add apps/hub-control-plane/src/db/ apps/hub-control-plane/package.json
git commit -m "feat(hub): add Hub database layer with 6-table migration schema"
```

---

### Task 3: Organization Service

**Files:**
- Create: `apps/hub-control-plane/src/services/organization.ts`
- Test: `apps/hub-control-plane/src/services/__tests__/organization.test.ts`

**Context:** Organizations are customer accounts. An org has a name, email, optional Stripe customer ID, and status (active/suspended). This is the first Hub service — follows the same pattern as platform-services (constructor takes db, methods return ServiceResult).

**Step 1: Write the failing test**

Create `apps/hub-control-plane/src/services/__tests__/organization.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { OrganizationService } from '../organization.js';
import { HubDb } from '../../db/connection.js';
import { runHubMigrations } from '../../db/migrate.js';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

describe('OrganizationService', () => {
  let container: StartedPostgreSqlContainer;
  let db: HubDb;
  let orgService: OrganizationService;

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
    orgService = new OrganizationService(db);
  }, 60_000);

  afterAll(async () => {
    await db.close();
    await container.stop();
  });

  it('should create an organization', async () => {
    const result = await orgService.create({ name: 'Acme Corp', email: 'admin@acme.com' });
    expect(result.success).toBe(true);
    expect(result.data.name).toBe('Acme Corp');
    expect(result.data.org_id).toBeDefined();
    expect(result.data.status).toBe('active');
  });

  it('should get an organization by ID', async () => {
    const created = await orgService.create({ name: 'Beta Inc', email: 'beta@inc.com' });
    const result = await orgService.get(created.data.org_id);
    expect(result.success).toBe(true);
    expect(result.data.name).toBe('Beta Inc');
  });

  it('should update stripe customer ID', async () => {
    const created = await orgService.create({ name: 'Gamma Ltd', email: 'g@gamma.com' });
    const result = await orgService.update(created.data.org_id, { stripe_customer_id: 'cus_123' });
    expect(result.success).toBe(true);
    expect(result.data.stripe_customer_id).toBe('cus_123');
  });

  it('should list organizations', async () => {
    const result = await orgService.list();
    expect(result.success).toBe(true);
    expect(result.data.total).toBeGreaterThanOrEqual(3);
  });

  it('should return error for non-existent org', async () => {
    const result = await orgService.get('nonexistent');
    expect(result.success).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter hub-control-plane exec vitest run src/services/__tests__/organization.test.ts`
Expected: FAIL — cannot import `OrganizationService`

**Step 3: Write the implementation**

Create `apps/hub-control-plane/src/services/organization.ts`:

```typescript
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
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter hub-control-plane exec vitest run src/services/__tests__/organization.test.ts`
Expected: PASS (5 tests)

**Step 5: Commit**

```bash
git add apps/hub-control-plane/src/services/organization.ts apps/hub-control-plane/src/services/__tests__/organization.test.ts
git commit -m "feat(hub): add OrganizationService with CRUD operations"
```

---

### Task 4: Product Catalog Service

**Files:**
- Create: `apps/hub-control-plane/src/services/product-catalog.ts`
- Test: `apps/hub-control-plane/src/services/__tests__/product-catalog.test.ts`

**Context:** The Product Catalog stores product definitions parsed from product manifests. A product defines which Packs to install for each plan tier. The Provisioning Orchestrator reads the catalog to know what to install on a new Spoke. Products are stored as JSONB manifests in the `products` table.

**Step 1: Write the failing test**

Create `apps/hub-control-plane/src/services/__tests__/product-catalog.test.ts`:

```typescript
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
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter hub-control-plane exec vitest run src/services/__tests__/product-catalog.test.ts`
Expected: FAIL — cannot import `ProductCatalogService`

**Step 3: Write the implementation**

Create `apps/hub-control-plane/src/services/product-catalog.ts`:

```typescript
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
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter hub-control-plane exec vitest run src/services/__tests__/product-catalog.test.ts`
Expected: PASS (5 tests)

**Step 5: Commit**

```bash
git add apps/hub-control-plane/src/services/product-catalog.ts apps/hub-control-plane/src/services/__tests__/product-catalog.test.ts
git commit -m "feat(hub): add ProductCatalogService with plan-based pack resolution"
```

---

### Task 5: Billing Service (Stripe Abstraction)

**Files:**
- Create: `apps/hub-control-plane/src/services/billing.ts`
- Test: `apps/hub-control-plane/src/services/__tests__/billing.test.ts`

**Context:** The billing service manages Stripe subscriptions. It uses a `BillingProvider` interface so tests use an in-memory mock and production uses the real Stripe SDK. The service creates subscriptions, handles webhooks (payment_succeeded, payment_failed, subscription_cancelled), and records everything in the `subscriptions` table.

**Step 1: Write the failing test**

Create `apps/hub-control-plane/src/services/__tests__/billing.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BillingService, type BillingProvider } from '../billing.js';
import { OrganizationService } from '../organization.js';
import { HubDb } from '../../db/connection.js';
import { runHubMigrations } from '../../db/migrate.js';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

// In-memory mock billing provider
class MockBillingProvider implements BillingProvider {
  customers = new Map<string, string>();
  subscriptions = new Map<string, { status: string; plan: string }>();
  nextId = 1;

  async createCustomer(name: string, email: string): Promise<string> {
    const id = `cus_mock_${this.nextId++}`;
    this.customers.set(id, email);
    return id;
  }

  async createSubscription(customerId: string, priceId: string): Promise<{ id: string; status: string }> {
    const id = `sub_mock_${this.nextId++}`;
    this.subscriptions.set(id, { status: 'active', plan: priceId });
    return { id, status: 'active' };
  }

  async cancelSubscription(subscriptionId: string): Promise<void> {
    const sub = this.subscriptions.get(subscriptionId);
    if (sub) sub.status = 'cancelled';
  }
}

describe('BillingService', () => {
  let container: StartedPostgreSqlContainer;
  let db: HubDb;
  let billing: BillingService;
  let orgService: OrganizationService;
  let provider: MockBillingProvider;

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
    orgService = new OrganizationService(db);
    provider = new MockBillingProvider();
    billing = new BillingService(db, provider);
  }, 60_000);

  afterAll(async () => {
    await db.close();
    await container.stop();
  });

  it('should create a customer and subscription', async () => {
    // Create org and a spoke row first (FK constraint)
    const org = await orgService.create({ name: 'Billing Test', email: 'bill@test.com' });
    await db.query(
      `INSERT INTO products (product_id, name, version, manifest) VALUES ('test-product', 'Test', '1.0.0', '{}')`,
    );
    await db.query(
      `INSERT INTO spokes (spoke_id, org_id, product_id, plan, region) VALUES ($1, $2, 'test-product', 'growth', 'eu-west')`,
      ['spoke-billing-1', org.data.org_id],
    );

    const result = await billing.setupSubscription({
      org_id: org.data.org_id,
      spoke_id: 'spoke-billing-1',
      plan: 'growth',
    });

    expect(result.success).toBe(true);
    expect(result.data.stripe_subscription_id).toContain('sub_mock_');
    expect(result.data.status).toBe('active');

    // Verify org got stripe_customer_id
    const updatedOrg = await orgService.get(org.data.org_id);
    expect(updatedOrg.data.stripe_customer_id).toContain('cus_mock_');
  });

  it('should cancel a subscription', async () => {
    const sub = await db.query(
      `SELECT * FROM subscriptions LIMIT 1`,
    );
    const subId = sub.rows[0].subscription_id;

    const result = await billing.cancelSubscription(subId);
    expect(result.success).toBe(true);

    const cancelled = await db.query(
      `SELECT status FROM subscriptions WHERE subscription_id = $1`,
      [subId],
    );
    expect(cancelled.rows[0].status).toBe('cancelled');
  });

  it('should handle payment_failed webhook', async () => {
    // Create a new active subscription
    const org = await orgService.create({ name: 'Webhook Test', email: 'wh@test.com' });
    await db.query(
      `INSERT INTO spokes (spoke_id, org_id, product_id, plan, region) VALUES ($1, $2, 'test-product', 'starter', 'eu-west')`,
      ['spoke-billing-2', org.data.org_id],
    );
    const sub = await billing.setupSubscription({
      org_id: org.data.org_id,
      spoke_id: 'spoke-billing-2',
      plan: 'starter',
    });

    const result = await billing.handleWebhookEvent({
      type: 'payment_failed',
      subscription_id: sub.data.stripe_subscription_id!,
    });
    expect(result.success).toBe(true);

    // Spoke should be suspended
    const spoke = await db.query(`SELECT status FROM spokes WHERE spoke_id = 'spoke-billing-2'`);
    expect(spoke.rows[0].status).toBe('suspended');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter hub-control-plane exec vitest run src/services/__tests__/billing.test.ts`
Expected: FAIL — cannot import `BillingService`

**Step 3: Write the implementation**

Create `apps/hub-control-plane/src/services/billing.ts`:

```typescript
import { randomUUID } from 'crypto';
import type { HubDb } from '../db/connection.js';

export interface BillingProvider {
  createCustomer(name: string, email: string): Promise<string>;
  createSubscription(customerId: string, priceId: string): Promise<{ id: string; status: string }>;
  cancelSubscription(subscriptionId: string): Promise<void>;
}

interface ServiceResult<T> {
  success: boolean;
  data: T;
  error?: string;
}

interface Subscription {
  subscription_id: string;
  org_id: string;
  spoke_id: string;
  stripe_subscription_id: string | null;
  plan: string;
  status: string;
}

export class BillingService {
  constructor(
    private db: HubDb,
    private provider: BillingProvider,
  ) {}

  async setupSubscription(input: {
    org_id: string;
    spoke_id: string;
    plan: string;
  }): Promise<ServiceResult<Subscription>> {
    // Get or create Stripe customer
    const orgResult = await this.db.query(
      `SELECT * FROM organizations WHERE org_id = $1`,
      [input.org_id],
    );
    if (orgResult.rows.length === 0) {
      return { success: false, data: null as any, error: 'Organization not found' };
    }
    const org = orgResult.rows[0];

    let stripeCustomerId = org.stripe_customer_id;
    if (!stripeCustomerId) {
      stripeCustomerId = await this.provider.createCustomer(org.name, org.email);
      await this.db.query(
        `UPDATE organizations SET stripe_customer_id = $1, updated_at = now() WHERE org_id = $2`,
        [stripeCustomerId, input.org_id],
      );
    }

    // Create Stripe subscription
    const priceId = `price_${input.plan}`;
    const stripeSub = await this.provider.createSubscription(stripeCustomerId, priceId);

    // Record in database
    const subscriptionId = `sub-${randomUUID().slice(0, 8)}`;
    await this.db.query(
      `INSERT INTO subscriptions (subscription_id, org_id, spoke_id, stripe_subscription_id, plan, status)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [subscriptionId, input.org_id, input.spoke_id, stripeSub.id, input.plan, stripeSub.status],
    );

    return {
      success: true,
      data: {
        subscription_id: subscriptionId,
        org_id: input.org_id,
        spoke_id: input.spoke_id,
        stripe_subscription_id: stripeSub.id,
        plan: input.plan,
        status: stripeSub.status,
      },
    };
  }

  async cancelSubscription(subscriptionId: string): Promise<ServiceResult<void>> {
    const result = await this.db.query(
      `SELECT * FROM subscriptions WHERE subscription_id = $1`,
      [subscriptionId],
    );
    if (result.rows.length === 0) {
      return { success: false, data: undefined as any, error: 'Subscription not found' };
    }

    const sub = result.rows[0];
    if (sub.stripe_subscription_id) {
      await this.provider.cancelSubscription(sub.stripe_subscription_id);
    }

    await this.db.query(
      `UPDATE subscriptions SET status = 'cancelled', updated_at = now() WHERE subscription_id = $1`,
      [subscriptionId],
    );
    return { success: true, data: undefined as any };
  }

  async handleWebhookEvent(event: { type: string; subscription_id: string }): Promise<ServiceResult<void>> {
    // Find internal subscription by stripe ID
    const result = await this.db.query(
      `SELECT * FROM subscriptions WHERE stripe_subscription_id = $1`,
      [event.subscription_id],
    );
    if (result.rows.length === 0) {
      return { success: false, data: undefined as any, error: 'Subscription not found for webhook' };
    }
    const sub = result.rows[0];

    if (event.type === 'payment_failed') {
      await this.db.query(
        `UPDATE subscriptions SET status = 'past_due', updated_at = now() WHERE subscription_id = $1`,
        [sub.subscription_id],
      );
      await this.db.query(
        `UPDATE spokes SET status = 'suspended', updated_at = now() WHERE spoke_id = $1`,
        [sub.spoke_id],
      );
    } else if (event.type === 'payment_succeeded') {
      await this.db.query(
        `UPDATE subscriptions SET status = 'active', updated_at = now() WHERE subscription_id = $1`,
        [sub.subscription_id],
      );
      await this.db.query(
        `UPDATE spokes SET status = 'active', updated_at = now() WHERE spoke_id = $1`,
        [sub.spoke_id],
      );
    } else if (event.type === 'subscription_cancelled') {
      await this.db.query(
        `UPDATE subscriptions SET status = 'cancelled', updated_at = now() WHERE subscription_id = $1`,
        [sub.subscription_id],
      );
    }

    return { success: true, data: undefined as any };
  }
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter hub-control-plane exec vitest run src/services/__tests__/billing.test.ts`
Expected: PASS (3 tests)

**Step 5: Commit**

```bash
git add apps/hub-control-plane/src/services/billing.ts apps/hub-control-plane/src/services/__tests__/billing.test.ts
git commit -m "feat(hub): add BillingService with Stripe abstraction and webhook handling"
```

---

### Task 6: Provisioning Orchestrator

**Files:**
- Create: `apps/hub-control-plane/src/services/provisioning.ts`
- Test: `apps/hub-control-plane/src/services/__tests__/provisioning.test.ts`

**Context:** The Provisioning Orchestrator implements the 5-phase pipeline: Claim → Provision → Boot → Install → Handoff. Each phase is idempotent — if it fails, the orchestrator can retry from the failed step. Infrastructure operations (K8s namespace creation, Helm deployment, DB provisioning) are abstracted behind an `InfrastructureProvider` interface. The orchestrator records every phase transition in the `provisioning_events` table.

The pipeline:
1. **CLAIM** — Validate org + product + plan. Assign spoke ID. Insert spoke row (status=provisioning).
2. **PROVISION** — Call infra provider: create namespace, deploy Helm, provision DBs.
3. **BOOT** — Call infra provider: trigger spoke first-boot (migrations, DID generation).
4. **INSTALL** — Resolve packs for plan, record in spoke manifest.
5. **HANDOFF** — Update spoke status to active, record completion.

**Step 1: Write the failing test**

Create `apps/hub-control-plane/src/services/__tests__/provisioning.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ProvisioningOrchestrator, type InfrastructureProvider } from '../provisioning.js';
import { OrganizationService } from '../organization.js';
import { ProductCatalogService } from '../product-catalog.js';
import { BillingService, type BillingProvider } from '../billing.js';
import { HubDb } from '../../db/connection.js';
import { runHubMigrations } from '../../db/migrate.js';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { ProductManifest } from '@eurocomply/types';

class MockInfraProvider implements InfrastructureProvider {
  namespaces: string[] = [];
  deployments: string[] = [];
  boots: string[] = [];

  async createNamespace(name: string) { this.namespaces.push(name); }
  async deploySpoke(spokeId: string, _config: any) { this.deployments.push(spokeId); }
  async triggerBoot(spokeId: string) { this.boots.push(spokeId); }
  async destroyNamespace(name: string) {
    this.namespaces = this.namespaces.filter(n => n !== name);
  }
}

class MockBillingProvider implements BillingProvider {
  nextId = 1;
  async createCustomer(_name: string, _email: string) { return `cus_${this.nextId++}`; }
  async createSubscription(_cid: string, _price: string) { return { id: `sub_${this.nextId++}`, status: 'active' }; }
  async cancelSubscription(_sid: string) {}
}

describe('ProvisioningOrchestrator', () => {
  let container: StartedPostgreSqlContainer;
  let db: HubDb;
  let orchestrator: ProvisioningOrchestrator;
  let infra: MockInfraProvider;
  let orgService: OrganizationService;
  let catalog: ProductCatalogService;

  const cosmeticsManifest: ProductManifest = {
    product: { id: 'cosmetics', name: 'EuroComply Cosmetics', version: '1.0.0' },
    os: { version: '^2.0.0' },
    packs: [
      { name: '@eu/cosmetics-vertical', version: '^1.0.0', type: 'environment', required: true },
      { name: '@eu/clp-classification', version: '^3.0.0', type: 'logic', required: true },
    ],
    plans: [
      { id: 'starter', max_products: 50, max_users: 10, packs: ['required_only'] },
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
    orgService = new OrganizationService(db);
    catalog = new ProductCatalogService(db);
    infra = new MockInfraProvider();
    const billingProvider = new MockBillingProvider();
    const billing = new BillingService(db, billingProvider);
    orchestrator = new ProvisioningOrchestrator(db, orgService, catalog, billing, infra);

    // Seed product
    await catalog.register(cosmeticsManifest);
  }, 60_000);

  afterAll(async () => {
    await db.close();
    await container.stop();
  });

  it('should provision a spoke through all 5 phases', async () => {
    const org = await orgService.create({ name: 'Acme', email: 'acme@test.com' });

    const result = await orchestrator.provision({
      org_id: org.data.org_id,
      product_id: 'cosmetics',
      plan: 'starter',
      region: 'eu-west',
      admin_email: 'admin@acme.com',
    });

    expect(result.success).toBe(true);
    expect(result.data.spoke_id).toBeDefined();
    expect(result.data.status).toBe('active');
    expect(result.data.hostname).toContain('.eurocomply.app');

    // Verify infra was called
    expect(infra.namespaces.length).toBe(1);
    expect(infra.deployments.length).toBe(1);
    expect(infra.boots.length).toBe(1);

    // Verify provisioning events were recorded
    const events = await db.query(
      `SELECT * FROM provisioning_events WHERE spoke_id = $1 ORDER BY created_at`,
      [result.data.spoke_id],
    );
    expect(events.rows.length).toBe(5);
    expect(events.rows.map((e: any) => e.phase)).toEqual([
      'claim', 'provision', 'boot', 'install', 'handoff',
    ]);
    expect(events.rows.every((e: any) => e.status === 'completed')).toBe(true);

    // Verify subscription was created
    const subs = await db.query(
      `SELECT * FROM subscriptions WHERE spoke_id = $1`,
      [result.data.spoke_id],
    );
    expect(subs.rows.length).toBe(1);
    expect(subs.rows[0].status).toBe('active');
  });

  it('should be idempotent — re-running skips completed phases', async () => {
    const org = await orgService.create({ name: 'Beta', email: 'beta@test.com' });

    // First run
    const result1 = await orchestrator.provision({
      org_id: org.data.org_id,
      product_id: 'cosmetics',
      plan: 'starter',
      region: 'eu-west',
      admin_email: 'admin@beta.com',
    });

    const prevNamespaceCount = infra.namespaces.length;

    // Second run with same spoke_id should skip completed phases
    const result2 = await orchestrator.resume(result1.data.spoke_id);
    expect(result2.success).toBe(true);
    // No new namespace created (idempotent)
    expect(infra.namespaces.length).toBe(prevNamespaceCount);
  });

  it('should fail if product does not exist', async () => {
    const org = await orgService.create({ name: 'Gamma', email: 'gamma@test.com' });
    const result = await orchestrator.provision({
      org_id: org.data.org_id,
      product_id: 'nonexistent',
      plan: 'starter',
      region: 'eu-west',
      admin_email: 'admin@gamma.com',
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Product not found');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter hub-control-plane exec vitest run src/services/__tests__/provisioning.test.ts`
Expected: FAIL — cannot import `ProvisioningOrchestrator`

**Step 3: Write the implementation**

Create `apps/hub-control-plane/src/services/provisioning.ts`:

```typescript
import { randomUUID } from 'crypto';
import type { HubDb } from '../db/connection.js';
import type { OrganizationService } from './organization.js';
import type { ProductCatalogService } from './product-catalog.js';
import type { BillingService } from './billing.js';

export interface InfrastructureProvider {
  createNamespace(name: string): Promise<void>;
  deploySpoke(spokeId: string, config: SpokeDeployConfig): Promise<void>;
  triggerBoot(spokeId: string): Promise<void>;
  destroyNamespace(name: string): Promise<void>;
}

export interface SpokeDeployConfig {
  spokeId: string;
  region: string;
  plan: string;
  productId: string;
  hostname: string;
}

interface ServiceResult<T> {
  success: boolean;
  data: T;
  error?: string;
}

interface ProvisionedSpoke {
  spoke_id: string;
  status: string;
  hostname: string;
}

type Phase = 'claim' | 'provision' | 'boot' | 'install' | 'handoff';

export class ProvisioningOrchestrator {
  constructor(
    private db: HubDb,
    private orgService: OrganizationService,
    private catalog: ProductCatalogService,
    private billing: BillingService,
    private infra: InfrastructureProvider,
  ) {}

  async provision(input: {
    org_id: string;
    product_id: string;
    plan: string;
    region: string;
    admin_email: string;
  }): Promise<ServiceResult<ProvisionedSpoke>> {
    // --- PHASE 1: CLAIM ---
    const org = await this.orgService.get(input.org_id);
    if (!org.success) return { success: false, data: null as any, error: org.error };

    const product = await this.catalog.get(input.product_id);
    if (!product.success) return { success: false, data: null as any, error: product.error };

    const spokeId = `spoke-${randomUUID().slice(0, 12)}`;
    const hostname = `${spokeId}.eurocomply.app`;

    await this.db.query(
      `INSERT INTO spokes (spoke_id, org_id, product_id, plan, region, status, hostname)
       VALUES ($1, $2, $3, $4, $5, 'provisioning', $6)`,
      [spokeId, input.org_id, input.product_id, input.plan, input.region, hostname],
    );
    await this.recordEvent(spokeId, 'claim', 'completed', { product_id: input.product_id, plan: input.plan });

    // --- PHASE 2: PROVISION ---
    await this.infra.createNamespace(spokeId);
    await this.infra.deploySpoke(spokeId, {
      spokeId,
      region: input.region,
      plan: input.plan,
      productId: input.product_id,
      hostname,
    });
    await this.recordEvent(spokeId, 'provision', 'completed', { region: input.region });

    // --- PHASE 3: BOOT ---
    await this.infra.triggerBoot(spokeId);
    await this.recordEvent(spokeId, 'boot', 'completed', {});

    // --- PHASE 4: INSTALL ---
    const packs = await this.catalog.resolvePacksForPlan(input.product_id, input.plan);
    await this.recordEvent(spokeId, 'install', 'completed', {
      packs_count: packs.data.length,
      packs: packs.data.map(p => p.name),
    });

    // --- PHASE 5: HANDOFF ---
    await this.billing.setupSubscription({
      org_id: input.org_id,
      spoke_id: spokeId,
      plan: input.plan,
    });

    await this.db.query(
      `UPDATE spokes SET status = 'active', updated_at = now() WHERE spoke_id = $1`,
      [spokeId],
    );
    await this.recordEvent(spokeId, 'handoff', 'completed', { admin_email: input.admin_email });

    return { success: true, data: { spoke_id: spokeId, status: 'active', hostname } };
  }

  async resume(spokeId: string): Promise<ServiceResult<ProvisionedSpoke>> {
    const spoke = await this.db.query(`SELECT * FROM spokes WHERE spoke_id = $1`, [spokeId]);
    if (spoke.rows.length === 0) {
      return { success: false, data: null as any, error: 'Spoke not found' };
    }

    if (spoke.rows[0].status === 'active') {
      return {
        success: true,
        data: { spoke_id: spokeId, status: 'active', hostname: spoke.rows[0].hostname },
      };
    }

    // Check which phases are completed
    const events = await this.db.query(
      `SELECT phase FROM provisioning_events WHERE spoke_id = $1 AND status = 'completed'`,
      [spokeId],
    );
    const completed = new Set(events.rows.map((e: any) => e.phase));
    const row = spoke.rows[0];

    if (!completed.has('provision')) {
      await this.infra.createNamespace(spokeId);
      await this.infra.deploySpoke(spokeId, {
        spokeId,
        region: row.region,
        plan: row.plan,
        productId: row.product_id,
        hostname: row.hostname,
      });
      await this.recordEvent(spokeId, 'provision', 'completed', { region: row.region });
    }

    if (!completed.has('boot')) {
      await this.infra.triggerBoot(spokeId);
      await this.recordEvent(spokeId, 'boot', 'completed', {});
    }

    if (!completed.has('install')) {
      const packs = await this.catalog.resolvePacksForPlan(row.product_id, row.plan);
      await this.recordEvent(spokeId, 'install', 'completed', { packs_count: packs.data.length });
    }

    if (!completed.has('handoff')) {
      await this.db.query(`UPDATE spokes SET status = 'active', updated_at = now() WHERE spoke_id = $1`, [spokeId]);
      await this.recordEvent(spokeId, 'handoff', 'completed', {});
    }

    return { success: true, data: { spoke_id: spokeId, status: 'active', hostname: row.hostname } };
  }

  private async recordEvent(spokeId: string, phase: Phase, status: string, detail: Record<string, unknown>): Promise<void> {
    await this.db.query(
      `INSERT INTO provisioning_events (spoke_id, phase, status, detail) VALUES ($1, $2, $3, $4)`,
      [spokeId, phase, status, JSON.stringify(detail)],
    );
  }
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter hub-control-plane exec vitest run src/services/__tests__/provisioning.test.ts`
Expected: PASS (3 tests)

**Step 5: Commit**

```bash
git add apps/hub-control-plane/src/services/provisioning.ts apps/hub-control-plane/src/services/__tests__/provisioning.test.ts
git commit -m "feat(hub): add ProvisioningOrchestrator with 5-phase idempotent pipeline"
```

---

### Task 7: Fleet Service (Heartbeat Processing)

**Files:**
- Create: `apps/hub-control-plane/src/services/fleet.ts`
- Test: `apps/hub-control-plane/src/services/__tests__/fleet.test.ts`

**Context:** The Fleet Service processes heartbeats from Spokes and manages the spoke registry. When a spoke sends a heartbeat, the Fleet Service updates the spoke's health data, last heartbeat timestamp, and returns signals (update available, pack updates, license validation). The service also detects stale spokes (no heartbeat for >5 minutes).

**Step 1: Write the failing test**

Create `apps/hub-control-plane/src/services/__tests__/fleet.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FleetService } from '../fleet.js';
import { HubDb } from '../../db/connection.js';
import { runHubMigrations } from '../../db/migrate.js';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { HeartbeatRequest } from '@eurocomply/types';

describe('FleetService', () => {
  let container: StartedPostgreSqlContainer;
  let db: HubDb;
  let fleet: FleetService;

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
    fleet = new FleetService(db);

    // Seed a spoke
    await db.query(`INSERT INTO organizations (org_id, name, email) VALUES ('org-fleet', 'Fleet Test', 'f@t.com')`);
    await db.query(`INSERT INTO products (product_id, name, version, manifest) VALUES ('prod-1', 'Test', '1.0.0', '{}')`);
    await db.query(
      `INSERT INTO spokes (spoke_id, org_id, product_id, plan, region, status, api_key_hash)
       VALUES ('spoke-fleet-1', 'org-fleet', 'prod-1', 'starter', 'eu-west', 'active', 'hash123')`,
    );
  }, 60_000);

  afterAll(async () => {
    await db.close();
    await container.stop();
  });

  it('should process a heartbeat and return signals', async () => {
    const hb: HeartbeatRequest = {
      spoke_id: 'spoke-fleet-1',
      os_version: '2.0.3',
      status: 'healthy',
      uptime_seconds: 3600,
      usage: { product_count: 10, user_count: 2, evaluation_count_24h: 50 },
    };

    const result = await fleet.processHeartbeat(hb);
    expect(result.success).toBe(true);
    expect(result.data.acknowledged).toBe(true);
    expect(result.data.license_valid).toBe(true);

    // Verify spoke health was updated
    const spoke = await db.query(`SELECT * FROM spokes WHERE spoke_id = 'spoke-fleet-1'`);
    expect(spoke.rows[0].last_heartbeat).not.toBeNull();
    expect(spoke.rows[0].os_version).toBe('2.0.3');
  });

  it('should reject heartbeat from unknown spoke', async () => {
    const hb: HeartbeatRequest = {
      spoke_id: 'unknown-spoke',
      os_version: '1.0.0',
      status: 'healthy',
      uptime_seconds: 100,
      usage: { product_count: 0, user_count: 0, evaluation_count_24h: 0 },
    };
    const result = await fleet.processHeartbeat(hb);
    expect(result.success).toBe(false);
  });

  it('should list spokes with health info', async () => {
    const result = await fleet.listSpokes();
    expect(result.success).toBe(true);
    expect(result.data.total).toBe(1);
    expect(result.data.items[0].spoke_id).toBe('spoke-fleet-1');
  });

  it('should detect stale spokes', async () => {
    // Set last_heartbeat to 10 minutes ago
    await db.query(
      `UPDATE spokes SET last_heartbeat = now() - interval '10 minutes' WHERE spoke_id = 'spoke-fleet-1'`,
    );
    const stale = await fleet.getStaleSpokes(5);
    expect(stale.data.length).toBe(1);
    expect(stale.data[0].spoke_id).toBe('spoke-fleet-1');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter hub-control-plane exec vitest run src/services/__tests__/fleet.test.ts`
Expected: FAIL — cannot import `FleetService`

**Step 3: Write the implementation**

Create `apps/hub-control-plane/src/services/fleet.ts`:

```typescript
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
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter hub-control-plane exec vitest run src/services/__tests__/fleet.test.ts`
Expected: PASS (4 tests)

**Step 5: Commit**

```bash
git add apps/hub-control-plane/src/services/fleet.ts apps/hub-control-plane/src/services/__tests__/fleet.test.ts
git commit -m "feat(hub): add FleetService with heartbeat processing and stale spoke detection"
```

---

### Task 8: Network Directory Service

**Files:**
- Create: `apps/hub-control-plane/src/services/network-directory.ts`
- Test: `apps/hub-control-plane/src/services/__tests__/network-directory.test.ts`

**Context:** The Network Directory maps DIDs to Spoke MCP endpoints for A2A discovery. When a Spoke boots, its Spoke Agent registers its DID and endpoint. Other Spokes query the directory to discover trading partners. The directory is opt-in — spokes choose whether to be visible. Only DID, endpoint, and capabilities are stored — no company names unless the spoke publishes one.

**Step 1: Write the failing test**

Create `apps/hub-control-plane/src/services/__tests__/network-directory.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { NetworkDirectoryService } from '../network-directory.js';
import { HubDb } from '../../db/connection.js';
import { runHubMigrations } from '../../db/migrate.js';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

describe('NetworkDirectoryService', () => {
  let container: StartedPostgreSqlContainer;
  let db: HubDb;
  let directory: NetworkDirectoryService;

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
    directory = new NetworkDirectoryService(db);

    // Seed spoke (FK)
    await db.query(`INSERT INTO organizations (org_id, name, email) VALUES ('org-dir', 'Dir Test', 'd@t.com')`);
    await db.query(`INSERT INTO products (product_id, name, version, manifest) VALUES ('prod-dir', 'Test', '1.0.0', '{}')`);
    await db.query(
      `INSERT INTO spokes (spoke_id, org_id, product_id, plan, region, status)
       VALUES ('spoke-dir-1', 'org-dir', 'prod-dir', 'starter', 'eu-west', 'active')`,
    );
  }, 60_000);

  afterAll(async () => {
    await db.close();
    await container.stop();
  });

  it('should register a DID entry', async () => {
    const result = await directory.register({
      did: 'did:web:acme.eurocomply.app',
      spoke_id: 'spoke-dir-1',
      endpoint: 'https://acme.eurocomply.app/mcp',
      capabilities: ['claims', 'evidence'],
    });
    expect(result.success).toBe(true);
  });

  it('should look up by DID', async () => {
    const result = await directory.lookup('did:web:acme.eurocomply.app');
    expect(result.success).toBe(true);
    expect(result.data.endpoint).toBe('https://acme.eurocomply.app/mcp');
    expect(result.data.capabilities).toContain('claims');
  });

  it('should list visible entries', async () => {
    const result = await directory.listVisible();
    expect(result.success).toBe(true);
    expect(result.data.total).toBe(1);
  });

  it('should update visibility', async () => {
    await directory.setVisibility('did:web:acme.eurocomply.app', false);
    const hidden = await directory.listVisible();
    expect(hidden.data.total).toBe(0);

    // Still findable by direct lookup
    const lookup = await directory.lookup('did:web:acme.eurocomply.app');
    expect(lookup.success).toBe(true);
  });

  it('should return error for unknown DID', async () => {
    const result = await directory.lookup('did:web:unknown');
    expect(result.success).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter hub-control-plane exec vitest run src/services/__tests__/network-directory.test.ts`
Expected: FAIL

**Step 3: Write the implementation**

Create `apps/hub-control-plane/src/services/network-directory.ts`:

```typescript
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
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter hub-control-plane exec vitest run src/services/__tests__/network-directory.test.ts`
Expected: PASS (5 tests)

**Step 5: Commit**

```bash
git add apps/hub-control-plane/src/services/network-directory.ts apps/hub-control-plane/src/services/__tests__/network-directory.test.ts
git commit -m "feat(hub): add NetworkDirectoryService with DID registration and lookup"
```

---

### Task 9: DID Utilities

**Files:**
- Create: `packages/network-protocol/src/did.ts`
- Modify: `packages/network-protocol/src/index.ts`
- Test: `packages/network-protocol/src/__tests__/did.test.ts`

**Context:** Each Spoke gets a DID at boot. For Phase 5, we use `did:web:` format derived from the spoke hostname. DID generation is simple: generate an Ed25519 key pair, create a DID document with the public key. The private key stays on the Spoke. The DID + endpoint is registered in the Hub Network Directory.

The `network-protocol` package is currently empty. This task adds the minimal DID utilities needed for Spoke boot and directory registration. Full A2A primitives are Phase 6.

**Step 1: Write the failing test**

Create `packages/network-protocol/src/__tests__/did.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { generateDID, createDIDDocument, type DIDKeyPair } from '../did.js';

describe('DID Utilities', () => {
  it('should generate a DID from a hostname', () => {
    const result = generateDID('acme-corp.eurocomply.app');
    expect(result.did).toBe('did:web:acme-corp.eurocomply.app');
    expect(result.publicKey).toBeDefined();
    expect(result.privateKey).toBeDefined();
    expect(result.publicKey).not.toBe(result.privateKey);
  });

  it('should create a DID document', () => {
    const keyPair = generateDID('test.eurocomply.app');
    const doc = createDIDDocument(keyPair);

    expect(doc.id).toBe('did:web:test.eurocomply.app');
    expect(doc['@context']).toContain('https://www.w3.org/ns/did/v1');
    expect(doc.verificationMethod).toHaveLength(1);
    expect(doc.verificationMethod[0].type).toBe('Ed25519VerificationKey2020');
    expect(doc.verificationMethod[0].publicKeyMultibase).toBeDefined();
  });

  it('should generate unique key pairs', () => {
    const kp1 = generateDID('one.eurocomply.app');
    const kp2 = generateDID('two.eurocomply.app');
    expect(kp1.publicKey).not.toBe(kp2.publicKey);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter network-protocol exec vitest run src/__tests__/did.test.ts`
Expected: FAIL — cannot import from `../did.js`

**Step 3: Write the implementation**

Create `packages/network-protocol/src/did.ts`:

```typescript
import { generateKeyPairSync } from 'crypto';

export interface DIDKeyPair {
  did: string;
  publicKey: string;
  privateKey: string;
}

export interface DIDDocument {
  '@context': string[];
  id: string;
  verificationMethod: Array<{
    id: string;
    type: string;
    controller: string;
    publicKeyMultibase: string;
  }>;
  authentication: string[];
  assertionMethod: string[];
}

export function generateDID(hostname: string): DIDKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pubKeyDer = publicKey.export({ type: 'spki', format: 'der' });
  const privKeyDer = privateKey.export({ type: 'pkcs8', format: 'der' });

  return {
    did: `did:web:${hostname}`,
    publicKey: Buffer.from(pubKeyDer).toString('base64url'),
    privateKey: Buffer.from(privKeyDer).toString('base64url'),
  };
}

export function createDIDDocument(keyPair: DIDKeyPair): DIDDocument {
  return {
    '@context': [
      'https://www.w3.org/ns/did/v1',
      'https://w3id.org/security/suites/ed25519-2020/v1',
    ],
    id: keyPair.did,
    verificationMethod: [
      {
        id: `${keyPair.did}#key-1`,
        type: 'Ed25519VerificationKey2020',
        controller: keyPair.did,
        publicKeyMultibase: `z${keyPair.publicKey}`,
      },
    ],
    authentication: [`${keyPair.did}#key-1`],
    assertionMethod: [`${keyPair.did}#key-1`],
  };
}
```

Update `packages/network-protocol/src/index.ts`:

```typescript
export { generateDID, createDIDDocument, type DIDKeyPair, type DIDDocument } from './did.js';
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter network-protocol exec vitest run src/__tests__/did.test.ts`
Expected: PASS (3 tests)

**Step 5: Commit**

```bash
git add packages/network-protocol/src/did.ts packages/network-protocol/src/__tests__/did.test.ts packages/network-protocol/src/index.ts
git commit -m "feat(network-protocol): add DID utilities — key generation and DID document creation"
```

---

### Task 10: Spoke Agent (Heartbeat Sender)

**Files:**
- Create: `apps/spoke-runtime/src/spoke-agent.ts`
- Create: `apps/spoke-runtime/src/hub-client.ts`
- Modify: `apps/spoke-runtime/src/boot.ts` — wire agent into boot
- Modify: `apps/spoke-runtime/src/boot.ts` — add `SpokeInstance.agent`
- Test: `apps/spoke-runtime/src/spoke-agent.test.ts`

**Context:** The Spoke Agent is a background process that periodically sends heartbeats to the Hub. It runs inside the spoke-runtime process (not a separate sidecar — that's a deployment concern). The agent uses a `HubClient` that wraps HTTP calls to the Hub API. For testing, we mock the Hub with a simple HTTP server (same pattern as the publish.test.ts fetch test from Phase 4).

The agent:
1. Sends heartbeat every 60s (configurable for tests)
2. Includes: spoke_id, os_version, status, uptime, usage counts
3. Processes response signals (license_valid, update available)
4. Stops cleanly on spoke shutdown

**Step 1: Write the failing test**

Create `apps/spoke-runtime/src/spoke-agent.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { SpokeAgent } from './spoke-agent.js';
import { HubClient } from './hub-client.js';
import { createServer, type Server } from 'http';
import type { HeartbeatRequest, HeartbeatResponse } from '@eurocomply/types';

describe('SpokeAgent', () => {
  let server: Server;
  let hubUrl: string;
  let receivedHeartbeats: HeartbeatRequest[] = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/hub/api/v1/heartbeat') {
        let body = '';
        req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        req.on('end', () => {
          receivedHeartbeats.push(JSON.parse(body));
          const response: HeartbeatResponse = {
            acknowledged: true,
            license_valid: true,
            signals: {
              os_update_available: null,
              pack_updates_available: 0,
              registry_sync_recommended: false,
              message: null,
            },
          };
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(response));
        });
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', () => resolve()));
    const addr = server.address() as { port: number };
    hubUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  it('should send a heartbeat to the Hub', async () => {
    const client = new HubClient(hubUrl, 'test-api-key');
    const agent = new SpokeAgent(client, {
      spokeId: 'spoke-test-1',
      osVersion: '2.0.0',
      intervalMs: 100, // fast for testing
    });

    agent.start();

    // Wait for at least one heartbeat
    await new Promise(resolve => setTimeout(resolve, 250));
    agent.stop();

    expect(receivedHeartbeats.length).toBeGreaterThanOrEqual(1);
    expect(receivedHeartbeats[0].spoke_id).toBe('spoke-test-1');
    expect(receivedHeartbeats[0].os_version).toBe('2.0.0');
    expect(receivedHeartbeats[0].status).toBe('healthy');
  });

  it('should stop cleanly', async () => {
    const client = new HubClient(hubUrl, 'test-api-key');
    const agent = new SpokeAgent(client, {
      spokeId: 'spoke-test-2',
      osVersion: '2.0.0',
      intervalMs: 50,
    });

    agent.start();
    await new Promise(resolve => setTimeout(resolve, 100));

    const countBefore = receivedHeartbeats.length;
    agent.stop();

    await new Promise(resolve => setTimeout(resolve, 200));
    // No more heartbeats after stop
    expect(receivedHeartbeats.length - countBefore).toBeLessThanOrEqual(2);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter spoke-runtime exec vitest run src/spoke-agent.test.ts`
Expected: FAIL — cannot import `SpokeAgent` or `HubClient`

**Step 3: Write the implementation**

Create `apps/spoke-runtime/src/hub-client.ts`:

```typescript
import type { HeartbeatRequest, HeartbeatResponse } from '@eurocomply/types';

export class HubClient {
  constructor(
    private hubUrl: string,
    private apiKey: string,
  ) {}

  async sendHeartbeat(hb: HeartbeatRequest): Promise<HeartbeatResponse> {
    const response = await fetch(`${this.hubUrl}/hub/api/v1/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(hb),
    });
    if (!response.ok) {
      throw new Error(`Heartbeat failed: ${response.status}`);
    }
    return response.json() as Promise<HeartbeatResponse>;
  }

  async registerDirectory(entry: {
    did: string;
    spoke_id: string;
    endpoint: string;
    capabilities: string[];
  }): Promise<void> {
    const response = await fetch(`${this.hubUrl}/hub/api/v1/directory`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(entry),
    });
    if (!response.ok) {
      throw new Error(`Directory registration failed: ${response.status}`);
    }
  }
}
```

Create `apps/spoke-runtime/src/spoke-agent.ts`:

```typescript
import type { HubClient } from './hub-client.js';
import type { HeartbeatRequest } from '@eurocomply/types';

export interface SpokeAgentConfig {
  spokeId: string;
  osVersion: string;
  intervalMs?: number;
}

export class SpokeAgent {
  private timer: ReturnType<typeof setInterval> | null = null;
  private startTime = Date.now();

  constructor(
    private client: HubClient,
    private config: SpokeAgentConfig,
  ) {}

  start(): void {
    const interval = this.config.intervalMs ?? 60_000;
    this.sendHeartbeat();
    this.timer = setInterval(() => this.sendHeartbeat(), interval);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async sendHeartbeat(): Promise<void> {
    const hb: HeartbeatRequest = {
      spoke_id: this.config.spokeId,
      os_version: this.config.osVersion,
      status: 'healthy',
      uptime_seconds: Math.floor((Date.now() - this.startTime) / 1000),
      usage: {
        product_count: 0,
        user_count: 0,
        evaluation_count_24h: 0,
      },
    };

    try {
      const response = await this.client.sendHeartbeat(hb);
      if (!response.license_valid) {
        console.warn(`[SpokeAgent] License invalid for ${this.config.spokeId}`);
      }
      if (response.signals.message) {
        console.info(`[SpokeAgent] Hub message: ${response.signals.message}`);
      }
    } catch (err) {
      console.error(`[SpokeAgent] Heartbeat failed:`, err);
    }
  }
}
```

Then modify `apps/spoke-runtime/src/boot.ts` to wire the agent:
- Add `SpokeAgent` and `HubClient` to imports
- Add `hubUrl?: string` and `spokeId` and `apiKey?: string` to `SpokeConfig`
- Create agent in boot if `config.hubUrl` is set
- Add `agent?: SpokeAgent` to `SpokeInstance`
- Stop agent in `close()`

**Step 4: Run test to verify it passes**

Run: `pnpm --filter spoke-runtime exec vitest run src/spoke-agent.test.ts`
Expected: PASS (2 tests)

**Step 5: Commit**

```bash
git add apps/spoke-runtime/src/spoke-agent.ts apps/spoke-runtime/src/hub-client.ts apps/spoke-runtime/src/spoke-agent.test.ts apps/spoke-runtime/src/boot.ts apps/spoke-runtime/src/config.ts
git commit -m "feat(spoke-runtime): add SpokeAgent with heartbeat sender and HubClient"
```

---

### Task 11: Hub HTTP Server

**Files:**
- Create: `apps/hub-control-plane/src/hub-server.ts`
- Modify: `apps/hub-control-plane/src/index.ts` — export all services
- Test: `apps/hub-control-plane/src/hub-server.test.ts`

**Context:** The Hub HTTP server mounts all services on Hono routes. It's the single entry point for Spoke agents (heartbeat, directory), the web portal (products, provisioning), and Stripe (webhooks). The existing `createRegistryAPI()` is preserved and mounted under `/packs`. New routes go under `/hub/api/v1/`.

The routes:
- `POST /hub/api/v1/heartbeat` — Fleet heartbeat processing
- `POST /hub/api/v1/provision` — Start provisioning pipeline
- `GET  /hub/api/v1/products` — List products
- `GET  /hub/api/v1/products/:id` — Get product details
- `POST /hub/api/v1/directory` — Register DID
- `GET  /hub/api/v1/directory/:did` — Lookup DID
- `POST /hub/api/v1/billing/webhook` — Stripe webhook
- `GET  /hub/api/v1/fleet/spokes` — List spokes
- `GET  /hub/health` — Health check

**Step 1: Write the failing test**

Create `apps/hub-control-plane/src/hub-server.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHubServer } from './hub-server.js';
import { HubDb } from './db/connection.js';
import { runHubMigrations } from './db/migrate.js';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { ProductManifest } from '@eurocomply/types';

describe('Hub HTTP Server', () => {
  let container: StartedPostgreSqlContainer;
  let db: HubDb;
  let app: ReturnType<typeof createHubServer>;

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

    app = createHubServer({ db });

    // Seed a product
    const manifest: ProductManifest = {
      product: { id: 'test-product', name: 'Test Product', version: '1.0.0' },
      os: { version: '^1.0.0' },
      packs: [{ name: '@test/pack', version: '^1.0.0', type: 'logic', required: true }],
      plans: [{ id: 'starter', max_products: 10, max_users: 5, packs: ['required_only'] }],
    };
    await app.request('/hub/api/v1/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(manifest),
    });
  }, 60_000);

  afterAll(async () => {
    await db.close();
    await container.stop();
  });

  it('should serve health endpoint', async () => {
    const res = await app.request('/hub/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
  });

  it('should list products', async () => {
    const res = await app.request('/hub/api/v1/products');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.total).toBeGreaterThanOrEqual(1);
  });

  it('should provision a spoke', async () => {
    // Create org first
    const orgRes = await app.request('/hub/api/v1/organizations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'HTTP Test Org', email: 'http@test.com' }),
    });
    expect(orgRes.status).toBe(201);
    const org = (await orgRes.json()) as any;

    // Provision
    const res = await app.request('/hub/api/v1/provision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        org_id: org.org_id,
        product_id: 'test-product',
        plan: 'starter',
        region: 'eu-west',
        admin_email: 'admin@test.com',
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.spoke_id).toBeDefined();
    expect(body.status).toBe('active');
  });

  it('should process heartbeat', async () => {
    // Get a spoke from fleet
    const spokesRes = await app.request('/hub/api/v1/fleet/spokes');
    const spokes = (await spokesRes.json()) as any;
    const spokeId = spokes.items[0].spoke_id;

    const res = await app.request('/hub/api/v1/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        spoke_id: spokeId,
        os_version: '2.0.0',
        status: 'healthy',
        uptime_seconds: 100,
        usage: { product_count: 5, user_count: 1, evaluation_count_24h: 10 },
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.acknowledged).toBe(true);
  });

  it('should register and lookup DID in directory', async () => {
    // Get spoke for FK
    const spokesRes = await app.request('/hub/api/v1/fleet/spokes');
    const spokes = (await spokesRes.json()) as any;
    const spokeId = spokes.items[0].spoke_id;

    // Register
    const regRes = await app.request('/hub/api/v1/directory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        did: 'did:web:test.eurocomply.app',
        spoke_id: spokeId,
        endpoint: 'https://test.eurocomply.app/mcp',
        capabilities: ['claims'],
      }),
    });
    expect(regRes.status).toBe(201);

    // Lookup
    const lookupRes = await app.request('/hub/api/v1/directory/did:web:test.eurocomply.app');
    expect(lookupRes.status).toBe(200);
    const entry = (await lookupRes.json()) as any;
    expect(entry.endpoint).toBe('https://test.eurocomply.app/mcp');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter hub-control-plane exec vitest run src/hub-server.test.ts`
Expected: FAIL — cannot import `createHubServer`

**Step 3: Write the implementation**

Create `apps/hub-control-plane/src/hub-server.ts`. This file creates the Hono app, instantiates all services, and mounts all routes. It takes `{ db, infra?, billingProvider? }` so tests can pass mocks. Use the mock InfrastructureProvider and MockBillingProvider as defaults when not provided (for testing).

The full implementation wires:
- `OrganizationService`
- `ProductCatalogService`
- `BillingService` (with provided or no-op provider)
- `ProvisioningOrchestrator` (with provided or no-op infra)
- `FleetService`
- `NetworkDirectoryService`

And mounts routes for each under `/hub/api/v1/`.

Also update `apps/hub-control-plane/src/index.ts` to export all services:

```typescript
export { createRegistryAPI } from './registry-api.js';
export { RegistryStore } from './registry-store.js';
export { createHubServer } from './hub-server.js';
export { HubDb } from './db/connection.js';
export { runHubMigrations } from './db/migrate.js';
export { OrganizationService } from './services/organization.js';
export { ProductCatalogService } from './services/product-catalog.js';
export { BillingService, type BillingProvider } from './services/billing.js';
export { ProvisioningOrchestrator, type InfrastructureProvider } from './services/provisioning.js';
export { FleetService } from './services/fleet.js';
export { NetworkDirectoryService } from './services/network-directory.js';
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter hub-control-plane exec vitest run src/hub-server.test.ts`
Expected: PASS (5 tests)

**Step 5: Commit**

```bash
git add apps/hub-control-plane/src/hub-server.ts apps/hub-control-plane/src/hub-server.test.ts apps/hub-control-plane/src/index.ts
git commit -m "feat(hub): add Hub HTTP server wiring all services into Hono routes"
```

---

### Task 12: E2E Integration Test

**Files:**
- Create: `apps/hub-control-plane/src/__tests__/e2e-provisioning.test.ts`

**Context:** This test proves the full Phase 5 workflow end-to-end: create org → register product → provision spoke → heartbeat → directory registration. It uses the Hub HTTP server with testcontainers PostgreSQL and mock infra/billing providers. It validates every step of the provisioning pipeline and confirms the Hub database state at each stage.

**Step 1: Write the test**

Create `apps/hub-control-plane/src/__tests__/e2e-provisioning.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHubServer } from '../hub-server.js';
import { HubDb } from '../db/connection.js';
import { runHubMigrations } from '../db/migrate.js';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { ProductManifest } from '@eurocomply/types';

describe('E2E: Phase 5 — Provisioning & Billing', () => {
  let container: StartedPostgreSqlContainer;
  let db: HubDb;
  let app: ReturnType<typeof createHubServer>;
  let orgId: string;
  let spokeId: string;

  const cosmeticsManifest: ProductManifest = {
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
    app = createHubServer({ db });
  }, 60_000);

  afterAll(async () => {
    await db.close();
    await container.stop();
  });

  it('Step 1: Register the cosmetics product', async () => {
    const res = await app.request('/hub/api/v1/products', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cosmeticsManifest),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.product_id).toBe('eurocomply-cosmetics');
  });

  it('Step 2: Customer signs up (create org)', async () => {
    const res = await app.request('/hub/api/v1/organizations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Acme Cosmetics GmbH', email: 'compliance@acme.de' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    orgId = body.org_id;
    expect(orgId).toBeDefined();
  });

  it('Step 3: Provision a spoke for the cosmetics product', async () => {
    const res = await app.request('/hub/api/v1/provision', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        org_id: orgId,
        product_id: 'eurocomply-cosmetics',
        plan: 'growth',
        region: 'eu-west',
        admin_email: 'compliance@acme.de',
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    spokeId = body.spoke_id;
    expect(spokeId).toBeDefined();
    expect(body.status).toBe('active');
    expect(body.hostname).toContain('.eurocomply.app');
  });

  it('Step 4: Verify provisioning events were recorded', async () => {
    const events = await db.query(
      `SELECT phase, status FROM provisioning_events WHERE spoke_id = $1 ORDER BY created_at`,
      [spokeId],
    );
    expect(events.rows).toHaveLength(5);
    expect(events.rows.map((e: any) => e.phase)).toEqual([
      'claim', 'provision', 'boot', 'install', 'handoff',
    ]);
  });

  it('Step 5: Verify subscription was created', async () => {
    const subs = await db.query(
      `SELECT * FROM subscriptions WHERE spoke_id = $1`,
      [spokeId],
    );
    expect(subs.rows).toHaveLength(1);
    expect(subs.rows[0].plan).toBe('growth');
    expect(subs.rows[0].status).toBe('active');
  });

  it('Step 6: Spoke sends heartbeat', async () => {
    const res = await app.request('/hub/api/v1/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        spoke_id: spokeId,
        os_version: '2.0.0',
        status: 'healthy',
        uptime_seconds: 120,
        usage: { product_count: 0, user_count: 1, evaluation_count_24h: 0 },
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.acknowledged).toBe(true);
    expect(body.license_valid).toBe(true);
  });

  it('Step 7: Spoke registers DID in directory', async () => {
    const res = await app.request('/hub/api/v1/directory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        did: `did:web:${spokeId}.eurocomply.app`,
        spoke_id: spokeId,
        endpoint: `https://${spokeId}.eurocomply.app/mcp`,
        capabilities: ['claims', 'evidence'],
      }),
    });
    expect(res.status).toBe(201);

    // Lookup the DID
    const lookupRes = await app.request(`/hub/api/v1/directory/did:web:${spokeId}.eurocomply.app`);
    expect(lookupRes.status).toBe(200);
    const entry = (await lookupRes.json()) as any;
    expect(entry.endpoint).toContain(spokeId);
    expect(entry.capabilities).toContain('claims');
  });

  it('Step 8: Fleet shows the spoke as healthy', async () => {
    const res = await app.request('/hub/api/v1/fleet/spokes');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    const spoke = body.items.find((s: any) => s.spoke_id === spokeId);
    expect(spoke).toBeDefined();
    expect(spoke.status).toBe('active');
    expect(spoke.os_version).toBe('2.0.0');
  });

  it('Step 9: Payment fails — spoke gets suspended', async () => {
    // Get stripe subscription ID
    const subs = await db.query(`SELECT stripe_subscription_id FROM subscriptions WHERE spoke_id = $1`, [spokeId]);
    const stripeSubId = subs.rows[0].stripe_subscription_id;

    const res = await app.request('/hub/api/v1/billing/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'payment_failed', subscription_id: stripeSubId }),
    });
    expect(res.status).toBe(200);

    // Spoke should be suspended
    const spokeResult = await db.query(`SELECT status FROM spokes WHERE spoke_id = $1`, [spokeId]);
    expect(spokeResult.rows[0].status).toBe('suspended');

    // Heartbeat should report license_valid = false
    const hbRes = await app.request('/hub/api/v1/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        spoke_id: spokeId,
        os_version: '2.0.0',
        status: 'healthy',
        uptime_seconds: 300,
        usage: { product_count: 0, user_count: 1, evaluation_count_24h: 0 },
      }),
    });
    const hbBody = (await hbRes.json()) as any;
    expect(hbBody.license_valid).toBe(false);
  });

  it('Step 10: Payment succeeds — spoke reactivated', async () => {
    const subs = await db.query(`SELECT stripe_subscription_id FROM subscriptions WHERE spoke_id = $1`, [spokeId]);
    const stripeSubId = subs.rows[0].stripe_subscription_id;

    await app.request('/hub/api/v1/billing/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'payment_succeeded', subscription_id: stripeSubId }),
    });

    const spokeResult = await db.query(`SELECT status FROM spokes WHERE spoke_id = $1`, [spokeId]);
    expect(spokeResult.rows[0].status).toBe('active');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter hub-control-plane exec vitest run src/__tests__/e2e-provisioning.test.ts`
Expected: FAIL (if earlier tasks not yet done) or PASS (if all wired correctly)

**Step 3: Fix any integration issues**

At this point all services are implemented. The E2E test may surface integration issues between services that weren't caught in unit tests. Fix them one by one.

**Step 4: Run the full test suite**

Run: `pnpm --filter hub-control-plane test`
Expected: ALL PASS

Run: `pnpm build && pnpm test`
Expected: ALL PASS (except pre-existing web-portal/network-protocol "no test files" failures)

**Step 5: Commit**

```bash
git add apps/hub-control-plane/src/__tests__/e2e-provisioning.test.ts
git commit -m "test(hub): add E2E test for full provisioning + billing + heartbeat + directory flow"
```

---

## Verification

After all 12 tasks:

1. **Build:** `pnpm build` — all 9 packages compile
2. **Tests:** `pnpm --filter hub-control-plane test` — all Hub tests pass (DB, org, product, billing, provisioning, fleet, directory, HTTP server, E2E)
3. **Tests:** `pnpm --filter spoke-runtime test` — all Spoke tests pass (including new spoke-agent test)
4. **Tests:** `pnpm --filter network-protocol test` — DID utility tests pass
5. **Tests:** `pnpm --filter types test` — Hub type tests pass
6. **Full suite:** `pnpm test` — all packages pass

## What This Proves

The E2E test validates the Phase 5 success criteria:
- Customer signs up (create org) ✅
- Selects product and plan ✅
- Payment processed (billing subscription) ✅
- Spoke provisioned through 5-phase pipeline ✅
- Spoke heartbeats to Hub ✅
- DID registered in Network Directory ✅
- Payment failure → spoke suspended → payment success → spoke reactivated ✅

## What's Deferred to Phase 5b

- Web portal UI (marketing, onboarding, dashboard)
- Telemetry collection
- OS update rollout
- Real Stripe SDK integration (currently mocked)
- Real K8s/Helm integration (currently mocked)
- Helm charts and Terraform modules
- Decommissioning pipeline
- Spoke credential rotation
