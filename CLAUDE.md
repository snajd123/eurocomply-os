# EuroComply OS

Monorepo for the EuroComply Compliance OS engine. pnpm workspaces + Turborepo.

## Architecture

The OS kernel has two co-equal halves:

**Kernel VM** (`packages/kernel-vm`) — Pure computation engine. Zero dependencies, zero I/O, synchronous. Every handler is a pure function: `(config, input, ExecutionContext) → HandlerResult`. 52 immutable handlers across 7 categories. Rules are ASTs composed from handlers. Runnable anywhere JavaScript runs.

**Platform Services** (`packages/platform-services`) — Stateful syscall layer. ~98 MCP tools for entity CRUD, graph operations, file storage, search, permissions, jobs, events, audit, AI, UI blueprints, and more. Assembles `ExecutionContext` by pre-loading entity data from PostgreSQL/Neo4j, invokes the VM, persists results.

The execution loop:
```
MCP Request
  → Platform Services assembles ExecutionContext (entity data + graph)
  → Kernel VM evaluates handler chain (pure, deterministic)
  → Platform Services persists ComplianceResult + audit entry
  → MCP Response
```

## Kernel VM Handlers (7 categories, 52 total)

All handler names are **generic primitives**. Domain semantics (compliance, BOM, regulatory) belong in packs, not handler names.

| Category | Count | Purpose | Handlers |
|----------|-------|---------|----------|
| Computation | 9 | Aggregate and transform values | `core:collection_sum`, `core:collection_max`, `core:collection_min`, `core:weighted_sum`, `core:count`, `core:rollup`, `core:average`, `core:ratio`, `core:unit_convert` |
| Validation | 10 | Pass/fail checks | `core:threshold_check`, `core:presence_check`, `core:absence_check`, `core:list_check`, `core:date_check`, `core:document_check`, `core:credential_check`, `core:enum_check`, `core:pattern_check`, `core:completeness_check` |
| Logic Gates | 6 | Compose handlers | `core:and`, `core:or`, `core:not`, `core:if_then`, `core:for_each`, `core:pipe` |
| Graph | 8 | Traverse pre-loaded graph data | `core:trace_upstream`, `core:trace_downstream`, `core:find_path`, `core:subgraph_extract`, `core:impact_analysis`, `core:shortest_path`, `core:neighbors`, `core:cycle_detect` |
| Resolution | 8 | Resolve conflicts and rank | `core:data_conflict_resolve`, `core:find_substitute`, `core:rule_resolve`, `core:priority_rank`, `core:entity_match`, `core:version_select`, `core:threshold_interpolate`, `core:action_sequence` |
| Temporal | 2 | Deadlines and schedules | `core:deadline`, `core:schedule` |
| AI | 9 | LLM-powered (delegated via bridge) | `ai:extract`, `ai:interpret`, `ai:gap_analysis`, `ai:query`, `ai:generate`, `ai:classify`, `ai:detect_anomaly`, `ai:explain`, `ai:score` |

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
- `entity:*` (11) — define, extend, describe, create, get, update, delete, list, list_types, bulk_create, bulk_update
- `relation:*` (6) — define, create, update, delete, list, list_types
- `search:*` (6) — configure_index, query, semantic, similar, save, list_saved
- `permission:*` (7) — define_role, grant_role, revoke_role, check, list_grants, list_principals, define_group
- `file:*` (8) — upload, attach, get, list, delete, parse, list_attachments, create_version

**Tier 2 (52 tools):**
- `version:*` (6) — history, get, compare, restore, branch, merge
- `task:*` (6) — create, update, complete, list, reassign, delegation
- `comment:*` (5) — threaded comments with mentions
- `notify:*` (6) — channels, send, preferences
- `audit:*` (2) — query, export
- `job:*` (5) — submit, status, cancel, list, retry
- `template:*` (4) — entity templates and cloning
- `i18n:*` (4) — field translations
- `ai:*` (7) — extract, interpret, classify, generate, query, explain, score (direct MCP tools, outside rule evaluation)
- `ui:*` (7) — define_view, get_view, list_views, delete_view, register_action, merge_views, list_components
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

## UI Architecture (Three-Tier Model)

**Tier 0 (Kernel Primitives):** Radix UI + Tailwind CSS. Headless logic: accessibility, focus management, keyboard navigation. Zero visual styling. This is a dependency, not something we build.

**Tier 1 (Standard Library):** `packages/ui-library`. shadcn components skinned with Figma design tokens for industrial density. ~10 core components: Shell, Sidebar, DataGrid, Form, StatusBadge, ScoreGauge, ActionPanel, DetailCard, Timeline, CommandBar. Workflow: shadcn MCP scaffolds component → Figma MCP extracts tokens → AI skins component.

**Tier 2 (Generative Layer):** JSON blueprints stored via `ui:*` MCP tools. The AI agent calls `ui:define_view` to describe pages. The OS reads the blueprint and renders Tier 1 components. View cascade: system layer + company layer + user layer → merged into final view.

**Universal Shell** (`apps/universal-shell`): Domain-agnostic React app hosted once. Connects to any spoke via URL parameter or custom domain lookup. Contains the ViewRenderer that maps blueprint JSON to Tier 1 components. Same code serves `app.eurocomply.eu` and `plm.acme.com` — the spoke determines the product.

**Hub Dashboard** (`apps/hub-dashboard`, formerly `web-portal`): Account management only — billing, spoke list, provisioning status. Does NOT use the blueprint system. Build deferred.

## AI Runtime (Two-Tier Data Sovereignty)

**Tier A (self-hosted, Ollama):** Used when customer data is involved — document extraction, classification, scoring, explanations. Data never leaves infrastructure. OpenAI-compatible API.

**Tier B (cloud API, Anthropic):** Used for reasoning over schemas/rules only — interpretation, gap analysis, generation. No customer data exposure. Structured output via tool use.

Gateway enforces classification: if context contains entity data → Tier A; schemas/rules only → Tier B; ambiguous → Tier A.

## Infrastructure

**Hub** — Single deployment: provisioning orchestrator, public registry, product catalog, billing (Stripe), network directory, telemetry. Hub cannot store compliance data (no tables for it). Hub cannot reach into spokes (pull-only model).

**Spoke** — One per customer: kernel VM + platform services, dedicated PostgreSQL + Neo4j, object storage bucket, LLM gateway, MCP server, spoke agent sidecar. Operates independently of Hub.

**Provisioning** — 5-phase pipeline: Claim → Provision (K8s namespace + Helm) → Boot (migrations, DID generation) → Install (packs from manifest via Simulator) → Handoff. Idempotent, observable.

**Fleet** — Spoke agent heartbeats every 60s. Hub responds with signals (update available, pack updates, sync). Hub never initiates connections.

## Monorepo Structure

```
apps/
  spoke-runtime/          # Customer OS backend — wires kernel + services, serves MCP (HTTP/SSE + stdio) + Hono REST
  hub-control-plane/      # SaaS backend: billing/, provisioning/, registry-api/, fleet/, network-directory/
  hub-dashboard/          # Hub account management UI — billing, spoke list (was web-portal, build deferred)
  universal-shell/        # Generic UI runtime — connects to any spoke, renders blueprints via ViewRenderer

packages/
  kernel-vm/              # Pure computation engine (ZERO runtime deps)
  platform-services/      # Stateful layer (depends on kernel-vm, types)
  ui-library/             # Tier 1 UI components — shadcn + Figma design tokens, industrial density
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
ui-library (standalone — Radix + Tailwind + shadcn)
cli → kernel-vm, registry-sdk, types
  ↑
spoke-runtime → kernel-vm, platform-services, registry-sdk, types
hub-control-plane → registry-sdk, network-protocol, types
hub-dashboard → types
universal-shell → ui-library, types
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
