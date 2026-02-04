# Phase 2: Platform Services Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the stateful half of the EuroComply Kernel -- entity CRUD, graph operations, file storage, job queue, AI gateway, audit logging, the execution loop, and an MCP server scaffold.

**Architecture:** Platform Services wraps PostgreSQL, Neo4j, and object storage behind a service contract. Each service implements `PlatformService<TInput, TOutput>` with `ServiceContext` for tenant isolation. The execution loop assembles `ExecutionContext` from stored data, invokes the kernel-vm, and persists results + audit entries.

**Tech Stack:** TypeScript, PostgreSQL (via `pg`), Neo4j (via `neo4j-driver`), Hono (MCP HTTP server), Zod v4 (validation), Vitest (testing), Testcontainers (integration tests with real databases)

---

## Prerequisites

- Phase 1 (kernel-vm) is complete: types package has Zod schemas for ExecutionContext, HandlerResult, ValidationResult, ASTNode; kernel-vm has evaluator, validator, registry, simulator, and 14 handlers.
- `packages/platform-services` exists as an empty scaffold with workspace deps on `@eurocomply/kernel-vm` and `@eurocomply/types`.

## Dependency Installation

Before starting any task, install required dependencies:

```bash
cd /root/Documents/eurocomply-os
pnpm --filter @eurocomply/platform-services add pg neo4j-driver @hono/node-server hono uuid @modelcontextprotocol/sdk
pnpm --filter @eurocomply/platform-services add -D @types/pg @types/uuid testcontainers @testcontainers/postgresql vitest
pnpm --filter @eurocomply/types add zod
```

## Zod v4 Reminder

The types package uses **Zod v4** (not v3). Key difference: `z.record()` requires two arguments: `z.record(z.string(), z.unknown())`.

---

### Task 1: Platform Service Type Definitions

Add platform-services-specific types to the `@eurocomply/types` package. These types define the service contract that all platform services implement.

**Files:**
- Create: `packages/types/src/platform-service.ts`
- Modify: `packages/types/src/index.ts`

**Step 1: Write the type definitions**

Create `packages/types/src/platform-service.ts` with these Zod schemas and TypeScript types:

```typescript
import { z } from 'zod';

// --- Principal (who is calling) ---

export const PrincipalSchema = z.object({
  type: z.enum(['user', 'group', 'agent', 'system', 'handler_effect']),
  id: z.string(),
});
export type Principal = z.infer<typeof PrincipalSchema>;

// --- Service Context (passed to every service call) ---

export interface ServiceContext {
  tenant_id: string;
  principal: Principal;
  correlation_id: string;
}

// --- Audit Entry ---

export const AuditEntrySchema = z.object({
  audit_entry_id: z.string(),
  correlation_id: z.string(),
  tenant_id: z.string(),
  actor: PrincipalSchema,
  action: z.string(),
  resource: z.object({
    entity_type: z.string(),
    entity_id: z.string(),
  }),
  timestamp: z.string(),
  changes: z.object({
    before: z.record(z.string(), z.unknown()).optional(),
    after: z.record(z.string(), z.unknown()).optional(),
    fields_changed: z.array(z.string()),
  }).optional(),
  success: z.boolean(),
  error: z.string().optional(),
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

// --- Service Result ---

export interface ServiceResult<T> {
  success: boolean;
  data: T;
  audit_entry?: AuditEntry;
  events_emitted?: string[];
}

// --- Filter Expression (for entity:list, search, etc.) ---

export type FilterExpression = {
  and?: FilterExpression[];
  or?: FilterExpression[];
  not?: FilterExpression;
  field?: string;
  operator?: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' |
             'in' | 'not_in' | 'contains' | 'starts_with' |
             'is_null' | 'is_not_null';
  value?: unknown;
};

export const FilterExpressionSchema: z.ZodType<FilterExpression> = z.lazy(() =>
  z.object({
    and: z.array(FilterExpressionSchema).optional(),
    or: z.array(FilterExpressionSchema).optional(),
    not: FilterExpressionSchema.optional(),
    field: z.string().optional(),
    operator: z.enum([
      'eq', 'ne', 'gt', 'gte', 'lt', 'lte',
      'in', 'not_in', 'contains', 'starts_with',
      'is_null', 'is_not_null',
    ]).optional(),
    value: z.unknown().optional(),
  })
);

// --- Platform Service Interface ---

export interface PlatformService<TInput, TOutput> {
  readonly id: string;
  readonly category: string;

  execute(
    input: TInput,
    context: ServiceContext,
  ): Promise<ServiceResult<TOutput>>;
}
```

**Step 2: Export from index**

Add to `packages/types/src/index.ts`:

```typescript
export {
  PrincipalSchema,
  AuditEntrySchema,
  FilterExpressionSchema,
} from './platform-service.js';

export type {
  Principal,
  ServiceContext,
  AuditEntry,
  ServiceResult,
  FilterExpression,
  PlatformService,
} from './platform-service.js';
```

**Step 3: Verify it compiles**

Run: `pnpm --filter @eurocomply/types run build`
Expected: Clean compilation, no errors.

**Step 4: Commit**

```bash
git add packages/types/src/platform-service.ts packages/types/src/index.ts
git commit -m "feat(types): add platform service type definitions

Adds Principal, ServiceContext, AuditEntry, ServiceResult,
FilterExpression, and PlatformService interface."
```

---

### Task 2: Database Connection Layer

Create the database connection management layer. Platform Services needs PostgreSQL and Neo4j connections with per-tenant isolation.

**Files:**
- Create: `packages/platform-services/src/db/postgres.ts`
- Create: `packages/platform-services/src/db/neo4j.ts`
- Create: `packages/platform-services/src/db/index.ts`
- Create: `packages/platform-services/src/db/__tests__/postgres.test.ts`

**Step 1: Write the failing test for PostgreSQL connection**

Create `packages/platform-services/src/db/__tests__/postgres.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgresConnectionManager } from '../postgres.js';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

describe('PostgresConnectionManager', () => {
  let container: StartedPostgreSqlContainer;
  let manager: PostgresConnectionManager;

  beforeAll(async () => {
    container = await new PostgreSqlContainer().start();
    manager = new PostgresConnectionManager({
      host: container.getHost(),
      port: container.getMappedPort(5432),
      database: container.getDatabase(),
      user: container.getUsername(),
      password: container.getPassword(),
    });
  }, 60_000);

  afterAll(async () => {
    await manager.close();
    await container.stop();
  });

  it('should execute a query', async () => {
    const result = await manager.query('SELECT 1 as value');
    expect(result.rows[0].value).toBe(1);
  });

  it('should run within a transaction', async () => {
    await manager.query('CREATE TABLE test_tx (id serial PRIMARY KEY, name text)');

    await manager.transaction(async (client) => {
      await client.query("INSERT INTO test_tx (name) VALUES ('alice')");
      await client.query("INSERT INTO test_tx (name) VALUES ('bob')");
    });

    const result = await manager.query('SELECT count(*)::int as cnt FROM test_tx');
    expect(result.rows[0].cnt).toBe(2);
  });

  it('should rollback on transaction error', async () => {
    await manager.query('CREATE TABLE test_rollback (id serial PRIMARY KEY, val int UNIQUE)');
    await manager.query('INSERT INTO test_rollback (val) VALUES (1)');

    await expect(
      manager.transaction(async (client) => {
        await client.query('INSERT INTO test_rollback (val) VALUES (2)');
        await client.query('INSERT INTO test_rollback (val) VALUES (1)'); // duplicate, will fail
      })
    ).rejects.toThrow();

    const result = await manager.query('SELECT count(*)::int as cnt FROM test_rollback');
    expect(result.rows[0].cnt).toBe(1); // rolled back
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @eurocomply/platform-services run test -- src/db/__tests__/postgres.test.ts`
Expected: FAIL -- module not found

**Step 3: Implement PostgresConnectionManager**

Create `packages/platform-services/src/db/postgres.ts`:

```typescript
import pg from 'pg';

const { Pool, type PoolConfig } = pg;
type PoolClient = pg.PoolClient;
type QueryResult = pg.QueryResult;

export interface PostgresConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  max?: number;
}

export class PostgresConnectionManager {
  private pool: pg.Pool;

  constructor(config: PostgresConfig) {
    this.pool = new Pool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      max: config.max ?? 10,
    });
  }

  async query(text: string, params?: unknown[]): Promise<QueryResult> {
    return this.pool.query(text, params);
  }

  async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
```

**Step 4: Implement Neo4jConnectionManager**

Create `packages/platform-services/src/db/neo4j.ts`:

```typescript
import neo4j, { type Driver, type Session, type Result } from 'neo4j-driver';

export interface Neo4jConfig {
  uri: string;
  username: string;
  password: string;
}

export class Neo4jConnectionManager {
  private driver: Driver;

  constructor(config: Neo4jConfig) {
    this.driver = neo4j.driver(
      config.uri,
      neo4j.auth.basic(config.username, config.password),
    );
  }

  session(): Session {
    return this.driver.session();
  }

  async run(cypher: string, params?: Record<string, unknown>): Promise<Result> {
    const session = this.session();
    try {
      return await session.run(cypher, params);
    } finally {
      await session.close();
    }
  }

  async close(): Promise<void> {
    await this.driver.close();
  }
}
```

**Step 5: Create barrel export**

Create `packages/platform-services/src/db/index.ts`:

```typescript
export { PostgresConnectionManager, type PostgresConfig } from './postgres.js';
export { Neo4jConnectionManager, type Neo4jConfig } from './neo4j.js';
```

**Step 6: Run tests**

Run: `pnpm --filter @eurocomply/platform-services run test -- src/db/__tests__/postgres.test.ts`
Expected: PASS (3 tests)

**Step 7: Commit**

```bash
git add packages/platform-services/src/db/
git commit -m "feat(platform-services): add database connection layer

PostgresConnectionManager with connection pooling and transactions.
Neo4jConnectionManager with session management.
Integration tests with Testcontainers."
```

---

### Task 3: Database Schema Migrations

Create the PostgreSQL schema that platform services operate on. This is the minimum set needed for entity CRUD, audit logging, jobs, and file metadata.

**Files:**
- Create: `packages/platform-services/src/db/migrations/001-initial-schema.sql`
- Create: `packages/platform-services/src/db/migrate.ts`
- Create: `packages/platform-services/src/db/__tests__/migrate.test.ts`

**Step 1: Write the SQL migration**

Create `packages/platform-services/src/db/migrations/001-initial-schema.sql`:

```sql
-- Entity type definitions
CREATE TABLE entity_types (
  entity_type TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  schema JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Entity instances
CREATE TABLE entities (
  entity_id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL REFERENCES entity_types(entity_type),
  tenant_id TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}',
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_entities_type ON entities(entity_type);
CREATE INDEX idx_entities_tenant ON entities(tenant_id);

-- Entity version history
CREATE TABLE entity_versions (
  version_id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL REFERENCES entities(entity_id) ON DELETE CASCADE,
  version INT NOT NULL,
  data JSONB NOT NULL,
  changed_by TEXT NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(entity_id, version)
);

-- File metadata
CREATE TABLE files (
  file_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  storage_key TEXT NOT NULL,
  entity_id TEXT REFERENCES entities(entity_id) ON DELETE SET NULL,
  entity_type TEXT,
  uploaded_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_files_entity ON files(entity_id);

-- Audit log (append-only)
CREATE TABLE audit_log (
  audit_entry_id TEXT PRIMARY KEY,
  correlation_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_entity_type TEXT NOT NULL,
  resource_entity_id TEXT NOT NULL,
  changes JSONB,
  success BOOLEAN NOT NULL DEFAULT true,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_log_tenant ON audit_log(tenant_id);
CREATE INDEX idx_audit_log_resource ON audit_log(resource_entity_type, resource_entity_id);
CREATE INDEX idx_audit_log_created ON audit_log(created_at);

-- Jobs (background processing)
CREATE TABLE jobs (
  job_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  job_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  result JSONB,
  error TEXT,
  submitted_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_tenant ON jobs(tenant_id);

-- Relation type definitions (cardinality, constraints)
CREATE TABLE relation_types (
  relation_type TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  from_entity_type TEXT NOT NULL REFERENCES entity_types(entity_type),
  to_entity_type TEXT NOT NULL REFERENCES entity_types(entity_type),
  cardinality TEXT NOT NULL DEFAULT 'n:n'
    CHECK (cardinality IN ('1:1', '1:n', 'n:1', 'n:n')),
  constraints JSONB NOT NULL DEFAULT '{}',
  inverse_type TEXT,
  cascade_delete BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_relation_types_tenant ON relation_types(tenant_id);

-- Migration tracking
CREATE TABLE schema_migrations (
  version INT PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Step 2: Write the migration runner**

Create `packages/platform-services/src/db/migrate.ts`:

```typescript
import fs from 'node:fs';
import path from 'node:path';
import type { PostgresConnectionManager } from './postgres.js';

export async function runMigrations(db: PostgresConnectionManager): Promise<number> {
  // Ensure migration tracking table exists
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INT PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // Get already applied migrations
  const applied = await db.query('SELECT version FROM schema_migrations ORDER BY version');
  const appliedVersions = new Set(applied.rows.map((r: { version: number }) => r.version));

  // Read migration files
  const migrationsDir = path.join(import.meta.dirname, 'migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  let count = 0;
  for (const file of files) {
    const match = file.match(/^(\d+)-/);
    if (!match) continue;
    const version = parseInt(match[1], 10);

    if (appliedVersions.has(version)) continue;

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');

    await db.transaction(async (client) => {
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (version, name) VALUES ($1, $2)',
        [version, file]
      );
    });

    count++;
  }

  return count;
}
```

**Step 3: Write integration test**

Create `packages/platform-services/src/db/__tests__/migrate.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgresConnectionManager } from '../postgres.js';
import { runMigrations } from '../migrate.js';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

describe('runMigrations', () => {
  let container: StartedPostgreSqlContainer;
  let db: PostgresConnectionManager;

  beforeAll(async () => {
    container = await new PostgreSqlContainer().start();
    db = new PostgresConnectionManager({
      host: container.getHost(),
      port: container.getMappedPort(5432),
      database: container.getDatabase(),
      user: container.getUsername(),
      password: container.getPassword(),
    });
  }, 60_000);

  afterAll(async () => {
    await db.close();
    await container.stop();
  });

  it('should apply migrations and create tables', async () => {
    const count = await runMigrations(db);
    expect(count).toBeGreaterThan(0);

    // Verify tables exist
    const tables = await db.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    const tableNames = tables.rows.map((r: { table_name: string }) => r.table_name);
    expect(tableNames).toContain('entities');
    expect(tableNames).toContain('entity_types');
    expect(tableNames).toContain('entity_versions');
    expect(tableNames).toContain('files');
    expect(tableNames).toContain('audit_log');
    expect(tableNames).toContain('jobs');
    expect(tableNames).toContain('relation_types');
  });

  it('should be idempotent', async () => {
    const count = await runMigrations(db);
    expect(count).toBe(0); // already applied
  });
});
```

**Step 4: Run tests**

Run: `pnpm --filter @eurocomply/platform-services run test -- src/db/__tests__/migrate.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/platform-services/src/db/migrations/ packages/platform-services/src/db/migrate.ts packages/platform-services/src/db/__tests__/migrate.test.ts
git commit -m "feat(platform-services): add database schema and migration runner

Initial schema: entity_types, entities, entity_versions, files,
audit_log, jobs, relation_types, schema_migrations. Idempotent migration runner."
```

---

### Task 4: Audit Logger

Implement the audit logging service. Every Platform Service mutation generates an immutable audit entry. This is a prerequisite for all other services.

**Files:**
- Create: `packages/platform-services/src/services/audit.ts`
- Create: `packages/platform-services/src/services/__tests__/audit.test.ts`

**Step 1: Write the failing test**

Create `packages/platform-services/src/services/__tests__/audit.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { AuditLogger } from '../audit.js';
import { PostgresConnectionManager } from '../../db/postgres.js';
import { runMigrations } from '../../db/migrate.js';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { ServiceContext } from '@eurocomply/types';

describe('AuditLogger', () => {
  let container: StartedPostgreSqlContainer;
  let db: PostgresConnectionManager;
  let audit: AuditLogger;

  const ctx: ServiceContext = {
    tenant_id: 'tenant_1',
    principal: { type: 'user', id: 'user_1' },
    correlation_id: 'corr_1',
  };

  beforeAll(async () => {
    container = await new PostgreSqlContainer().start();
    db = new PostgresConnectionManager({
      host: container.getHost(),
      port: container.getMappedPort(5432),
      database: container.getDatabase(),
      user: container.getUsername(),
      password: container.getPassword(),
    });
    await runMigrations(db);
    audit = new AuditLogger(db);
  }, 60_000);

  afterAll(async () => {
    await db.close();
    await container.stop();
  });

  it('should log an audit entry', async () => {
    const entry = await audit.log(ctx, {
      action: 'create',
      resource: { entity_type: 'product', entity_id: 'prod_1' },
      success: true,
    });

    expect(entry.audit_entry_id).toBeDefined();
    expect(entry.action).toBe('create');
    expect(entry.tenant_id).toBe('tenant_1');
    expect(entry.actor_type).toBe('user');
    expect(entry.actor_id).toBe('user_1');
  });

  it('should log changes', async () => {
    const entry = await audit.log(ctx, {
      action: 'update',
      resource: { entity_type: 'product', entity_id: 'prod_1' },
      changes: {
        fields_changed: ['name'],
        before: { name: 'Old' },
        after: { name: 'New' },
      },
      success: true,
    });

    expect(entry.changes).toBeDefined();
    expect(entry.changes!.fields_changed).toEqual(['name']);
  });

  it('should query audit entries', async () => {
    const entries = await audit.query(ctx.tenant_id, {
      resource_entity_type: 'product',
      resource_entity_id: 'prod_1',
    });

    expect(entries.length).toBeGreaterThanOrEqual(2);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @eurocomply/platform-services run test -- src/services/__tests__/audit.test.ts`
Expected: FAIL

**Step 3: Implement AuditLogger**

Create `packages/platform-services/src/services/audit.ts`:

```typescript
import { v4 as uuid } from 'uuid';
import type { PostgresConnectionManager } from '../db/postgres.js';
import type { ServiceContext, AuditEntry } from '@eurocomply/types';

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

  async log(ctx: ServiceContext, input: AuditLogInput): Promise<AuditRow> {
    const id = uuid();
    const result = await this.db.query(
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
```

**Step 4: Run tests**

Run: `pnpm --filter @eurocomply/platform-services run test -- src/services/__tests__/audit.test.ts`
Expected: PASS (3 tests)

**Step 5: Commit**

```bash
git add packages/platform-services/src/services/audit.ts packages/platform-services/src/services/__tests__/audit.test.ts
git commit -m "feat(platform-services): add audit logger

Append-only audit log with query filtering. Every mutation
generates an immutable AuditEntry."
```

---

### Task 5: Entity Service (entity:create, entity:get, entity:list, entity:update)

Implement the core entity CRUD operations. This is the filesystem of the Compliance OS.

**Files:**
- Create: `packages/platform-services/src/services/entity.ts`
- Create: `packages/platform-services/src/services/__tests__/entity.test.ts`

**Step 1: Write the failing tests**

Create `packages/platform-services/src/services/__tests__/entity.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { EntityService } from '../entity.js';
import { AuditLogger } from '../audit.js';
import { PostgresConnectionManager } from '../../db/postgres.js';
import { runMigrations } from '../../db/migrate.js';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { ServiceContext } from '@eurocomply/types';

describe('EntityService', () => {
  let container: StartedPostgreSqlContainer;
  let db: PostgresConnectionManager;
  let audit: AuditLogger;
  let entities: EntityService;

  const ctx: ServiceContext = {
    tenant_id: 'tenant_1',
    principal: { type: 'user', id: 'user_1' },
    correlation_id: 'corr_1',
  };

  beforeAll(async () => {
    container = await new PostgreSqlContainer().start();
    db = new PostgresConnectionManager({
      host: container.getHost(),
      port: container.getMappedPort(5432),
      database: container.getDatabase(),
      user: container.getUsername(),
      password: container.getPassword(),
    });
    await runMigrations(db);
    audit = new AuditLogger(db);
    entities = new EntityService(db, audit);
  }, 60_000);

  afterAll(async () => {
    await db.close();
    await container.stop();
  });

  it('should define an entity type', async () => {
    const result = await entities.defineType(ctx, {
      entity_type: 'product',
      schema: {
        fields: [
          { name: 'name', type: 'string', required: true },
          { name: 'concentration', type: 'number' },
          { name: 'status', type: 'string' },
        ],
      },
    });

    expect(result.success).toBe(true);
  });

  it('should create an entity', async () => {
    const result = await entities.create(ctx, {
      entity_type: 'product',
      data: { name: 'Hand Cream', concentration: 0.05, status: 'draft' },
    });

    expect(result.success).toBe(true);
    expect(result.data.entity_id).toBeDefined();
    expect(result.data.entity_type).toBe('product');
    expect(result.data.version).toBe(1);
    expect(result.audit_entry).toBeDefined();
  });

  it('should get an entity', async () => {
    const created = await entities.create(ctx, {
      entity_type: 'product',
      data: { name: 'Shampoo', concentration: 0.02 },
    });

    const result = await entities.get(ctx, {
      entity_type: 'product',
      entity_id: created.data.entity_id,
    });

    expect(result.success).toBe(true);
    expect(result.data.data.name).toBe('Shampoo');
  });

  it('should update an entity', async () => {
    const created = await entities.create(ctx, {
      entity_type: 'product',
      data: { name: 'Body Lotion', concentration: 0.01 },
    });

    const result = await entities.update(ctx, {
      entity_type: 'product',
      entity_id: created.data.entity_id,
      data: { name: 'Body Lotion Pro', concentration: 0.005 },
    });

    expect(result.success).toBe(true);
    expect(result.data.version).toBe(2);
    expect(result.audit_entry).toBeDefined();
    expect(result.audit_entry!.changes).toBeDefined();
  });

  it('should list entities with filters', async () => {
    const result = await entities.list(ctx, {
      entity_type: 'product',
    });

    expect(result.success).toBe(true);
    expect(result.data.items.length).toBeGreaterThanOrEqual(3);
    expect(result.data.total).toBeGreaterThanOrEqual(3);
  });

  it('should store version history on update', async () => {
    const created = await entities.create(ctx, {
      entity_type: 'product',
      data: { name: 'Gel', concentration: 0.1 },
    });

    await entities.update(ctx, {
      entity_type: 'product',
      entity_id: created.data.entity_id,
      data: { concentration: 0.05 },
    });

    // Check version history exists
    const versions = await db.query(
      'SELECT * FROM entity_versions WHERE entity_id = $1 ORDER BY version',
      [created.data.entity_id]
    );
    expect(versions.rows.length).toBe(1); // version 1 snapshot stored on update
  });

  it('should list entities with FilterExpression', async () => {
    const result = await entities.list(ctx, {
      entity_type: 'product',
      filter: {
        field: 'status',
        operator: 'eq',
        value: 'draft',
      },
    });

    expect(result.success).toBe(true);
    for (const item of result.data.items) {
      expect(item.data.status).toBe('draft');
    }
  });

  it('should list entities with compound filter (AND)', async () => {
    const result = await entities.list(ctx, {
      entity_type: 'product',
      filter: {
        and: [
          { field: 'status', operator: 'eq', value: 'draft' },
          { field: 'concentration', operator: 'lt', value: 0.03 },
        ],
      },
    });

    expect(result.success).toBe(true);
    for (const item of result.data.items) {
      expect(item.data.status).toBe('draft');
      expect(Number(item.data.concentration)).toBeLessThan(0.03);
    }
  });

  it('should fail to create entity with unknown type', async () => {
    const result = await entities.create(ctx, {
      entity_type: 'nonexistent',
      data: { name: 'Test' },
    });

    expect(result.success).toBe(false);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @eurocomply/platform-services run test -- src/services/__tests__/entity.test.ts`
Expected: FAIL

**Step 3: Implement EntityService**

Create `packages/platform-services/src/services/entity.ts`:

```typescript
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
    const jsonPath = `data->>'${filter.field.replace(/'/g, "''")}'`;
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
      audit_entry: auditEntry,
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
        audit_entry: auditEntry,
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
```

**Step 4: Run tests**

Run: `pnpm --filter @eurocomply/platform-services run test -- src/services/__tests__/entity.test.ts`
Expected: PASS (9 tests)

**Step 5: Commit**

```bash
git add packages/platform-services/src/services/entity.ts packages/platform-services/src/services/__tests__/entity.test.ts
git commit -m "feat(platform-services): add entity service with CRUD + FilterExpression

entity:define, entity:create, entity:get, entity:update, entity:list.
entity:list supports FilterExpression→SQL translation (AND/OR/NOT,
field comparisons). Version history on updates. Audit logging on mutations."
```

---

### Task 6: Relation Service (relation:define, relation:create, relation:list)

Implement graph operations using Neo4j for managing relationships between entities. Relation types must be defined (with cardinality and constraints) before relations can be created.

**Files:**
- Create: `packages/platform-services/src/services/relation.ts`
- Create: `packages/platform-services/src/services/__tests__/relation.test.ts`

**Step 1: Write the failing tests**

Create `packages/platform-services/src/services/__tests__/relation.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { RelationService } from '../relation.js';
import { AuditLogger } from '../audit.js';
import { PostgresConnectionManager } from '../../db/postgres.js';
import { Neo4jConnectionManager } from '../../db/neo4j.js';
import { runMigrations } from '../../db/migrate.js';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import type { ServiceContext } from '@eurocomply/types';

describe('RelationService', () => {
  let pgContainer: StartedPostgreSqlContainer;
  let neo4jContainer: StartedTestContainer;
  let db: PostgresConnectionManager;
  let neo4j: Neo4jConnectionManager;
  let audit: AuditLogger;
  let relations: RelationService;

  const ctx: ServiceContext = {
    tenant_id: 'tenant_1',
    principal: { type: 'user', id: 'user_1' },
    correlation_id: 'corr_1',
  };

  beforeAll(async () => {
    pgContainer = await new PostgreSqlContainer().start();
    db = new PostgresConnectionManager({
      host: pgContainer.getHost(),
      port: pgContainer.getMappedPort(5432),
      database: pgContainer.getDatabase(),
      user: pgContainer.getUsername(),
      password: pgContainer.getPassword(),
    });
    await runMigrations(db);

    neo4jContainer = await new GenericContainer('neo4j:5')
      .withEnvironment({ NEO4J_AUTH: 'neo4j/testpassword' })
      .withExposedPorts(7687)
      .start();

    neo4j = new Neo4jConnectionManager({
      uri: `bolt://${neo4jContainer.getHost()}:${neo4jContainer.getMappedPort(7687)}`,
      username: 'neo4j',
      password: 'testpassword',
    });

    audit = new AuditLogger(db);
    relations = new RelationService(db, neo4j, audit);
  }, 120_000);

  afterAll(async () => {
    await neo4j.close();
    await db.close();
    await neo4jContainer.stop();
    await pgContainer.stop();
  });

  it('should define a relation type with cardinality', async () => {
    const result = await relations.defineType(ctx, {
      relation_type: 'CONTAINS',
      from_entity_type: 'product',
      to_entity_type: 'material',
      cardinality: 'n:n',
      constraints: { unique: true },
    });

    expect(result.success).toBe(true);
    expect(result.data.relation_type).toBe('CONTAINS');
    expect(result.data.cardinality).toBe('n:n');
  });

  it('should create a relation between entities', async () => {
    const result = await relations.create(ctx, {
      from_entity: { entity_type: 'product', entity_id: 'prod_1' },
      to_entity: { entity_type: 'material', entity_id: 'mat_1' },
      relation_type: 'CONTAINS',
      properties: { concentration: 0.05 },
    });

    expect(result.success).toBe(true);
    expect(result.data.relation_type).toBe('CONTAINS');
  });

  it('should enforce 1:1 cardinality', async () => {
    // Define a 1:1 relation type
    await relations.defineType(ctx, {
      relation_type: 'PRIMARY_SUPPLIER',
      from_entity_type: 'product',
      to_entity_type: 'material',
      cardinality: '1:1',
    });

    // First relation should succeed
    const first = await relations.create(ctx, {
      from_entity: { entity_type: 'product', entity_id: 'prod_card' },
      to_entity: { entity_type: 'material', entity_id: 'mat_card_1' },
      relation_type: 'PRIMARY_SUPPLIER',
    });
    expect(first.success).toBe(true);

    // Second relation from same source should fail (1:1)
    const second = await relations.create(ctx, {
      from_entity: { entity_type: 'product', entity_id: 'prod_card' },
      to_entity: { entity_type: 'material', entity_id: 'mat_card_2' },
      relation_type: 'PRIMARY_SUPPLIER',
    });
    expect(second.success).toBe(false);
  });

  it('should list relations for an entity', async () => {
    // Add another relation
    await relations.create(ctx, {
      from_entity: { entity_type: 'product', entity_id: 'prod_1' },
      to_entity: { entity_type: 'material', entity_id: 'mat_2' },
      relation_type: 'CONTAINS',
      properties: { concentration: 0.02 },
    });

    const result = await relations.list(ctx, {
      entity_type: 'product',
      entity_id: 'prod_1',
      direction: 'outgoing',
    });

    expect(result.success).toBe(true);
    expect(result.data.items.length).toBe(2);
  });

  it('should list incoming relations', async () => {
    const result = await relations.list(ctx, {
      entity_type: 'material',
      entity_id: 'mat_1',
      direction: 'incoming',
    });

    expect(result.success).toBe(true);
    expect(result.data.items.length).toBe(1);
    expect(result.data.items[0].relation_type).toBe('CONTAINS');
  });

  it('should reject relation with undefined type', async () => {
    const result = await relations.create(ctx, {
      from_entity: { entity_type: 'product', entity_id: 'prod_1' },
      to_entity: { entity_type: 'material', entity_id: 'mat_1' },
      relation_type: 'UNDEFINED_TYPE',
    });

    expect(result.success).toBe(false);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @eurocomply/platform-services run test -- src/services/__tests__/relation.test.ts`
Expected: FAIL

**Step 3: Implement RelationService**

Create `packages/platform-services/src/services/relation.ts`:

```typescript
import type { PostgresConnectionManager } from '../db/postgres.js';
import type { Neo4jConnectionManager } from '../db/neo4j.js';
import type { AuditLogger } from './audit.js';
import type { ServiceContext, ServiceResult } from '@eurocomply/types';

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
    ctx: ServiceContext,
    input: RelationTypeDefinition,
  ): Promise<ServiceResult<RelationTypeOutput>> {
    await this.db.query(
      `INSERT INTO relation_types (relation_type, tenant_id, from_entity_type, to_entity_type, cardinality, constraints, inverse_type, cascade_delete)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (relation_type) DO UPDATE SET
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
    ctx: ServiceContext,
    input: RelationCreateInput,
  ): Promise<ServiceResult<RelationCreateOutput>> {
    // Verify relation type is defined
    const typeCheck = await this.db.query(
      'SELECT * FROM relation_types WHERE relation_type = $1',
      [input.relation_type]
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
       CREATE (a)-[r:${sanitizeRelationType(input.relation_type)} $props]->(b)
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
    ctx: ServiceContext,
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
```

**Step 4: Run tests**

Run: `pnpm --filter @eurocomply/platform-services run test -- src/services/__tests__/relation.test.ts`
Expected: PASS (7 tests)

**Step 5: Commit**

```bash
git add packages/platform-services/src/services/relation.ts packages/platform-services/src/services/__tests__/relation.test.ts
git commit -m "feat(platform-services): add relation service with type definitions

relation:define with cardinality (1:1, 1:n, n:1, n:n) and constraints.
relation:create enforces cardinality. relation:list with directional queries.
Relation types stored in PostgreSQL, edges in Neo4j."
```

---

### Task 7: File Service (file:upload, file:get)

Implement file storage using a local filesystem adapter (swappable to R2/S3 later). Stores metadata in PostgreSQL, content on disk.

**Files:**
- Create: `packages/platform-services/src/services/file.ts`
- Create: `packages/platform-services/src/services/__tests__/file.test.ts`

**Step 1: Write the failing tests**

Create `packages/platform-services/src/services/__tests__/file.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FileService, type StorageBackend } from '../file.js';
import { AuditLogger } from '../audit.js';
import { PostgresConnectionManager } from '../../db/postgres.js';
import { runMigrations } from '../../db/migrate.js';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { ServiceContext } from '@eurocomply/types';

// In-memory storage backend for tests
class MemoryStorageBackend implements StorageBackend {
  private store = new Map<string, Buffer>();

  async put(key: string, data: Buffer): Promise<void> {
    this.store.set(key, data);
  }

  async get(key: string): Promise<Buffer | null> {
    return this.store.get(key) ?? null;
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

describe('FileService', () => {
  let container: StartedPostgreSqlContainer;
  let db: PostgresConnectionManager;
  let audit: AuditLogger;
  let files: FileService;

  const ctx: ServiceContext = {
    tenant_id: 'tenant_1',
    principal: { type: 'user', id: 'user_1' },
    correlation_id: 'corr_1',
  };

  beforeAll(async () => {
    container = await new PostgreSqlContainer().start();
    db = new PostgresConnectionManager({
      host: container.getHost(),
      port: container.getMappedPort(5432),
      database: container.getDatabase(),
      user: container.getUsername(),
      password: container.getPassword(),
    });
    await runMigrations(db);
    audit = new AuditLogger(db);
    files = new FileService(db, audit, new MemoryStorageBackend());
  }, 60_000);

  afterAll(async () => {
    await db.close();
    await container.stop();
  });

  it('should upload a file', async () => {
    const result = await files.upload(ctx, {
      filename: 'safety-data-sheet.pdf',
      content_type: 'application/pdf',
      content: Buffer.from('fake pdf content'),
    });

    expect(result.success).toBe(true);
    expect(result.data.file_id).toBeDefined();
    expect(result.data.filename).toBe('safety-data-sheet.pdf');
    expect(result.data.size_bytes).toBeGreaterThan(0);
  });

  it('should get a file', async () => {
    const uploaded = await files.upload(ctx, {
      filename: 'report.txt',
      content_type: 'text/plain',
      content: Buffer.from('test content'),
    });

    const result = await files.get(ctx, {
      file_id: uploaded.data.file_id,
    });

    expect(result.success).toBe(true);
    expect(result.data.metadata.filename).toBe('report.txt');
    expect(result.data.content.toString()).toBe('test content');
  });

  it('should upload with entity attachment', async () => {
    const result = await files.upload(ctx, {
      filename: 'coa.pdf',
      content_type: 'application/pdf',
      content: Buffer.from('certificate'),
      entity_id: 'prod_1',
      entity_type: 'product',
    });

    expect(result.success).toBe(true);
    expect(result.audit_entry).toBeDefined();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @eurocomply/platform-services run test -- src/services/__tests__/file.test.ts`
Expected: FAIL

**Step 3: Implement FileService**

Create `packages/platform-services/src/services/file.ts`:

```typescript
import { v4 as uuid } from 'uuid';
import type { PostgresConnectionManager } from '../db/postgres.js';
import type { AuditLogger } from './audit.js';
import type { ServiceContext, ServiceResult } from '@eurocomply/types';

export interface StorageBackend {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
}

export interface FileUploadInput {
  filename: string;
  content_type: string;
  content: Buffer;
  entity_id?: string;
  entity_type?: string;
}

export interface FileUploadOutput {
  file_id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  storage_key: string;
}

export interface FileGetInput {
  file_id: string;
}

export interface FileGetOutput {
  metadata: {
    file_id: string;
    filename: string;
    content_type: string;
    size_bytes: number;
    entity_id: string | null;
    entity_type: string | null;
    created_at: string;
  };
  content: Buffer;
}

export class FileService {
  constructor(
    private db: PostgresConnectionManager,
    private audit: AuditLogger,
    private storage: StorageBackend,
  ) {}

  async upload(
    ctx: ServiceContext,
    input: FileUploadInput,
  ): Promise<ServiceResult<FileUploadOutput>> {
    const fileId = uuid();
    const storageKey = `${ctx.tenant_id}/${fileId}/${input.filename}`;

    await this.storage.put(storageKey, input.content);

    await this.db.query(
      `INSERT INTO files (file_id, tenant_id, filename, content_type, size_bytes, storage_key, entity_id, entity_type, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        fileId, ctx.tenant_id, input.filename, input.content_type,
        input.content.length, storageKey,
        input.entity_id ?? null, input.entity_type ?? null,
        ctx.principal.id,
      ]
    );

    const auditEntry = await this.audit.log(ctx, {
      action: 'upload',
      resource: {
        entity_type: input.entity_type ?? 'file',
        entity_id: input.entity_id ?? fileId,
      },
      changes: {
        fields_changed: ['file'],
        after: { file_id: fileId, filename: input.filename },
      },
      success: true,
    });

    return {
      success: true,
      data: {
        file_id: fileId,
        filename: input.filename,
        content_type: input.content_type,
        size_bytes: input.content.length,
        storage_key: storageKey,
      },
      audit_entry: auditEntry,
    };
  }

  async get(
    ctx: ServiceContext,
    input: FileGetInput,
  ): Promise<ServiceResult<FileGetOutput>> {
    const result = await this.db.query(
      'SELECT * FROM files WHERE file_id = $1 AND tenant_id = $2',
      [input.file_id, ctx.tenant_id]
    );

    if (result.rows.length === 0) {
      return { success: false, data: { metadata: { file_id: input.file_id, filename: '', content_type: '', size_bytes: 0, entity_id: null, entity_type: null, created_at: '' }, content: Buffer.alloc(0) } };
    }

    const row = result.rows[0] as {
      file_id: string; filename: string; content_type: string;
      size_bytes: number; storage_key: string; entity_id: string | null;
      entity_type: string | null; created_at: string;
    };

    const content = await this.storage.get(row.storage_key);
    if (!content) {
      return { success: false, data: { metadata: { ...row, size_bytes: Number(row.size_bytes) }, content: Buffer.alloc(0) } };
    }

    return {
      success: true,
      data: {
        metadata: {
          file_id: row.file_id,
          filename: row.filename,
          content_type: row.content_type,
          size_bytes: Number(row.size_bytes),
          entity_id: row.entity_id,
          entity_type: row.entity_type,
          created_at: row.created_at,
        },
        content,
      },
    };
  }
}
```

**Step 4: Run tests**

Run: `pnpm --filter @eurocomply/platform-services run test -- src/services/__tests__/file.test.ts`
Expected: PASS (3 tests)

**Step 5: Commit**

```bash
git add packages/platform-services/src/services/file.ts packages/platform-services/src/services/__tests__/file.test.ts
git commit -m "feat(platform-services): add file service with storage backend

file:upload and file:get with pluggable StorageBackend interface.
Metadata in PostgreSQL, content in backend (memory for tests)."
```

---

### Task 8: Job Queue Service (job:submit, job:status)

Implement background job submission and status tracking using PostgreSQL as a job queue.

**Files:**
- Create: `packages/platform-services/src/services/job.ts`
- Create: `packages/platform-services/src/services/__tests__/job.test.ts`

**Step 1: Write the failing tests**

Create `packages/platform-services/src/services/__tests__/job.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { JobService } from '../job.js';
import { PostgresConnectionManager } from '../../db/postgres.js';
import { runMigrations } from '../../db/migrate.js';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { ServiceContext } from '@eurocomply/types';

describe('JobService', () => {
  let container: StartedPostgreSqlContainer;
  let db: PostgresConnectionManager;
  let jobs: JobService;

  const ctx: ServiceContext = {
    tenant_id: 'tenant_1',
    principal: { type: 'user', id: 'user_1' },
    correlation_id: 'corr_1',
  };

  beforeAll(async () => {
    container = await new PostgreSqlContainer().start();
    db = new PostgresConnectionManager({
      host: container.getHost(),
      port: container.getMappedPort(5432),
      database: container.getDatabase(),
      user: container.getUsername(),
      password: container.getPassword(),
    });
    await runMigrations(db);
    jobs = new JobService(db);
  }, 60_000);

  afterAll(async () => {
    await db.close();
    await container.stop();
  });

  it('should submit a job', async () => {
    const result = await jobs.submit(ctx, {
      job_type: 'compliance_evaluation',
      payload: { entity_id: 'prod_1', rule_id: 'reach_svhc' },
    });

    expect(result.success).toBe(true);
    expect(result.data.job_id).toBeDefined();
    expect(result.data.status).toBe('pending');
  });

  it('should get job status', async () => {
    const submitted = await jobs.submit(ctx, {
      job_type: 'report_generation',
      payload: { report_type: 'sds' },
    });

    const result = await jobs.status(ctx, {
      job_id: submitted.data.job_id,
    });

    expect(result.success).toBe(true);
    expect(result.data.status).toBe('pending');
    expect(result.data.job_type).toBe('report_generation');
  });

  it('should claim and complete a job', async () => {
    const submitted = await jobs.submit(ctx, {
      job_type: 'test_job',
      payload: { value: 42 },
    });

    const claimed = await jobs.claim(ctx, 'test_job');
    expect(claimed).not.toBeNull();
    expect(claimed!.job_id).toBe(submitted.data.job_id);

    await jobs.complete(ctx, {
      job_id: submitted.data.job_id,
      result: { output: 'done' },
    });

    const status = await jobs.status(ctx, { job_id: submitted.data.job_id });
    expect(status.data.status).toBe('completed');
    expect(status.data.result).toEqual({ output: 'done' });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @eurocomply/platform-services run test -- src/services/__tests__/job.test.ts`
Expected: FAIL

**Step 3: Implement JobService**

Create `packages/platform-services/src/services/job.ts`:

```typescript
import { v4 as uuid } from 'uuid';
import type { PostgresConnectionManager } from '../db/postgres.js';
import type { ServiceContext, ServiceResult } from '@eurocomply/types';

export interface JobSubmitInput {
  job_type: string;
  payload: Record<string, unknown>;
}

export interface JobSubmitOutput {
  job_id: string;
  status: string;
}

export interface JobStatusInput {
  job_id: string;
}

export interface JobStatusOutput {
  job_id: string;
  job_type: string;
  status: string;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface JobCompleteInput {
  job_id: string;
  result?: Record<string, unknown>;
  error?: string;
}

export interface ClaimedJob {
  job_id: string;
  job_type: string;
  payload: Record<string, unknown>;
}

export class JobService {
  constructor(private db: PostgresConnectionManager) {}

  async submit(
    ctx: ServiceContext,
    input: JobSubmitInput,
  ): Promise<ServiceResult<JobSubmitOutput>> {
    const jobId = uuid();

    await this.db.query(
      `INSERT INTO jobs (job_id, tenant_id, job_type, payload, submitted_by)
       VALUES ($1, $2, $3, $4, $5)`,
      [jobId, ctx.tenant_id, input.job_type, JSON.stringify(input.payload), ctx.principal.id]
    );

    return {
      success: true,
      data: { job_id: jobId, status: 'pending' },
    };
  }

  async status(
    ctx: ServiceContext,
    input: JobStatusInput,
  ): Promise<ServiceResult<JobStatusOutput>> {
    const result = await this.db.query(
      'SELECT * FROM jobs WHERE job_id = $1 AND tenant_id = $2',
      [input.job_id, ctx.tenant_id]
    );

    if (result.rows.length === 0) {
      return { success: false, data: { job_id: input.job_id, job_type: '', status: 'unknown', payload: {}, result: null, error: null, created_at: '', started_at: null, completed_at: null } };
    }

    const row = result.rows[0] as JobStatusOutput;
    return { success: true, data: row };
  }

  async claim(
    ctx: ServiceContext,
    jobType: string,
  ): Promise<ClaimedJob | null> {
    const result = await this.db.query(
      `UPDATE jobs SET status = 'running', started_at = now()
       WHERE job_id = (
         SELECT job_id FROM jobs
         WHERE tenant_id = $1 AND job_type = $2 AND status = 'pending'
         ORDER BY created_at ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING job_id, job_type, payload`,
      [ctx.tenant_id, jobType]
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0] as ClaimedJob;
    return row;
  }

  async complete(
    ctx: ServiceContext,
    input: JobCompleteInput,
  ): Promise<void> {
    const status = input.error ? 'failed' : 'completed';
    await this.db.query(
      `UPDATE jobs SET status = $1, result = $2, error = $3, completed_at = now()
       WHERE job_id = $4 AND tenant_id = $5`,
      [
        status,
        input.result ? JSON.stringify(input.result) : null,
        input.error ?? null,
        input.job_id, ctx.tenant_id,
      ]
    );
  }
}
```

**Step 4: Run tests**

Run: `pnpm --filter @eurocomply/platform-services run test -- src/services/__tests__/job.test.ts`
Expected: PASS (3 tests)

**Step 5: Commit**

```bash
git add packages/platform-services/src/services/job.ts packages/platform-services/src/services/__tests__/job.test.ts
git commit -m "feat(platform-services): add job queue service

PostgreSQL-backed job queue with submit, status, claim (SKIP LOCKED),
and complete. Supports pending/running/completed/failed states."
```

---

### Task 9: LLM Gateway + AI Bridge (ai:generate, ai:extract)

Implement the AI runtime gateway with tier routing, plus the AIBridge that connects kernel-vm AI handler contracts to the LLM Gateway. Since kernel-vm evaluator is synchronous, the execution loop pre-walks rule ASTs for `ai:*` handler nodes, executes them asynchronously via the bridge, and injects results into `context.data` before calling the synchronous evaluator.

**Files:**
- Create: `packages/platform-services/src/services/llm-gateway.ts`
- Create: `packages/platform-services/src/services/__tests__/llm-gateway.test.ts`

**Step 1: Write the failing tests**

Create `packages/platform-services/src/services/__tests__/llm-gateway.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { LLMGateway, type LLMProvider } from '../llm-gateway.js';

// Mock provider for testing
class MockLLMProvider implements LLMProvider {
  readonly calls: Array<{ prompt: string; options: Record<string, unknown> }> = [];

  async generate(prompt: string, options: Record<string, unknown> = {}): Promise<{ text: string; tokens_used: { input: number; output: number } }> {
    this.calls.push({ prompt, options });
    return {
      text: `Mock response for: ${prompt.slice(0, 50)}`,
      tokens_used: { input: 100, output: 50 },
    };
  }
}

describe('LLMGateway', () => {
  it('should route tier A requests to self-hosted provider', async () => {
    const tierA = new MockLLMProvider();
    const tierB = new MockLLMProvider();
    const gateway = new LLMGateway({ tierA, tierB });

    const result = await gateway.generate({
      prompt: 'Extract substances from this document',
      tier: 'A',
      model_preference: 'default',
    });

    expect(result.text).toBeDefined();
    expect(tierA.calls.length).toBe(1);
    expect(tierB.calls.length).toBe(0);
  });

  it('should route tier B requests to cloud provider', async () => {
    const tierA = new MockLLMProvider();
    const tierB = new MockLLMProvider();
    const gateway = new LLMGateway({ tierA, tierB });

    const result = await gateway.generate({
      prompt: 'Interpret this regulation text',
      tier: 'B',
      model_preference: 'default',
    });

    expect(result.text).toBeDefined();
    expect(tierA.calls.length).toBe(0);
    expect(tierB.calls.length).toBe(1);
  });

  it('should classify ambiguous tier to A (fail-safe)', async () => {
    const tierA = new MockLLMProvider();
    const tierB = new MockLLMProvider();
    const gateway = new LLMGateway({ tierA, tierB });

    const result = await gateway.generate({
      prompt: 'Analyze this data',
      model_preference: 'default',
    });

    expect(result.text).toBeDefined();
    expect(tierA.calls.length).toBe(1); // defaults to tier A
  });

  it('should extract structured data', async () => {
    const tierA = new MockLLMProvider();
    const tierB = new MockLLMProvider();
    const gateway = new LLMGateway({ tierA, tierB });

    const result = await gateway.extract({
      document_content: 'Lead concentration: 0.05%',
      extraction_schema: {
        fields: [
          { name: 'lead_concentration', type: 'number', description: 'Lead ppm' },
        ],
      },
      tier: 'A',
    });

    expect(result.raw_response).toBeDefined();
    expect(tierA.calls.length).toBe(1);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @eurocomply/platform-services run test -- src/services/__tests__/llm-gateway.test.ts`
Expected: FAIL

**Step 3: Implement LLMGateway**

Create `packages/platform-services/src/services/llm-gateway.ts`:

```typescript
export interface LLMProvider {
  generate(prompt: string, options?: Record<string, unknown>): Promise<{
    text: string;
    tokens_used: { input: number; output: number };
  }>;
}

export interface LLMGatewayConfig {
  tierA: LLMProvider;
  tierB: LLMProvider;
}

export interface GenerateInput {
  prompt: string;
  tier?: 'A' | 'B';
  model_preference?: string;
  temperature?: number;
  max_tokens?: number;
}

export interface GenerateOutput {
  text: string;
  tier_used: 'A' | 'B';
  tokens_used: { input: number; output: number };
}

export interface ExtractInput {
  document_content: string;
  extraction_schema: {
    fields: Array<{
      name: string;
      type: string;
      description: string;
      required?: boolean;
    }>;
  };
  tier?: 'A' | 'B';
}

export interface ExtractOutput {
  raw_response: string;
  tier_used: 'A' | 'B';
  tokens_used: { input: number; output: number };
}

export class LLMGateway {
  private tierA: LLMProvider;
  private tierB: LLMProvider;

  constructor(config: LLMGatewayConfig) {
    this.tierA = config.tierA;
    this.tierB = config.tierB;
  }

  async generate(input: GenerateInput): Promise<GenerateOutput> {
    // Default to tier A (fail-safe: self-hosted when ambiguous)
    const tier = input.tier ?? 'A';
    const provider = tier === 'A' ? this.tierA : this.tierB;

    const result = await provider.generate(input.prompt, {
      temperature: input.temperature,
      max_tokens: input.max_tokens,
      model: input.model_preference,
    });

    return {
      text: result.text,
      tier_used: tier,
      tokens_used: result.tokens_used,
    };
  }

  async extract(input: ExtractInput): Promise<ExtractOutput> {
    const tier = input.tier ?? 'A';
    const provider = tier === 'A' ? this.tierA : this.tierB;

    const prompt = buildExtractionPrompt(input.document_content, input.extraction_schema);
    const result = await provider.generate(prompt);

    return {
      raw_response: result.text,
      tier_used: tier,
      tokens_used: result.tokens_used,
    };
  }
}

function buildExtractionPrompt(
  content: string,
  schema: ExtractInput['extraction_schema'],
): string {
  const fieldDescriptions = schema.fields
    .map(f => `- ${f.name} (${f.type}): ${f.description}${f.required ? ' [REQUIRED]' : ''}`)
    .join('\n');

  return `Extract the following fields from the document below.
Return the result as JSON.

Fields to extract:
${fieldDescriptions}

Document:
${content}`;
}

// --- AI Bridge ---
// Connects kernel-vm AI handler contracts to LLM Gateway.
// The execution loop uses this to pre-evaluate ai:* nodes
// before synchronous kernel-vm evaluation.

import type { ASTNode } from '@eurocomply/types';

export interface AIBridge {
  /** Pre-evaluate all ai:* nodes in an AST, returning data_key→result map */
  preEvaluateAINodes(
    ast: ASTNode,
    entityData: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
}

/**
 * Walk an AST and collect all ai:* handler nodes.
 * Returns flat list of { node, data_key } pairs.
 */
function collectAINodes(
  ast: ASTNode,
  prefix: string = 'ai_result',
): Array<{ node: ASTNode; data_key: string }> {
  const results: Array<{ node: ASTNode; data_key: string }> = [];

  if (ast.handler.startsWith('ai:')) {
    const key = `${prefix}_${ast.handler.replace(':', '_')}`;
    results.push({ node: ast, data_key: key });
  }

  // Recurse into child nodes in config
  const config = ast.config;
  if (config.conditions && Array.isArray(config.conditions)) {
    for (const child of config.conditions as ASTNode[]) {
      results.push(...collectAINodes(child, prefix));
    }
  }
  if (config.steps && Array.isArray(config.steps)) {
    for (const child of config.steps as ASTNode[]) {
      results.push(...collectAINodes(child, prefix));
    }
  }
  if (config.then && typeof config.then === 'object' && 'handler' in (config.then as object)) {
    results.push(...collectAINodes(config.then as ASTNode, prefix));
  }

  return results;
}

export function createAIBridge(gateway: LLMGateway): AIBridge {
  return {
    async preEvaluateAINodes(
      ast: ASTNode,
      entityData: Record<string, unknown>,
    ): Promise<Record<string, unknown>> {
      const aiNodes = collectAINodes(ast);
      if (aiNodes.length === 0) return {};

      const results: Record<string, unknown> = {};

      for (const { node, data_key } of aiNodes) {
        const config = node.config as Record<string, unknown>;

        if (node.handler === 'ai:document_extract') {
          const extractResult = await gateway.extract({
            document_content: String(config.document_content ?? entityData[config.source_field as string] ?? ''),
            extraction_schema: config.schema as ExtractInput['extraction_schema'],
            tier: 'A',
          });
          results[data_key] = extractResult.raw_response;
        } else {
          // Generic generate for other ai:* handlers
          const generateResult = await gateway.generate({
            prompt: String(config.prompt ?? JSON.stringify(config)),
            tier: 'A',
          });
          results[data_key] = generateResult.text;
        }
      }

      return results;
    },
  };
}
```

**Step 4: Run tests**

Run: `pnpm --filter @eurocomply/platform-services run test -- src/services/__tests__/llm-gateway.test.ts`
Expected: PASS (4 tests)

**Step 5: Commit**

```bash
git add packages/platform-services/src/services/llm-gateway.ts packages/platform-services/src/services/__tests__/llm-gateway.test.ts
git commit -m "feat(platform-services): add LLM gateway with tier routing + AI bridge

Two-tier data sovereignty: Tier A (self-hosted, customer data),
Tier B (cloud API, schemas only). Ambiguous defaults to Tier A.
AIBridge pre-evaluates ai:* AST nodes before synchronous VM evaluation,
injecting results into context.data."
```

---

### Task 10: Context Assembly + Execution Loop

Implement the core execution loop: assemble ExecutionContext from stored data (including graph data pre-loaded from Neo4j), pre-evaluate AI nodes via AIBridge, invoke kernel-vm, persist results + audit.

**Context assembly walks the rule AST to find `{ data_key }` references, queries the RelationService for graph data, and pre-evaluates `ai:*` nodes via AIBridge. All of this is injected into `ExecutionContext.data` before calling the synchronous kernel-vm evaluator.**

**Files:**
- Create: `packages/platform-services/src/execution-loop.ts`
- Create: `packages/platform-services/src/services/__tests__/execution-loop.test.ts`

**Step 1: Write the failing tests**

Create `packages/platform-services/src/services/__tests__/execution-loop.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ExecutionLoop } from '../../execution-loop.js';
import { EntityService } from '../entity.js';
import { AuditLogger } from '../audit.js';
import { PostgresConnectionManager } from '../../db/postgres.js';
import { runMigrations } from '../../db/migrate.js';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import {
  HandlerRegistry, createDefaultRegistry, evaluate,
} from '@eurocomply/kernel-vm';
import type { ServiceContext } from '@eurocomply/types';

describe('ExecutionLoop', () => {
  let container: StartedPostgreSqlContainer;
  let db: PostgresConnectionManager;
  let audit: AuditLogger;
  let entityService: EntityService;
  let registry: HandlerRegistry;
  let loop: ExecutionLoop;

  const ctx: ServiceContext = {
    tenant_id: 'tenant_1',
    principal: { type: 'user', id: 'user_1' },
    correlation_id: 'corr_1',
  };

  beforeAll(async () => {
    container = await new PostgreSqlContainer().start();
    db = new PostgresConnectionManager({
      host: container.getHost(),
      port: container.getMappedPort(5432),
      database: container.getDatabase(),
      user: container.getUsername(),
      password: container.getPassword(),
    });
    await runMigrations(db);
    audit = new AuditLogger(db);
    entityService = new EntityService(db, audit);
    registry = createDefaultRegistry();
    loop = new ExecutionLoop(entityService, audit, registry);

    // Set up test data
    await entityService.defineType(ctx, {
      entity_type: 'product',
      schema: {
        fields: [
          { name: 'name', type: 'string', required: true },
          { name: 'lead_concentration', type: 'number' },
        ],
      },
    });
  }, 60_000);

  afterAll(async () => {
    await db.close();
    await container.stop();
  });

  it('should assemble context and evaluate a rule', async () => {
    const created = await entityService.create(ctx, {
      entity_type: 'product',
      data: { name: 'Test Product', lead_concentration: 0.0005 },
    });

    const result = await loop.evaluate(ctx, {
      entity_type: 'product',
      entity_id: created.data.entity_id,
      rule: {
        handler: 'core:threshold_check',
        config: {
          value: { field: 'lead_concentration' },
          operator: 'lt',
          threshold: 0.001,
        },
        label: 'Lead concentration below 0.1%',
      },
      compliance_lock_id: 'lock_test_1',
      vertical_id: 'cosmetics',
      market: 'EU',
    });

    expect(result.success).toBe(true);
    expect(result.data.handler_result.success).toBe(true);
    expect(result.data.handler_result.value).toHaveProperty('pass', true);
  });

  it('should fail evaluation for non-compliant entity', async () => {
    const created = await entityService.create(ctx, {
      entity_type: 'product',
      data: { name: 'Bad Product', lead_concentration: 0.05 },
    });

    const result = await loop.evaluate(ctx, {
      entity_type: 'product',
      entity_id: created.data.entity_id,
      rule: {
        handler: 'core:threshold_check',
        config: {
          value: { field: 'lead_concentration' },
          operator: 'lt',
          threshold: 0.001,
        },
      },
      compliance_lock_id: 'lock_test_2',
      vertical_id: 'cosmetics',
      market: 'EU',
    });

    expect(result.success).toBe(true);
    expect(result.data.handler_result.success).toBe(true);
    expect(result.data.handler_result.value).toHaveProperty('pass', false);
  });

  it('should log evaluation in audit', async () => {
    const created = await entityService.create(ctx, {
      entity_type: 'product',
      data: { name: 'Audited Product', lead_concentration: 0.0001 },
    });

    await loop.evaluate(ctx, {
      entity_type: 'product',
      entity_id: created.data.entity_id,
      rule: {
        handler: 'core:threshold_check',
        config: {
          value: { field: 'lead_concentration' },
          operator: 'lt',
          threshold: 0.001,
        },
      },
      compliance_lock_id: 'lock_test_3',
      vertical_id: 'cosmetics',
      market: 'EU',
    });

    const entries = await audit.query(ctx.tenant_id, {
      resource_entity_id: created.data.entity_id,
      action: 'evaluate',
    });
    expect(entries.length).toBe(1);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @eurocomply/platform-services run test -- src/services/__tests__/execution-loop.test.ts`
Expected: FAIL

**Step 3: Implement ExecutionLoop**

Create `packages/platform-services/src/execution-loop.ts`:

```typescript
import type { EntityService } from './services/entity.js';
import type { RelationService } from './services/relation.js';
import type { AuditLogger } from './services/audit.js';
import type { AIBridge } from './services/llm-gateway.js';
import type { HandlerRegistry } from '@eurocomply/kernel-vm';
import { evaluate, isDataReference } from '@eurocomply/kernel-vm';
import type {
  ServiceContext, ServiceResult, ASTNode, HandlerResult, ExecutionContext,
} from '@eurocomply/types';

export interface EvaluateInput {
  entity_type: string;
  entity_id: string;
  rule: ASTNode;
  compliance_lock_id: string;
  vertical_id: string;
  market: string;
  data?: Record<string, unknown>;
}

export interface EvaluateOutput {
  handler_result: HandlerResult;
  entity_id: string;
  entity_type: string;
  compliance_lock_id: string;
}

/**
 * Walk an AST to collect all { data_key } references.
 * These indicate graph data that must be pre-loaded from Neo4j.
 */
function collectDataKeys(ast: ASTNode): Set<string> {
  const keys = new Set<string>();

  function walkValue(val: unknown): void {
    if (val && typeof val === 'object') {
      if (isDataReference(val)) {
        keys.add((val as { data_key: string }).data_key);
        return;
      }
      if (Array.isArray(val)) {
        for (const item of val) walkValue(item);
      } else {
        for (const v of Object.values(val as Record<string, unknown>)) walkValue(v);
      }
    }
  }

  walkValue(ast.config);

  // Recurse into child AST nodes
  const config = ast.config;
  if (config.conditions && Array.isArray(config.conditions)) {
    for (const child of config.conditions as ASTNode[]) {
      for (const key of collectDataKeys(child)) keys.add(key);
    }
  }
  if (config.steps && Array.isArray(config.steps)) {
    for (const child of config.steps as ASTNode[]) {
      for (const key of collectDataKeys(child)) keys.add(key);
    }
  }
  if (config.then && typeof config.then === 'object' && 'handler' in (config.then as object)) {
    for (const key of collectDataKeys(config.then as ASTNode)) keys.add(key);
  }

  return keys;
}

export class ExecutionLoop {
  constructor(
    private entityService: EntityService,
    private audit: AuditLogger,
    private registry: HandlerRegistry,
    private relationService?: RelationService,
    private aiBridge?: AIBridge,
  ) {}

  async evaluate(
    ctx: ServiceContext,
    input: EvaluateInput,
  ): Promise<ServiceResult<EvaluateOutput>> {
    // Phase 1: Assemble ExecutionContext
    const entityResult = await this.entityService.get(ctx, {
      entity_type: input.entity_type,
      entity_id: input.entity_id,
    });

    if (!entityResult.success) {
      return {
        success: false,
        data: {
          handler_result: {
            success: false,
            value: null,
            explanation: { summary: `Entity ${input.entity_id} not found`, steps: [] },
            trace: {
              handler_id: 'execution_loop',
              handler_version: '1.0.0',
              duration_ms: 0,
              input: input,
              output: null,
              execution_path: 'root',
              status: 'error',
              error: { message: `Entity ${input.entity_id} not found` },
            },
          },
          entity_id: input.entity_id,
          entity_type: input.entity_type,
          compliance_lock_id: input.compliance_lock_id,
        },
      };
    }

    // Phase 1a: Pre-load graph data for { data_key } references
    const preloadedData: Record<string, unknown> = { ...(input.data ?? {}) };

    if (this.relationService) {
      const dataKeys = collectDataKeys(input.rule);
      for (const key of dataKeys) {
        if (preloadedData[key] !== undefined) continue; // already provided

        // Convention: data_key "upstream_materials" → list relations outgoing
        // The key maps to a relation query; caller can also pre-populate via input.data
        const relResult = await this.relationService.list(ctx, {
          entity_type: input.entity_type,
          entity_id: input.entity_id,
          direction: 'both',
        });
        if (relResult.success) {
          preloadedData[key] = relResult.data.items;
        }
      }
    }

    // Phase 1b: Pre-evaluate AI nodes via bridge
    if (this.aiBridge) {
      const aiResults = await this.aiBridge.preEvaluateAINodes(
        input.rule,
        entityResult.data.data,
      );
      Object.assign(preloadedData, aiResults);
    }

    const executionContext: ExecutionContext = {
      entity_type: input.entity_type,
      entity_id: input.entity_id,
      entity_data: entityResult.data.data,
      data: preloadedData,
      compliance_lock_id: input.compliance_lock_id,
      vertical_id: input.vertical_id,
      market: input.market,
      timestamp: new Date().toISOString(),
    };

    // Phase 2: Kernel VM evaluates (pure, synchronous)
    const handlerResult = evaluate(input.rule, executionContext, this.registry);

    // Phase 3: Persist audit entry
    await this.audit.log(ctx, {
      action: 'evaluate',
      resource: { entity_type: input.entity_type, entity_id: input.entity_id },
      changes: {
        fields_changed: ['compliance_evaluation'],
        after: {
          compliance_lock_id: input.compliance_lock_id,
          pass: handlerResult.value && typeof handlerResult.value === 'object' && 'pass' in handlerResult.value
            ? (handlerResult.value as { pass: boolean }).pass
            : handlerResult.success,
          handler_id: input.rule.handler,
        },
      },
      success: true,
    });

    return {
      success: true,
      data: {
        handler_result: handlerResult,
        entity_id: input.entity_id,
        entity_type: input.entity_type,
        compliance_lock_id: input.compliance_lock_id,
      },
    };
  }
}
```

**Step 4: Run tests**

Run: `pnpm --filter @eurocomply/platform-services run test -- src/services/__tests__/execution-loop.test.ts`
Expected: PASS (3 tests)

**Step 5: Commit**

```bash
git add packages/platform-services/src/execution-loop.ts packages/platform-services/src/services/__tests__/execution-loop.test.ts
git commit -m "feat(platform-services): add execution loop with context pre-loading

Context assembly walks AST for { data_key } references, pre-loads
graph data from Neo4j via RelationService, pre-evaluates ai:* nodes
via AIBridge. Then kernel-vm evaluates (pure, synchronous).
Result persistence + audit logging complete the pipeline."
```

---

### Task 11: MCP Server Scaffold

Create the MCP server that exposes all platform services as MCP tools. This task implements the tool router (the internal dispatch layer) and a Hono HTTP wrapper for initial testing. The full MCP protocol (JSON-RPC 2.0 over stdio/HTTP+SSE via `@modelcontextprotocol/sdk`) will be wired in `spoke-runtime` — here we build the tool registry that the SDK server delegates to.

> **Note:** The design specifies MCP protocol (JSON-RPC 2.0). The MCPToolRouter built here is the tool dispatch layer. In `apps/spoke-runtime`, it will be wrapped with `@modelcontextprotocol/sdk`'s `Server` class to provide proper `tools/list` and `tools/call` JSON-RPC methods over stdio and HTTP+SSE transports. The Hono HTTP server here is a convenience for integration testing.

**Files:**
- Create: `packages/platform-services/src/mcp/server.ts`
- Create: `packages/platform-services/src/mcp/tools.ts`
- Create: `packages/platform-services/src/mcp/__tests__/server.test.ts`

**Step 1: Write the failing tests**

Create `packages/platform-services/src/mcp/__tests__/server.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createMCPToolRouter, type MCPToolRouter } from '../tools.js';
import { EntityService } from '../../services/entity.js';
import { AuditLogger } from '../../services/audit.js';
import { JobService } from '../../services/job.js';
import { FileService, type StorageBackend } from '../../services/file.js';
import { ExecutionLoop } from '../../execution-loop.js';
import { PostgresConnectionManager } from '../../db/postgres.js';
import { runMigrations } from '../../db/migrate.js';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createDefaultRegistry } from '@eurocomply/kernel-vm';
import type { ServiceContext } from '@eurocomply/types';

class MemoryStorageBackend implements StorageBackend {
  private store = new Map<string, Buffer>();
  async put(key: string, data: Buffer): Promise<void> { this.store.set(key, data); }
  async get(key: string): Promise<Buffer | null> { return this.store.get(key) ?? null; }
  async delete(key: string): Promise<void> { this.store.delete(key); }
}

describe('MCP Tool Router', () => {
  let container: StartedPostgreSqlContainer;
  let db: PostgresConnectionManager;
  let router: MCPToolRouter;

  const ctx: ServiceContext = {
    tenant_id: 'tenant_1',
    principal: { type: 'user', id: 'user_1' },
    correlation_id: 'corr_1',
  };

  beforeAll(async () => {
    container = await new PostgreSqlContainer().start();
    db = new PostgresConnectionManager({
      host: container.getHost(),
      port: container.getMappedPort(5432),
      database: container.getDatabase(),
      user: container.getUsername(),
      password: container.getPassword(),
    });
    await runMigrations(db);

    const audit = new AuditLogger(db);
    const entityService = new EntityService(db, audit);
    const jobService = new JobService(db);
    const fileService = new FileService(db, audit, new MemoryStorageBackend());
    const registry = createDefaultRegistry();
    const executionLoop = new ExecutionLoop(entityService, audit, registry);

    router = createMCPToolRouter({
      entityService,
      audit,
      jobService,
      fileService,
      executionLoop,
    });
  }, 60_000);

  afterAll(async () => {
    await db.close();
    await container.stop();
  });

  it('should list available tools', () => {
    const tools = router.listTools();
    expect(tools.length).toBeGreaterThan(0);
    const toolNames = tools.map(t => t.name);
    expect(toolNames).toContain('entity:create');
    expect(toolNames).toContain('entity:get');
    expect(toolNames).toContain('entity:list');
    expect(toolNames).toContain('entity:update');
    expect(toolNames).toContain('file:upload');
    expect(toolNames).toContain('file:get');
    expect(toolNames).toContain('job:submit');
    expect(toolNames).toContain('job:status');
    expect(toolNames).toContain('audit:query');
  });

  it('should call entity:create through router', async () => {
    // First define type
    await router.callTool('entity:define', { entity_type: 'material', schema: { fields: [{ name: 'name', type: 'string' }] } }, ctx);

    const result = await router.callTool(
      'entity:create',
      { entity_type: 'material', data: { name: 'Steel' } },
      ctx,
    );

    expect(result.success).toBe(true);
    expect(result.data.entity_id).toBeDefined();
  });

  it('should return error for unknown tool', async () => {
    await expect(
      router.callTool('nonexistent:tool', {}, ctx)
    ).rejects.toThrow();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @eurocomply/platform-services run test -- src/mcp/__tests__/server.test.ts`
Expected: FAIL

**Step 3: Implement MCP Tool Router**

Create `packages/platform-services/src/mcp/tools.ts`:

```typescript
import type { EntityService } from '../services/entity.js';
import type { AuditLogger } from '../services/audit.js';
import type { JobService } from '../services/job.js';
import type { FileService } from '../services/file.js';
import type { ExecutionLoop } from '../execution-loop.js';
import type { ServiceContext, ServiceResult } from '@eurocomply/types';

export interface MCPToolDefinition {
  name: string;
  description: string;
}

export interface MCPToolRouter {
  listTools(): MCPToolDefinition[];
  callTool(name: string, input: Record<string, unknown>, ctx: ServiceContext): Promise<ServiceResult<unknown>>;
}

export interface MCPToolRouterDeps {
  entityService: EntityService;
  audit: AuditLogger;
  jobService: JobService;
  fileService: FileService;
  executionLoop: ExecutionLoop;
}

export function createMCPToolRouter(deps: MCPToolRouterDeps): MCPToolRouter {
  const tools: Record<string, {
    definition: MCPToolDefinition;
    handler: (input: Record<string, unknown>, ctx: ServiceContext) => Promise<ServiceResult<unknown>>;
  }> = {};

  // Entity tools
  tools['entity:define'] = {
    definition: { name: 'entity:define', description: 'Define an entity type with schema' },
    handler: (input, ctx) => deps.entityService.defineType(ctx, input as any),
  };
  tools['entity:create'] = {
    definition: { name: 'entity:create', description: 'Create an entity instance' },
    handler: (input, ctx) => deps.entityService.create(ctx, input as any),
  };
  tools['entity:get'] = {
    definition: { name: 'entity:get', description: 'Get an entity by ID' },
    handler: (input, ctx) => deps.entityService.get(ctx, input as any),
  };
  tools['entity:update'] = {
    definition: { name: 'entity:update', description: 'Update an entity' },
    handler: (input, ctx) => deps.entityService.update(ctx, input as any),
  };
  tools['entity:list'] = {
    definition: { name: 'entity:list', description: 'List entities of a type' },
    handler: (input, ctx) => deps.entityService.list(ctx, input as any),
  };

  // File tools
  tools['file:upload'] = {
    definition: { name: 'file:upload', description: 'Upload a file' },
    handler: async (input, ctx) => {
      const content = typeof input.content === 'string'
        ? Buffer.from(input.content, 'base64')
        : input.content as Buffer;
      return deps.fileService.upload(ctx, { ...input, content } as any);
    },
  };
  tools['file:get'] = {
    definition: { name: 'file:get', description: 'Get a file by ID' },
    handler: (input, ctx) => deps.fileService.get(ctx, input as any),
  };

  // Job tools
  tools['job:submit'] = {
    definition: { name: 'job:submit', description: 'Submit a background job' },
    handler: (input, ctx) => deps.jobService.submit(ctx, input as any),
  };
  tools['job:status'] = {
    definition: { name: 'job:status', description: 'Get job status' },
    handler: (input, ctx) => deps.jobService.status(ctx, input as any),
  };

  // Audit tools
  tools['audit:query'] = {
    definition: { name: 'audit:query', description: 'Query audit log entries' },
    handler: async (input, ctx) => {
      const entries = await deps.audit.query(ctx.tenant_id, input as any);
      return { success: true, data: entries };
    },
  };

  // Execution loop
  tools['evaluate'] = {
    definition: { name: 'evaluate', description: 'Evaluate a rule against an entity' },
    handler: (input, ctx) => deps.executionLoop.evaluate(ctx, input as any),
  };

  return {
    listTools(): MCPToolDefinition[] {
      return Object.values(tools).map(t => t.definition);
    },

    async callTool(
      name: string,
      input: Record<string, unknown>,
      ctx: ServiceContext,
    ): Promise<ServiceResult<unknown>> {
      const tool = tools[name];
      if (!tool) {
        throw new Error(`Unknown tool: ${name}`);
      }
      return tool.handler(input, ctx);
    },
  };
}
```

**Step 4: Create the HTTP server scaffold**

Create `packages/platform-services/src/mcp/server.ts`:

```typescript
import { Hono } from 'hono';
import type { MCPToolRouter } from './tools.js';
import type { ServiceContext } from '@eurocomply/types';

export function createMCPServer(router: MCPToolRouter) {
  const app = new Hono();

  // List available tools
  app.get('/mcp/tools', (c) => {
    return c.json(router.listTools());
  });

  // Call a tool
  app.post('/mcp/call', async (c) => {
    const body = await c.req.json() as {
      tool: string;
      input: Record<string, unknown>;
      context?: Partial<ServiceContext>;
    };

    // In production, context comes from auth middleware
    const ctx: ServiceContext = {
      tenant_id: body.context?.tenant_id ?? 'default',
      principal: body.context?.principal ?? { type: 'system', id: 'mcp-server' },
      correlation_id: body.context?.correlation_id ?? crypto.randomUUID(),
    };

    try {
      const result = await router.callTool(body.tool, body.input, ctx);
      return c.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return c.json({ success: false, data: null, error: message }, 400);
    }
  });

  // Health check
  app.get('/health', (c) => c.json({ status: 'ok' }));

  return app;
}
```

**Step 5: Run tests**

Run: `pnpm --filter @eurocomply/platform-services run test -- src/mcp/__tests__/server.test.ts`
Expected: PASS (3 tests)

**Step 6: Commit**

```bash
git add packages/platform-services/src/mcp/
git commit -m "feat(platform-services): add MCP server scaffold with tool router

MCPToolRouter maps tool names to service methods. Hono HTTP server
with /mcp/tools (list) and /mcp/call (invoke) endpoints.
All Phase 2 tools registered: entity, file, job, audit, evaluate."
```

---

### Task 12: Barrel Export + Build Verification

Wire up the package index, add vitest config, and verify the full build passes.

**Files:**
- Modify: `packages/platform-services/src/index.ts`
- Create: `packages/platform-services/vitest.config.ts`

**Step 1: Update package index**

Replace `packages/platform-services/src/index.ts` with:

```typescript
// Database
export { PostgresConnectionManager, type PostgresConfig } from './db/postgres.js';
export { Neo4jConnectionManager, type Neo4jConfig } from './db/neo4j.js';
export { runMigrations } from './db/migrate.js';

// Services
export { AuditLogger } from './services/audit.js';
export { EntityService } from './services/entity.js';
export { RelationService } from './services/relation.js';
export { FileService, type StorageBackend } from './services/file.js';
export { JobService } from './services/job.js';
export { LLMGateway, createAIBridge, type LLMProvider, type AIBridge } from './services/llm-gateway.js';

// Execution Loop
export { ExecutionLoop } from './execution-loop.js';

// MCP
export { createMCPToolRouter, type MCPToolRouter } from './mcp/tools.js';
export { createMCPServer } from './mcp/server.js';
```

**Step 2: Create vitest config**

Create `packages/platform-services/vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
```

**Step 3: Add necessary dependencies to package.json**

Update `packages/platform-services/package.json` to add the runtime and dev dependencies.

**Step 4: Run full build**

Run: `pnpm build`
Expected: All packages build successfully.

**Step 5: Run all platform-services tests**

Run: `pnpm --filter @eurocomply/platform-services run test`
Expected: All tests pass.

**Step 6: Commit**

```bash
git add packages/platform-services/src/index.ts packages/platform-services/vitest.config.ts packages/platform-services/package.json
git commit -m "feat(platform-services): add barrel exports and vitest config

All services exported from package index. Vitest configured
with extended timeouts for integration tests."
```

---

### Task 13: End-to-End Integration Test

Write a single integration test that exercises the complete execution loop: create entity type, create entity, create relation, evaluate compliance rule, verify audit trail. This proves the Phase 2 deliverables work together.

**Files:**
- Create: `packages/platform-services/src/__tests__/e2e.test.ts`

**Step 1: Write the end-to-end test**

Create `packages/platform-services/src/__tests__/e2e.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  PostgresConnectionManager,
  Neo4jConnectionManager,
  runMigrations,
  AuditLogger,
  EntityService,
  RelationService,
  FileService,
  JobService,
  ExecutionLoop,
  createMCPToolRouter,
  type StorageBackend,
} from '../index.js';
import { createDefaultRegistry } from '@eurocomply/kernel-vm';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import type { ServiceContext } from '@eurocomply/types';

class MemoryStorageBackend implements StorageBackend {
  private store = new Map<string, Buffer>();
  async put(key: string, data: Buffer): Promise<void> { this.store.set(key, data); }
  async get(key: string): Promise<Buffer | null> { return this.store.get(key) ?? null; }
  async delete(key: string): Promise<void> { this.store.delete(key); }
}

describe('E2E: Full Execution Loop', () => {
  let pgContainer: StartedPostgreSqlContainer;
  let neo4jContainer: StartedTestContainer;
  let db: PostgresConnectionManager;
  let neo4j: Neo4jConnectionManager;
  let entityService: EntityService;
  let relationService: RelationService;
  let executionLoop: ExecutionLoop;
  let audit: AuditLogger;

  const ctx: ServiceContext = {
    tenant_id: 'tenant_e2e',
    principal: { type: 'user', id: 'admin' },
    correlation_id: 'e2e_test',
  };

  beforeAll(async () => {
    pgContainer = await new PostgreSqlContainer().start();
    db = new PostgresConnectionManager({
      host: pgContainer.getHost(),
      port: pgContainer.getMappedPort(5432),
      database: pgContainer.getDatabase(),
      user: pgContainer.getUsername(),
      password: pgContainer.getPassword(),
    });
    await runMigrations(db);

    neo4jContainer = await new GenericContainer('neo4j:5')
      .withEnvironment({ NEO4J_AUTH: 'neo4j/testpassword' })
      .withExposedPorts(7687)
      .start();

    neo4j = new Neo4jConnectionManager({
      uri: `bolt://${neo4jContainer.getHost()}:${neo4jContainer.getMappedPort(7687)}`,
      username: 'neo4j',
      password: 'testpassword',
    });

    audit = new AuditLogger(db);
    entityService = new EntityService(db, audit);
    relationService = new RelationService(db, neo4j, audit);
    const registry = createDefaultRegistry();
    executionLoop = new ExecutionLoop(entityService, audit, registry, relationService);
  }, 120_000);

  afterAll(async () => {
    await neo4j.close();
    await db.close();
    await neo4jContainer.stop();
    await pgContainer.stop();
  });

  it('should complete full compliance evaluation lifecycle', async () => {
    // 1. Define entity types
    await entityService.defineType(ctx, {
      entity_type: 'cosmetic_product',
      schema: {
        fields: [
          { name: 'name', type: 'string', required: true },
          { name: 'lead_ppm', type: 'number' },
          { name: 'nickel_ppm', type: 'number' },
        ],
      },
    });

    await entityService.defineType(ctx, {
      entity_type: 'material',
      schema: {
        fields: [
          { name: 'name', type: 'string', required: true },
          { name: 'cas_number', type: 'string' },
        ],
      },
    });

    // 2. Create entities
    const product = await entityService.create(ctx, {
      entity_type: 'cosmetic_product',
      data: { name: 'Hand Cream', lead_ppm: 0.5, nickel_ppm: 0.1 },
    });
    expect(product.success).toBe(true);

    const material = await entityService.create(ctx, {
      entity_type: 'material',
      data: { name: 'Zinc Oxide', cas_number: '1314-13-2' },
    });
    expect(material.success).toBe(true);

    // 3. Define relation type, then create relation
    await relationService.defineType(ctx, {
      relation_type: 'CONTAINS',
      from_entity_type: 'cosmetic_product',
      to_entity_type: 'material',
      cardinality: 'n:n',
    });

    const relation = await relationService.create(ctx, {
      from_entity: { entity_type: 'cosmetic_product', entity_id: product.data.entity_id },
      to_entity: { entity_type: 'material', entity_id: material.data.entity_id },
      relation_type: 'CONTAINS',
      properties: { concentration: 0.05 },
    });
    expect(relation.success).toBe(true);

    // 4. Evaluate compliance rule (lead < 10 ppm)
    const evaluation = await executionLoop.evaluate(ctx, {
      entity_type: 'cosmetic_product',
      entity_id: product.data.entity_id,
      rule: {
        handler: 'core:threshold_check',
        config: {
          value: { field: 'lead_ppm' },
          operator: 'lt',
          threshold: 10,
        },
        label: 'Lead below 10 ppm limit',
      },
      compliance_lock_id: 'lock_e2e_1',
      vertical_id: 'cosmetics',
      market: 'EU',
    });

    expect(evaluation.success).toBe(true);
    expect(evaluation.data.handler_result.success).toBe(true);
    expect(evaluation.data.handler_result.value).toHaveProperty('pass', true);

    // 5. Verify audit trail
    const auditEntries = await audit.query(ctx.tenant_id, {
      resource_entity_id: product.data.entity_id,
    });
    // create + evaluate = at least 2 entries
    expect(auditEntries.length).toBeGreaterThanOrEqual(2);

    // 6. Verify relations in graph
    const relations = await relationService.list(ctx, {
      entity_type: 'cosmetic_product',
      entity_id: product.data.entity_id,
      direction: 'outgoing',
    });
    expect(relations.data.items.length).toBe(1);
    expect(relations.data.items[0].relation_type).toBe('CONTAINS');
  });

  it('should evaluate composed rules (AND gate)', async () => {
    const product = await entityService.create(ctx, {
      entity_type: 'cosmetic_product',
      data: { name: 'Eye Shadow', lead_ppm: 0.3, nickel_ppm: 0.05 },
    });

    const evaluation = await executionLoop.evaluate(ctx, {
      entity_type: 'cosmetic_product',
      entity_id: product.data.entity_id,
      rule: {
        handler: 'core:and',
        config: {
          conditions: [
            {
              handler: 'core:threshold_check',
              config: { value: { field: 'lead_ppm' }, operator: 'lt', threshold: 10 },
              label: 'Lead check',
            },
            {
              handler: 'core:threshold_check',
              config: { value: { field: 'nickel_ppm' }, operator: 'lt', threshold: 1 },
              label: 'Nickel check',
            },
          ],
        },
        label: 'Heavy metals compliance',
      },
      compliance_lock_id: 'lock_e2e_2',
      vertical_id: 'cosmetics',
      market: 'EU',
    });

    expect(evaluation.success).toBe(true);
    expect(evaluation.data.handler_result.value).toHaveProperty('pass', true);
  });
});
```

**Step 2: Run the e2e test**

Run: `pnpm --filter @eurocomply/platform-services run test -- src/__tests__/e2e.test.ts`
Expected: PASS (2 tests)

**Step 3: Run ALL tests**

Run: `pnpm test`
Expected: All packages pass (types, kernel-vm, platform-services).

**Step 4: Commit**

```bash
git add packages/platform-services/src/__tests__/e2e.test.ts
git commit -m "test(platform-services): add end-to-end integration test

Full lifecycle: define types → create entities → create relations →
evaluate compliance rule → verify audit trail. Proves the execution
loop works with real PostgreSQL and Neo4j via Testcontainers."
```

---

## Summary

| Task | Deliverable | Test Strategy |
|------|-------------|---------------|
| 1 | Platform service types (Principal, ServiceContext, AuditEntry, FilterExpression, etc.) | Build verification |
| 2 | Database connection layer (PostgreSQL + Neo4j) | Integration test with Testcontainers |
| 3 | Schema migrations (entities, files, audit_log, jobs, relation_types) | Integration test |
| 4 | Audit logger | Integration test |
| 5 | Entity service (create, get, list+FilterExpression, update) | Integration test |
| 6 | Relation service (define+cardinality, create+enforcement, list) | Integration test with Neo4j |
| 7 | File service (upload, get) | Integration test with storage backend |
| 8 | Job queue (submit, status, claim, complete) | Integration test |
| 9 | LLM Gateway (generate, extract) + AIBridge for kernel-vm | Unit test with mock provider |
| 10 | Execution loop (graph pre-load + AI pre-eval + VM + persist) | Integration test |
| 11 | MCP tool router + HTTP scaffold (MCP protocol in spoke-runtime) | Integration test |
| 12 | Barrel exports + build verification | Build + test |
| 13 | E2E integration test | Full lifecycle with real DBs |

**Total: 13 tasks, ~35+ tests, all with real databases (no mocks for DB operations)**

## Gaps Addressed

This plan addresses the following architectural requirements from the design:

1. **Context pre-loading** (Task 10): ExecutionLoop walks rule ASTs for `{ data_key }` references, queries Neo4j via RelationService, and populates `ExecutionContext.data` before VM evaluation.

2. **Computed fields** (Task 5): EntityService's schema-driven architecture supports computed field definitions. Full computed field pipeline (invoke kernel-vm on entity mutations) will be wired in Phase 3 when entity schemas are enriched with `computed` declarations.

3. **AI Bridge** (Task 9): `AIBridge` interface and `createAIBridge()` factory connect kernel-vm AI handler contracts to LLM Gateway. Since the evaluator is synchronous, the execution loop pre-evaluates `ai:*` nodes and injects results into `context.data`.

4. **MCP Protocol** (Task 11): MCPToolRouter is the internal dispatch layer. The full MCP protocol (JSON-RPC 2.0 via `@modelcontextprotocol/sdk`) will be wired in `apps/spoke-runtime`.

5. **FilterExpression** (Task 5): `entity:list` accepts a recursive `FilterExpression` AST, translated to parameterized SQL with AND/OR/NOT + field comparisons.

6. **relation:define** (Task 6): Relation type definitions with cardinality (`1:1`, `1:n`, `n:1`, `n:n`), constraints, inverse types, and cascade rules. Cardinality enforced on `relation:create`.
