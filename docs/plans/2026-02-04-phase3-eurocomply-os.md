# Phase 3: First Vertical Slice — eurocomply-os Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a bootable spoke-runtime that serves MCP, a CLI that validates packs locally, and a pack loader — proving the full compliance loop from pack → seed data → product → evaluation → result.

**Architecture:** The spoke-runtime wires kernel-vm + platform-services into a standalone Node.js process. It reads config from env vars, connects to PostgreSQL + Neo4j, runs migrations, loads seed data and packs from disk, then serves the existing MCP tool router over Hono HTTP. The CLI operates entirely offline using kernel-vm's Simulator and validator — no database needed. The registry-sdk provides a `PackLoader` that reads pack directories from the filesystem.

**Tech Stack:** TypeScript, Hono (HTTP server), Zod (schema validation), Vitest (testing), PostgreSQL + Neo4j (testcontainers for tests)

---

## Dependency Order

```
Task 1: Pack manifest types (types/)
  ↓
Task 2: Pack loader (registry-sdk/)
  ↓
Task 3: CLI lint command (cli/)
  ↓
Task 4: CLI test command (cli/)
  ↓
Task 5: Spoke runtime config + boot (spoke-runtime/)
  ↓
Task 6: Spoke runtime MCP server (spoke-runtime/)
  ↓
Task 7: Seed data + pack loading (spoke-runtime/)
  ↓
Task 8: E2E integration test (spoke-runtime/)
```

Tasks 3-4 (CLI) and Tasks 5-7 (spoke-runtime) are independent of each other after Task 2.

---

### Task 1: Pack Manifest Types

**Files:**
- Modify: `packages/types/src/pack-manifest.ts` (create)
- Modify: `packages/types/src/index.ts`

**Context:** Phase 3 only needs a subset of the full pack manifest. We define the fields needed now; future phases extend the schema. The full manifest spec is in `design/docs/2026-02-03-registry-design.md` §2.

**Step 1: Create the pack manifest schema**

Create `packages/types/src/pack-manifest.ts`:

```typescript
import { z } from 'zod';

export const PackManifestSchema = z.object({
  name: z.string().regex(/^@[a-z0-9-]+\/[a-z0-9-]+$/, 'Pack name must be scoped: @scope/name'),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'Version must be semver: X.Y.Z'),
  type: z.enum(['logic', 'environment', 'driver', 'intelligence']),

  handler_vm_version: z.string().optional(),

  scope: z.object({
    verticals: z.array(z.string()).optional(),
    markets: z.array(z.string()).optional(),
    entity_types: z.array(z.string()).optional(),
  }).optional(),

  regulation_ref: z.string().optional(),

  logic_root: z.string().optional(),
  validation_suite: z.string().optional(),
  validation_hash: z.string().optional(),
});

export type PackManifest = z.infer<typeof PackManifestSchema>;
```

**Step 2: Export from types index**

In `packages/types/src/index.ts`, add:

```typescript
export { PackManifestSchema, type PackManifest } from './pack-manifest.js';
```

**Step 3: Build and verify**

Run: `pnpm build`
Expected: All packages build cleanly.

**Step 4: Commit**

```
feat(types): add PackManifest Zod schema for pack.json validation
```

---

### Task 2: Pack Loader (registry-sdk)

**Files:**
- Create: `packages/registry-sdk/src/pack-loader.ts`
- Create: `packages/registry-sdk/src/pack-loader.test.ts`
- Modify: `packages/registry-sdk/src/index.ts`
- Modify: `packages/registry-sdk/package.json` (add dependency on `@eurocomply/types`)

**Context:** The `PackLoader` reads a pack directory from disk. It parses `pack.json`, loads the rule AST from `logic_root`, and loads the validation suite. This is used by both the CLI (for lint/test) and the spoke-runtime (for loading installed packs). The registry-sdk already has `@eurocomply/kernel-vm` and `@eurocomply/types` as dependencies.

**Step 1: Write the failing test**

Create `packages/registry-sdk/src/pack-loader.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { loadPack } from './pack-loader.js';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('PackLoader', () => {
  const testDir = join(tmpdir(), `pack-loader-test-${Date.now()}`);

  beforeAll(() => {
    mkdirSync(join(testDir, 'rules'), { recursive: true });
    mkdirSync(join(testDir, 'tests'), { recursive: true });

    writeFileSync(join(testDir, 'pack.json'), JSON.stringify({
      name: '@test/sample-pack',
      version: '1.0.0',
      type: 'logic',
      scope: { verticals: ['cosmetics'], markets: ['EU'] },
      logic_root: 'rules/main.ast.json',
      validation_suite: 'tests/validation_suite.json',
    }));

    writeFileSync(join(testDir, 'rules', 'main.ast.json'), JSON.stringify({
      handler: 'core:threshold_check',
      config: {
        value: { field: 'lead_ppm' },
        operator: 'lt',
        threshold: 10,
      },
      label: 'Lead below 10 ppm',
    }));

    writeFileSync(join(testDir, 'tests', 'validation_suite.json'), JSON.stringify({
      vertical_id: 'cosmetics',
      test_cases: [
        {
          id: 'lead-compliant',
          description: 'Product with low lead passes',
          entity_data: { name: 'Safe Product', lead_ppm: 0.5 },
          expected_status: 'compliant',
        },
        {
          id: 'lead-non-compliant',
          description: 'Product with high lead fails',
          entity_data: { name: 'Unsafe Product', lead_ppm: 15 },
          expected_status: 'non_compliant',
        },
      ],
    }));
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should load a valid pack from directory', async () => {
    const pack = await loadPack(testDir);
    expect(pack.manifest.name).toBe('@test/sample-pack');
    expect(pack.manifest.version).toBe('1.0.0');
    expect(pack.manifest.type).toBe('logic');
  });

  it('should load the rule AST', async () => {
    const pack = await loadPack(testDir);
    expect(pack.ruleAST).toBeDefined();
    expect(pack.ruleAST!.handler).toBe('core:threshold_check');
  });

  it('should load the validation suite', async () => {
    const pack = await loadPack(testDir);
    expect(pack.validationSuite).toBeDefined();
    expect(pack.validationSuite!.test_cases).toHaveLength(2);
  });

  it('should reject invalid manifest', async () => {
    const badDir = join(tmpdir(), `bad-pack-${Date.now()}`);
    mkdirSync(badDir, { recursive: true });
    writeFileSync(join(badDir, 'pack.json'), JSON.stringify({ name: 'invalid' }));
    await expect(loadPack(badDir)).rejects.toThrow();
    rmSync(badDir, { recursive: true, force: true });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/registry-sdk && pnpm test`
Expected: FAIL — `loadPack` not found.

**Step 3: Write the implementation**

Create `packages/registry-sdk/src/pack-loader.ts`:

```typescript
import { readFile } from 'fs/promises';
import { join } from 'path';
import { PackManifestSchema, type PackManifest } from '@eurocomply/types';
import type { ASTNode } from '@eurocomply/types';
import type { ValidationSuite } from '@eurocomply/kernel-vm';

export interface LoadedPack {
  manifest: PackManifest;
  ruleAST: ASTNode | null;
  validationSuite: ValidationSuite | null;
  directory: string;
}

export async function loadPack(directory: string): Promise<LoadedPack> {
  const manifestPath = join(directory, 'pack.json');
  const raw = await readFile(manifestPath, 'utf-8');
  const manifest = PackManifestSchema.parse(JSON.parse(raw));

  let ruleAST: ASTNode | null = null;
  if (manifest.logic_root) {
    const astPath = join(directory, manifest.logic_root);
    const astRaw = await readFile(astPath, 'utf-8');
    ruleAST = JSON.parse(astRaw) as ASTNode;
  }

  let validationSuite: ValidationSuite | null = null;
  if (manifest.validation_suite) {
    const suitePath = join(directory, manifest.validation_suite);
    const suiteRaw = await readFile(suitePath, 'utf-8');
    validationSuite = JSON.parse(suiteRaw) as ValidationSuite;
  }

  return { manifest, ruleAST, validationSuite, directory };
}
```

**Step 4: Export from index**

Replace `packages/registry-sdk/src/index.ts`:

```typescript
export { loadPack, type LoadedPack } from './pack-loader.js';
```

**Step 5: Run tests to verify they pass**

Run: `cd packages/registry-sdk && pnpm test`
Expected: 4 tests pass.

**Step 6: Build**

Run: `pnpm build`
Expected: All packages build cleanly.

**Step 7: Commit**

```
feat(registry-sdk): add PackLoader to read pack directories from disk
```

---

### Task 3: CLI lint Command

**Files:**
- Create: `packages/cli/src/index.ts` (overwrite empty scaffold)
- Create: `packages/cli/src/commands/lint.ts`
- Create: `packages/cli/src/commands/lint.test.ts`

**Context:** `eurocomply lint <pack-dir>` reads a pack directory, validates the manifest, and runs `validateAST` from kernel-vm on the rule AST. Exits 0 on success, 1 on errors. Output is structured text (not JSON) for human readability.

**Step 1: Write the failing test**

Create `packages/cli/src/commands/lint.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { lint } from './lint.js';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('eurocomply lint', () => {
  const validDir = join(tmpdir(), `lint-valid-${Date.now()}`);
  const invalidDir = join(tmpdir(), `lint-invalid-${Date.now()}`);

  beforeAll(() => {
    // Valid pack
    mkdirSync(join(validDir, 'rules'), { recursive: true });
    writeFileSync(join(validDir, 'pack.json'), JSON.stringify({
      name: '@test/valid-pack',
      version: '1.0.0',
      type: 'logic',
      logic_root: 'rules/main.ast.json',
    }));
    writeFileSync(join(validDir, 'rules', 'main.ast.json'), JSON.stringify({
      handler: 'core:threshold_check',
      config: { value: { field: 'x' }, operator: 'lt', threshold: 10 },
    }));

    // Invalid pack — unknown handler
    mkdirSync(join(invalidDir, 'rules'), { recursive: true });
    writeFileSync(join(invalidDir, 'pack.json'), JSON.stringify({
      name: '@test/bad-pack',
      version: '1.0.0',
      type: 'logic',
      logic_root: 'rules/main.ast.json',
    }));
    writeFileSync(join(invalidDir, 'rules', 'main.ast.json'), JSON.stringify({
      handler: 'core:nonexistent_handler',
      config: {},
    }));
  });

  afterAll(() => {
    rmSync(validDir, { recursive: true, force: true });
    rmSync(invalidDir, { recursive: true, force: true });
  });

  it('should return success for a valid pack', async () => {
    const result = await lint(validDir);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should return errors for unknown handler', async () => {
    const result = await lint(invalidDir);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].error).toContain('Unknown handler');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/cli && pnpm test`
Expected: FAIL — `lint` not found.

**Step 3: Write the implementation**

Create `packages/cli/src/commands/lint.ts`:

```typescript
import { loadPack } from '@eurocomply/registry-sdk';
import { validateAST, createDefaultRegistry } from '@eurocomply/kernel-vm';
import type { ASTValidationResult } from '@eurocomply/types';

export interface LintResult {
  valid: boolean;
  packName: string;
  errors: Array<{ path: string; error: string; suggestion?: string }>;
  handlersUsed: string[];
  complexity: number;
}

export async function lint(packDir: string): Promise<LintResult> {
  const pack = await loadPack(packDir);
  const registry = createDefaultRegistry();

  if (!pack.ruleAST) {
    return {
      valid: false,
      packName: pack.manifest.name,
      errors: [{ path: 'pack.json', error: 'No logic_root specified — nothing to lint' }],
      handlersUsed: [],
      complexity: 0,
    };
  }

  const result: ASTValidationResult = validateAST(pack.ruleAST, registry);

  return {
    valid: result.valid,
    packName: pack.manifest.name,
    errors: result.errors,
    handlersUsed: result.handlers_used,
    complexity: result.estimated_complexity,
  };
}
```

**Step 4: Write the CLI entry point**

Replace `packages/cli/src/index.ts`:

```typescript
#!/usr/bin/env node

import { lint } from './commands/lint.js';

const [command, ...args] = process.argv.slice(2);

async function main(): Promise<void> {
  switch (command) {
    case 'lint': {
      const packDir = args[0];
      if (!packDir) {
        console.error('Usage: eurocomply lint <pack-directory>');
        process.exit(1);
      }
      const result = await lint(packDir);
      if (result.valid) {
        console.log(`✓ ${result.packName} — valid`);
        console.log(`  Handlers: ${result.handlersUsed.join(', ')}`);
        console.log(`  Complexity: ${result.complexity}`);
      } else {
        console.error(`✗ ${result.packName} — ${result.errors.length} error(s)`);
        for (const err of result.errors) {
          console.error(`  ${err.path}: ${err.error}`);
        }
        process.exit(1);
      }
      break;
    }

    case 'test': {
      const packDir = args[0];
      if (!packDir) {
        console.error('Usage: eurocomply test <pack-directory>');
        process.exit(1);
      }
      // Dynamically import to avoid loading test deps for lint
      const { test } = await import('./commands/test.js');
      const result = await test(packDir);
      if (result.allPassed) {
        console.log(`✓ ${result.packName} — ${result.passed}/${result.total} tests passed`);
      } else {
        console.error(`✗ ${result.packName} — ${result.failed}/${result.total} tests failed`);
        for (const r of result.results.filter(r => !r.match)) {
          console.error(`  FAIL: ${r.description} (expected ${r.expected_status}, got ${r.actual_status})`);
        }
        process.exit(1);
      }
      break;
    }

    default:
      console.log('Usage: eurocomply <command> [args]');
      console.log('');
      console.log('Commands:');
      console.log('  lint <pack-dir>   Validate a pack\'s manifest and rule AST');
      console.log('  test <pack-dir>   Run a pack\'s validation suite');
      process.exit(command ? 1 : 0);
  }
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
```

**Step 5: Run tests**

Run: `cd packages/cli && pnpm test`
Expected: 2 tests pass.

**Step 6: Build**

Run: `pnpm build`
Expected: Clean build.

**Step 7: Commit**

```
feat(cli): add eurocomply lint command for pack validation
```

---

### Task 4: CLI test Command

**Files:**
- Create: `packages/cli/src/commands/test.ts`
- Create: `packages/cli/src/commands/test.test.ts`

**Context:** `eurocomply test <pack-dir>` loads a pack, runs the Simulator against its validation suite, and reports results. The Simulator is already implemented in kernel-vm (`Simulator.run(ast, suite)`). This command is the primary feedback loop for pack authors.

**Step 1: Write the failing test**

Create `packages/cli/src/commands/test.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { test as testCmd } from './test.js';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('eurocomply test', () => {
  const packDir = join(tmpdir(), `test-cmd-${Date.now()}`);

  beforeAll(() => {
    mkdirSync(join(packDir, 'rules'), { recursive: true });
    mkdirSync(join(packDir, 'tests'), { recursive: true });

    writeFileSync(join(packDir, 'pack.json'), JSON.stringify({
      name: '@test/testable-pack',
      version: '1.0.0',
      type: 'logic',
      logic_root: 'rules/main.ast.json',
      validation_suite: 'tests/validation_suite.json',
    }));

    writeFileSync(join(packDir, 'rules', 'main.ast.json'), JSON.stringify({
      handler: 'core:threshold_check',
      config: {
        value: { field: 'concentration' },
        operator: 'lt',
        threshold: 0.1,
      },
      label: 'Concentration below 0.1%',
    }));

    writeFileSync(join(packDir, 'tests', 'validation_suite.json'), JSON.stringify({
      vertical_id: 'cosmetics',
      test_cases: [
        {
          id: 'below-limit',
          description: 'Concentration below limit passes',
          entity_data: { name: 'Safe', concentration: 0.05 },
          expected_status: 'compliant',
        },
        {
          id: 'above-limit',
          description: 'Concentration above limit fails',
          entity_data: { name: 'Unsafe', concentration: 0.5 },
          expected_status: 'non_compliant',
        },
      ],
    }));
  });

  afterAll(() => {
    rmSync(packDir, { recursive: true, force: true });
  });

  it('should run all test cases and report results', async () => {
    const result = await testCmd(packDir);
    expect(result.total).toBe(2);
    expect(result.passed).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.allPassed).toBe(true);
  });

  it('should detect mismatched expected status', async () => {
    const badDir = join(tmpdir(), `test-bad-${Date.now()}`);
    mkdirSync(join(badDir, 'rules'), { recursive: true });
    mkdirSync(join(badDir, 'tests'), { recursive: true });

    writeFileSync(join(badDir, 'pack.json'), JSON.stringify({
      name: '@test/bad-test-pack',
      version: '1.0.0',
      type: 'logic',
      logic_root: 'rules/main.ast.json',
      validation_suite: 'tests/validation_suite.json',
    }));

    writeFileSync(join(badDir, 'rules', 'main.ast.json'), JSON.stringify({
      handler: 'core:threshold_check',
      config: { value: { field: 'x' }, operator: 'lt', threshold: 10 },
    }));

    // Expect non_compliant but value 5 < 10 = compliant
    writeFileSync(join(badDir, 'tests', 'validation_suite.json'), JSON.stringify({
      vertical_id: 'test',
      test_cases: [
        { id: 'wrong', description: 'Mismatch', entity_data: { x: 5 }, expected_status: 'non_compliant' },
      ],
    }));

    const result = await testCmd(badDir);
    expect(result.failed).toBe(1);
    expect(result.allPassed).toBe(false);

    rmSync(badDir, { recursive: true, force: true });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd packages/cli && pnpm test`
Expected: FAIL — `test` module not found.

**Step 3: Write the implementation**

Create `packages/cli/src/commands/test.ts`:

```typescript
import { loadPack } from '@eurocomply/registry-sdk';
import { Simulator, createDefaultRegistry } from '@eurocomply/kernel-vm';
import type { TestCaseResult } from '@eurocomply/kernel-vm';

export interface TestResult {
  packName: string;
  total: number;
  passed: number;
  failed: number;
  allPassed: boolean;
  astValid: boolean;
  results: TestCaseResult[];
}

export async function test(packDir: string): Promise<TestResult> {
  const pack = await loadPack(packDir);
  const registry = createDefaultRegistry();
  const simulator = new Simulator(registry);

  if (!pack.ruleAST) {
    return {
      packName: pack.manifest.name,
      total: 0, passed: 0, failed: 0,
      allPassed: false,
      astValid: false,
      results: [],
    };
  }

  if (!pack.validationSuite) {
    return {
      packName: pack.manifest.name,
      total: 0, passed: 0, failed: 0,
      allPassed: false,
      astValid: true,
      results: [],
    };
  }

  const report = simulator.run(pack.ruleAST, pack.validationSuite);

  return {
    packName: pack.manifest.name,
    total: report.total,
    passed: report.passed,
    failed: report.failed,
    allPassed: report.ast_valid && report.failed === 0,
    astValid: report.ast_valid,
    results: report.results,
  };
}
```

**Step 4: Run tests**

Run: `cd packages/cli && pnpm test`
Expected: All tests pass (lint + test commands).

**Step 5: Build**

Run: `pnpm build`
Expected: Clean build.

**Step 6: Commit**

```
feat(cli): add eurocomply test command for running validation suites
```

---

### Task 5: Spoke Runtime — Config and Database Boot

**Files:**
- Create: `apps/spoke-runtime/src/config.ts`
- Create: `apps/spoke-runtime/src/boot.ts`
- Create: `apps/spoke-runtime/src/boot.test.ts`
- Modify: `apps/spoke-runtime/package.json` (add hono dependency)

**Context:** The spoke-runtime is the standalone Node.js process that constitutes a customer's Spoke. It reads configuration from environment variables, connects to PostgreSQL and Neo4j, runs database migrations, then starts serving. For Phase 3, Neo4j is optional (the CLP check doesn't require graph traversal). The MCP server uses Hono (already scaffolded in platform-services).

**Step 1: Add hono dependency**

In `apps/spoke-runtime/package.json`, add to dependencies:

```json
"hono": "^4.0.0"
```

Run: `pnpm install`

**Step 2: Create config module**

Create `apps/spoke-runtime/src/config.ts`:

```typescript
export interface SpokeConfig {
  port: number;
  postgres: {
    host: string;
    port: number;
    database: string;
    user: string;
    password: string;
  };
  neo4j?: {
    uri: string;
    username: string;
    password: string;
  };
  tenantId: string;
  packsDir?: string;
  seedFile?: string;
}

export function loadConfig(): SpokeConfig {
  return {
    port: parseInt(process.env.PORT ?? '3000', 10),
    postgres: {
      host: process.env.PGHOST ?? 'localhost',
      port: parseInt(process.env.PGPORT ?? '5432', 10),
      database: process.env.PGDATABASE ?? 'eurocomply',
      user: process.env.PGUSER ?? 'eurocomply',
      password: process.env.PGPASSWORD ?? 'eurocomply',
    },
    neo4j: process.env.NEO4J_URI ? {
      uri: process.env.NEO4J_URI,
      username: process.env.NEO4J_USERNAME ?? 'neo4j',
      password: process.env.NEO4J_PASSWORD ?? 'neo4j',
    } : undefined,
    tenantId: process.env.TENANT_ID ?? 'default',
    packsDir: process.env.PACKS_DIR,
    seedFile: process.env.SEED_FILE,
  };
}
```

**Step 3: Create boot module**

Create `apps/spoke-runtime/src/boot.ts`:

```typescript
import {
  PostgresConnectionManager,
  Neo4jConnectionManager,
  runMigrations,
  AuditLogger,
  EntityService,
  RelationService,
  JobService,
  FileService,
  ExecutionLoop,
  createMCPToolRouter,
  createMCPServer,
  type StorageBackend,
} from '@eurocomply/platform-services';
import { createDefaultRegistry } from '@eurocomply/kernel-vm';
import type { SpokeConfig } from './config.js';

class MemoryStorageBackend implements StorageBackend {
  private store = new Map<string, Buffer>();
  async put(key: string, data: Buffer): Promise<void> { this.store.set(key, data); }
  async get(key: string): Promise<Buffer | null> { return this.store.get(key) ?? null; }
  async delete(key: string): Promise<void> { this.store.delete(key); }
}

export interface SpokeInstance {
  app: ReturnType<typeof createMCPServer>;
  db: PostgresConnectionManager;
  neo4j?: Neo4jConnectionManager;
  entityService: EntityService;
  audit: AuditLogger;
  executionLoop: ExecutionLoop;
  relationService?: RelationService;
  close(): Promise<void>;
}

export async function boot(config: SpokeConfig): Promise<SpokeInstance> {
  // Connect to PostgreSQL
  const db = new PostgresConnectionManager(config.postgres);
  await runMigrations(db);

  // Optionally connect to Neo4j
  let neo4j: Neo4jConnectionManager | undefined;
  if (config.neo4j) {
    neo4j = new Neo4jConnectionManager(config.neo4j);
  }

  // Create services
  const audit = new AuditLogger(db);
  const entityService = new EntityService(db, audit);
  const jobService = new JobService(db);
  const fileService = new FileService(db, audit, new MemoryStorageBackend());
  const registry = createDefaultRegistry();
  const executionLoop = new ExecutionLoop(db, entityService, audit, registry);

  let relationService: RelationService | undefined;
  if (neo4j) {
    relationService = new RelationService(db, neo4j, audit);
  }

  // Create MCP tool router and HTTP server
  const router = createMCPToolRouter({
    entityService,
    audit,
    jobService,
    fileService,
    executionLoop,
  });
  const app = createMCPServer(router);

  return {
    app,
    db,
    neo4j,
    entityService,
    audit,
    executionLoop,
    relationService,
    async close() {
      if (neo4j) await neo4j.close();
      await db.close();
    },
  };
}
```

**Step 4: Write boot test**

Create `apps/spoke-runtime/src/boot.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { boot, type SpokeInstance } from './boot.js';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

describe('Spoke Boot', () => {
  let container: StartedPostgreSqlContainer;
  let spoke: SpokeInstance;

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
      tenantId: 'test-tenant',
    });
  }, 60_000);

  afterAll(async () => {
    await spoke.close();
    await container.stop();
  });

  it('should boot successfully with database connection', () => {
    expect(spoke.app).toBeDefined();
    expect(spoke.entityService).toBeDefined();
    expect(spoke.executionLoop).toBeDefined();
  });

  it('should serve health endpoint', async () => {
    const res = await spoke.app.request('/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
  });

  it('should list MCP tools', async () => {
    const res = await spoke.app.request('/mcp/tools');
    expect(res.status).toBe(200);
    const tools = await res.json();
    expect(tools.length).toBeGreaterThan(0);
  });
});
```

**Step 5: Add testcontainers dev dependency**

In `apps/spoke-runtime/package.json`, add to devDependencies:

```json
"@testcontainers/postgresql": "^10.0.0",
"testcontainers": "^10.0.0"
```

Run: `pnpm install`

**Step 6: Run tests**

Run: `cd apps/spoke-runtime && pnpm test`
Expected: 3 tests pass.

**Step 7: Build**

Run: `pnpm build`
Expected: Clean build.

**Step 8: Commit**

```
feat(spoke-runtime): add config, boot sequence, and MCP server wiring
```

---

### Task 6: Spoke Runtime — Entry Point and Process Server

**Files:**
- Modify: `apps/spoke-runtime/src/index.ts` (overwrite empty scaffold)

**Context:** The entry point loads config from env, boots the spoke, and starts the Hono server using Node's `serve` function. It handles graceful shutdown on SIGTERM/SIGINT.

**Step 1: Write the entry point**

Replace `apps/spoke-runtime/src/index.ts`:

```typescript
import { serve } from '@hono/node-server';
import { loadConfig } from './config.js';
import { boot } from './boot.js';

async function main(): Promise<void> {
  const config = loadConfig();
  console.log(`Booting spoke (tenant: ${config.tenantId})...`);

  const spoke = await boot(config);
  console.log('Spoke booted successfully.');

  const server = serve({
    fetch: spoke.app.fetch,
    port: config.port,
  }, (info) => {
    console.log(`Spoke MCP server listening on port ${info.port}`);
  });

  const shutdown = async () => {
    console.log('Shutting down...');
    server.close();
    await spoke.close();
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch(err => {
  console.error('Failed to boot spoke:', err);
  process.exit(1);
});
```

**Step 2: Add @hono/node-server dependency**

In `apps/spoke-runtime/package.json`, add to dependencies:

```json
"@hono/node-server": "^1.0.0"
```

Run: `pnpm install`

**Step 3: Build**

Run: `pnpm build`
Expected: Clean build.

**Step 4: Commit**

```
feat(spoke-runtime): add entry point with HTTP server and graceful shutdown
```

---

### Task 7: Spoke Runtime — Seed Data and Pack Loading

**Files:**
- Create: `apps/spoke-runtime/src/seed.ts`
- Create: `apps/spoke-runtime/src/seed.test.ts`
- Create: `apps/spoke-runtime/fixtures/clp-annex-vi-seed.json`

**Context:** The seed module loads initial data (entity type definitions and substance entities) from a JSON file into the database via EntityService. This simulates the "Ingest" step from Phase 3's vertical slice. In production this would be an Intelligence Pack; for Phase 3 it's a static fixture. The seed file contains a small subset of CLP Annex VI substances with their restriction limits.

**Step 1: Create the seed data fixture**

Create `apps/spoke-runtime/fixtures/clp-annex-vi-seed.json`:

```json
{
  "entity_types": [
    {
      "entity_type": "substance",
      "schema": {
        "fields": [
          { "name": "name", "type": "string", "required": true },
          { "name": "cas_number", "type": "string" },
          { "name": "ec_number", "type": "string" },
          { "name": "clp_classification", "type": "string" },
          { "name": "max_concentration_pct", "type": "number" }
        ]
      }
    },
    {
      "entity_type": "cosmetic_product",
      "schema": {
        "fields": [
          { "name": "name", "type": "string", "required": true },
          { "name": "product_type", "type": "string" },
          { "name": "lead_ppm", "type": "number" },
          { "name": "nickel_ppm", "type": "number" },
          { "name": "cadmium_ppm", "type": "number" },
          { "name": "mercury_ppm", "type": "number" },
          { "name": "chromium_vi_ppm", "type": "number" }
        ]
      }
    }
  ],
  "entities": {
    "substance": [
      { "name": "Lead", "cas_number": "7439-92-1", "ec_number": "231-100-4", "clp_classification": "Repr. 1A", "max_concentration_pct": 0.001 },
      { "name": "Cadmium", "cas_number": "7440-43-9", "ec_number": "231-152-8", "clp_classification": "Carc. 1B", "max_concentration_pct": 0.001 },
      { "name": "Mercury", "cas_number": "7439-97-6", "ec_number": "231-106-7", "clp_classification": "Repr. 1B", "max_concentration_pct": 0.0001 },
      { "name": "Nickel", "cas_number": "7440-02-0", "ec_number": "231-111-4", "clp_classification": "Carc. 2", "max_concentration_pct": 0.01 },
      { "name": "Chromium VI", "cas_number": "18540-29-9", "ec_number": "242-367-1", "clp_classification": "Carc. 1A", "max_concentration_pct": 0.0001 },
      { "name": "Arsenic", "cas_number": "7440-38-2", "ec_number": "231-148-6", "clp_classification": "Carc. 1A", "max_concentration_pct": 0.0005 },
      { "name": "Antimony", "cas_number": "7440-36-0", "ec_number": "231-146-5", "clp_classification": "Acute Tox. 4", "max_concentration_pct": 0.005 },
      { "name": "Barium", "cas_number": "7440-39-3", "ec_number": "231-149-1", "clp_classification": "Acute Tox. 4", "max_concentration_pct": 0.05 },
      { "name": "Selenium", "cas_number": "7782-49-2", "ec_number": "231-957-4", "clp_classification": "Acute Tox. 3", "max_concentration_pct": 0.001 },
      { "name": "Formaldehyde", "cas_number": "50-00-0", "ec_number": "200-001-8", "clp_classification": "Carc. 1B", "max_concentration_pct": 0.2 }
    ]
  }
}
```

**Step 2: Write the seed module**

Create `apps/spoke-runtime/src/seed.ts`:

```typescript
import { readFile } from 'fs/promises';
import type { EntityService } from '@eurocomply/platform-services';
import type { PlatformServiceContext } from '@eurocomply/platform-services';

interface SeedData {
  entity_types: Array<{
    entity_type: string;
    schema: { fields: Array<{ name: string; type: string; required?: boolean }> };
  }>;
  entities: Record<string, Array<Record<string, unknown>>>;
}

export async function loadSeedData(
  seedFile: string,
  entityService: EntityService,
  ctx: PlatformServiceContext,
): Promise<{ typesCreated: number; entitiesCreated: number }> {
  const raw = await readFile(seedFile, 'utf-8');
  const seed: SeedData = JSON.parse(raw);

  let typesCreated = 0;
  for (const typeDef of seed.entity_types) {
    await entityService.defineType(ctx, typeDef);
    typesCreated++;
  }

  let entitiesCreated = 0;
  for (const [entityType, entities] of Object.entries(seed.entities)) {
    for (const data of entities) {
      await entityService.create(ctx, { entity_type: entityType, data });
      entitiesCreated++;
    }
  }

  return { typesCreated, entitiesCreated };
}
```

**Step 3: Write the seed test**

Create `apps/spoke-runtime/src/seed.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { loadSeedData } from './seed.js';
import { boot, type SpokeInstance } from './boot.js';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { join } from 'path';

describe('Seed Data Loader', () => {
  let container: StartedPostgreSqlContainer;
  let spoke: SpokeInstance;

  const ctx = {
    tenant_id: 'test-tenant',
    principal: { type: 'system' as const, id: 'seed' },
    correlation_id: 'seed-test',
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
      tenantId: 'test-tenant',
    });
  }, 60_000);

  afterAll(async () => {
    await spoke.close();
    await container.stop();
  });

  it('should load seed data from fixture file', async () => {
    const seedFile = join(import.meta.dirname, '..', 'fixtures', 'clp-annex-vi-seed.json');
    const result = await loadSeedData(seedFile, spoke.entityService, ctx);
    expect(result.typesCreated).toBe(2);
    expect(result.entitiesCreated).toBe(10);
  });

  it('should be queryable after seeding', async () => {
    const substances = await spoke.entityService.list(ctx, { entity_type: 'substance' });
    expect(substances.success).toBe(true);
    expect(substances.data.total).toBe(10);
  });
});
```

**Step 4: Run tests**

Run: `cd apps/spoke-runtime && pnpm test`
Expected: All tests pass (boot + seed).

**Step 5: Build**

Run: `pnpm build`
Expected: Clean build.

**Step 6: Commit**

```
feat(spoke-runtime): add seed data loader and CLP Annex VI fixture (10 substances)
```

---

### Task 8: E2E Integration Test — Full Vertical Slice

**Files:**
- Create: `apps/spoke-runtime/src/e2e.test.ts`

**Context:** This is the Phase 3 proof-point. The test boots a spoke, seeds CLP substance data, creates a cosmetic product, evaluates it against a CLP restriction rule, and verifies the compliance result and audit trail. It exercises every layer: Platform Services (entity:create) → kernel-vm (threshold_check) → audit (log). The rule AST is the same format that would come from a Logic Pack's `rules/main.ast.json`.

**Step 1: Write the E2E test**

Create `apps/spoke-runtime/src/e2e.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { boot, type SpokeInstance } from './boot.js';
import { loadSeedData } from './seed.js';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { join } from 'path';
import type { ASTNode } from '@eurocomply/types';

describe('E2E: Phase 3 Vertical Slice — CLP Restriction Check', () => {
  let container: StartedPostgreSqlContainer;
  let spoke: SpokeInstance;

  const ctx = {
    tenant_id: 'spoke-e2e',
    principal: { type: 'user' as const, id: 'test-user' },
    correlation_id: 'e2e-phase3',
  };

  // The CLP restriction rule — same format as a Logic Pack's rules/main.ast.json
  const clpLeadRule: ASTNode = {
    handler: 'core:threshold_check',
    config: {
      value: { field: 'lead_ppm' },
      operator: 'lt',
      threshold: 10,
    },
    label: 'CLP Annex VI: Lead below 10 ppm limit',
  };

  const clpHeavyMetalsRule: ASTNode = {
    handler: 'core:and',
    config: {
      conditions: [
        {
          handler: 'core:threshold_check',
          config: { value: { field: 'lead_ppm' }, operator: 'lt', threshold: 10 },
          label: 'Lead < 10 ppm',
        },
        {
          handler: 'core:threshold_check',
          config: { value: { field: 'cadmium_ppm' }, operator: 'lt', threshold: 10 },
          label: 'Cadmium < 10 ppm',
        },
        {
          handler: 'core:threshold_check',
          config: { value: { field: 'mercury_ppm' }, operator: 'lt', threshold: 1 },
          label: 'Mercury < 1 ppm',
        },
      ],
    },
    label: 'CLP Annex VI: Heavy metals compliance',
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
      tenantId: 'spoke-e2e',
    });

    // Seed CLP substance reference data
    const seedFile = join(import.meta.dirname, '..', 'fixtures', 'clp-annex-vi-seed.json');
    await loadSeedData(seedFile, spoke.entityService, ctx);
  }, 60_000);

  afterAll(async () => {
    await spoke.close();
    await container.stop();
  });

  it('Step 1-3: should ingest seed data and create a compliant product', async () => {
    const product = await spoke.entityService.create(ctx, {
      entity_type: 'cosmetic_product',
      data: {
        name: 'Gentle Face Cream',
        product_type: 'leave-on',
        lead_ppm: 0.5,
        nickel_ppm: 0.05,
        cadmium_ppm: 0.1,
        mercury_ppm: 0.01,
        chromium_vi_ppm: 0.001,
      },
    });
    expect(product.success).toBe(true);
    expect(product.data.entity_id).toBeDefined();
  });

  it('Step 4-5: should evaluate a compliant product and return pass', async () => {
    const product = await spoke.entityService.create(ctx, {
      entity_type: 'cosmetic_product',
      data: {
        name: 'Safe Moisturizer',
        lead_ppm: 0.3,
        cadmium_ppm: 0.1,
        mercury_ppm: 0.01,
      },
    });

    const result = await spoke.executionLoop.evaluate(ctx, {
      entity_type: 'cosmetic_product',
      entity_id: product.data.entity_id,
      rule: clpLeadRule,
      compliance_lock_id: 'clp-basic-v1',
      vertical_id: 'cosmetics',
      market: 'EU',
    });

    expect(result.success).toBe(true);
    expect(result.data.handler_result.success).toBe(true);
    expect(result.data.handler_result.value).toHaveProperty('pass', true);
    expect(result.data.handler_result.trace.status).toBe('success');
    expect(result.data.compliance_lock_id).toBe('clp-basic-v1');
  });

  it('should evaluate a non-compliant product and return fail', async () => {
    const product = await spoke.entityService.create(ctx, {
      entity_type: 'cosmetic_product',
      data: {
        name: 'Contaminated Lipstick',
        lead_ppm: 25,
        cadmium_ppm: 0.1,
        mercury_ppm: 0.01,
      },
    });

    const result = await spoke.executionLoop.evaluate(ctx, {
      entity_type: 'cosmetic_product',
      entity_id: product.data.entity_id,
      rule: clpLeadRule,
      compliance_lock_id: 'clp-basic-v1',
      vertical_id: 'cosmetics',
      market: 'EU',
    });

    expect(result.success).toBe(true);
    expect(result.data.handler_result.value).toHaveProperty('pass', false);
  });

  it('should evaluate composed rule (AND gate) for heavy metals', async () => {
    const product = await spoke.entityService.create(ctx, {
      entity_type: 'cosmetic_product',
      data: {
        name: 'Premium Eye Shadow',
        lead_ppm: 0.5,
        cadmium_ppm: 0.2,
        mercury_ppm: 0.005,
      },
    });

    const result = await spoke.executionLoop.evaluate(ctx, {
      entity_type: 'cosmetic_product',
      entity_id: product.data.entity_id,
      rule: clpHeavyMetalsRule,
      compliance_lock_id: 'clp-basic-v1',
      vertical_id: 'cosmetics',
      market: 'EU',
    });

    expect(result.success).toBe(true);
    expect(result.data.handler_result.value).toHaveProperty('pass', true);
  });

  it('should produce audit trail for evaluation', async () => {
    const product = await spoke.entityService.create(ctx, {
      entity_type: 'cosmetic_product',
      data: { name: 'Audit Trail Product', lead_ppm: 2 },
    });

    await spoke.executionLoop.evaluate(ctx, {
      entity_type: 'cosmetic_product',
      entity_id: product.data.entity_id,
      rule: clpLeadRule,
      compliance_lock_id: 'clp-basic-v1',
      vertical_id: 'cosmetics',
      market: 'EU',
    });

    const entries = await spoke.audit.query(ctx.tenant_id, {
      resource_entity_id: product.data.entity_id,
      action: 'evaluate',
    });
    expect(entries.length).toBe(1);
    expect(entries[0].action).toBe('evaluate');
  });

  it('should serve evaluation via MCP HTTP endpoint', async () => {
    // Create product via MCP
    const defineRes = await spoke.app.request('/mcp/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tool: 'entity:create',
        input: {
          entity_type: 'cosmetic_product',
          data: { name: 'MCP Product', lead_ppm: 1.5 },
        },
        context: { tenant_id: ctx.tenant_id, principal: ctx.principal, correlation_id: 'mcp-test' },
      }),
    });

    expect(defineRes.status).toBe(200);
    const createResult = await defineRes.json() as { success: boolean; data: { entity_id: string } };
    expect(createResult.success).toBe(true);

    // Evaluate via MCP
    const evalRes = await spoke.app.request('/mcp/call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tool: 'evaluate',
        input: {
          entity_type: 'cosmetic_product',
          entity_id: createResult.data.entity_id,
          rule: clpLeadRule,
          compliance_lock_id: 'clp-basic-v1',
          vertical_id: 'cosmetics',
          market: 'EU',
        },
        context: { tenant_id: ctx.tenant_id, principal: ctx.principal, correlation_id: 'mcp-eval' },
      }),
    });

    expect(evalRes.status).toBe(200);
    const evalResult = await evalRes.json() as { success: boolean; data: { handler_result: { value: { pass: boolean } } } };
    expect(evalResult.success).toBe(true);
    expect(evalResult.data.handler_result.value.pass).toBe(true);
  });
});
```

**Step 2: Run the E2E test**

Run: `cd apps/spoke-runtime && pnpm test`
Expected: All tests pass.

**Step 3: Run full monorepo build + test**

Run: `pnpm build && pnpm test`
Expected: All packages build and all tests pass across the monorepo.

**Step 4: Commit**

```
test(spoke-runtime): add E2E integration test for Phase 3 vertical slice
```

---

## Verification Checklist

After all tasks:

- [ ] `pnpm build` — all 9 packages build
- [ ] `pnpm test` — all tests pass across monorepo
- [ ] `eurocomply lint <pack-dir>` — validates a pack's manifest and AST
- [ ] `eurocomply test <pack-dir>` — runs a pack's validation suite via Simulator
- [ ] spoke-runtime boots, connects to PG, runs migrations, serves MCP over HTTP
- [ ] E2E: seed data → create product → evaluate rule → compliance result with audit trail
- [ ] MCP endpoint serves the same evaluation over HTTP (MCP universality)
