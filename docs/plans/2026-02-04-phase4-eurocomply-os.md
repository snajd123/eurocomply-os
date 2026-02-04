# Phase 4: The Registry (Pack Lifecycle) — eurocomply-os Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the machinery to install, version, publish, and manage Packs dynamically — turning the hardcoded Phase 3 vertical slice into a proper pack lifecycle with Compliance Locks, dependency resolution, and a Hub Registry API.

**Architecture:** The registry-sdk gains pack installation (dependency resolution + Simulator validation + Compliance Lock generation). The hub-control-plane gets a Registry API (Hono HTTP) for publishing and discovering packs. The spoke-runtime gains pack installation on boot. The CLI gets a `publish` command. New types (ComplianceLock, Environment/Driver/Intelligence pack schemas) are added to the types package. The Simulator gains portfolio diff capability (evaluate a rule change against existing entities).

**Tech Stack:** TypeScript, Zod (schema validation), Hono (Hub HTTP server), Vitest (testing), PostgreSQL (testcontainers for tests)

**Prerequisites:** Phase 3 complete (kernel-vm, platform-services, registry-sdk with PackLoader, CLI lint/test, spoke-runtime boot).

---

## Dependency Order

```
Task 1: Extended pack manifest + ComplianceLock types (types/)
  ↓
Task 2: Pack installer — dependency resolution + lock generation (registry-sdk/)
  ↓
Task 3: Simulator portfolio diff (kernel-vm/)
  ↓
Task 4: Pack installation service (platform-services/)
  ↓
Task 5: Registry MCP tools — registry:install, registry:list, registry:lock (platform-services/)
  ↓
Task 6: Hub Registry API — pack:publish, pack:search, pack:versions (hub-control-plane/)
  ↓
Task 7: CLI publish command (cli/)
  ↓
Task 8: Spoke boot pack installation (spoke-runtime/)
  ↓
Task 9: E2E integration test — publish → install → evaluate → lock (spoke-runtime/)
```

Tasks 3 and 4 are independent of each other after Task 2. Task 6 is independent of Tasks 3-5 after Task 1.

---

### Task 1: Extended Pack Manifest + ComplianceLock Types

**Files:**
- Modify: `packages/types/src/pack-manifest.ts`
- Create: `packages/types/src/compliance-lock.ts`
- Modify: `packages/types/src/index.ts`

**Context:** Phase 3 added a minimal PackManifest. Phase 4 extends it with `author`, `trust_tier`, `dependencies`, `required_schemas`, `conflict_resolution`, and `documentation_root`. A new ComplianceLock type pins exact pack versions + content hashes for deterministic replay. Both are Zod schemas in the types package. Refer to `design/docs/2026-02-03-registry-design.md` §2 and §3.3 for the full spec.

**Step 1: Extend PackManifestSchema**

In `packages/types/src/pack-manifest.ts`, add these fields to the existing schema:

```typescript
import { z } from 'zod';

export const PackAuthorSchema = z.object({
  name: z.string(),
  did: z.string().optional(),
});

export type PackAuthor = z.infer<typeof PackAuthorSchema>;

export const TrustTierSchema = z.enum(['community', 'verified', 'certified']);
export type TrustTier = z.infer<typeof TrustTierSchema>;

export const PackManifestSchema = z.object({
  name: z.string().regex(/^@[a-z0-9-]+\/[a-z0-9-]+$/, 'Pack name must be scoped: @scope/name'),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'Version must be semver: X.Y.Z'),
  type: z.enum(['logic', 'environment', 'driver', 'intelligence']),

  author: PackAuthorSchema.optional(),
  trust_tier: TrustTierSchema.optional(),

  handler_vm_version: z.string().optional(),

  dependencies: z.record(z.string(), z.string()).optional(),

  required_schemas: z.array(z.object({
    id: z.string(),
    version: z.string(),
  })).optional(),

  scope: z.object({
    verticals: z.array(z.string()).optional(),
    markets: z.array(z.string()).optional(),
    entity_types: z.array(z.string()).optional(),
  }).optional(),

  regulation_ref: z.string().optional(),

  logic_root: z.string().optional(),
  validation_suite: z.string().optional(),
  validation_hash: z.string().optional(),
  documentation_root: z.string().optional(),

  conflict_resolution: z.object({
    strategy: z.enum(['most_restrictive', 'explicit_priority', 'merge']),
    overridable: z.boolean().optional(),
  }).optional(),
});

export type PackManifest = z.infer<typeof PackManifestSchema>;
```

**Step 2: Create ComplianceLock schema**

Create `packages/types/src/compliance-lock.ts`:

```typescript
import { z } from 'zod';

export const LockedPackSchema = z.object({
  version: z.string(),
  cid: z.string(),
  signature: z.string().optional(),
  publisher_did: z.string().optional(),
  trust_tier: z.enum(['community', 'verified', 'certified']).optional(),
});

export type LockedPack = z.infer<typeof LockedPackSchema>;

export const LockedSchemaSchema = z.object({
  version: z.string(),
  cid: z.string(),
});

export type LockedSchema = z.infer<typeof LockedSchemaSchema>;

export const ComplianceLockSchema = z.object({
  lock_id: z.string(),
  tenant_id: z.string(),
  timestamp: z.string(),
  handler_vm_exact: z.string(),

  root_pack: z.object({
    name: z.string(),
    version: z.string(),
    cid: z.string(),
  }),

  packs: z.record(z.string(), LockedPackSchema),
  schemas: z.record(z.string(), LockedSchemaSchema).optional(),

  status: z.enum(['active', 'superseded', 'rolled_back']).optional(),
});

export type ComplianceLock = z.infer<typeof ComplianceLockSchema>;
```

**Step 3: Export from types index**

In `packages/types/src/index.ts`, add:

```typescript
export { PackAuthorSchema, TrustTierSchema, PackManifestSchema } from './pack-manifest.js';
export type { PackAuthor, TrustTier, PackManifest } from './pack-manifest.js';

export { LockedPackSchema, LockedSchemaSchema, ComplianceLockSchema } from './compliance-lock.js';
export type { LockedPack, LockedSchema, ComplianceLock } from './compliance-lock.js';
```

Note: Remove the old `PackManifestSchema` export line and replace with the new one that also exports `PackAuthorSchema` and `TrustTierSchema`.

**Step 4: Build and verify**

Run: `pnpm build`
Expected: All packages build cleanly. Existing tests still pass.

**Step 5: Commit**

```
feat(types): extend PackManifest with author, trust_tier, dependencies; add ComplianceLock schema
```

---

### Task 2: Pack Installer — Dependency Resolution + Lock Generation

**Files:**
- Create: `packages/registry-sdk/src/pack-installer.ts`
- Create: `packages/registry-sdk/src/pack-installer.test.ts`
- Modify: `packages/registry-sdk/src/index.ts`

**Context:** The pack installer takes a loaded pack, resolves its dependencies (for Phase 4, dependencies are other pack directories on disk — no network registry yet), validates all packs via the Simulator, and generates a ComplianceLock. The installer returns a `PackInstallPlan` describing what needs to be installed. Actual database writes happen in platform-services (Task 4).

The dependency resolution for Phase 4 is simple: read `manifest.dependencies`, look them up in a provided `packsByName` map (pre-loaded from disk). Full network resolution comes in later phases.

**Step 1: Write the failing test**

Create `packages/registry-sdk/src/pack-installer.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createInstallPlan } from './pack-installer.js';
import { loadPack } from './pack-loader.js';
import { createDefaultRegistry } from '@eurocomply/kernel-vm';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('PackInstaller', () => {
  const baseDir = join(tmpdir(), `pack-installer-test-${Date.now()}`);
  const mainPackDir = join(baseDir, 'main-pack');
  const depPackDir = join(baseDir, 'dep-pack');

  beforeAll(() => {
    // Dependency pack
    mkdirSync(join(depPackDir, 'rules'), { recursive: true });
    mkdirSync(join(depPackDir, 'tests'), { recursive: true });
    writeFileSync(join(depPackDir, 'pack.json'), JSON.stringify({
      name: '@test/dep-pack',
      version: '1.0.0',
      type: 'logic',
      logic_root: 'rules/main.ast.json',
      validation_suite: 'tests/validation_suite.json',
    }));
    writeFileSync(join(depPackDir, 'rules', 'main.ast.json'), JSON.stringify({
      handler: 'core:threshold_check',
      config: { value: { field: 'x' }, operator: 'lt', threshold: 100 },
      label: 'X below 100',
    }));
    writeFileSync(join(depPackDir, 'tests', 'validation_suite.json'), JSON.stringify({
      vertical_id: 'test',
      test_cases: [
        { id: 'pass', description: 'Pass', entity_data: { x: 50 }, expected_status: 'compliant' },
      ],
    }));

    // Main pack with dependency
    mkdirSync(join(mainPackDir, 'rules'), { recursive: true });
    mkdirSync(join(mainPackDir, 'tests'), { recursive: true });
    writeFileSync(join(mainPackDir, 'pack.json'), JSON.stringify({
      name: '@test/main-pack',
      version: '2.0.0',
      type: 'logic',
      dependencies: { '@test/dep-pack': '^1.0.0' },
      logic_root: 'rules/main.ast.json',
      validation_suite: 'tests/validation_suite.json',
    }));
    writeFileSync(join(mainPackDir, 'rules', 'main.ast.json'), JSON.stringify({
      handler: 'core:threshold_check',
      config: { value: { field: 'y' }, operator: 'lt', threshold: 10 },
      label: 'Y below 10',
    }));
    writeFileSync(join(mainPackDir, 'tests', 'validation_suite.json'), JSON.stringify({
      vertical_id: 'test',
      test_cases: [
        { id: 'pass', description: 'Pass', entity_data: { y: 5 }, expected_status: 'compliant' },
      ],
    }));
  });

  afterAll(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it('should create an install plan with resolved dependencies', async () => {
    const registry = createDefaultRegistry();
    const mainPack = await loadPack(mainPackDir);
    const depPack = await loadPack(depPackDir);

    const plan = await createInstallPlan(mainPack, {
      availablePacks: { '@test/dep-pack': depPack },
      registry,
      handlerVmVersion: '1.0.0',
      tenantId: 'test-tenant',
    });

    expect(plan.valid).toBe(true);
    expect(plan.packsToInstall).toHaveLength(2);
    expect(plan.lock.root_pack.name).toBe('@test/main-pack');
    expect(plan.lock.packs['@test/dep-pack@1.0.0']).toBeDefined();
    expect(plan.lock.packs['@test/main-pack@2.0.0']).toBeDefined();
  });

  it('should fail if dependency is missing', async () => {
    const registry = createDefaultRegistry();
    const mainPack = await loadPack(mainPackDir);

    const plan = await createInstallPlan(mainPack, {
      availablePacks: {},
      registry,
      handlerVmVersion: '1.0.0',
      tenantId: 'test-tenant',
    });

    expect(plan.valid).toBe(false);
    expect(plan.errors.length).toBeGreaterThan(0);
    expect(plan.errors[0]).toContain('@test/dep-pack');
  });

  it('should validate all packs via Simulator', async () => {
    const registry = createDefaultRegistry();
    const mainPack = await loadPack(mainPackDir);
    const depPack = await loadPack(depPackDir);

    const plan = await createInstallPlan(mainPack, {
      availablePacks: { '@test/dep-pack': depPack },
      registry,
      handlerVmVersion: '1.0.0',
      tenantId: 'test-tenant',
    });

    expect(plan.valid).toBe(true);
    expect(plan.simulationResults).toHaveLength(2);
    for (const result of plan.simulationResults) {
      expect(result.allPassed).toBe(true);
    }
  });
});
```

**Step 2: Write the implementation**

Create `packages/registry-sdk/src/pack-installer.ts`:

```typescript
import { Simulator, createDefaultRegistry } from '@eurocomply/kernel-vm';
import type { HandlerRegistry } from '@eurocomply/kernel-vm';
import type { ComplianceLock } from '@eurocomply/types';
import type { LoadedPack } from './pack-loader.js';
import { createHash } from 'crypto';

export interface PackInstallOptions {
  availablePacks: Record<string, LoadedPack>;
  registry: HandlerRegistry;
  handlerVmVersion: string;
  tenantId: string;
}

export interface SimulationResult {
  packName: string;
  total: number;
  passed: number;
  failed: number;
  allPassed: boolean;
  astValid: boolean;
}

export interface PackInstallPlan {
  valid: boolean;
  errors: string[];
  packsToInstall: LoadedPack[];
  simulationResults: SimulationResult[];
  lock: ComplianceLock;
}

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export async function createInstallPlan(
  rootPack: LoadedPack,
  options: PackInstallOptions,
): Promise<PackInstallPlan> {
  const errors: string[] = [];
  const resolved: LoadedPack[] = [];
  const visited = new Set<string>();

  // Resolve dependency tree (BFS)
  function resolve(pack: LoadedPack): void {
    const key = `${pack.manifest.name}@${pack.manifest.version}`;
    if (visited.has(key)) return;
    visited.add(key);

    if (pack.manifest.dependencies) {
      for (const [depName, _versionRange] of Object.entries(pack.manifest.dependencies)) {
        const depPack = options.availablePacks[depName];
        if (!depPack) {
          errors.push(`Missing dependency: ${depName} required by ${pack.manifest.name}`);
          continue;
        }
        resolve(depPack);
      }
    }
    resolved.push(pack);
  }

  resolve(rootPack);

  if (errors.length > 0) {
    return {
      valid: false,
      errors,
      packsToInstall: [],
      simulationResults: [],
      lock: createEmptyLock(rootPack, options),
    };
  }

  // Run Simulator on each pack with a validation suite
  const simulator = new Simulator(options.registry);
  const simulationResults: SimulationResult[] = [];

  for (const pack of resolved) {
    if (pack.ruleAST && pack.validationSuite) {
      const report = simulator.run(pack.ruleAST, pack.validationSuite);
      const result: SimulationResult = {
        packName: pack.manifest.name,
        total: report.total,
        passed: report.passed,
        failed: report.failed,
        allPassed: report.ast_valid && report.failed === 0,
        astValid: report.ast_valid,
      };
      simulationResults.push(result);

      if (!result.allPassed) {
        errors.push(`Simulation failed for ${pack.manifest.name}: ${report.failed}/${report.total} tests failed`);
      }
    } else {
      // Non-logic packs (environment, driver, intelligence) don't require simulation
      simulationResults.push({
        packName: pack.manifest.name,
        total: 0, passed: 0, failed: 0,
        allPassed: true,
        astValid: true,
      });
    }
  }

  if (errors.length > 0) {
    return {
      valid: false,
      errors,
      packsToInstall: resolved,
      simulationResults,
      lock: createEmptyLock(rootPack, options),
    };
  }

  // Generate ComplianceLock
  const packs: ComplianceLock['packs'] = {};
  for (const pack of resolved) {
    const key = `${pack.manifest.name}@${pack.manifest.version}`;
    const manifestStr = JSON.stringify(pack.manifest);
    packs[key] = {
      version: pack.manifest.version,
      cid: hashContent(manifestStr),
      trust_tier: pack.manifest.trust_tier,
      publisher_did: pack.manifest.author?.did,
    };
  }

  const lock: ComplianceLock = {
    lock_id: `lock_${Date.now()}`,
    tenant_id: options.tenantId,
    timestamp: new Date().toISOString(),
    handler_vm_exact: options.handlerVmVersion,
    root_pack: {
      name: rootPack.manifest.name,
      version: rootPack.manifest.version,
      cid: hashContent(JSON.stringify(rootPack.manifest)),
    },
    packs,
    status: 'active',
  };

  return {
    valid: true,
    errors: [],
    packsToInstall: resolved,
    simulationResults,
    lock,
  };
}

function createEmptyLock(rootPack: LoadedPack, options: PackInstallOptions): ComplianceLock {
  return {
    lock_id: `lock_${Date.now()}`,
    tenant_id: options.tenantId,
    timestamp: new Date().toISOString(),
    handler_vm_exact: options.handlerVmVersion,
    root_pack: {
      name: rootPack.manifest.name,
      version: rootPack.manifest.version,
      cid: '',
    },
    packs: {},
  };
}
```

**Step 3: Export from index**

In `packages/registry-sdk/src/index.ts`, add:

```typescript
export { createInstallPlan, type PackInstallPlan, type PackInstallOptions, type SimulationResult } from './pack-installer.js';
```

**Step 4: Run tests**

Run: `cd packages/registry-sdk && pnpm test`
Expected: All tests pass (4 pack-loader + 3 pack-installer = 7).

**Step 5: Build**

Run: `pnpm build`
Expected: Clean build.

**Step 6: Commit**

```
feat(registry-sdk): add pack installer with dependency resolution and lock generation
```

---

### Task 3: Simulator Portfolio Diff

**Files:**
- Create: `packages/kernel-vm/src/portfolio-diff.ts`
- Create: `packages/kernel-vm/src/portfolio-diff.test.ts`
- Modify: `packages/kernel-vm/src/index.ts`

**Context:** Before installing a pack on an existing spoke, the Simulator must assess impact: "How many existing entities will change compliance status?" The portfolio diff evaluates a rule AST against a set of entity data records (the tenant's existing products) and reports which ones change status. This is a pure computation — no I/O. Entity data is passed in as an array.

**Step 1: Write the failing test**

Create `packages/kernel-vm/src/portfolio-diff.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { portfolioDiff } from './portfolio-diff.js';
import { createDefaultRegistry } from './registry.js';
import type { ASTNode } from '@eurocomply/types';

describe('Portfolio Diff', () => {
  const registry = createDefaultRegistry();

  const oldRule: ASTNode = {
    handler: 'core:threshold_check',
    config: { value: { field: 'lead_ppm' }, operator: 'lt', threshold: 20 },
    label: 'Lead below 20 ppm',
  };

  const newRule: ASTNode = {
    handler: 'core:threshold_check',
    config: { value: { field: 'lead_ppm' }, operator: 'lt', threshold: 10 },
    label: 'Lead below 10 ppm (stricter)',
  };

  const entities = [
    { entity_id: 'p1', entity_type: 'product', data: { lead_ppm: 5 } },
    { entity_id: 'p2', entity_type: 'product', data: { lead_ppm: 15 } },
    { entity_id: 'p3', entity_type: 'product', data: { lead_ppm: 25 } },
  ];

  it('should detect status changes when rule becomes stricter', () => {
    const diff = portfolioDiff({ oldRule, newRule, entities, registry, verticalId: 'test' });

    expect(diff.totalEvaluated).toBe(3);
    // p1: pass→pass (no change), p2: pass→fail (changed), p3: fail→fail (no change)
    expect(diff.statusChanges).toHaveLength(1);
    expect(diff.statusChanges[0].entity_id).toBe('p2');
    expect(diff.statusChanges[0].oldStatus).toBe('compliant');
    expect(diff.statusChanges[0].newStatus).toBe('non_compliant');
  });

  it('should report no changes when rules are identical', () => {
    const diff = portfolioDiff({ oldRule, newRule: oldRule, entities, registry, verticalId: 'test' });
    expect(diff.statusChanges).toHaveLength(0);
  });

  it('should handle first-time install (no old rule)', () => {
    const diff = portfolioDiff({ oldRule: null, newRule, entities, registry, verticalId: 'test' });
    expect(diff.totalEvaluated).toBe(3);
    // All are "new" evaluations — reported as changes from 'unknown' to actual status
    expect(diff.newEvaluations).toBe(3);
  });
});
```

**Step 2: Write the implementation**

Create `packages/kernel-vm/src/portfolio-diff.ts`:

```typescript
import { evaluate } from './evaluator.js';
import type { HandlerRegistry } from './registry.js';
import type { ASTNode, ExecutionContext } from '@eurocomply/types';

export interface EntityRecord {
  entity_id: string;
  entity_type: string;
  data: Record<string, unknown>;
}

export interface StatusChange {
  entity_id: string;
  entity_type: string;
  oldStatus: 'compliant' | 'non_compliant' | 'unknown';
  newStatus: 'compliant' | 'non_compliant';
}

export interface PortfolioDiffInput {
  oldRule: ASTNode | null;
  newRule: ASTNode;
  entities: EntityRecord[];
  registry: HandlerRegistry;
  verticalId: string;
}

export interface PortfolioDiffResult {
  totalEvaluated: number;
  statusChanges: StatusChange[];
  newEvaluations: number;
  unchangedCompliant: number;
  unchangedNonCompliant: number;
}

function evaluateEntity(
  rule: ASTNode,
  entity: EntityRecord,
  registry: HandlerRegistry,
  verticalId: string,
): 'compliant' | 'non_compliant' {
  const ctx: ExecutionContext = {
    entity_type: entity.entity_type,
    entity_id: entity.entity_id,
    entity_data: entity.data,
    data: {},
    compliance_lock_id: 'portfolio-diff',
    vertical_id: verticalId,
    market: 'diff',
    timestamp: new Date().toISOString(),
  };
  const result = evaluate(rule, ctx, registry);
  return result.success ? 'compliant' : 'non_compliant';
}

export function portfolioDiff(input: PortfolioDiffInput): PortfolioDiffResult {
  const statusChanges: StatusChange[] = [];
  let newEvaluations = 0;
  let unchangedCompliant = 0;
  let unchangedNonCompliant = 0;

  for (const entity of input.entities) {
    const newStatus = evaluateEntity(input.newRule, entity, input.registry, input.verticalId);

    if (input.oldRule === null) {
      newEvaluations++;
      continue;
    }

    const oldStatus = evaluateEntity(input.oldRule, entity, input.registry, input.verticalId);

    if (oldStatus !== newStatus) {
      statusChanges.push({
        entity_id: entity.entity_id,
        entity_type: entity.entity_type,
        oldStatus,
        newStatus,
      });
    } else if (newStatus === 'compliant') {
      unchangedCompliant++;
    } else {
      unchangedNonCompliant++;
    }
  }

  return {
    totalEvaluated: input.entities.length,
    statusChanges,
    newEvaluations,
    unchangedCompliant,
    unchangedNonCompliant,
  };
}
```

**Step 3: Export from index**

In `packages/kernel-vm/src/index.ts`, add:

```typescript
export { portfolioDiff, type PortfolioDiffInput, type PortfolioDiffResult, type StatusChange, type EntityRecord } from './portfolio-diff.js';
```

**Step 4: Run tests**

Run: `cd packages/kernel-vm && pnpm test`
Expected: All tests pass (existing 73 + 3 new = 76).

**Step 5: Build**

Run: `pnpm build`
Expected: Clean build.

**Step 6: Commit**

```
feat(kernel-vm): add portfolio diff for evaluating rule change impact on existing entities
```

---

### Task 4: Pack Installation Service

**Files:**
- Create: `packages/platform-services/src/services/pack.ts`
- Create: `packages/platform-services/src/services/__tests__/pack.test.ts`
- Create: `packages/platform-services/src/db/migrations/002-pack-tables.sql`
- Modify: `packages/platform-services/src/db/migrate.ts` (include new migration)
- Modify: `packages/platform-services/src/index.ts`

**Context:** The PackService manages installed packs and compliance locks in PostgreSQL. It stores the manifest, tracks installation status, and persists ComplianceLocks. This is a Platform Service (stateful) — the pure computation (Simulator, dependency resolution) lives in registry-sdk/kernel-vm.

**Step 1: Create the migration**

Create `packages/platform-services/src/db/migrations/002-pack-tables.sql`:

```sql
-- Installed packs
CREATE TABLE installed_packs (
  tenant_id TEXT NOT NULL,
  pack_name TEXT NOT NULL,
  pack_version TEXT NOT NULL,
  pack_type TEXT NOT NULL,
  manifest JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  installed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, pack_name)
);

CREATE INDEX idx_installed_packs_type ON installed_packs(pack_type);

-- Compliance locks
CREATE TABLE compliance_locks (
  lock_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  root_pack_name TEXT NOT NULL,
  lock_data JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_compliance_locks_tenant ON compliance_locks(tenant_id);
CREATE INDEX idx_compliance_locks_root ON compliance_locks(root_pack_name);
```

**Step 2: Update migrate.ts**

Read `packages/platform-services/src/db/migrate.ts` to understand how migrations are loaded. The current implementation reads SQL files from the migrations directory. The new `002-pack-tables.sql` file should be picked up automatically if the migration runner processes files in order. Verify this — if the migration runner uses a hardcoded list, add `002-pack-tables.sql` to it.

**Step 3: Create the PackService**

Create `packages/platform-services/src/services/pack.ts`:

```typescript
import type { Queryable } from '../db/postgres.js';
import type { PostgresConnectionManager } from '../db/postgres.js';
import type { PlatformServiceContext } from '../context.js';
import type { ComplianceLock, PackManifest } from '@eurocomply/types';
import type { ServiceResult } from '@eurocomply/types';
import type { AuditLogger } from './audit.js';

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

    const row = result.rows[0];
    const installed: InstalledPack = {
      pack_name: row.pack_name,
      pack_version: row.pack_version,
      pack_type: row.pack_type,
      manifest: JSON.parse(row.manifest),
      status: row.status,
      installed_at: row.installed_at,
    };

    await this.audit.log(ctx, {
      action: 'pack:install',
      resource_type: 'pack',
      resource_entity_id: manifest.name,
      details: { version: manifest.version, type: manifest.type },
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
      manifest: JSON.parse(row.manifest),
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
      resource_type: 'compliance_lock',
      resource_entity_id: lock.lock_id,
      details: { root_pack: lock.root_pack.name, packs_count: Object.keys(lock.packs).length },
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
      return { success: false, data: null as any, error: `Lock not found: ${lockId}` };
    }

    return { success: true, data: JSON.parse(result.rows[0].lock_data) };
  }

  async listLocks(
    ctx: PlatformServiceContext,
  ): Promise<ServiceResult<{ items: ComplianceLock[]; total: number }>> {
    const db: Queryable = ctx.tx ?? this.db;

    const result = await db.query(
      `SELECT lock_data FROM compliance_locks WHERE tenant_id = $1 AND status = 'active' ORDER BY created_at DESC`,
      [ctx.tenant_id],
    );

    const items = result.rows.map((row: any) => JSON.parse(row.lock_data));
    return { success: true, data: { items, total: items.length } };
  }
}
```

**Step 4: Write the test**

Create `packages/platform-services/src/services/__tests__/pack.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PackService } from '../pack.js';
import { AuditLogger } from '../audit.js';
import { PostgresConnectionManager } from '../../db/postgres.js';
import { runMigrations } from '../../db/migrate.js';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { PlatformServiceContext } from '../../context.js';

describe('PackService', () => {
  let container: StartedPostgreSqlContainer;
  let db: PostgresConnectionManager;
  let packService: PackService;

  const ctx: PlatformServiceContext = {
    tenant_id: 'test-tenant',
    principal: { type: 'system', id: 'test' },
    correlation_id: 'pack-test',
  };

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    db = new PostgresConnectionManager({
      host: container.getHost(),
      port: container.getMappedPort(5432),
      database: container.getDatabase(),
      user: container.getUsername(),
      password: container.getPassword(),
    });
    await runMigrations(db);
    const audit = new AuditLogger(db);
    packService = new PackService(db, audit);
  }, 60_000);

  afterAll(async () => {
    await db.close();
    await container.stop();
  });

  it('should install a pack', async () => {
    const result = await packService.install(ctx, {
      name: '@test/sample-pack',
      version: '1.0.0',
      type: 'logic',
    });
    expect(result.success).toBe(true);
    expect(result.data.pack_name).toBe('@test/sample-pack');
    expect(result.data.status).toBe('active');
  });

  it('should list installed packs', async () => {
    const result = await packService.list(ctx);
    expect(result.success).toBe(true);
    expect(result.data.total).toBe(1);
    expect(result.data.items[0].pack_name).toBe('@test/sample-pack');
  });

  it('should save and retrieve a compliance lock', async () => {
    const lock = {
      lock_id: 'test-lock-1',
      tenant_id: ctx.tenant_id,
      timestamp: new Date().toISOString(),
      handler_vm_exact: '1.0.0',
      root_pack: { name: '@test/sample-pack', version: '1.0.0', cid: 'abc123' },
      packs: {
        '@test/sample-pack@1.0.0': { version: '1.0.0', cid: 'abc123' },
      },
      status: 'active' as const,
    };

    const saveResult = await packService.saveLock(ctx, lock);
    expect(saveResult.success).toBe(true);

    const getResult = await packService.getLock(ctx, 'test-lock-1');
    expect(getResult.success).toBe(true);
    expect(getResult.data.root_pack.name).toBe('@test/sample-pack');
    expect(getResult.data.packs['@test/sample-pack@1.0.0'].cid).toBe('abc123');
  });

  it('should update an existing pack on re-install', async () => {
    const result = await packService.install(ctx, {
      name: '@test/sample-pack',
      version: '2.0.0',
      type: 'logic',
    });
    expect(result.success).toBe(true);
    expect(result.data.pack_version).toBe('2.0.0');

    const listResult = await packService.list(ctx);
    expect(listResult.data.total).toBe(1);
    expect(listResult.data.items[0].pack_version).toBe('2.0.0');
  });
});
```

**Step 5: Export from index**

In `packages/platform-services/src/index.ts`, add:

```typescript
export { PackService, type InstalledPack } from './services/pack.js';
```

**Step 6: Run tests**

Run: `cd packages/platform-services && pnpm test`
Expected: All tests pass (existing + 4 new).

**Step 7: Build**

Run: `pnpm build`
Expected: Clean build.

**Step 8: Commit**

```
feat(platform-services): add PackService for installed packs and compliance locks
```

---

### Task 5: Registry MCP Tools

**Files:**
- Modify: `packages/platform-services/src/mcp/tools.ts`

**Context:** Add `registry:*` namespace tools to the MCP router. These tools delegate to the PackService. Phase 4 scope: `registry:install` (install a pack from manifest), `registry:list` (list installed packs), `registry:lock` (get/list compliance locks). Full registry tools (search, publish, bump, diff) come in later phases when the Hub Registry API is mature.

**Step 1: Update the tools router**

In `packages/platform-services/src/mcp/tools.ts`:

1. Add `PackService` to the `MCPToolRouterDeps` interface:
   ```typescript
   packService?: PackService;
   ```

2. Add registry tools (conditionally, if packService is provided):

```typescript
  if (deps.packService) {
    tools['registry:install'] = {
      definition: { name: 'registry:install', description: 'Install a pack from manifest' },
      handler: (input, ctx) => deps.packService!.install(ctx, input as any),
    };
    tools['registry:list'] = {
      definition: { name: 'registry:list', description: 'List installed packs' },
      handler: (input, ctx) => deps.packService!.list(ctx),
    };
    tools['registry:lock'] = {
      definition: { name: 'registry:lock', description: 'Get a compliance lock by ID' },
      handler: (input, ctx) => deps.packService!.getLock(ctx, (input as any).lock_id),
    };
    tools['registry:locks'] = {
      definition: { name: 'registry:locks', description: 'List compliance locks' },
      handler: (input, ctx) => deps.packService!.listLocks(ctx),
    };
    tools['registry:save-lock'] = {
      definition: { name: 'registry:save-lock', description: 'Save a compliance lock' },
      handler: (input, ctx) => deps.packService!.saveLock(ctx, input as any),
    };
  }
```

**Step 2: Build and verify**

Run: `pnpm build`
Expected: Clean build.

**Step 3: Commit**

```
feat(platform-services): add registry:* MCP tools for pack and lock management
```

---

### Task 6: Hub Registry API

**Files:**
- Create: `apps/hub-control-plane/src/registry-api.ts`
- Create: `apps/hub-control-plane/src/registry-api.test.ts`
- Create: `apps/hub-control-plane/src/registry-store.ts`
- Modify: `apps/hub-control-plane/src/index.ts`
- Modify: `apps/hub-control-plane/package.json`

**Context:** The Hub Registry API is a Hono HTTP server that stores published packs (manifest + content) and serves them to Spokes and the CLI. For Phase 4, packs are stored in-memory (production will use object storage + PostgreSQL). The API supports: `POST /packs` (publish), `GET /packs` (search), `GET /packs/:name/:version` (get specific version), `GET /packs/:name/versions` (list versions).

**Step 1: Add dependencies**

In `apps/hub-control-plane/package.json`, add to dependencies:

```json
"hono": "^4.0.0"
```

Add to devDependencies:

```json
"vitest": "^3.0.0"
```

Run: `pnpm install`

**Step 2: Create the registry store**

Create `apps/hub-control-plane/src/registry-store.ts`:

```typescript
import type { PackManifest } from '@eurocomply/types';

export interface PublishedPack {
  manifest: PackManifest;
  content: Record<string, unknown>;
  publishedAt: string;
  cid: string;
}

export class RegistryStore {
  private packs = new Map<string, Map<string, PublishedPack>>();

  publish(manifest: PackManifest, content: Record<string, unknown>, cid: string): PublishedPack {
    if (!this.packs.has(manifest.name)) {
      this.packs.set(manifest.name, new Map());
    }
    const published: PublishedPack = {
      manifest,
      content,
      publishedAt: new Date().toISOString(),
      cid,
    };
    this.packs.get(manifest.name)!.set(manifest.version, published);
    return published;
  }

  get(name: string, version: string): PublishedPack | null {
    return this.packs.get(name)?.get(version) ?? null;
  }

  getLatest(name: string): PublishedPack | null {
    const versions = this.packs.get(name);
    if (!versions || versions.size === 0) return null;
    const sorted = Array.from(versions.keys()).sort().reverse();
    return versions.get(sorted[0]) ?? null;
  }

  listVersions(name: string): string[] {
    const versions = this.packs.get(name);
    if (!versions) return [];
    return Array.from(versions.keys()).sort().reverse();
  }

  search(query?: { type?: string; vertical?: string }): PublishedPack[] {
    const results: PublishedPack[] = [];
    for (const versions of this.packs.values()) {
      for (const pack of versions.values()) {
        if (query?.type && pack.manifest.type !== query.type) continue;
        if (query?.vertical && !pack.manifest.scope?.verticals?.includes(query.vertical)) continue;
        results.push(pack);
      }
    }
    return results;
  }
}
```

**Step 3: Create the registry API**

Create `apps/hub-control-plane/src/registry-api.ts`:

```typescript
import { Hono } from 'hono';
import { PackManifestSchema } from '@eurocomply/types';
import { RegistryStore } from './registry-store.js';
import { createHash } from 'crypto';

export function createRegistryAPI(store: RegistryStore) {
  const app = new Hono();

  // Publish a pack
  app.post('/packs', async (c) => {
    const body = await c.req.json() as { manifest: unknown; content?: Record<string, unknown> };

    const parsed = PackManifestSchema.safeParse(body.manifest);
    if (!parsed.success) {
      return c.json({ error: 'Invalid manifest', details: parsed.error.issues }, 400);
    }

    const manifest = parsed.data;
    const cid = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
    const published = store.publish(manifest, body.content ?? {}, cid);

    return c.json({
      name: manifest.name,
      version: manifest.version,
      cid,
      publishedAt: published.publishedAt,
    }, 201);
  });

  // Search packs
  app.get('/packs', (c) => {
    const type = c.req.query('type');
    const vertical = c.req.query('vertical');
    const results = store.search({ type: type ?? undefined, vertical: vertical ?? undefined });
    return c.json({
      packs: results.map(p => ({
        name: p.manifest.name,
        version: p.manifest.version,
        type: p.manifest.type,
        cid: p.cid,
        publishedAt: p.publishedAt,
      })),
    });
  });

  // Get specific version
  app.get('/packs/:name{.+}/:version', (c) => {
    const name = c.req.param('name');
    const version = c.req.param('version');
    const pack = store.get(name, version);
    if (!pack) return c.json({ error: 'Pack not found' }, 404);
    return c.json({ manifest: pack.manifest, cid: pack.cid, publishedAt: pack.publishedAt });
  });

  // List versions
  app.get('/packs/:name{.+}/versions', (c) => {
    const name = c.req.param('name');
    const versions = store.listVersions(name);
    return c.json({ name, versions });
  });

  app.get('/health', (c) => c.json({ status: 'ok' }));

  return app;
}
```

**Step 4: Write tests**

Create `apps/hub-control-plane/src/registry-api.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { createRegistryAPI } from './registry-api.js';
import { RegistryStore } from './registry-store.js';

describe('Hub Registry API', () => {
  let store: RegistryStore;
  let app: ReturnType<typeof createRegistryAPI>;

  beforeEach(() => {
    store = new RegistryStore();
    app = createRegistryAPI(store);
  });

  it('should publish a pack', async () => {
    const res = await app.request('/packs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        manifest: {
          name: '@test/my-pack',
          version: '1.0.0',
          type: 'logic',
        },
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.name).toBe('@test/my-pack');
    expect(body.cid).toBeDefined();
  });

  it('should reject invalid manifest', async () => {
    const res = await app.request('/packs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ manifest: { name: 'invalid' } }),
    });
    expect(res.status).toBe(400);
  });

  it('should search packs', async () => {
    store.publish({ name: '@test/logic-a', version: '1.0.0', type: 'logic' }, {}, 'cid1');
    store.publish({ name: '@test/env-a', version: '1.0.0', type: 'environment' }, {}, 'cid2');

    const res = await app.request('/packs?type=logic');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.packs).toHaveLength(1);
    expect(body.packs[0].name).toBe('@test/logic-a');
  });

  it('should get a specific pack version', async () => {
    store.publish({ name: '@test/my-pack', version: '1.0.0', type: 'logic' }, {}, 'cid1');

    const res = await app.request('/packs/@test/my-pack/1.0.0');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.manifest.name).toBe('@test/my-pack');
  });

  it('should list versions', async () => {
    store.publish({ name: '@test/my-pack', version: '1.0.0', type: 'logic' }, {}, 'cid1');
    store.publish({ name: '@test/my-pack', version: '2.0.0', type: 'logic' }, {}, 'cid2');

    const res = await app.request('/packs/@test/my-pack/versions');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.versions).toContain('1.0.0');
    expect(body.versions).toContain('2.0.0');
  });

  it('should return 404 for unknown pack', async () => {
    const res = await app.request('/packs/@test/nonexistent/1.0.0');
    expect(res.status).toBe(404);
  });
});
```

**Step 5: Update hub-control-plane entry point**

Replace `apps/hub-control-plane/src/index.ts`:

```typescript
export { createRegistryAPI } from './registry-api.js';
export { RegistryStore, type PublishedPack } from './registry-store.js';
```

**Step 6: Create vitest config**

Create `apps/hub-control-plane/vitest.config.ts`:

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
```

**Step 7: Run tests**

Run: `cd apps/hub-control-plane && pnpm test`
Expected: 6 tests pass.

**Step 8: Build**

Run: `pnpm build`
Expected: Clean build.

**Step 9: Commit**

```
feat(hub-control-plane): add Registry API for publishing and discovering packs
```

---

### Task 7: CLI Publish Command

**Files:**
- Create: `packages/cli/src/commands/publish.ts`
- Create: `packages/cli/src/commands/publish.test.ts`
- Modify: `packages/cli/src/index.ts`

**Context:** `eurocomply publish <pack-dir> --registry <url>` publishes a pack to the Hub Registry API. It loads the pack, validates it (lint + test), then POSTs the manifest to the registry. For Phase 4, no signature verification — just manifest + content upload.

**Step 1: Write the failing test**

Create `packages/cli/src/commands/publish.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { publish } from './publish.js';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Mock HTTP server using a simple handler
let lastPublishBody: any = null;

describe('eurocomply publish', () => {
  const packDir = join(tmpdir(), `publish-test-${Date.now()}`);

  beforeAll(() => {
    mkdirSync(join(packDir, 'rules'), { recursive: true });
    mkdirSync(join(packDir, 'tests'), { recursive: true });

    writeFileSync(join(packDir, 'pack.json'), JSON.stringify({
      name: '@test/publishable',
      version: '1.0.0',
      type: 'logic',
      logic_root: 'rules/main.ast.json',
      validation_suite: 'tests/validation_suite.json',
    }));

    writeFileSync(join(packDir, 'rules', 'main.ast.json'), JSON.stringify({
      handler: 'core:threshold_check',
      config: { value: { field: 'x' }, operator: 'lt', threshold: 10 },
    }));

    writeFileSync(join(packDir, 'tests', 'validation_suite.json'), JSON.stringify({
      vertical_id: 'test',
      test_cases: [
        { id: 'pass', description: 'Pass', entity_data: { x: 5 }, expected_status: 'compliant' },
      ],
    }));
  });

  afterAll(() => {
    rmSync(packDir, { recursive: true, force: true });
  });

  it('should validate pack before publishing', async () => {
    const result = await publish(packDir, {
      registryUrl: 'http://localhost:0',
      dryRun: true,
    });

    expect(result.validated).toBe(true);
    expect(result.lintResult.valid).toBe(true);
    expect(result.testResult.allPassed).toBe(true);
  });

  it('should fail publish if lint fails', async () => {
    const badDir = join(tmpdir(), `publish-bad-${Date.now()}`);
    mkdirSync(join(badDir, 'rules'), { recursive: true });
    writeFileSync(join(badDir, 'pack.json'), JSON.stringify({
      name: '@test/bad-publish',
      version: '1.0.0',
      type: 'logic',
      logic_root: 'rules/main.ast.json',
    }));
    writeFileSync(join(badDir, 'rules', 'main.ast.json'), JSON.stringify({
      handler: 'core:nonexistent',
      config: {},
    }));

    const result = await publish(badDir, {
      registryUrl: 'http://localhost:0',
      dryRun: true,
    });

    expect(result.validated).toBe(false);
    expect(result.lintResult.valid).toBe(false);

    rmSync(badDir, { recursive: true, force: true });
  });
});
```

**Step 2: Write the implementation**

Create `packages/cli/src/commands/publish.ts`:

```typescript
import { loadPack } from '@eurocomply/registry-sdk';
import { lint, type LintResult } from './lint.js';
import { test as testCmd, type TestResult } from './test.js';

export interface PublishOptions {
  registryUrl: string;
  dryRun?: boolean;
}

export interface PublishResult {
  packName: string;
  version: string;
  validated: boolean;
  lintResult: LintResult;
  testResult: TestResult;
  published: boolean;
  cid?: string;
  error?: string;
}

export async function publish(packDir: string, options: PublishOptions): Promise<PublishResult> {
  const pack = await loadPack(packDir);

  // Validate: lint
  const lintResult = await lint(packDir);
  if (!lintResult.valid) {
    return {
      packName: pack.manifest.name,
      version: pack.manifest.version,
      validated: false,
      lintResult,
      testResult: { packName: pack.manifest.name, total: 0, passed: 0, failed: 0, allPassed: false, astValid: false, results: [] },
      published: false,
      error: `Lint failed: ${lintResult.errors.length} error(s)`,
    };
  }

  // Validate: test
  const testResult = await testCmd(packDir);
  if (!testResult.allPassed) {
    return {
      packName: pack.manifest.name,
      version: pack.manifest.version,
      validated: false,
      lintResult,
      testResult,
      published: false,
      error: `Tests failed: ${testResult.failed}/${testResult.total}`,
    };
  }

  if (options.dryRun) {
    return {
      packName: pack.manifest.name,
      version: pack.manifest.version,
      validated: true,
      lintResult,
      testResult,
      published: false,
    };
  }

  // Publish to registry
  try {
    const response = await fetch(`${options.registryUrl}/packs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        manifest: pack.manifest,
        content: {
          ruleAST: pack.ruleAST,
          validationSuite: pack.validationSuite,
        },
      }),
    });

    if (!response.ok) {
      const errBody = await response.json().catch(() => ({}));
      return {
        packName: pack.manifest.name,
        version: pack.manifest.version,
        validated: true,
        lintResult,
        testResult,
        published: false,
        error: `Registry returned ${response.status}: ${JSON.stringify(errBody)}`,
      };
    }

    const result = await response.json() as { cid: string };
    return {
      packName: pack.manifest.name,
      version: pack.manifest.version,
      validated: true,
      lintResult,
      testResult,
      published: true,
      cid: result.cid,
    };
  } catch (err) {
    return {
      packName: pack.manifest.name,
      version: pack.manifest.version,
      validated: true,
      lintResult,
      testResult,
      published: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}
```

**Step 3: Update CLI entry point**

In `packages/cli/src/index.ts`, add a `publish` case to the switch statement:

```typescript
    case 'publish': {
      const packDir = args[0];
      if (!packDir) {
        console.error('Usage: eurocomply publish <pack-directory> [--registry <url>] [--dry-run]');
        process.exit(1);
      }
      const { publish } = await import('./commands/publish.js');
      const registryUrl = args.includes('--registry') ? args[args.indexOf('--registry') + 1] : 'http://localhost:3001';
      const dryRun = args.includes('--dry-run');
      const result = await publish(packDir, { registryUrl, dryRun });

      if (!result.validated) {
        console.error(`✗ ${result.packName}@${result.version} — validation failed`);
        console.error(`  ${result.error}`);
        process.exit(1);
      }
      if (dryRun) {
        console.log(`✓ ${result.packName}@${result.version} — validation passed (dry run, not published)`);
      } else if (result.published) {
        console.log(`✓ ${result.packName}@${result.version} — published (CID: ${result.cid})`);
      } else {
        console.error(`✗ ${result.packName}@${result.version} — publish failed: ${result.error}`);
        process.exit(1);
      }
      break;
    }
```

Also update the help text in the `default` case to include publish.

**Step 4: Run tests**

Run: `cd packages/cli && pnpm test`
Expected: All tests pass (lint 2 + test 2 + publish 2 = 6).

**Step 5: Build**

Run: `pnpm build`
Expected: Clean build.

**Step 6: Commit**

```
feat(cli): add eurocomply publish command with lint+test validation gate
```

---

### Task 8: Spoke Boot Pack Installation

**Files:**
- Modify: `apps/spoke-runtime/src/boot.ts`
- Modify: `apps/spoke-runtime/src/boot.test.ts`

**Context:** When a spoke boots with a `packsDir` config, it loads all pack directories from that directory and installs them via the PackService. This connects the pack lifecycle to the spoke's startup sequence. The boot module already creates all services — now we add PackService and pack loading.

**Step 1: Update boot.ts**

Add to the boot function:
1. Import and create `PackService`
2. Add `PackService` to `SpokeInstance`
3. If `config.packsDir` is set, load all pack directories and install them
4. Pass `packService` to the MCP tool router

Read the current `apps/spoke-runtime/src/boot.ts` to understand the exact structure before making changes. The key additions:

```typescript
import { PackService } from '@eurocomply/platform-services';
import { loadPack } from '@eurocomply/registry-sdk';
import { readdirSync, statSync } from 'fs';
import { join } from 'path';
```

In the `SpokeInstance` interface, add:
```typescript
packService: PackService;
```

After creating services, add:
```typescript
const packService = new PackService(db, audit);
```

After creating the MCP router (add packService to router deps), add pack loading:
```typescript
// Load packs from directory if configured
if (config.packsDir) {
  const packDirs = readdirSync(config.packsDir)
    .map(name => join(config.packsDir!, name))
    .filter(path => statSync(path).isDirectory());

  const ctx = {
    tenant_id: config.tenantId,
    principal: { type: 'system' as const, id: 'boot' },
    correlation_id: 'boot-pack-install',
  };

  for (const dir of packDirs) {
    try {
      const pack = await loadPack(dir);
      await packService.install(ctx, pack.manifest);
    } catch (err) {
      console.error(`Failed to load pack from ${dir}:`, err);
    }
  }
}
```

**Step 2: Update boot test**

Add a test that boots with a pack directory and verifies packs are installed:

```typescript
it('should install packs from directory on boot', async () => {
  // Create a temporary pack directory
  const packsDir = join(tmpdir(), `boot-packs-${Date.now()}`);
  mkdirSync(join(packsDir, 'test-pack', 'rules'), { recursive: true });
  writeFileSync(join(packsDir, 'test-pack', 'pack.json'), JSON.stringify({
    name: '@test/boot-pack',
    version: '1.0.0',
    type: 'logic',
  }));

  const spokeWithPacks = await boot({
    port: 0,
    postgres: { host: container.getHost(), port: container.getMappedPort(5432), database: container.getDatabase(), user: container.getUsername(), password: container.getPassword() },
    tenantId: 'test-tenant-packs',
    packsDir,
  });

  const packs = await spokeWithPacks.packService.list({
    tenant_id: 'test-tenant-packs',
    principal: { type: 'system', id: 'test' },
    correlation_id: 'test',
  });

  expect(packs.data.total).toBe(1);
  expect(packs.data.items[0].pack_name).toBe('@test/boot-pack');

  await spokeWithPacks.close();
  rmSync(packsDir, { recursive: true, force: true });
});
```

Add the necessary imports (`join`, `mkdirSync`, `writeFileSync`, `rmSync`, `tmpdir`) to the test file.

**Step 3: Run tests**

Run: `cd apps/spoke-runtime && pnpm test`
Expected: All tests pass (boot 4 + seed 2 + e2e 6 = 12).

**Step 4: Build**

Run: `pnpm build`
Expected: Clean build.

**Step 5: Commit**

```
feat(spoke-runtime): add pack installation on boot from packsDir config
```

---

### Task 9: E2E Integration Test — Publish → Install → Evaluate → Lock

**Files:**
- Create: `apps/spoke-runtime/src/e2e-registry.test.ts`

**Context:** This is the Phase 4 proof-point. The test: boots a spoke with seed data, publishes a CLP pack to an in-memory Hub Registry, installs the pack on the spoke via PackService, evaluates a product against the pack's rule, saves a ComplianceLock, and verifies the lock pins the correct pack versions. This exercises every layer added in Phase 4.

**Step 1: Write the E2E test**

Create `apps/spoke-runtime/src/e2e-registry.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { boot, type SpokeInstance } from './boot.js';
import { loadSeedData } from './seed.js';
import { loadPack, createInstallPlan } from '@eurocomply/registry-sdk';
import { createDefaultRegistry } from '@eurocomply/kernel-vm';
import { createRegistryAPI, RegistryStore } from '@eurocomply/hub-control-plane';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { join } from 'path';
import type { ASTNode } from '@eurocomply/types';

describe('E2E: Phase 4 — Pack Lifecycle', () => {
  let container: StartedPostgreSqlContainer;
  let spoke: SpokeInstance;
  let hubApp: ReturnType<typeof createRegistryAPI>;
  let hubStore: RegistryStore;

  const ctx = {
    tenant_id: 'phase4-e2e',
    principal: { type: 'user' as const, id: 'test-user' },
    correlation_id: 'e2e-phase4',
  };

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start();
    spoke = await boot({
      port: 0,
      postgres: {
        host: container.getHost(),
        port: container.getMappedPort(5432),
        database: container.getDatabase(),
        user: container.getUsername(),
        password: container.getPassword(),
      },
      tenantId: 'phase4-e2e',
    });

    // Seed CLP data
    const seedFile = join(import.meta.dirname, '..', 'fixtures', 'clp-annex-vi-seed.json');
    await loadSeedData(seedFile, spoke.entityService, ctx);

    // Create Hub Registry
    hubStore = new RegistryStore();
    hubApp = createRegistryAPI(hubStore);
  }, 60_000);

  afterAll(async () => {
    await spoke.close();
    await container.stop();
  });

  it('should publish a pack to the Hub Registry', async () => {
    const res = await hubApp.request('/packs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        manifest: {
          name: '@eu/clp-basic',
          version: '1.0.0',
          type: 'logic',
          scope: { verticals: ['cosmetics'], markets: ['EU'] },
        },
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.cid).toBeDefined();
  });

  it('should install a pack on the spoke', async () => {
    const result = await spoke.packService.install(ctx, {
      name: '@eu/clp-basic',
      version: '1.0.0',
      type: 'logic',
      scope: { verticals: ['cosmetics'], markets: ['EU'] },
    });
    expect(result.success).toBe(true);
    expect(result.data.pack_name).toBe('@eu/clp-basic');
    expect(result.data.status).toBe('active');
  });

  it('should list installed packs', async () => {
    const result = await spoke.packService.list(ctx);
    expect(result.success).toBe(true);
    expect(result.data.total).toBe(1);
  });

  it('should evaluate a product and save a compliance lock', async () => {
    // Create product
    const product = await spoke.entityService.create(ctx, {
      entity_type: 'cosmetic_product',
      data: { name: 'Phase 4 Test Product', lead_ppm: 0.5 },
    });

    const rule: ASTNode = {
      handler: 'core:threshold_check',
      config: { value: { field: 'lead_ppm' }, operator: 'lt', threshold: 10 },
      label: 'Lead < 10 ppm',
    };

    // Evaluate
    const evalResult = await spoke.executionLoop.evaluate(ctx, {
      entity_type: 'cosmetic_product',
      entity_id: product.data.entity_id,
      rule,
      compliance_lock_id: 'clp-basic-v1-lock',
      vertical_id: 'cosmetics',
      market: 'EU',
    });
    expect(evalResult.success).toBe(true);
    expect(evalResult.data.handler_result.value).toHaveProperty('pass', true);

    // Save lock
    const lock = {
      lock_id: 'clp-basic-v1-lock',
      tenant_id: ctx.tenant_id,
      timestamp: new Date().toISOString(),
      handler_vm_exact: '1.0.0',
      root_pack: { name: '@eu/clp-basic', version: '1.0.0', cid: 'test-cid' },
      packs: {
        '@eu/clp-basic@1.0.0': { version: '1.0.0', cid: 'test-cid' },
      },
      status: 'active' as const,
    };
    const lockResult = await spoke.packService.saveLock(ctx, lock);
    expect(lockResult.success).toBe(true);

    // Retrieve lock
    const getLockResult = await spoke.packService.getLock(ctx, 'clp-basic-v1-lock');
    expect(getLockResult.success).toBe(true);
    expect(getLockResult.data.root_pack.name).toBe('@eu/clp-basic');
    expect(getLockResult.data.packs['@eu/clp-basic@1.0.0'].version).toBe('1.0.0');
  });

  it('should serve registry tools via MCP', async () => {
    const res = await spoke.app.request('/mcp/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tool: 'registry:list',
        input: {},
        context: { tenant_id: ctx.tenant_id, principal: ctx.principal },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(body.data.total).toBe(1);
  });
});
```

**Step 2: Run tests**

Run: `cd apps/spoke-runtime && pnpm test`
Expected: All tests pass.

**Step 3: Run full monorepo build + test**

Run: `pnpm build && pnpm test`
Expected: All packages build and test.

**Step 4: Commit**

```
test(spoke-runtime): add E2E test for Phase 4 pack lifecycle — publish, install, evaluate, lock
```

---

## Verification Checklist

After all tasks:

- [ ] `pnpm build` — all packages build
- [ ] `pnpm test` — all tests pass across monorepo
- [ ] PackManifest extended with author, trust_tier, dependencies, conflict_resolution
- [ ] ComplianceLock type with lock_id, tenant_id, packs, schemas
- [ ] Pack installer resolves dependencies, runs Simulator, generates lock
- [ ] Portfolio diff evaluates rule changes against existing entities
- [ ] PackService persists installed packs and compliance locks in PostgreSQL
- [ ] Registry MCP tools: registry:install, registry:list, registry:lock, registry:locks, registry:save-lock
- [ ] Hub Registry API: POST /packs, GET /packs, GET /packs/:name/:version
- [ ] CLI `eurocomply publish` with lint+test validation gate
- [ ] Spoke boot loads packs from packsDir config
- [ ] E2E: publish → install → evaluate → save lock → retrieve lock → MCP
