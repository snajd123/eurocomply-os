# EuroComply OS

Monorepo for the EuroComply Compliance OS engine. pnpm workspaces + Turborepo.

## Architecture

The OS kernel has two co-equal halves:

**Kernel VM** (`packages/kernel-vm`) — Pure computation engine. Zero dependencies, zero I/O, synchronous. Every handler is a pure function: `(config, input, ExecutionContext) → HandlerResult`. ~53 immutable handlers across 9 categories. Rules are ASTs composed from handlers. Runnable anywhere JavaScript runs.

**Platform Services** (`packages/platform-services`) — Stateful syscall layer. ~90 MCP tools for entity CRUD, graph operations, file storage, search, permissions, jobs, events, audit, and AI. Assembles `ExecutionContext` by pre-loading entity data from PostgreSQL/Neo4j, invokes the VM, persists results.

The execution loop:
```
MCP Request
  → Platform Services assembles ExecutionContext (entity data + graph)
  → Kernel VM evaluates handler chain (pure, deterministic)
  → Platform Services persists ComplianceResult + audit entry
  → MCP Response
```

## Kernel VM Handlers (9 categories, ~53 total)

| Category | Handlers | Examples |
|----------|----------|---------|
| Computation (9) | Calculate values from BOM | `core:bom_sum`, `core:bom_weighted`, `core:unit_convert`, `core:ratio` |
| Validation (10) | Pass/fail checks | `core:threshold_check`, `core:absence_check`, `core:list_check`, `core:completeness_check` |
| Logic Gates (7) | Compose handlers | `core:and`, `core:or`, `core:if_then`, `core:for_each`, `core:pipe` |
| Graph (8) | Supply chain traversal | `core:trace_upstream`, `core:trace_downstream`, `core:impact_analysis`, `core:find_path` |
| Resolution (8) | Conflict resolution | `core:data_conflict_resolve`, `core:find_substitute`, `core:entity_match` |
| Temporal (2) | Deadlines, schedules | `core:deadline`, `core:schedule` |
| AI (9) | LLM-powered (delegated via bridge) | `ai:document_extract`, `ai:compliance_interpret`, `ai:gap_analysis` |

All graph data is pre-loaded by Platform Services into ExecutionContext — kernel-vm never accesses Neo4j directly. AI handlers define contracts in kernel-vm but execution is delegated to Platform Services via a bridge mechanism.

## Core Types (`packages/types`)

**ExecutionContext** — Input to every handler:
- `entity_type`, `entity_id`, `entity_data` — the entity being evaluated
- `data: Record<string, unknown>` — pre-loaded graph data (keyed by context_key from rule AST)
- `compliance_lock_id` — pinned version set
- `vertical_id`, `market`, `timestamp`

**HandlerResult<T>** — Output from every handler:
- `success: boolean`, `value: T`
- `explanation: { summary, steps[], references[] }` — human-readable breakdown
- `trace: ExecutionTrace` — full audit trail (handler_id, version, duration, input/output, child_traces)

**ValidationResult** — Standard output for validation handlers:
- `pass: boolean`, `handler_id`, `handler_version`, `explanation`, `trace`, `confidence?`

## Rule Logic AST

Rules are JSON ASTs composed from handlers. Four composition patterns:

1. **Leaf node** — single handler with config
2. **Pipe** (`core:pipe`) — sequential chain, output feeds next input
3. **Tree** (`core:and`/`core:or`) — branching logic
4. **Iteration** (`core:for_each`) — apply validation to every item in collection

AST validated at compile-time and runtime: handler existence, config schema match, circular reference detection, complexity estimation.

## Platform Services MCP Tools

**Tier 1 (38 tools):**
- `entity:*` (11) — define, extend, describe, create, read, update, delete, list, bulk ops
- `relation:*` (6) — define, create, update, delete, list relation types and instances
- `search:*` (6) — configure indexes, full-text/semantic/similarity search, saved searches
- `permission:*` (7) — roles, grants, revocations, runtime checks, groups
- `file:*` (8) — upload, attach, get, parse, versioning (Cloudflare R2 backend)

**Tier 2 (52 tools):**
- `version:*` (6) — history, diff, restore, branch, merge
- `task:*` (6) — create, update, complete, list, reassign, delegation
- `comment:*` (5) — threaded comments with mentions
- `notify:*` (6) — channels, send, preferences
- `audit:*` (3) — query, export, retention
- `job:*` (5) — submit, status, cancel, retry background jobs
- `template:*` (4) — entity templates and cloning
- `i18n:*` (4) — field translations
- `ai:*` (7+) — document extract, classify, risk score, explain, query, conversation, design assistance
- `ui:*` (4) — generative UI views and actions
- `events:*` (2) — subscribe/emit internal events

## Registry & Packs (`packages/registry-sdk`)

Four pack types: **Logic** (rule ASTs + validation suites), **Environment** (entity schemas + vertical config), **Driver** (external system connectors), **Intelligence** (reference data).

Each pack has a `pack.json` manifest with: name, version, type, author DID, trust_tier, handler_vm_version compatibility, dependencies, required_schemas, scope, regulation_ref.

**Compliance Lock** (`compliance-lock.json`) — Immutable record pinning exact versions + CIDs of all packs, schemas, and handler_vm_exact version used in an evaluation. Enables deterministic replay: same lock + same data = same result.

**Installation lifecycle:** dependency resolution → shadow schema → validation playback → portfolio diff → human approval → lock commit. No lock update without Simulator approval.

**Simulator** — Shadow-tests proposed changes against tenant's real products. Generates diff report showing compliance status changes. META changes (rules, verticals, workflows) always require human approval.

## A2A Network Protocol (`packages/network-protocol`)

Five primitives: **Identity** (GSR resolution), **Claims** (signed VCs), **Requests** (cross-company proof asks), **Evidence** (machine-verifiable proof chains), **Subscriptions** (change notifications).

DID-based identity. Each spoke gets a DID at boot. Trust verified via graph path traversal to tenant-defined trust anchors. Spokes communicate P2P; Hub provides Network Directory for DID → endpoint resolution only.

## AI Runtime (Two-Tier Data Sovereignty)

**Tier A (self-hosted 7B-13B):** Used when customer data is involved — document extraction, classification, risk scoring, explanations, conversations. Data never leaves infrastructure.

**Tier B (cloud API permitted):** Used for reasoning over schemas/rules only — entity design, workflow design, regulation interpretation. No customer data exposure.

Gateway enforces classification: if context contains entity data → Tier A; schemas/rules only → Tier B; ambiguous → Tier A.

## Infrastructure

**Hub** — Single deployment: provisioning orchestrator, public registry, product catalog, billing (Stripe), network directory, telemetry. Hub cannot store compliance data (no tables for it). Hub cannot reach into spokes (pull-only model).

**Spoke** — One per customer: kernel VM + platform services, dedicated PostgreSQL + Neo4j, object storage bucket, LLM gateway, MCP server, spoke agent sidecar. Operates independently of Hub.

**Provisioning** — 5-phase pipeline: Claim → Provision (K8s namespace + Helm) → Boot (migrations, DID generation) → Install (packs from manifest via Simulator) → Handoff. Idempotent, observable.

**Fleet** — Spoke agent heartbeats every 60s. Hub responds with signals (update available, pack updates, sync). Hub never initiates connections.

## Monorepo Structure

```
apps/
  spoke-runtime/          # Customer OS — wires kernel + services, serves MCP (HTTP/SSE + stdio) + Hono REST
  hub-control-plane/      # SaaS backend: billing/, provisioning/, registry-api/, fleet/, network-directory/
  web-portal/             # Next.js frontend: marketing/, onboarding/, dashboard/

packages/
  kernel-vm/              # Pure computation engine (ZERO runtime deps)
  platform-services/      # Stateful layer (depends on kernel-vm, types)
  network-protocol/       # A2A primitives (depends on types)
  registry-sdk/           # Pack installer + simulator (depends on kernel-vm, types)
  cli/                    # eurocomply CLI: lint, test, publish, simulate
  types/                  # Shared Zod schemas: ExecutionContext, HandlerResult, ValidationResult, AST nodes, MCP tool definitions

infra/
  helm/{spoke,hub}/       # Helm charts
  terraform/{modules,environments}/

design/docs/              # Architecture design documents
```

## Build

```sh
pnpm install
pnpm build        # turbo run build (respects dependency order)
pnpm test         # turbo run test
pnpm lint         # turbo run lint
```

## Dependency Graph

```
types
  ↑
kernel-vm (zero runtime deps)
  ↑
platform-services → kernel-vm, types
registry-sdk → kernel-vm, types
network-protocol → types
cli → kernel-vm, registry-sdk, types
  ↑
spoke-runtime → kernel-vm, platform-services, registry-sdk, types
hub-control-plane → registry-sdk, network-protocol, types
web-portal → types
```

## Workflow Discipline

When using subagent-driven-development to execute implementation plans:
- NEVER skip per-task reviews (spec compliance + code quality) — they catch cascading issues early
- Do not batch reviews at the end — a single final review cannot catch intermediate regressions
- Run spec compliance review BEFORE code quality review (wrong order = wasted effort)
- Do not move to the next task while either review has open issues
- Speed is not a valid reason to skip quality gates
- NEVER parallelize implementer subagents — execute tasks sequentially so each task can verify integration with previous tasks. Parallel implementation causes disconnected code that compiles but doesn't actually work together.
- Spec reviews must check end-to-end connectivity, not just plan-text matching. Ask: "Is this code actually called from the runtime? Does the data flow between components?" A library function that passes unit tests but is never wired into the boot sequence or execution path is incomplete.
- NEVER use haiku for reviews — use sonnet or opus. Cheap reviews produce cheap results.
- When a task produces a reusable function (e.g., `createInstallPlan`), the task that uses it (e.g., spoke boot) MUST actually call it. If the plan doesn't connect them, flag the gap before implementing — don't silently produce disconnected code.

## Known Limitations (Phase 1)

- **Semver pre-release tags:** `HandlerRegistry.compareVersions` does simple numeric split — `1.0.0` vs `1.1.0` works, but `-alpha.1` tags are not supported. Acceptable until Compliance Lock needs pre-release pinning.
- **Dot-escaped field paths:** `getNestedValue` splits strictly on `.` — data keys containing dots (URLs, chemical names) will mis-resolve. Consider bracket notation or escaping when Platform Services exposes user-defined keys.

## Key Invariants

1. Kernel VM handlers are pure functions — zero I/O, deterministic, synchronous
2. Platform Services pre-loads all data into ExecutionContext before VM evaluation
3. AI handlers define contracts in kernel-vm but delegate execution to Platform Services
4. Compliance Lock pins exact versions + CIDs — same lock + same data = same result
5. Hub never stores compliance data and cannot reach into spokes
6. Spokes operate independently of Hub availability
7. META changes (rules, verticals, workflows) always require Simulator + human approval
8. Every mutation generates an audit entry; compliance locks and audit logs are append-only
9. Reserved MCP namespaces (`core:`, `entity:`, `relation:`, `ai:`, `meta:`, `a2a:`, `registry:`, etc.) cannot be used by Driver Packs
10. Public packs cannot depend on private CIDs
11. `tenant_id` exists in all Platform Services tables for Hub code reuse — Spokes are single-tenant (dedicated DB per customer) so `tenant_id` is redundant for isolation there, but the Hub is multi-tenant. Composite PKs `(tenant_id, entity_type)` and `(tenant_id, relation_type)` keep the schema valid for both. Do not remove `tenant_id` from the schema.
12. Platform Services methods that touch PostgreSQL must use `ctx.tx ?? this.db` for queries — this allows callers to pass a `UnitOfWork` transaction via `PlatformServiceContext.tx` so multiple service calls share a single PG transaction. Using `this.db` directly bypasses the caller's transaction and reintroduces the half-committed state bug (e.g., evaluation persisted without its audit entry).
13. `PlatformServiceContext` (extends `ServiceContext` with optional `tx?: Queryable`) lives in `packages/platform-services/src/context.ts`, not in `@eurocomply/types`. DB-layer types (`Queryable`, `UnitOfWork`) must not leak into the shared types package.
