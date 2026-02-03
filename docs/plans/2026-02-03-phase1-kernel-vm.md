# Phase 1: Kernel VM Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the pure computation engine (`@eurocomply/types` + `@eurocomply/kernel-vm`) — the foundation everything else depends on.

**Architecture:** Two packages. `types` defines shared Zod schemas (ExecutionContext, HandlerResult, ValidationResult, ASTNode). `kernel-vm` implements the handler registry with versioned resolution, AST validator, AST evaluator, ~14 handlers across 4 categories, and the Simulator. kernel-vm has ZERO external runtime dependencies — it uses `import type` from types only. All handlers are pure synchronous functions: `(config, input, context, evaluate) → HandlerResult`.

**Tech Stack:** TypeScript 5.7, Zod (types package only), Vitest (testing)

**Key design constraints:**
- kernel-vm `package.json` has no `dependencies` — only `devDependencies`
- kernel-vm uses `import type` from `@eurocomply/types` (erased at compile time)
- Every handler is deterministic: same input → same output
- HandlerRegistry supports `resolve(id, version)` for Compliance Lock compatibility
- AST is validated before execution

---

## Task 1: Project Setup

**Files:**
- Modify: `packages/types/package.json`
- Modify: `packages/kernel-vm/package.json`
- Modify: `packages/kernel-vm/tsconfig.json`
- Create: `packages/kernel-vm/vitest.config.ts`

**Step 1: Add Zod to types package**

```bash
cd /root/Documents/eurocomply-os && pnpm --filter @eurocomply/types add zod
```

**Step 2: Add types as devDependency of kernel-vm + add vitest config**

```bash
pnpm --filter @eurocomply/kernel-vm add -D @eurocomply/types
```

Add tsconfig reference. `packages/kernel-vm/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"],
  "references": [
    { "path": "../types" }
  ]
}
```

Create `packages/kernel-vm/vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['src/**/*.test.ts'],
  },
});
```

**Step 3: Verify build works**

```bash
pnpm build
```

Expected: Clean build, no errors.

**Step 4: Commit**

```bash
git add packages/types/package.json packages/kernel-vm/package.json packages/kernel-vm/tsconfig.json packages/kernel-vm/vitest.config.ts pnpm-lock.yaml
git commit -m "chore: add zod to types, wire kernel-vm dev dependencies"
```

---

## Task 2: Core Result Types

**Files:**
- Create: `packages/types/src/handler-result.ts`
- Modify: `packages/types/src/index.ts`

**Step 1: Write the types**

Create `packages/types/src/handler-result.ts`:
```typescript
import { z } from 'zod';

// --- Explanation ---

export const ExplanationStepSchema = z.object({
  action: z.string(),
  result: z.string(),
  data: z.record(z.unknown()).optional(),
});
export type ExplanationStep = z.infer<typeof ExplanationStepSchema>;

export const ReferenceSchema = z.object({
  type: z.enum(['regulation', 'gsr', 'document', 'calculation']),
  id: z.string(),
  title: z.string().optional(),
  excerpt: z.string().optional(),
});
export type Reference = z.infer<typeof ReferenceSchema>;

export const ExplanationSchema = z.object({
  summary: z.string(),
  steps: z.array(ExplanationStepSchema),
  references: z.array(ReferenceSchema).optional(),
});
export type Explanation = z.infer<typeof ExplanationSchema>;

// --- Warning ---

export const WarningSchema = z.object({
  code: z.string(),
  message: z.string(),
  path: z.string().optional(),
});
export type Warning = z.infer<typeof WarningSchema>;

// --- Execution Trace ---

export interface ExecutionTrace {
  handler_id: string;
  handler_version: string;
  duration_ms: number;
  input: unknown;
  output: unknown;
  child_traces?: ExecutionTrace[];
  execution_path: string;
  status: 'success' | 'failed' | 'error';
  error?: { message: string; stack?: string };
}

export const ExecutionTraceSchema: z.ZodType<ExecutionTrace> = z.lazy(() =>
  z.object({
    handler_id: z.string(),
    handler_version: z.string(),
    duration_ms: z.number(),
    input: z.unknown(),
    output: z.unknown(),
    child_traces: z.array(ExecutionTraceSchema).optional(),
    execution_path: z.string(),
    status: z.enum(['success', 'failed', 'error']),
    error: z.object({
      message: z.string(),
      stack: z.string().optional(),
    }).optional(),
  })
);

// --- Handler Result ---

export const HandlerResultSchema = z.object({
  success: z.boolean(),
  value: z.unknown(),
  explanation: ExplanationSchema,
  trace: ExecutionTraceSchema,
  warnings: z.array(WarningSchema).optional(),
});

export interface HandlerResult<T = unknown> {
  success: boolean;
  value: T;
  explanation: Explanation;
  trace: ExecutionTrace;
  warnings?: Warning[];
}
```

**Step 2: Update index.ts to re-export**

`packages/types/src/index.ts`:
```typescript
export {
  ExplanationStepSchema,
  ReferenceSchema,
  ExplanationSchema,
  WarningSchema,
  ExecutionTraceSchema,
  HandlerResultSchema,
} from './handler-result.js';

export type {
  ExplanationStep,
  Reference,
  Explanation,
  Warning,
  ExecutionTrace,
  HandlerResult,
} from './handler-result.js';
```

**Step 3: Verify build**

```bash
pnpm --filter @eurocomply/types build
```

Expected: Clean build.

**Step 4: Commit**

```bash
git add packages/types/src/
git commit -m "feat(types): add HandlerResult, Explanation, ExecutionTrace schemas"
```

---

## Task 3: Context and Validation Types

**Files:**
- Create: `packages/types/src/execution-context.ts`
- Create: `packages/types/src/validation-result.ts`
- Modify: `packages/types/src/index.ts`

**Step 1: Write ExecutionContext**

Create `packages/types/src/execution-context.ts`:
```typescript
import { z } from 'zod';

export const FieldReferenceSchema = z.object({
  field: z.string(),
});
export type FieldReference = z.infer<typeof FieldReferenceSchema>;

export const DataReferenceSchema = z.object({
  data_key: z.string(),
});
export type DataReference = z.infer<typeof DataReferenceSchema>;

export const ExecutionContextSchema = z.object({
  entity_type: z.string(),
  entity_id: z.string(),
  entity_data: z.record(z.unknown()),
  data: z.record(z.unknown()),
  compliance_lock_id: z.string(),
  vertical_id: z.string(),
  market: z.string(),
  timestamp: z.string(),
});
export type ExecutionContext = z.infer<typeof ExecutionContextSchema>;
```

**Step 2: Write ValidationResult**

Create `packages/types/src/validation-result.ts`:
```typescript
import { z } from 'zod';
import { ExplanationSchema, ExecutionTraceSchema, WarningSchema } from './handler-result.js';

export const ValidationResultSchema = z.object({
  pass: z.boolean(),
  handler_id: z.string(),
  handler_version: z.string(),
  explanation: ExplanationSchema,
  trace: ExecutionTraceSchema,
  details: z.record(z.unknown()),
  confidence: z.number().min(0).max(1).optional(),
  warnings: z.array(WarningSchema).optional(),
});
export type ValidationResult = z.infer<typeof ValidationResultSchema>;
```

**Step 3: Update index.ts**

Append to `packages/types/src/index.ts`:
```typescript
export {
  FieldReferenceSchema,
  DataReferenceSchema,
  ExecutionContextSchema,
} from './execution-context.js';

export type {
  FieldReference,
  DataReference,
  ExecutionContext,
} from './execution-context.js';

export { ValidationResultSchema } from './validation-result.js';
export type { ValidationResult } from './validation-result.js';
```

**Step 4: Build and commit**

```bash
pnpm --filter @eurocomply/types build
git add packages/types/src/
git commit -m "feat(types): add ExecutionContext, ValidationResult, FieldReference schemas"
```

---

## Task 4: AST and Handler Metadata Types

**Files:**
- Create: `packages/types/src/ast.ts`
- Create: `packages/types/src/handler.ts`
- Modify: `packages/types/src/index.ts`

**Step 1: Write handler metadata types**

Create `packages/types/src/handler.ts`:
```typescript
import { z } from 'zod';

export const HandlerCategorySchema = z.enum([
  'computation',
  'validation',
  'logic',
  'graph',
  'resolution',
  'temporal',
  'ai',
]);
export type HandlerCategory = z.infer<typeof HandlerCategorySchema>;

export const HandlerMetadataSchema = z.object({
  id: z.string(),
  version: z.string(),
  category: HandlerCategorySchema,
  description: z.string(),
});
export type HandlerMetadata = z.infer<typeof HandlerMetadataSchema>;
```

**Step 2: Write AST types**

Create `packages/types/src/ast.ts`:
```typescript
import { z } from 'zod';

export interface ASTNode {
  handler: string;
  config: Record<string, unknown>;
  label?: string;
}

export const ASTNodeSchema: z.ZodType<ASTNode> = z.lazy(() =>
  z.object({
    handler: z.string(),
    config: z.record(z.unknown()),
    label: z.string().optional(),
  })
);

export const ASTValidationErrorSchema = z.object({
  path: z.string(),
  error: z.string(),
  suggestion: z.string().optional(),
});
export type ASTValidationError = z.infer<typeof ASTValidationErrorSchema>;

export const ASTValidationResultSchema = z.object({
  valid: z.boolean(),
  errors: z.array(ASTValidationErrorSchema),
  handlers_used: z.array(z.string()),
  estimated_complexity: z.number(),
});
export type ASTValidationResult = z.infer<typeof ASTValidationResultSchema>;
```

**Step 3: Update index.ts**

Append to `packages/types/src/index.ts`:
```typescript
export { HandlerCategorySchema, HandlerMetadataSchema } from './handler.js';
export type { HandlerCategory, HandlerMetadata } from './handler.js';

export { ASTNodeSchema, ASTValidationErrorSchema, ASTValidationResultSchema } from './ast.js';
export type { ASTNode, ASTValidationError, ASTValidationResult } from './ast.js';
```

**Step 4: Build and commit**

```bash
pnpm --filter @eurocomply/types build
git add packages/types/src/
git commit -m "feat(types): add ASTNode, HandlerCategory, HandlerMetadata schemas"
```

---

## Task 5: Handler Interface and Versioned Registry

**Files:**
- Create: `packages/kernel-vm/src/handler.ts`
- Create: `packages/kernel-vm/src/registry.ts`
- Create: `packages/kernel-vm/src/registry.test.ts`

**Step 1: Write the failing test**

Create `packages/kernel-vm/src/registry.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { HandlerRegistry } from './registry.js';
import type { HandlerDefinition } from './handler.js';
import type { ExecutionContext, HandlerResult } from '@eurocomply/types';

function makeStubHandler(id: string, version: string): HandlerDefinition {
  return {
    id,
    version,
    category: 'validation',
    description: `Stub ${id}`,
    execute: (_config, _input, _ctx, _evaluate) => ({
      success: true,
      value: null,
      explanation: { summary: 'stub', steps: [] },
      trace: {
        handler_id: id,
        handler_version: version,
        duration_ms: 0,
        input: null,
        output: null,
        execution_path: id,
        status: 'success' as const,
      },
    }),
  };
}

describe('HandlerRegistry', () => {
  it('registers and retrieves a handler by id', () => {
    const registry = new HandlerRegistry();
    const handler = makeStubHandler('core:threshold_check', '1.0.0');
    registry.register(handler);
    expect(registry.get('core:threshold_check')).toBe(handler);
  });

  it('returns undefined for unknown handler', () => {
    const registry = new HandlerRegistry();
    expect(registry.get('core:unknown')).toBeUndefined();
  });

  it('resolves handler by id and compatible version', () => {
    const registry = new HandlerRegistry();
    const v1 = makeStubHandler('core:threshold_check', '1.0.0');
    const v2 = makeStubHandler('core:threshold_check', '2.0.0');
    registry.register(v1);
    registry.register(v2);
    expect(registry.resolve('core:threshold_check', '1.0.0')).toBe(v1);
    expect(registry.resolve('core:threshold_check', '2.0.0')).toBe(v2);
  });

  it('resolve returns latest version when no version specified', () => {
    const registry = new HandlerRegistry();
    registry.register(makeStubHandler('core:test', '1.0.0'));
    const latest = makeStubHandler('core:test', '1.1.0');
    registry.register(latest);
    expect(registry.resolve('core:test')).toBe(latest);
  });

  it('resolve returns undefined for non-existent version', () => {
    const registry = new HandlerRegistry();
    registry.register(makeStubHandler('core:test', '1.0.0'));
    expect(registry.resolve('core:test', '3.0.0')).toBeUndefined();
  });

  it('has() checks handler existence', () => {
    const registry = new HandlerRegistry();
    registry.register(makeStubHandler('core:test', '1.0.0'));
    expect(registry.has('core:test')).toBe(true);
    expect(registry.has('core:missing')).toBe(false);
  });

  it('list() returns all handler metadata', () => {
    const registry = new HandlerRegistry();
    registry.register(makeStubHandler('core:a', '1.0.0'));
    registry.register(makeStubHandler('core:b', '1.0.0'));
    const list = registry.list();
    expect(list).toHaveLength(2);
    expect(list.map(h => h.id)).toEqual(['core:a', 'core:b']);
  });

  it('throws on duplicate id+version registration', () => {
    const registry = new HandlerRegistry();
    registry.register(makeStubHandler('core:test', '1.0.0'));
    expect(() => registry.register(makeStubHandler('core:test', '1.0.0'))).toThrow();
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd /root/Documents/eurocomply-os && pnpm --filter @eurocomply/kernel-vm test
```

Expected: FAIL — modules don't exist yet.

**Step 3: Write the implementation**

Create `packages/kernel-vm/src/handler.ts`:
```typescript
import type { ExecutionContext, HandlerResult, HandlerCategory, ASTNode } from '@eurocomply/types';

export type EvaluateFn = (
  node: ASTNode,
  context: ExecutionContext,
  input?: unknown
) => HandlerResult;

export interface HandlerDefinition {
  readonly id: string;
  readonly version: string;
  readonly category: HandlerCategory;
  readonly description: string;

  execute(
    config: Record<string, unknown>,
    input: unknown,
    context: ExecutionContext,
    evaluate: EvaluateFn
  ): HandlerResult;
}
```

Create `packages/kernel-vm/src/registry.ts`:
```typescript
import type { HandlerDefinition } from './handler.js';
import type { HandlerMetadata } from '@eurocomply/types';

export class HandlerRegistry {
  // Map<id, Map<version, HandlerDefinition>>
  private handlers = new Map<string, Map<string, HandlerDefinition>>();

  register(handler: HandlerDefinition): void {
    let versions = this.handlers.get(handler.id);
    if (!versions) {
      versions = new Map();
      this.handlers.set(handler.id, versions);
    }
    if (versions.has(handler.version)) {
      throw new Error(
        `Handler ${handler.id}@${handler.version} is already registered`
      );
    }
    versions.set(handler.version, handler);
  }

  /** Get the latest version of a handler by id. */
  get(id: string): HandlerDefinition | undefined {
    const versions = this.handlers.get(id);
    if (!versions || versions.size === 0) return undefined;
    return this.latestVersion(versions);
  }

  /**
   * Resolve a handler by id and optional exact version.
   * If version is omitted, returns the latest registered version.
   */
  resolve(id: string, version?: string): HandlerDefinition | undefined {
    const versions = this.handlers.get(id);
    if (!versions || versions.size === 0) return undefined;
    if (version) return versions.get(version);
    return this.latestVersion(versions);
  }

  has(id: string): boolean {
    return this.handlers.has(id);
  }

  list(): HandlerMetadata[] {
    const result: HandlerMetadata[] = [];
    for (const [_id, versions] of this.handlers) {
      const latest = this.latestVersion(versions);
      if (latest) {
        result.push({
          id: latest.id,
          version: latest.version,
          category: latest.category,
          description: latest.description,
        });
      }
    }
    return result;
  }

  private latestVersion(
    versions: Map<string, HandlerDefinition>
  ): HandlerDefinition | undefined {
    let latest: HandlerDefinition | undefined;
    let latestParts: number[] = [];
    for (const handler of versions.values()) {
      const parts = handler.version.split('.').map(Number);
      if (!latest || this.compareVersions(parts, latestParts) > 0) {
        latest = handler;
        latestParts = parts;
      }
    }
    return latest;
  }

  private compareVersions(a: number[], b: number[]): number {
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      const av = a[i] ?? 0;
      const bv = b[i] ?? 0;
      if (av !== bv) return av - bv;
    }
    return 0;
  }
}
```

**Step 4: Run tests**

```bash
pnpm --filter @eurocomply/kernel-vm test
```

Expected: All 8 tests PASS.

**Step 5: Commit**

```bash
git add packages/kernel-vm/src/handler.ts packages/kernel-vm/src/registry.ts packages/kernel-vm/src/registry.test.ts
git commit -m "feat(kernel-vm): add HandlerDefinition interface and versioned HandlerRegistry"
```

---

## Task 6: Core Utilities — Field Resolution and Result Helpers

**Files:**
- Create: `packages/kernel-vm/src/resolve.ts`
- Create: `packages/kernel-vm/src/result.ts`
- Create: `packages/kernel-vm/src/resolve.test.ts`

**Step 1: Write the failing test**

Create `packages/kernel-vm/src/resolve.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { resolveValue, getNestedValue, isFieldReference, isDataReference } from './resolve.js';
import type { ExecutionContext } from '@eurocomply/types';

const ctx: ExecutionContext = {
  entity_type: 'product',
  entity_id: 'prod_1',
  entity_data: {
    name: 'Test Product',
    concentration: 0.05,
    materials: [
      { id: 'm1', name: 'Water', concentration: 0.8 },
      { id: 'm2', name: 'Ethanol', concentration: 0.15 },
    ],
  },
  data: {
    reach_svhc_list: ['CAS-123', 'CAS-456'],
  },
  compliance_lock_id: 'lock_1',
  vertical_id: 'cosmetics',
  market: 'EU',
  timestamp: '2026-01-01T00:00:00Z',
};

describe('getNestedValue', () => {
  it('gets top-level field', () => {
    expect(getNestedValue({ a: 1 }, 'a')).toBe(1);
  });
  it('gets nested field with dot notation', () => {
    expect(getNestedValue({ a: { b: { c: 3 } } }, 'a.b.c')).toBe(3);
  });
  it('gets array element by index', () => {
    expect(getNestedValue({ items: [10, 20] }, 'items.1')).toBe(20);
  });
  it('returns undefined for missing path', () => {
    expect(getNestedValue({ a: 1 }, 'b.c')).toBeUndefined();
  });
});

describe('isFieldReference / isDataReference', () => {
  it('detects field reference', () => {
    expect(isFieldReference({ field: 'name' })).toBe(true);
    expect(isFieldReference('literal')).toBe(false);
    expect(isFieldReference(42)).toBe(false);
  });
  it('detects data reference', () => {
    expect(isDataReference({ data_key: 'svhc' })).toBe(true);
    expect(isDataReference({ field: 'name' })).toBe(false);
  });
});

describe('resolveValue', () => {
  it('resolves field reference from entity_data', () => {
    expect(resolveValue({ field: 'concentration' }, ctx)).toBe(0.05);
  });
  it('resolves nested field reference', () => {
    expect(resolveValue({ field: 'materials.0.name' }, ctx)).toBe('Water');
  });
  it('resolves data reference from context.data', () => {
    expect(resolveValue({ data_key: 'reach_svhc_list' }, ctx)).toEqual(['CAS-123', 'CAS-456']);
  });
  it('returns literal values unchanged', () => {
    expect(resolveValue(42, ctx)).toBe(42);
    expect(resolveValue('hello', ctx)).toBe('hello');
  });
  it('resolves from input when input_field reference', () => {
    expect(resolveValue({ input_field: 'result' }, ctx, { result: 99 })).toBe(99);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
pnpm --filter @eurocomply/kernel-vm test
```

Expected: FAIL — modules don't exist.

**Step 3: Write the implementation**

Create `packages/kernel-vm/src/resolve.ts`:
```typescript
import type { ExecutionContext } from '@eurocomply/types';

export function getNestedValue(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function isFieldReference(value: unknown): value is { field: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'field' in value &&
    typeof (value as Record<string, unknown>).field === 'string'
  );
}

export function isDataReference(value: unknown): value is { data_key: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'data_key' in value &&
    typeof (value as Record<string, unknown>).data_key === 'string'
  );
}

export function isInputReference(value: unknown): value is { input_field: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'input_field' in value &&
    typeof (value as Record<string, unknown>).input_field === 'string'
  );
}

export function resolveValue(
  ref: unknown,
  context: ExecutionContext,
  input?: unknown
): unknown {
  if (isFieldReference(ref)) {
    return getNestedValue(context.entity_data, ref.field);
  }
  if (isDataReference(ref)) {
    return getNestedValue(context.data, ref.data_key);
  }
  if (isInputReference(ref)) {
    return getNestedValue(input, ref.input_field);
  }
  return ref;
}
```

Create `packages/kernel-vm/src/result.ts`:
```typescript
import type { HandlerResult, ExecutionTrace, Explanation, ExplanationStep, Reference, Warning } from '@eurocomply/types';

export function makeTrace(opts: {
  handler_id: string;
  handler_version: string;
  input: unknown;
  output: unknown;
  duration_ms: number;
  execution_path: string;
  status: 'success' | 'failed' | 'error';
  child_traces?: ExecutionTrace[];
  error?: { message: string };
}): ExecutionTrace {
  return {
    handler_id: opts.handler_id,
    handler_version: opts.handler_version,
    duration_ms: opts.duration_ms,
    input: opts.input,
    output: opts.output,
    execution_path: opts.execution_path,
    status: opts.status,
    child_traces: opts.child_traces,
    error: opts.error,
  };
}

export function makeSuccess<T>(
  value: T,
  opts: {
    summary: string;
    steps?: ExplanationStep[];
    references?: Reference[];
    handler_id: string;
    handler_version: string;
    input: unknown;
    execution_path: string;
    duration_ms: number;
    child_traces?: ExecutionTrace[];
    warnings?: Warning[];
  }
): HandlerResult<T> {
  return {
    success: true,
    value,
    explanation: {
      summary: opts.summary,
      steps: opts.steps ?? [],
      references: opts.references,
    },
    trace: makeTrace({
      handler_id: opts.handler_id,
      handler_version: opts.handler_version,
      input: opts.input,
      output: value,
      duration_ms: opts.duration_ms,
      execution_path: opts.execution_path,
      status: 'success',
      child_traces: opts.child_traces,
    }),
    warnings: opts.warnings,
  };
}

export function makeFailure<T>(
  value: T,
  opts: {
    summary: string;
    steps?: ExplanationStep[];
    references?: Reference[];
    handler_id: string;
    handler_version: string;
    input: unknown;
    execution_path: string;
    duration_ms: number;
    child_traces?: ExecutionTrace[];
    error?: { message: string };
    warnings?: Warning[];
  }
): HandlerResult<T> {
  return {
    success: false,
    value,
    explanation: {
      summary: opts.summary,
      steps: opts.steps ?? [],
      references: opts.references,
    },
    trace: makeTrace({
      handler_id: opts.handler_id,
      handler_version: opts.handler_version,
      input: opts.input,
      output: value,
      duration_ms: opts.duration_ms,
      execution_path: opts.execution_path,
      status: 'failed',
      child_traces: opts.child_traces,
      error: opts.error,
    }),
    warnings: opts.warnings,
  };
}

/** Measure execution duration in ms using performance.now() if available, Date.now() otherwise. */
export function now(): number {
  if (typeof performance !== 'undefined' && performance.now) {
    return performance.now();
  }
  return Date.now();
}
```

**Step 4: Run tests**

```bash
pnpm --filter @eurocomply/kernel-vm test
```

Expected: All resolve tests PASS.

**Step 5: Commit**

```bash
git add packages/kernel-vm/src/resolve.ts packages/kernel-vm/src/resolve.test.ts packages/kernel-vm/src/result.ts
git commit -m "feat(kernel-vm): add field resolution utilities and result helpers"
```

---

## Task 7: AST Validator

**Files:**
- Create: `packages/kernel-vm/src/validator.ts`
- Create: `packages/kernel-vm/src/validator.test.ts`

**Step 1: Write the failing test**

Create `packages/kernel-vm/src/validator.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { validateAST } from './validator.js';
import { HandlerRegistry } from './registry.js';
import type { HandlerDefinition } from './handler.js';
import type { ASTNode } from '@eurocomply/types';

function stubHandler(id: string, version = '1.0.0'): HandlerDefinition {
  return {
    id, version, category: 'validation', description: `Stub ${id}`,
    execute: () => ({
      success: true, value: null,
      explanation: { summary: '', steps: [] },
      trace: { handler_id: id, handler_version: version, duration_ms: 0, input: null, output: null, execution_path: id, status: 'success' as const },
    }),
  };
}

function makeRegistry(): HandlerRegistry {
  const reg = new HandlerRegistry();
  reg.register(stubHandler('core:threshold_check'));
  reg.register(stubHandler('core:and'));
  reg.register(stubHandler('core:or'));
  reg.register(stubHandler('core:pipe'));
  reg.register(stubHandler('core:for_each'));
  return reg;
}

describe('validateAST', () => {
  it('validates a simple leaf node', () => {
    const ast: ASTNode = { handler: 'core:threshold_check', config: { value: 1, threshold: 0.5, operator: 'lt' } };
    const result = validateAST(ast, makeRegistry());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.handlers_used).toContain('core:threshold_check');
  });

  it('reports unknown handler', () => {
    const ast: ASTNode = { handler: 'core:nonexistent', config: {} };
    const result = validateAST(ast, makeRegistry());
    expect(result.valid).toBe(false);
    expect(result.errors[0].error).toContain('Unknown handler');
  });

  it('validates nested AND conditions', () => {
    const ast: ASTNode = {
      handler: 'core:and',
      config: {
        conditions: [
          { handler: 'core:threshold_check', config: { value: 1, threshold: 0.5, operator: 'lt' } },
          { handler: 'core:threshold_check', config: { value: 2, threshold: 1, operator: 'gt' } },
        ],
      },
    };
    const result = validateAST(ast, makeRegistry());
    expect(result.valid).toBe(true);
    expect(result.handlers_used).toContain('core:and');
    expect(result.handlers_used).toContain('core:threshold_check');
  });

  it('reports error in nested child', () => {
    const ast: ASTNode = {
      handler: 'core:and',
      config: {
        conditions: [
          { handler: 'core:missing_handler', config: {} },
        ],
      },
    };
    const result = validateAST(ast, makeRegistry());
    expect(result.valid).toBe(false);
    expect(result.errors[0].path).toContain('conditions[0]');
  });

  it('validates pipe steps', () => {
    const ast: ASTNode = {
      handler: 'core:pipe',
      config: {
        steps: [
          { handler: 'core:threshold_check', config: {} },
          { handler: 'core:threshold_check', config: {} },
        ],
      },
    };
    const result = validateAST(ast, makeRegistry());
    expect(result.valid).toBe(true);
  });

  it('validates for_each validation child', () => {
    const ast: ASTNode = {
      handler: 'core:for_each',
      config: {
        source: { field: 'materials' },
        validation: { handler: 'core:threshold_check', config: {} },
        require: 'all',
      },
    };
    const result = validateAST(ast, makeRegistry());
    expect(result.valid).toBe(true);
  });

  it('computes estimated complexity', () => {
    const ast: ASTNode = {
      handler: 'core:and',
      config: {
        conditions: [
          { handler: 'core:threshold_check', config: {} },
          { handler: 'core:threshold_check', config: {} },
          { handler: 'core:threshold_check', config: {} },
        ],
      },
    };
    const result = validateAST(ast, makeRegistry());
    expect(result.estimated_complexity).toBeGreaterThan(1);
  });

  it('detects circular references via depth limit', () => {
    // Build a deeply nested AST that exceeds max depth
    let current: ASTNode = { handler: 'core:threshold_check', config: {} };
    for (let i = 0; i < 60; i++) {
      current = { handler: 'core:and', config: { conditions: [current] } };
    }
    const result = validateAST(current, makeRegistry());
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.error.includes('depth'))).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
pnpm --filter @eurocomply/kernel-vm test
```

Expected: FAIL — `validateAST` doesn't exist.

**Step 3: Write the implementation**

Create `packages/kernel-vm/src/validator.ts`:
```typescript
import type { ASTNode, ASTValidationResult, ASTValidationError } from '@eurocomply/types';
import type { HandlerRegistry } from './registry.js';

const MAX_DEPTH = 50;

// Known composition handlers and which config keys contain child AST nodes
const CHILD_NODE_KEYS: Record<string, string[]> = {
  'core:and': ['conditions'],
  'core:or': ['conditions'],
  'core:not': ['condition'],
  'core:if_then': ['if', 'then', 'else'],
  'core:pipe': ['steps'],
  'core:for_each': ['validation'],
};

export function validateAST(
  ast: ASTNode,
  registry: HandlerRegistry
): ASTValidationResult {
  const errors: ASTValidationError[] = [];
  const handlersUsed = new Set<string>();
  let complexity = 0;

  function walk(node: ASTNode, path: string, depth: number): void {
    if (depth > MAX_DEPTH) {
      errors.push({
        path,
        error: `Maximum AST depth (${MAX_DEPTH}) exceeded — possible circular reference`,
      });
      return;
    }

    complexity++;

    // Check handler exists
    if (!registry.has(node.handler)) {
      errors.push({
        path,
        error: `Unknown handler: ${node.handler}`,
      });
      return;
    }

    handlersUsed.add(node.handler);

    // Walk child nodes for known composition handlers
    const childKeys = CHILD_NODE_KEYS[node.handler];
    if (childKeys) {
      for (const key of childKeys) {
        const child = node.config[key];
        if (child == null) continue;

        if (Array.isArray(child)) {
          for (let i = 0; i < child.length; i++) {
            if (isASTNode(child[i])) {
              walk(child[i] as ASTNode, `${path}.${key}[${i}]`, depth + 1);
            }
          }
        } else if (isASTNode(child)) {
          walk(child as ASTNode, `${path}.${key}`, depth + 1);
        }
      }
    }
  }

  walk(ast, 'root', 0);

  return {
    valid: errors.length === 0,
    errors,
    handlers_used: Array.from(handlersUsed),
    estimated_complexity: complexity,
  };
}

function isASTNode(value: unknown): value is ASTNode {
  return (
    typeof value === 'object' &&
    value !== null &&
    'handler' in value &&
    typeof (value as Record<string, unknown>).handler === 'string' &&
    'config' in value
  );
}
```

**Step 4: Run tests**

```bash
pnpm --filter @eurocomply/kernel-vm test
```

Expected: All validator tests PASS.

**Step 5: Commit**

```bash
git add packages/kernel-vm/src/validator.ts packages/kernel-vm/src/validator.test.ts
git commit -m "feat(kernel-vm): add AST validator with depth checking and child node traversal"
```

---

## Task 8: Logic Gate Handlers — and, or, not, if_then

**Files:**
- Create: `packages/kernel-vm/src/handlers/logic/and.ts`
- Create: `packages/kernel-vm/src/handlers/logic/or.ts`
- Create: `packages/kernel-vm/src/handlers/logic/not.ts`
- Create: `packages/kernel-vm/src/handlers/logic/if-then.ts`
- Create: `packages/kernel-vm/src/handlers/logic/logic.test.ts`

**Step 1: Write the failing test**

Create `packages/kernel-vm/src/handlers/logic/logic.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { andHandler } from './and.js';
import { orHandler } from './or.js';
import { notHandler } from './not.js';
import { ifThenHandler } from './if-then.js';
import type { ExecutionContext, HandlerResult, ASTNode } from '@eurocomply/types';
import type { EvaluateFn } from '../../handler.js';

const ctx: ExecutionContext = {
  entity_type: 'product', entity_id: 'p1',
  entity_data: {}, data: {},
  compliance_lock_id: 'lock_1', vertical_id: 'test', market: 'EU',
  timestamp: '2026-01-01T00:00:00Z',
};

function makeEvaluate(results: Map<string, boolean>): EvaluateFn {
  return (node: ASTNode, _ctx: ExecutionContext, _input?: unknown): HandlerResult => ({
    success: results.get(node.handler) ?? false,
    value: { pass: results.get(node.handler) ?? false },
    explanation: { summary: `${node.handler} result`, steps: [] },
    trace: {
      handler_id: node.handler, handler_version: '1.0.0',
      duration_ms: 0, input: null, output: null,
      execution_path: node.handler, status: 'success',
    },
  });
}

describe('core:and', () => {
  it('passes when all conditions pass', () => {
    const evaluate = makeEvaluate(new Map([['a', true], ['b', true]]));
    const result = andHandler.execute(
      { conditions: [{ handler: 'a', config: {} }, { handler: 'b', config: {} }] },
      null, ctx, evaluate
    );
    expect(result.success).toBe(true);
  });

  it('fails when any condition fails', () => {
    const evaluate = makeEvaluate(new Map([['a', true], ['b', false]]));
    const result = andHandler.execute(
      { conditions: [{ handler: 'a', config: {} }, { handler: 'b', config: {} }] },
      null, ctx, evaluate
    );
    expect(result.success).toBe(false);
  });

  it('supports short_circuit option', () => {
    let callCount = 0;
    const evaluate: EvaluateFn = (node, _ctx, _input) => {
      callCount++;
      return {
        success: false, value: { pass: false },
        explanation: { summary: 'fail', steps: [] },
        trace: { handler_id: node.handler, handler_version: '1.0.0', duration_ms: 0, input: null, output: null, execution_path: node.handler, status: 'success' },
      };
    };
    andHandler.execute(
      { conditions: [{ handler: 'a', config: {} }, { handler: 'b', config: {} }], short_circuit: true },
      null, ctx, evaluate
    );
    expect(callCount).toBe(1);
  });
});

describe('core:or', () => {
  it('passes when any condition passes', () => {
    const evaluate = makeEvaluate(new Map([['a', false], ['b', true]]));
    const result = orHandler.execute(
      { conditions: [{ handler: 'a', config: {} }, { handler: 'b', config: {} }] },
      null, ctx, evaluate
    );
    expect(result.success).toBe(true);
  });

  it('fails when all conditions fail', () => {
    const evaluate = makeEvaluate(new Map([['a', false], ['b', false]]));
    const result = orHandler.execute(
      { conditions: [{ handler: 'a', config: {} }, { handler: 'b', config: {} }] },
      null, ctx, evaluate
    );
    expect(result.success).toBe(false);
  });
});

describe('core:not', () => {
  it('negates a passing condition', () => {
    const evaluate = makeEvaluate(new Map([['a', true]]));
    const result = notHandler.execute(
      { condition: { handler: 'a', config: {} } },
      null, ctx, evaluate
    );
    expect(result.success).toBe(false);
  });

  it('negates a failing condition', () => {
    const evaluate = makeEvaluate(new Map([['a', false]]));
    const result = notHandler.execute(
      { condition: { handler: 'a', config: {} } },
      null, ctx, evaluate
    );
    expect(result.success).toBe(true);
  });
});

describe('core:if_then', () => {
  it('runs then branch when if passes', () => {
    const evaluate: EvaluateFn = (node, _ctx, _input) => ({
      success: node.handler === 'cond' || node.handler === 'then_branch',
      value: { pass: node.handler === 'cond' || node.handler === 'then_branch' },
      explanation: { summary: node.handler, steps: [] },
      trace: { handler_id: node.handler, handler_version: '1.0.0', duration_ms: 0, input: null, output: null, execution_path: node.handler, status: 'success' },
    });
    const result = ifThenHandler.execute(
      {
        if: { handler: 'cond', config: {} },
        then: { handler: 'then_branch', config: {} },
      },
      null, ctx, evaluate
    );
    expect(result.success).toBe(true);
  });

  it('runs else branch when if fails', () => {
    const evaluate: EvaluateFn = (node, _ctx, _input) => ({
      success: node.handler !== 'cond',
      value: { pass: node.handler !== 'cond' },
      explanation: { summary: node.handler, steps: [] },
      trace: { handler_id: node.handler, handler_version: '1.0.0', duration_ms: 0, input: null, output: null, execution_path: node.handler, status: 'success' },
    });
    const result = ifThenHandler.execute(
      {
        if: { handler: 'cond', config: {} },
        then: { handler: 'then_branch', config: {} },
        else: { handler: 'else_branch', config: {} },
      },
      null, ctx, evaluate
    );
    expect(result.success).toBe(true);
  });

  it('uses default_when_skipped when no else branch', () => {
    const evaluate = makeEvaluate(new Map([['cond', false]]));
    const result = ifThenHandler.execute(
      { if: { handler: 'cond', config: {} }, then: { handler: 'then_branch', config: {} }, default_when_skipped: true },
      null, ctx, evaluate
    );
    expect(result.success).toBe(true);
  });
});
```

**Step 2: Run test to verify failure**

```bash
pnpm --filter @eurocomply/kernel-vm test
```

**Step 3: Write the implementations**

Create `packages/kernel-vm/src/handlers/logic/and.ts`:
```typescript
import type { HandlerDefinition, EvaluateFn } from '../../handler.js';
import type { ASTNode, ExecutionContext, HandlerResult } from '@eurocomply/types';
import { makeSuccess, makeFailure, now } from '../../result.js';

const ID = 'core:and';
const VERSION = '1.0.0';

export const andHandler: HandlerDefinition = {
  id: ID, version: VERSION, category: 'logic',
  description: 'Logical AND — passes only when all conditions pass',

  execute(config, input, context, evaluate) {
    const start = now();
    const conditions = (config as { conditions: ASTNode[]; short_circuit?: boolean; minimum_pass?: number }).conditions;
    const shortCircuit = (config as { short_circuit?: boolean }).short_circuit ?? false;
    const childTraces = [];
    const results: HandlerResult[] = [];

    for (let i = 0; i < conditions.length; i++) {
      const child = evaluate(conditions[i], context, input);
      results.push(child);
      childTraces.push(child.trace);
      if (!child.success && shortCircuit) break;
    }

    const passed = results.filter(r => r.success).length;
    const total = conditions.length;
    const success = passed === total;

    const opts = {
      summary: `AND: ${passed}/${total} conditions passed`,
      steps: results.map((r, i) => ({
        action: `Evaluate condition ${i}`,
        result: r.success ? 'PASS' : 'FAIL',
        data: { summary: r.explanation.summary },
      })),
      handler_id: ID, handler_version: VERSION,
      input, execution_path: ID, duration_ms: now() - start,
      child_traces: childTraces,
    };

    return success
      ? makeSuccess({ pass: true, passed, total }, opts)
      : makeFailure({ pass: false, passed, total }, opts);
  },
};
```

Create `packages/kernel-vm/src/handlers/logic/or.ts`:
```typescript
import type { HandlerDefinition } from '../../handler.js';
import type { ASTNode, HandlerResult } from '@eurocomply/types';
import { makeSuccess, makeFailure, now } from '../../result.js';

const ID = 'core:or';
const VERSION = '1.0.0';

export const orHandler: HandlerDefinition = {
  id: ID, version: VERSION, category: 'logic',
  description: 'Logical OR — passes when any condition passes',

  execute(config, input, context, evaluate) {
    const start = now();
    const conditions = (config as { conditions: ASTNode[]; short_circuit?: boolean }).conditions;
    const shortCircuit = (config as { short_circuit?: boolean }).short_circuit ?? false;
    const childTraces = [];
    const results: HandlerResult[] = [];

    for (const cond of conditions) {
      const child = evaluate(cond, context, input);
      results.push(child);
      childTraces.push(child.trace);
      if (child.success && shortCircuit) break;
    }

    const passed = results.filter(r => r.success).length;
    const total = conditions.length;
    const success = passed > 0;

    const opts = {
      summary: `OR: ${passed}/${total} conditions passed`,
      steps: results.map((r, i) => ({
        action: `Evaluate condition ${i}`,
        result: r.success ? 'PASS' : 'FAIL',
      })),
      handler_id: ID, handler_version: VERSION,
      input, execution_path: ID, duration_ms: now() - start,
      child_traces: childTraces,
    };

    return success
      ? makeSuccess({ pass: true, passed, total }, opts)
      : makeFailure({ pass: false, passed, total }, opts);
  },
};
```

Create `packages/kernel-vm/src/handlers/logic/not.ts`:
```typescript
import type { HandlerDefinition } from '../../handler.js';
import type { ASTNode } from '@eurocomply/types';
import { makeSuccess, makeFailure, now } from '../../result.js';

const ID = 'core:not';
const VERSION = '1.0.0';

export const notHandler: HandlerDefinition = {
  id: ID, version: VERSION, category: 'logic',
  description: 'Logical NOT — negates the result of a condition',

  execute(config, input, context, evaluate) {
    const start = now();
    const condition = (config as { condition: ASTNode }).condition;
    const child = evaluate(condition, context, input);
    const success = !child.success;

    const opts = {
      summary: `NOT: ${child.success ? 'PASS→FAIL' : 'FAIL→PASS'}`,
      steps: [{ action: 'Negate condition', result: success ? 'PASS' : 'FAIL' }],
      handler_id: ID, handler_version: VERSION,
      input, execution_path: ID, duration_ms: now() - start,
      child_traces: [child.trace],
    };

    return success
      ? makeSuccess({ pass: true, negated: true }, opts)
      : makeFailure({ pass: false, negated: true }, opts);
  },
};
```

Create `packages/kernel-vm/src/handlers/logic/if-then.ts`:
```typescript
import type { HandlerDefinition } from '../../handler.js';
import type { ASTNode } from '@eurocomply/types';
import { makeSuccess, makeFailure, now } from '../../result.js';

const ID = 'core:if_then';
const VERSION = '1.0.0';

export const ifThenHandler: HandlerDefinition = {
  id: ID, version: VERSION, category: 'logic',
  description: 'Conditional branching — evaluates then or else based on if condition',

  execute(config, input, context, evaluate) {
    const start = now();
    const cfg = config as {
      if: ASTNode;
      then: ASTNode;
      else?: ASTNode;
      default_when_skipped?: boolean;
    };

    const condResult = evaluate(cfg.if, context, input);
    const childTraces = [condResult.trace];

    if (condResult.success) {
      const thenResult = evaluate(cfg.then, context, input);
      childTraces.push(thenResult.trace);
      const opts = {
        summary: `IF passed → THEN ${thenResult.success ? 'PASS' : 'FAIL'}`,
        steps: [
          { action: 'Evaluate IF condition', result: 'PASS' },
          { action: 'Evaluate THEN branch', result: thenResult.success ? 'PASS' : 'FAIL' },
        ],
        handler_id: ID, handler_version: VERSION,
        input, execution_path: ID, duration_ms: now() - start,
        child_traces: childTraces,
      };
      return thenResult.success
        ? makeSuccess({ pass: true, branch: 'then' }, opts)
        : makeFailure({ pass: false, branch: 'then' }, opts);
    }

    if (cfg.else) {
      const elseResult = evaluate(cfg.else, context, input);
      childTraces.push(elseResult.trace);
      const opts = {
        summary: `IF failed → ELSE ${elseResult.success ? 'PASS' : 'FAIL'}`,
        steps: [
          { action: 'Evaluate IF condition', result: 'FAIL' },
          { action: 'Evaluate ELSE branch', result: elseResult.success ? 'PASS' : 'FAIL' },
        ],
        handler_id: ID, handler_version: VERSION,
        input, execution_path: ID, duration_ms: now() - start,
        child_traces: childTraces,
      };
      return elseResult.success
        ? makeSuccess({ pass: true, branch: 'else' }, opts)
        : makeFailure({ pass: false, branch: 'else' }, opts);
    }

    const defaultResult = cfg.default_when_skipped ?? false;
    const opts = {
      summary: `IF failed → skipped (default: ${defaultResult})`,
      steps: [{ action: 'Evaluate IF condition', result: 'FAIL' }, { action: 'No ELSE branch', result: 'SKIPPED' }],
      handler_id: ID, handler_version: VERSION,
      input, execution_path: ID, duration_ms: now() - start,
      child_traces: childTraces,
    };
    return defaultResult
      ? makeSuccess({ pass: true, branch: 'skipped' }, opts)
      : makeFailure({ pass: false, branch: 'skipped' }, opts);
  },
};
```

**Step 4: Run tests**

```bash
pnpm --filter @eurocomply/kernel-vm test
```

Expected: All logic handler tests PASS.

**Step 5: Commit**

```bash
git add packages/kernel-vm/src/handlers/logic/
git commit -m "feat(kernel-vm): add logic gate handlers — and, or, not, if_then"
```

---

## Task 9: Composition Handlers — pipe, for_each

**Files:**
- Create: `packages/kernel-vm/src/handlers/logic/pipe.ts`
- Create: `packages/kernel-vm/src/handlers/logic/for-each.ts`
- Create: `packages/kernel-vm/src/handlers/logic/composition.test.ts`

**Step 1: Write the failing test**

Create `packages/kernel-vm/src/handlers/logic/composition.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { pipeHandler } from './pipe.js';
import { forEachHandler } from './for-each.js';
import type { ExecutionContext, ASTNode, HandlerResult } from '@eurocomply/types';
import type { EvaluateFn } from '../../handler.js';

const ctx: ExecutionContext = {
  entity_type: 'product', entity_id: 'p1',
  entity_data: {
    materials: [
      { id: 'm1', name: 'Water', concentration: 0.8 },
      { id: 'm2', name: 'Lead', concentration: 0.002 },
    ],
  },
  data: {}, compliance_lock_id: 'lock_1',
  vertical_id: 'test', market: 'EU', timestamp: '2026-01-01T00:00:00Z',
};

describe('core:pipe', () => {
  it('chains handler outputs — each step receives previous output', () => {
    let callIndex = 0;
    const evaluate: EvaluateFn = (_node, _ctx, input) => {
      callIndex++;
      const val = ((input as number) ?? 0) + 10;
      return {
        success: true, value: val,
        explanation: { summary: `step ${callIndex}`, steps: [] },
        trace: { handler_id: 'step', handler_version: '1.0.0', duration_ms: 0, input, output: val, execution_path: 'step', status: 'success' },
      };
    };
    const result = pipeHandler.execute(
      { steps: [{ handler: 'a', config: {} }, { handler: 'b', config: {} }] },
      0, ctx, evaluate
    );
    expect(result.success).toBe(true);
    expect(result.value).toBe(20); // 0 + 10 + 10
  });

  it('stops on first failure', () => {
    let callCount = 0;
    const evaluate: EvaluateFn = (_node, _ctx, _input) => {
      callCount++;
      return {
        success: false, value: null,
        explanation: { summary: 'fail', steps: [] },
        trace: { handler_id: 'step', handler_version: '1.0.0', duration_ms: 0, input: null, output: null, execution_path: 'step', status: 'failed' },
      };
    };
    const result = pipeHandler.execute(
      { steps: [{ handler: 'a', config: {} }, { handler: 'b', config: {} }] },
      null, ctx, evaluate
    );
    expect(result.success).toBe(false);
    expect(callCount).toBe(1);
  });
});

describe('core:for_each', () => {
  it('passes when all items pass (require: all)', () => {
    const evaluate: EvaluateFn = (_node, _ctx, input) => {
      const item = input as { concentration: number };
      const pass = item.concentration < 1;
      return {
        success: pass, value: { pass },
        explanation: { summary: pass ? 'ok' : 'fail', steps: [] },
        trace: { handler_id: 'check', handler_version: '1.0.0', duration_ms: 0, input, output: { pass }, execution_path: 'check', status: 'success' },
      };
    };
    const result = forEachHandler.execute(
      { source: { field: 'materials' }, validation: { handler: 'check', config: {} }, require: 'all' },
      null, ctx, evaluate
    );
    expect(result.success).toBe(true);
  });

  it('fails when any item fails (require: all)', () => {
    const evaluate: EvaluateFn = (_node, _ctx, input) => {
      const item = input as { concentration: number };
      const pass = item.concentration < 0.5;
      return {
        success: pass, value: { pass },
        explanation: { summary: pass ? 'ok' : 'fail', steps: [] },
        trace: { handler_id: 'check', handler_version: '1.0.0', duration_ms: 0, input, output: { pass }, execution_path: 'check', status: 'success' },
      };
    };
    const result = forEachHandler.execute(
      { source: { field: 'materials' }, validation: { handler: 'check', config: {} }, require: 'all' },
      null, ctx, evaluate
    );
    expect(result.success).toBe(false);
  });

  it('passes when any item passes (require: any)', () => {
    const evaluate: EvaluateFn = (_node, _ctx, input) => {
      const item = input as { concentration: number };
      const pass = item.concentration < 0.5;
      return {
        success: pass, value: { pass },
        explanation: { summary: pass ? 'ok' : 'fail', steps: [] },
        trace: { handler_id: 'check', handler_version: '1.0.0', duration_ms: 0, input, output: { pass }, execution_path: 'check', status: 'success' },
      };
    };
    const result = forEachHandler.execute(
      { source: { field: 'materials' }, validation: { handler: 'check', config: {} }, require: 'any' },
      null, ctx, evaluate
    );
    expect(result.success).toBe(true);
  });
});
```

**Step 2: Run test to verify failure**

```bash
pnpm --filter @eurocomply/kernel-vm test
```

**Step 3: Write the implementations**

Create `packages/kernel-vm/src/handlers/logic/pipe.ts`:
```typescript
import type { HandlerDefinition } from '../../handler.js';
import type { ASTNode } from '@eurocomply/types';
import { makeSuccess, makeFailure, now } from '../../result.js';

const ID = 'core:pipe';
const VERSION = '1.0.0';

export const pipeHandler: HandlerDefinition = {
  id: ID, version: VERSION, category: 'logic',
  description: 'Sequential pipeline — output of each step feeds as input to the next',

  execute(config, input, context, evaluate) {
    const start = now();
    const steps = (config as { steps: ASTNode[] }).steps;
    const childTraces = [];
    let currentInput = input;

    for (let i = 0; i < steps.length; i++) {
      const stepResult = evaluate(steps[i], context, currentInput);
      childTraces.push(stepResult.trace);

      if (!stepResult.success) {
        return makeFailure(stepResult.value, {
          summary: `Pipe failed at step ${i + 1}/${steps.length}`,
          steps: [{ action: `Step ${i + 1}`, result: 'FAIL', data: { summary: stepResult.explanation.summary } }],
          handler_id: ID, handler_version: VERSION,
          input, execution_path: ID, duration_ms: now() - start,
          child_traces: childTraces,
        });
      }

      currentInput = stepResult.value;
    }

    return makeSuccess(currentInput, {
      summary: `Pipe completed ${steps.length} steps`,
      steps: childTraces.map((t, i) => ({ action: `Step ${i + 1}`, result: 'PASS' })),
      handler_id: ID, handler_version: VERSION,
      input, execution_path: ID, duration_ms: now() - start,
      child_traces: childTraces,
    });
  },
};
```

Create `packages/kernel-vm/src/handlers/logic/for-each.ts`:
```typescript
import type { HandlerDefinition } from '../../handler.js';
import type { ASTNode } from '@eurocomply/types';
import { resolveValue } from '../../resolve.js';
import { makeSuccess, makeFailure, now } from '../../result.js';

const ID = 'core:for_each';
const VERSION = '1.0.0';

export const forEachHandler: HandlerDefinition = {
  id: ID, version: VERSION, category: 'logic',
  description: 'Iterate over a collection and apply validation to each item',

  execute(config, input, context, evaluate) {
    const start = now();
    const cfg = config as {
      source: unknown;
      validation: ASTNode;
      require: 'all' | 'any' | 'none';
    };

    const items = resolveValue(cfg.source, context, input);
    if (!Array.isArray(items)) {
      return makeFailure({ pass: false, error: 'source is not an array' }, {
        summary: 'for_each: source did not resolve to an array',
        handler_id: ID, handler_version: VERSION,
        input, execution_path: ID, duration_ms: now() - start,
        error: { message: 'source is not an array' },
      });
    }

    const childTraces = [];
    const results: { index: number; success: boolean; item: unknown }[] = [];

    for (let i = 0; i < items.length; i++) {
      const itemResult = evaluate(cfg.validation, context, items[i]);
      childTraces.push(itemResult.trace);
      results.push({ index: i, success: itemResult.success, item: items[i] });
    }

    const passed = results.filter(r => r.success).length;
    const total = results.length;

    let success: boolean;
    switch (cfg.require) {
      case 'all': success = passed === total; break;
      case 'any': success = passed > 0; break;
      case 'none': success = passed === 0; break;
      default: success = passed === total;
    }

    const failures = results.filter(r => !r.success);
    const opts = {
      summary: `for_each (${cfg.require}): ${passed}/${total} passed`,
      steps: results.map((r) => ({
        action: `Item ${r.index}`,
        result: r.success ? 'PASS' : 'FAIL',
      })),
      handler_id: ID, handler_version: VERSION,
      input, execution_path: ID, duration_ms: now() - start,
      child_traces: childTraces,
    };

    const value = { pass: success, passed, total, failures: failures.map(f => ({ index: f.index, item: f.item })) };
    return success ? makeSuccess(value, opts) : makeFailure(value, opts);
  },
};
```

**Step 4: Run tests**

```bash
pnpm --filter @eurocomply/kernel-vm test
```

Expected: All composition tests PASS.

**Step 5: Commit**

```bash
git add packages/kernel-vm/src/handlers/logic/pipe.ts packages/kernel-vm/src/handlers/logic/for-each.ts packages/kernel-vm/src/handlers/logic/composition.test.ts
git commit -m "feat(kernel-vm): add pipe and for_each composition handlers"
```

---

## Task 10: Validation Handlers

**Files:**
- Create: `packages/kernel-vm/src/handlers/validation/threshold-check.ts`
- Create: `packages/kernel-vm/src/handlers/validation/absence-check.ts`
- Create: `packages/kernel-vm/src/handlers/validation/list-check.ts`
- Create: `packages/kernel-vm/src/handlers/validation/completeness-check.ts`
- Create: `packages/kernel-vm/src/handlers/validation/validation.test.ts`

**Step 1: Write the failing test**

Create `packages/kernel-vm/src/handlers/validation/validation.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { thresholdCheckHandler } from './threshold-check.js';
import { absenceCheckHandler } from './absence-check.js';
import { listCheckHandler } from './list-check.js';
import { completenessCheckHandler } from './completeness-check.js';
import type { ExecutionContext } from '@eurocomply/types';

const noopEvaluate = () => { throw new Error('should not be called'); };

const ctx: ExecutionContext = {
  entity_type: 'product', entity_id: 'p1',
  entity_data: {
    lead_concentration: 0.0003,
    substances: ['CAS-123', 'CAS-789'],
    name: 'Test Product',
    weight: 100,
  },
  data: {
    svhc_list: ['CAS-456', 'CAS-789'],
    approved_list: ['CAS-123', 'CAS-789', 'CAS-999'],
  },
  compliance_lock_id: 'lock_1', vertical_id: 'cosmetics',
  market: 'EU', timestamp: '2026-01-01T00:00:00Z',
};

describe('core:threshold_check', () => {
  it('passes when value < threshold', () => {
    const result = thresholdCheckHandler.execute(
      { value: { field: 'lead_concentration' }, operator: 'lt', threshold: 0.001 },
      null, ctx, noopEvaluate
    );
    expect(result.success).toBe(true);
  });

  it('fails when value >= threshold', () => {
    const result = thresholdCheckHandler.execute(
      { value: { field: 'lead_concentration' }, operator: 'lt', threshold: 0.0001 },
      null, ctx, noopEvaluate
    );
    expect(result.success).toBe(false);
  });

  it('supports all operators', () => {
    expect(thresholdCheckHandler.execute({ value: 10, operator: 'gt', threshold: 5 }, null, ctx, noopEvaluate).success).toBe(true);
    expect(thresholdCheckHandler.execute({ value: 5, operator: 'gte', threshold: 5 }, null, ctx, noopEvaluate).success).toBe(true);
    expect(thresholdCheckHandler.execute({ value: 5, operator: 'lte', threshold: 5 }, null, ctx, noopEvaluate).success).toBe(true);
    expect(thresholdCheckHandler.execute({ value: 5, operator: 'eq', threshold: 5 }, null, ctx, noopEvaluate).success).toBe(true);
    expect(thresholdCheckHandler.execute({ value: 5, operator: 'ne', threshold: 6 }, null, ctx, noopEvaluate).success).toBe(true);
  });

  it('supports tolerance', () => {
    const result = thresholdCheckHandler.execute(
      { value: 0.001, operator: 'lt', threshold: 0.001, tolerance: 0.0001 },
      null, ctx, noopEvaluate
    );
    expect(result.success).toBe(true);
  });
});

describe('core:absence_check', () => {
  it('passes when no prohibited items found', () => {
    const result = absenceCheckHandler.execute(
      { source: { field: 'substances' }, prohibited: { data_key: 'svhc_list' } },
      null,
      { ...ctx, entity_data: { ...ctx.entity_data, substances: ['CAS-123'] } },
      noopEvaluate
    );
    expect(result.success).toBe(true);
  });

  it('fails when prohibited items found', () => {
    const result = absenceCheckHandler.execute(
      { source: { field: 'substances' }, prohibited: { data_key: 'svhc_list' } },
      null, ctx, noopEvaluate
    );
    expect(result.success).toBe(false);
    expect((result.value as any).found).toContain('CAS-789');
  });
});

describe('core:list_check', () => {
  it('passes when all values in allowlist', () => {
    const result = listCheckHandler.execute(
      { value: { field: 'substances' }, list_source: { data_key: 'approved_list' }, list_type: 'allowlist' },
      null, ctx, noopEvaluate
    );
    expect(result.success).toBe(true);
  });

  it('fails when values in blocklist', () => {
    const result = listCheckHandler.execute(
      { value: { field: 'substances' }, list_source: { data_key: 'svhc_list' }, list_type: 'blocklist' },
      null, ctx, noopEvaluate
    );
    expect(result.success).toBe(false);
  });
});

describe('core:completeness_check', () => {
  it('passes when all required fields present', () => {
    const result = completenessCheckHandler.execute(
      { entity: { field: '' }, required_fields: ['name', 'weight'] },
      null, ctx, noopEvaluate
    );
    expect(result.success).toBe(true);
  });

  it('fails when required fields missing', () => {
    const result = completenessCheckHandler.execute(
      { entity: { field: '' }, required_fields: ['name', 'description', 'category'] },
      null, ctx, noopEvaluate
    );
    expect(result.success).toBe(false);
    expect((result.value as any).missing).toContain('description');
  });

  it('supports minimum_completion percentage', () => {
    const result = completenessCheckHandler.execute(
      { entity: { field: '' }, required_fields: ['name', 'weight', 'description', 'category'], minimum_completion: 0.5 },
      null, ctx, noopEvaluate
    );
    expect(result.success).toBe(true); // 2/4 = 50%
  });
});
```

**Step 2: Run test to verify failure**

```bash
pnpm --filter @eurocomply/kernel-vm test
```

**Step 3: Write the implementations**

Create `packages/kernel-vm/src/handlers/validation/threshold-check.ts`:
```typescript
import type { HandlerDefinition } from '../../handler.js';
import { resolveValue } from '../../resolve.js';
import { makeSuccess, makeFailure, now } from '../../result.js';

const ID = 'core:threshold_check';
const VERSION = '1.0.0';
type Op = 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'ne';

function compare(v: number, op: Op, t: number, tol = 0): boolean {
  switch (op) {
    case 'gt':  return v > t - tol;
    case 'gte': return v >= t - tol;
    case 'lt':  return v < t + tol;
    case 'lte': return v <= t + tol;
    case 'eq':  return Math.abs(v - t) <= tol;
    case 'ne':  return Math.abs(v - t) > tol;
  }
}

export const thresholdCheckHandler: HandlerDefinition = {
  id: ID, version: VERSION, category: 'validation',
  description: 'Check if a numeric value meets a threshold condition',
  execute(config, input, context, _evaluate) {
    const start = now();
    const cfg = config as { value: unknown; operator: Op; threshold: number; tolerance?: number };
    const resolved = resolveValue(cfg.value, context, input);
    const value = typeof resolved === 'number' ? resolved : Number(resolved);
    const pass = compare(value, cfg.operator, cfg.threshold, cfg.tolerance);
    const opts = {
      summary: `${value} ${cfg.operator} ${cfg.threshold} → ${pass ? 'PASS' : 'FAIL'}`,
      steps: [{ action: 'Compare value to threshold', result: `${value} ${cfg.operator} ${cfg.threshold}` }],
      handler_id: ID, handler_version: VERSION,
      input: cfg, execution_path: ID, duration_ms: now() - start,
    };
    const val = { pass, handler_id: ID, handler_version: VERSION, value, threshold: cfg.threshold, operator: cfg.operator };
    return pass ? makeSuccess(val, opts) : makeFailure(val, opts);
  },
};
```

Create `packages/kernel-vm/src/handlers/validation/absence-check.ts`:
```typescript
import type { HandlerDefinition } from '../../handler.js';
import { resolveValue } from '../../resolve.js';
import { makeSuccess, makeFailure, now } from '../../result.js';

const ID = 'core:absence_check';
const VERSION = '1.0.0';

export const absenceCheckHandler: HandlerDefinition = {
  id: ID, version: VERSION, category: 'validation',
  description: 'Check that no prohibited items appear in source',
  execute(config, input, context, _evaluate) {
    const start = now();
    const cfg = config as { source: unknown; prohibited: unknown };
    const source = resolveValue(cfg.source, context, input);
    const prohibited = resolveValue(cfg.prohibited, context, input);
    const srcArr = Array.isArray(source) ? source : [source];
    const prohibSet = new Set(Array.isArray(prohibited) ? prohibited : [prohibited]);
    const found = srcArr.filter(item => prohibSet.has(item));
    const pass = found.length === 0;
    const opts = {
      summary: pass ? 'No prohibited items found' : `${found.length} prohibited item(s): ${found.join(', ')}`,
      steps: [{ action: 'Check against prohibited list', result: pass ? 'PASS' : 'FAIL', data: { found } }],
      handler_id: ID, handler_version: VERSION, input: cfg, execution_path: ID, duration_ms: now() - start,
    };
    const val = { pass, handler_id: ID, handler_version: VERSION, found, checked: srcArr.length };
    return pass ? makeSuccess(val, opts) : makeFailure(val, opts);
  },
};
```

Create `packages/kernel-vm/src/handlers/validation/list-check.ts`:
```typescript
import type { HandlerDefinition } from '../../handler.js';
import { resolveValue } from '../../resolve.js';
import { makeSuccess, makeFailure, now } from '../../result.js';

const ID = 'core:list_check';
const VERSION = '1.0.0';

export const listCheckHandler: HandlerDefinition = {
  id: ID, version: VERSION, category: 'validation',
  description: 'Check if values appear in an allowlist or blocklist',
  execute(config, input, context, _evaluate) {
    const start = now();
    const cfg = config as { value: unknown; list_source: unknown; list_type: 'allowlist' | 'blocklist' };
    const values = resolveValue(cfg.value, context, input);
    const list = resolveValue(cfg.list_source, context, input);
    const vArr = Array.isArray(values) ? values : [values];
    const lSet = new Set(Array.isArray(list) ? list : [list]);
    const inList = vArr.filter(v => lSet.has(v));
    const notInList = vArr.filter(v => !lSet.has(v));
    const pass = cfg.list_type === 'allowlist' ? notInList.length === 0 : inList.length === 0;
    const opts = {
      summary: `${cfg.list_type}: ${inList.length}/${vArr.length} in list → ${pass ? 'PASS' : 'FAIL'}`,
      steps: [{ action: `Check ${cfg.list_type}`, result: pass ? 'PASS' : 'FAIL', data: { in_list: inList, not_in_list: notInList } }],
      handler_id: ID, handler_version: VERSION, input: cfg, execution_path: ID, duration_ms: now() - start,
    };
    const val = { pass, handler_id: ID, handler_version: VERSION, list_type: cfg.list_type, in_list: inList, not_in_list: notInList };
    return pass ? makeSuccess(val, opts) : makeFailure(val, opts);
  },
};
```

Create `packages/kernel-vm/src/handlers/validation/completeness-check.ts`:
```typescript
import type { HandlerDefinition } from '../../handler.js';
import { resolveValue, getNestedValue } from '../../resolve.js';
import { makeSuccess, makeFailure, now } from '../../result.js';

const ID = 'core:completeness_check';
const VERSION = '1.0.0';

export const completenessCheckHandler: HandlerDefinition = {
  id: ID, version: VERSION, category: 'validation',
  description: 'Check that required fields are present and non-empty',
  execute(config, input, context, _evaluate) {
    const start = now();
    const cfg = config as { entity: unknown; required_fields: string[]; minimum_completion?: number };
    let entity: unknown;
    if (typeof cfg.entity === 'object' && cfg.entity !== null && 'field' in cfg.entity) {
      const ref = cfg.entity as { field: string };
      entity = ref.field === '' ? context.entity_data : resolveValue(cfg.entity, context, input);
    } else {
      entity = resolveValue(cfg.entity, context, input);
    }
    const present: string[] = [];
    const missing: string[] = [];
    for (const f of cfg.required_fields) {
      const v = getNestedValue(entity, f);
      if (v != null && v !== '' && !(Array.isArray(v) && v.length === 0)) present.push(f);
      else missing.push(f);
    }
    const completion = cfg.required_fields.length > 0 ? present.length / cfg.required_fields.length : 1;
    const pass = completion >= (cfg.minimum_completion ?? 1.0);
    const opts = {
      summary: `Completeness: ${present.length}/${cfg.required_fields.length} (${(completion * 100).toFixed(0)}%) → ${pass ? 'PASS' : 'FAIL'}`,
      steps: [{ action: 'Check required fields', result: pass ? 'PASS' : 'FAIL', data: { present, missing } }],
      handler_id: ID, handler_version: VERSION, input: cfg, execution_path: ID, duration_ms: now() - start,
    };
    const val = { pass, handler_id: ID, handler_version: VERSION, present, missing, completion };
    return pass ? makeSuccess(val, opts) : makeFailure(val, opts);
  },
};
```

**Step 4: Run tests, Step 5: Commit**

```bash
pnpm --filter @eurocomply/kernel-vm test
git add packages/kernel-vm/src/handlers/validation/
git commit -m "feat(kernel-vm): add validation handlers — threshold, absence, list, completeness"
```

---

## Task 11: Computation Handlers — bom_sum, unit_convert, ratio

**Files:**
- Create: `packages/kernel-vm/src/handlers/computation/bom-sum.ts`
- Create: `packages/kernel-vm/src/handlers/computation/unit-convert.ts`
- Create: `packages/kernel-vm/src/handlers/computation/ratio.ts`
- Create: `packages/kernel-vm/src/handlers/computation/computation.test.ts`

**Step 1: Write the failing test**

Create `packages/kernel-vm/src/handlers/computation/computation.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { bomSumHandler } from './bom-sum.js';
import { unitConvertHandler } from './unit-convert.js';
import { ratioHandler } from './ratio.js';
import type { ExecutionContext } from '@eurocomply/types';

const noopEvaluate = () => { throw new Error('should not be called'); };
const ctx: ExecutionContext = {
  entity_type: 'product', entity_id: 'p1',
  entity_data: {
    materials: [
      { id: 'm1', lead_ppm: 10, type: 'active' },
      { id: 'm2', lead_ppm: 20, type: 'excipient' },
      { id: 'm3', lead_ppm: 5, type: 'active' },
    ],
    total_weight: 500,
    active_concentration: 0.15,
  },
  data: {}, compliance_lock_id: 'lock_1',
  vertical_id: 'cosmetics', market: 'EU', timestamp: '2026-01-01T00:00:00Z',
};

describe('core:bom_sum', () => {
  it('sums a field across all items', () => {
    const r = bomSumHandler.execute({ source: { field: 'materials' }, field: 'lead_ppm' }, null, ctx, noopEvaluate);
    expect(r.success).toBe(true);
    expect((r.value as any).sum).toBe(35);
  });
  it('applies filter', () => {
    const r = bomSumHandler.execute({ source: { field: 'materials' }, field: 'lead_ppm', filter: { field: 'type', equals: 'active' } }, null, ctx, noopEvaluate);
    expect((r.value as any).sum).toBe(15);
  });
});

describe('core:unit_convert', () => {
  it('converts ppm to percent', () => {
    const r = unitConvertHandler.execute({ source_value: 10000, source_unit: 'ppm', target_unit: 'percent' }, null, ctx, noopEvaluate);
    expect((r.value as any).converted).toBe(1);
  });
  it('converts kg to g', () => {
    const r = unitConvertHandler.execute({ source_value: 2.5, source_unit: 'kg', target_unit: 'g' }, null, ctx, noopEvaluate);
    expect((r.value as any).converted).toBe(2500);
  });
  it('fails on unsupported conversion', () => {
    const r = unitConvertHandler.execute({ source_value: 100, source_unit: 'kg', target_unit: 'ppm' }, null, ctx, noopEvaluate);
    expect(r.success).toBe(false);
  });
  it('resolves field references', () => {
    const r = unitConvertHandler.execute({ source_value: { field: 'total_weight' }, source_unit: 'g', target_unit: 'kg' }, null, ctx, noopEvaluate);
    expect((r.value as any).converted).toBe(0.5);
  });
});

describe('core:ratio', () => {
  it('computes ratio', () => {
    const r = ratioHandler.execute({ numerator: { field: 'active_concentration' }, denominator: 1 }, null, ctx, noopEvaluate);
    expect((r.value as any).ratio).toBe(0.15);
  });
  it('supports multiply_by', () => {
    const r = ratioHandler.execute({ numerator: { field: 'active_concentration' }, denominator: 1, multiply_by: 100 }, null, ctx, noopEvaluate);
    expect((r.value as any).ratio).toBe(15);
  });
  it('fails on division by zero', () => {
    const r = ratioHandler.execute({ numerator: 10, denominator: 0 }, null, ctx, noopEvaluate);
    expect(r.success).toBe(false);
  });
});
```

**Step 2-3: Implement handlers**

Create `packages/kernel-vm/src/handlers/computation/bom-sum.ts`:
```typescript
import type { HandlerDefinition } from '../../handler.js';
import { resolveValue, getNestedValue } from '../../resolve.js';
import { makeSuccess, makeFailure, now } from '../../result.js';
const ID = 'core:bom_sum'; const VERSION = '1.0.0';

export const bomSumHandler: HandlerDefinition = {
  id: ID, version: VERSION, category: 'computation',
  description: 'Sum a numeric field across items in a collection',
  execute(config, input, context, _evaluate) {
    const start = now();
    const cfg = config as { source: unknown; field: string; filter?: { field: string; equals: unknown } };
    const source = resolveValue(cfg.source, context, input);
    if (!Array.isArray(source)) return makeFailure({ sum: 0 }, { summary: 'source is not array', handler_id: ID, handler_version: VERSION, input: cfg, execution_path: ID, duration_ms: now() - start, error: { message: 'not array' } });
    let items = source;
    if (cfg.filter) items = items.filter(item => getNestedValue(item, cfg.filter!.field) === cfg.filter!.equals);
    const sum = items.reduce((a, item) => a + (Number(getNestedValue(item, cfg.field)) || 0), 0);
    return makeSuccess({ sum, items_counted: items.length }, { summary: `Sum '${cfg.field}': ${sum} (${items.length} items)`, handler_id: ID, handler_version: VERSION, input: cfg, execution_path: ID, duration_ms: now() - start });
  },
};
```

Create `packages/kernel-vm/src/handlers/computation/unit-convert.ts`:
```typescript
import type { HandlerDefinition } from '../../handler.js';
import { resolveValue } from '../../resolve.js';
import { makeSuccess, makeFailure, now } from '../../result.js';
const ID = 'core:unit_convert'; const VERSION = '1.0.0';
const C: Record<string, Record<string, number>> = {
  'ppm': { 'percent': 1e-4, 'ppb': 1e3, 'mg/kg': 1 },
  'ppb': { 'ppm': 1e-3, 'percent': 1e-7, 'mg/kg': 1e-3 },
  'percent': { 'ppm': 1e4, 'ppb': 1e7, 'mg/kg': 1e4 },
  'mg/kg': { 'ppm': 1, 'ppb': 1e3, 'percent': 1e-4 },
  'kg': { 'g': 1e3, 'mg': 1e6 }, 'g': { 'kg': 1e-3, 'mg': 1e3 }, 'mg': { 'kg': 1e-6, 'g': 1e-3 },
  'l': { 'ml': 1e3 }, 'ml': { 'l': 1e-3 },
};
export const unitConvertHandler: HandlerDefinition = {
  id: ID, version: VERSION, category: 'computation',
  description: 'Convert a value between units',
  execute(config, input, context, _evaluate) {
    const start = now();
    const cfg = config as { source_value: unknown; source_unit: string; target_unit: string };
    const value = Number(resolveValue(cfg.source_value, context, input));
    if (cfg.source_unit === cfg.target_unit) return makeSuccess({ converted: value, source_unit: cfg.source_unit, target_unit: cfg.target_unit }, { summary: `${value} ${cfg.source_unit}`, handler_id: ID, handler_version: VERSION, input: cfg, execution_path: ID, duration_ms: now() - start });
    const f = C[cfg.source_unit]?.[cfg.target_unit];
    if (f == null) return makeFailure({ converted: null }, { summary: `Cannot convert ${cfg.source_unit} → ${cfg.target_unit}`, handler_id: ID, handler_version: VERSION, input: cfg, execution_path: ID, duration_ms: now() - start, error: { message: 'unsupported' } });
    return makeSuccess({ converted: value * f, source_unit: cfg.source_unit, target_unit: cfg.target_unit }, { summary: `${value} ${cfg.source_unit} = ${value * f} ${cfg.target_unit}`, handler_id: ID, handler_version: VERSION, input: cfg, execution_path: ID, duration_ms: now() - start });
  },
};
```

Create `packages/kernel-vm/src/handlers/computation/ratio.ts`:
```typescript
import type { HandlerDefinition } from '../../handler.js';
import { resolveValue } from '../../resolve.js';
import { makeSuccess, makeFailure, now } from '../../result.js';
const ID = 'core:ratio'; const VERSION = '1.0.0';
export const ratioHandler: HandlerDefinition = {
  id: ID, version: VERSION, category: 'computation',
  description: 'Compute ratio between two values',
  execute(config, input, context, _evaluate) {
    const start = now();
    const cfg = config as { numerator: unknown; denominator: unknown; multiply_by?: number };
    const num = Number(resolveValue(cfg.numerator, context, input));
    const den = Number(resolveValue(cfg.denominator, context, input));
    if (den === 0) return makeFailure({ ratio: null }, { summary: 'Division by zero', handler_id: ID, handler_version: VERSION, input: cfg, execution_path: ID, duration_ms: now() - start, error: { message: 'zero denominator' } });
    const ratio = (num / den) * (cfg.multiply_by ?? 1);
    return makeSuccess({ ratio, numerator: num, denominator: den }, { summary: `${num}/${den}${cfg.multiply_by ? ` × ${cfg.multiply_by}` : ''} = ${ratio}`, handler_id: ID, handler_version: VERSION, input: cfg, execution_path: ID, duration_ms: now() - start });
  },
};
```

**Step 4-5: Test and commit**

```bash
pnpm --filter @eurocomply/kernel-vm test
git add packages/kernel-vm/src/handlers/computation/
git commit -m "feat(kernel-vm): add computation handlers — bom_sum, unit_convert, ratio"
```

---

## Task 12: Temporal Handler — deadline

**Files:**
- Create: `packages/kernel-vm/src/handlers/temporal/deadline.ts`
- Create: `packages/kernel-vm/src/handlers/temporal/temporal.test.ts`

**Step 1: Write test, Step 2: Verify failure, Step 3: Implement**

Create `packages/kernel-vm/src/handlers/temporal/temporal.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { deadlineHandler } from './deadline.js';
import type { ExecutionContext } from '@eurocomply/types';
const noopEvaluate = () => { throw new Error('unused'); };

describe('core:deadline', () => {
  it('within_window when deadline not reached', () => {
    const ctx: ExecutionContext = {
      entity_type: 'product', entity_id: 'p1',
      entity_data: { submitted_at: '2026-01-01T00:00:00Z' },
      data: {}, compliance_lock_id: 'lock_1', vertical_id: 'test', market: 'EU',
      timestamp: '2026-01-15T00:00:00Z',
    };
    const r = deadlineHandler.execute({ window: { duration: { value: 30, unit: 'days' }, started_at: { field: 'submitted_at' } }, on_expired: 'fail' }, null, ctx, noopEvaluate);
    expect(r.success).toBe(true);
    expect((r.value as any).status).toBe('within_window');
  });

  it('expired when deadline passed', () => {
    const ctx: ExecutionContext = {
      entity_type: 'product', entity_id: 'p1',
      entity_data: { submitted_at: '2025-01-01T00:00:00Z' },
      data: {}, compliance_lock_id: 'lock_1', vertical_id: 'test', market: 'EU',
      timestamp: '2026-01-15T00:00:00Z',
    };
    const r = deadlineHandler.execute({ window: { duration: { value: 30, unit: 'days' }, started_at: { field: 'submitted_at' } }, on_expired: 'fail' }, null, ctx, noopEvaluate);
    expect(r.success).toBe(false);
    expect((r.value as any).status).toBe('expired');
  });

  it('uses context.timestamp for determinism', () => {
    const ctx: ExecutionContext = {
      entity_type: 'product', entity_id: 'p1',
      entity_data: { submitted_at: '2026-01-01T00:00:00Z' },
      data: {}, compliance_lock_id: 'lock_1', vertical_id: 'test', market: 'EU',
      timestamp: '2026-02-01T00:00:00Z', // 31 days
    };
    const r = deadlineHandler.execute({ window: { duration: { value: 30, unit: 'days' }, started_at: { field: 'submitted_at' } }, on_expired: 'fail' }, null, ctx, noopEvaluate);
    expect(r.success).toBe(false);
  });
});
```

Create `packages/kernel-vm/src/handlers/temporal/deadline.ts`:
```typescript
import type { HandlerDefinition } from '../../handler.js';
import { resolveValue } from '../../resolve.js';
import { makeSuccess, makeFailure, now as perfNow } from '../../result.js';
const ID = 'core:deadline'; const VERSION = '1.0.0';
const MS: Record<string, number> = { hours: 36e5, days: 864e5, weeks: 6048e5, months: 2592e6, years: 31536e6 };

export const deadlineHandler: HandlerDefinition = {
  id: ID, version: VERSION, category: 'temporal',
  description: 'Check if a deadline has been reached',
  execute(config, input, context, _evaluate) {
    const start = perfNow();
    const cfg = config as { window: { duration: { value: number; unit: string }; started_at: unknown }; on_expired: 'fail' | 'escalate' };
    const startedAt = new Date(String(resolveValue(cfg.window.started_at, context, input))).getTime();
    const currentTime = new Date(context.timestamp).getTime();
    const deadlineMs = startedAt + cfg.window.duration.value * (MS[cfg.window.duration.unit] ?? 0);
    const remainingMs = deadlineMs - currentTime;
    const expired = remainingMs <= 0;
    const days = Math.ceil(Math.abs(remainingMs) / 864e5);
    const status = expired ? 'expired' : 'within_window';
    const value = {
      status,
      time_remaining: expired ? undefined : { value: days, unit: 'days' },
      time_overdue: expired ? { value: days, unit: 'days' } : undefined,
    };
    const opts = { summary: expired ? `Expired ${days}d ago` : `${days}d remaining`, steps: [{ action: 'Check deadline', result: status }], handler_id: ID, handler_version: VERSION, input: cfg, execution_path: ID, duration_ms: perfNow() - start };
    return expired && cfg.on_expired === 'fail' ? makeFailure(value, opts) : makeSuccess(value, opts);
  },
};
```

**Step 4-5: Test and commit**

```bash
pnpm --filter @eurocomply/kernel-vm test
git add packages/kernel-vm/src/handlers/temporal/
git commit -m "feat(kernel-vm): add deadline temporal handler"
```

---

## Task 13: AST Evaluator + Handler Registration + Public API

**Files:**
- Create: `packages/kernel-vm/src/evaluator.ts`
- Create: `packages/kernel-vm/src/handlers/index.ts`
- Create: `packages/kernel-vm/src/evaluator.test.ts`
- Modify: `packages/kernel-vm/src/index.ts`

**Step 1: Write the failing test**

Create `packages/kernel-vm/src/evaluator.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { evaluate } from './evaluator.js';
import { createDefaultRegistry } from './handlers/index.js';
import type { ExecutionContext, ASTNode } from '@eurocomply/types';

const ctx: ExecutionContext = {
  entity_type: 'product', entity_id: 'p1',
  entity_data: {
    lead_concentration: 0.0003,
    cadmium_concentration: 0.002,
    substances: ['CAS-123', 'CAS-456'],
    materials: [
      { id: 'm1', lead_ppm: 10, type: 'active' },
      { id: 'm2', lead_ppm: 5, type: 'active' },
    ],
  },
  data: { svhc_list: ['CAS-789', 'CAS-999'] },
  compliance_lock_id: 'lock_1', vertical_id: 'cosmetics', market: 'EU', timestamp: '2026-01-01T00:00:00Z',
};

describe('evaluate', () => {
  it('evaluates single threshold_check', () => {
    const ast: ASTNode = { handler: 'core:threshold_check', config: { value: { field: 'lead_concentration' }, operator: 'lt', threshold: 0.001 } };
    const r = evaluate(ast, ctx, createDefaultRegistry());
    expect(r.success).toBe(true);
  });

  it('evaluates AND of two checks', () => {
    const ast: ASTNode = { handler: 'core:and', config: { conditions: [
      { handler: 'core:threshold_check', config: { value: { field: 'lead_concentration' }, operator: 'lt', threshold: 0.001 } },
      { handler: 'core:threshold_check', config: { value: { field: 'cadmium_concentration' }, operator: 'lt', threshold: 0.01 } },
    ] } };
    const r = evaluate(ast, ctx, createDefaultRegistry());
    expect(r.success).toBe(true);
    expect(r.trace.child_traces).toHaveLength(2);
  });

  it('evaluates pipe: bom_sum → threshold', () => {
    const ast: ASTNode = { handler: 'core:pipe', config: { steps: [
      { handler: 'core:bom_sum', config: { source: { field: 'materials' }, field: 'lead_ppm' } },
      { handler: 'core:threshold_check', config: { value: { input_field: 'sum' }, operator: 'lt', threshold: 100 } },
    ] } };
    const r = evaluate(ast, ctx, createDefaultRegistry());
    expect(r.success).toBe(true);
  });

  it('throws on unknown handler', () => {
    expect(() => evaluate({ handler: 'core:nope', config: {} }, ctx, createDefaultRegistry())).toThrow('Unknown handler');
  });
});
```

**Step 2-3: Implement**

Create `packages/kernel-vm/src/handlers/index.ts`:
```typescript
import { HandlerRegistry } from '../registry.js';
import { andHandler } from './logic/and.js';
import { orHandler } from './logic/or.js';
import { notHandler } from './logic/not.js';
import { ifThenHandler } from './logic/if-then.js';
import { pipeHandler } from './logic/pipe.js';
import { forEachHandler } from './logic/for-each.js';
import { thresholdCheckHandler } from './validation/threshold-check.js';
import { absenceCheckHandler } from './validation/absence-check.js';
import { listCheckHandler } from './validation/list-check.js';
import { completenessCheckHandler } from './validation/completeness-check.js';
import { bomSumHandler } from './computation/bom-sum.js';
import { unitConvertHandler } from './computation/unit-convert.js';
import { ratioHandler } from './computation/ratio.js';
import { deadlineHandler } from './temporal/deadline.js';

export function createDefaultRegistry(): HandlerRegistry {
  const r = new HandlerRegistry();
  [andHandler, orHandler, notHandler, ifThenHandler, pipeHandler, forEachHandler,
   thresholdCheckHandler, absenceCheckHandler, listCheckHandler, completenessCheckHandler,
   bomSumHandler, unitConvertHandler, ratioHandler, deadlineHandler].forEach(h => r.register(h));
  return r;
}
```

Create `packages/kernel-vm/src/evaluator.ts`:
```typescript
import type { ASTNode, ExecutionContext, HandlerResult } from '@eurocomply/types';
import type { HandlerRegistry } from './registry.js';
import type { EvaluateFn } from './handler.js';

export function evaluate(ast: ASTNode, context: ExecutionContext, registry: HandlerRegistry): HandlerResult {
  return evalNode(ast, context, context.entity_data, registry, 'root');
}

function evalNode(node: ASTNode, context: ExecutionContext, input: unknown, registry: HandlerRegistry, path: string): HandlerResult {
  const handler = registry.get(node.handler);
  if (!handler) throw new Error(`Unknown handler: ${node.handler}`);

  const evaluateFn: EvaluateFn = (child, ctx, childInput) =>
    evalNode(child, ctx, childInput ?? input, registry, `${path} > ${child.handler}`);

  const result = handler.execute(node.config, input, context, evaluateFn);
  return { ...result, trace: { ...result.trace, execution_path: path } };
}
```

Update `packages/kernel-vm/src/index.ts`:
```typescript
export { HandlerRegistry } from './registry.js';
export { evaluate } from './evaluator.js';
export { validateAST } from './validator.js';
export { createDefaultRegistry } from './handlers/index.js';
export type { HandlerDefinition, EvaluateFn } from './handler.js';
export { resolveValue, getNestedValue, isFieldReference, isDataReference } from './resolve.js';
export { makeSuccess, makeFailure, makeTrace } from './result.js';
```

**Step 4-5: Test and commit**

```bash
pnpm --filter @eurocomply/kernel-vm test
git add packages/kernel-vm/src/evaluator.ts packages/kernel-vm/src/evaluator.test.ts packages/kernel-vm/src/handlers/index.ts packages/kernel-vm/src/index.ts
git commit -m "feat(kernel-vm): add AST evaluator, wire all 14 handlers, export public API"
```

---

## Task 14: Simulator

**Files:**
- Create: `packages/kernel-vm/src/simulator.ts`
- Create: `packages/kernel-vm/src/simulator.test.ts`

**Step 1: Write the failing test**

Create `packages/kernel-vm/src/simulator.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { Simulator } from './simulator.js';
import { createDefaultRegistry } from './handlers/index.js';
import type { ASTNode } from '@eurocomply/types';

const registry = createDefaultRegistry();
const rule: ASTNode = { handler: 'core:and', config: { conditions: [
  { handler: 'core:threshold_check', config: { value: { field: 'lead_ppm' }, operator: 'lt', threshold: 100 } },
  { handler: 'core:absence_check', config: { source: { field: 'substances' }, prohibited: { data_key: 'banned' } } },
] } };

describe('Simulator', () => {
  it('runs suite and reports all pass', () => {
    const sim = new Simulator(registry);
    const report = sim.run(rule, { vertical_id: 'test', test_cases: [
      { id: 'tc1', description: 'clean', entity_data: { lead_ppm: 5, substances: ['A'] }, context_data: { banned: ['Z'] }, expected_status: 'compliant' },
      { id: 'tc2', description: 'dirty', entity_data: { lead_ppm: 200, substances: ['A'] }, context_data: { banned: ['Z'] }, expected_status: 'non_compliant' },
    ] });
    expect(report.passed).toBe(2);
    expect(report.failed).toBe(0);
  });

  it('reports mismatch', () => {
    const sim = new Simulator(registry);
    const report = sim.run(rule, { vertical_id: 'test', test_cases: [
      { id: 'tc1', description: 'wrong expectation', entity_data: { lead_ppm: 200, substances: [] }, context_data: { banned: [] }, expected_status: 'compliant' },
    ] });
    expect(report.failed).toBe(1);
    expect(report.results[0].match).toBe(false);
  });

  it('validates AST before running', () => {
    const sim = new Simulator(registry);
    const report = sim.run({ handler: 'core:nope', config: {} }, { vertical_id: 'test', test_cases: [] });
    expect(report.ast_valid).toBe(false);
  });

  it('includes traces', () => {
    const sim = new Simulator(registry);
    const report = sim.run(rule, { vertical_id: 'test', test_cases: [
      { id: 'tc1', description: 'basic', entity_data: { lead_ppm: 5, substances: [] }, context_data: { banned: [] }, expected_status: 'compliant' },
    ] });
    expect(report.results[0].trace.handler_id).toBe('core:and');
  });
});
```

**Step 2-3: Implement**

Create `packages/kernel-vm/src/simulator.ts`:
```typescript
import type { ASTNode, ASTValidationError, ExecutionTrace } from '@eurocomply/types';
import type { HandlerRegistry } from './registry.js';
import { validateAST } from './validator.js';
import { evaluate } from './evaluator.js';

export interface TestCase {
  id: string;
  description: string;
  entity_data: Record<string, unknown>;
  context_data?: Record<string, unknown>;
  expected_status: 'compliant' | 'non_compliant';
}

export interface ValidationSuite {
  vertical_id: string;
  test_cases: TestCase[];
}

export interface TestCaseResult {
  test_case_id: string;
  description: string;
  expected_status: 'compliant' | 'non_compliant';
  actual_status: 'compliant' | 'non_compliant';
  match: boolean;
  trace: ExecutionTrace;
  explanation: string;
}

export interface SimulatorReport {
  ast_valid: boolean;
  ast_errors: ASTValidationError[];
  total: number;
  passed: number;
  failed: number;
  results: TestCaseResult[];
}

export class Simulator {
  constructor(private registry: HandlerRegistry) {}

  run(ast: ASTNode, suite: ValidationSuite): SimulatorReport {
    const v = validateAST(ast, this.registry);
    if (!v.valid) return { ast_valid: false, ast_errors: v.errors, total: 0, passed: 0, failed: 0, results: [] };

    const results: TestCaseResult[] = suite.test_cases.map(tc => {
      const ctx = {
        entity_type: 'test', entity_id: tc.id,
        entity_data: tc.entity_data, data: tc.context_data ?? {},
        compliance_lock_id: 'simulator', vertical_id: suite.vertical_id,
        market: 'test', timestamp: new Date().toISOString(),
      };
      const r = evaluate(ast, ctx, this.registry);
      const actual = r.success ? 'compliant' as const : 'non_compliant' as const;
      return { test_case_id: tc.id, description: tc.description, expected_status: tc.expected_status, actual_status: actual, match: actual === tc.expected_status, trace: r.trace, explanation: r.explanation.summary };
    });

    return { ast_valid: true, ast_errors: [], total: results.length, passed: results.filter(r => r.match).length, failed: results.filter(r => !r.match).length, results };
  }
}
```

**Step 4: Run full test suite and build**

```bash
pnpm build && pnpm --filter @eurocomply/kernel-vm test
```

Expected: Clean build, all tests pass.

**Step 5: Commit**

```bash
git add packages/kernel-vm/src/simulator.ts packages/kernel-vm/src/simulator.test.ts
git commit -m "feat(kernel-vm): add Simulator — runs validation suites against rule ASTs"
```

---

## Summary

| Task | What | Handlers |
|------|------|----------|
| 1 | Project setup | — |
| 2 | HandlerResult, Explanation, ExecutionTrace (types) | — |
| 3 | ExecutionContext, ValidationResult, FieldReference (types) | — |
| 4 | ASTNode, HandlerCategory, HandlerMetadata (types) | — |
| 5 | HandlerDefinition + versioned HandlerRegistry | — |
| 6 | Field resolution + result helpers | — |
| 7 | AST Validator | — |
| 8 | Logic gates: and, or, not, if_then | 4 |
| 9 | Composition: pipe, for_each | 2 |
| 10 | Validation: threshold_check, absence_check, list_check, completeness_check | 4 |
| 11 | Computation: bom_sum, unit_convert, ratio | 3 |
| 12 | Temporal: deadline | 1 |
| 13 | AST Evaluator + handler registration + public API | — |
| 14 | Simulator | — |

**Total: 14 handlers, 14 tasks, ~70 steps**

After completion: `@eurocomply/types` and `@eurocomply/kernel-vm` are fully functional with zero external runtime deps, test coverage of all handlers, and a working Simulator.
