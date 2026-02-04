# Platform Completion Design: Phases 5.1–5.7

**Status:** Draft
**Date:** 2026-02-04
**Scope:** Both `eurocomply-os` and `eurocomply-registry` repositories

---

## 1. Objective

Complete the EuroComply OS platform so an AI agent can connect to a Spoke's MCP endpoint and build real products (PLM, ERP, or any domain-specific application) without workarounds. This means:

1. All 52 kernel-vm handlers implemented (38 new + 14 existing, 1 rename)
2. All ~90 MCP tools implemented (excluding A2A protocol)
3. Real LLM integration (Anthropic + Ollama)
4. UI runtime (Universal Shell + component library + blueprint system)
5. Platform hardening (validation, error handling, security)

After these phases, the platform is **agent-ready**: an AI agent can define data models, create entities, link them with relations, search, evaluate rules, generate UIs, and use AI capabilities — all through MCP.

---

## 2. Repository Scope

| Change | Repo |
|--------|------|
| Handler implementations (kernel-vm) | `eurocomply-os` |
| MCP tools + services + migrations | `eurocomply-os` |
| `packages/ui-library` (new) | `eurocomply-os` |
| `apps/universal-shell` (new) | `eurocomply-os` |
| `apps/web-portal` rename to `apps/hub-dashboard` | `eurocomply-os` |
| LLM provider implementations | `eurocomply-os` |
| Platform hardening | `eurocomply-os` |
| Design doc updates (handler names, architecture) | `eurocomply-os` |
| CLAUDE.md updates (handler names, new packages/apps) | **Both repos** |
| Pack AST handler references (if any renamed) | `eurocomply-registry` |
| Handler documentation for pack authors | `eurocomply-registry` |

---

## 3. Handler Renaming

**Principle:** Handlers are generic computation primitives. Domain semantics (compliance, BOM, regulatory) belong in packs, not handler names.

### Renames

| Current ID | New ID | Rationale |
|-----------|--------|-----------|
| `core:bom_sum` | `core:collection_sum` | Sums a field across a collection — not BOM-specific |

### New handlers with generic names (replacing designed names)

| Designed Name | Final Generic Name | Rationale |
|--------------|-------------------|-----------|
| `core:bom_max` | `core:collection_max` | Max value in collection |
| `core:bom_min` | `core:collection_min` | Min value in collection |
| `core:bom_weighted` | `core:weighted_sum` | Weighted calculation through hierarchy |
| `core:regulatory_conflict_resolve` | `core:rule_resolve` | Resolves conflicts between rule sets |
| `ai:compliance_interpret` | `ai:interpret` | Interprets text and applies to data |
| `ai:risk_score` | `ai:score` | Scores entity on weighted factors |

### Impact on `eurocomply-registry`

Existing pack ASTs reference only generic handler IDs (`core:and`, `core:threshold_check`, `core:completeness_check`). No pack references `core:bom_sum`. The rename has **zero impact** on existing packs.

CLAUDE.md in `eurocomply-registry` must be updated to document all 52 handler IDs so pack authors know what primitives are available.

---

## 4. Complete Handler Inventory (52 Total)

### Computation (9 handlers)

| Handler ID | Status | Description |
|-----------|--------|-------------|
| `core:collection_sum` | RENAME from `core:bom_sum` | Sum a numeric field across items in a collection |
| `core:collection_max` | NEW | Find maximum value in a collection |
| `core:collection_min` | NEW | Find minimum value in a collection |
| `core:weighted_sum` | NEW | Cascading weighted calculation through hierarchy |
| `core:count` | NEW | Count items matching criteria with optional distinct |
| `core:rollup` | NEW | Aggregate values from children to parent in hierarchical data |
| `core:average` | NEW | Calculate mean value across items |
| `core:ratio` | EXISTS | Compute ratio between two values |
| `core:unit_convert` | EXISTS | Convert between units (ppm, ppb, %, mg/kg, kg, g, mg, l, ml) |

### Validation (10 handlers)

| Handler ID | Status | Description |
|-----------|--------|-------------|
| `core:threshold_check` | EXISTS | Compare value against limit (lt, lte, gt, gte, eq, ne) with tolerance |
| `core:presence_check` | NEW | Verify required item exists with minimum count option |
| `core:absence_check` | EXISTS | Check that prohibited items do NOT exist in collection |
| `core:list_check` | EXISTS | Check if values appear in allowlist or blocklist |
| `core:date_check` | NEW | Validate dates (not_expired, not_before, not_after, within_range, age checks) |
| `core:document_check` | NEW | Verify required documents are attached, valid, and current |
| `core:credential_check` | NEW | Validate verifiable credentials (signature, expiration, issuer) |
| `core:enum_check` | NEW | Validate value is in allowed set |
| `core:pattern_check` | NEW | Validate format (regex, GTIN, CAS, EC number, email, URL) |
| `core:completeness_check` | EXISTS | Verify all required fields are populated |

### Logic Gates (6 handlers — COMPLETE)

| Handler ID | Status | Description |
|-----------|--------|-------------|
| `core:and` | EXISTS | All conditions must pass (supports short_circuit) |
| `core:or` | EXISTS | Any condition must pass |
| `core:not` | EXISTS | Invert a condition |
| `core:if_then` | EXISTS | Conditional branching with optional else |
| `core:for_each` | EXISTS | Apply validation to every item (all/any/none) |
| `core:pipe` | EXISTS | Sequential chain — output feeds next input |

### Graph (8 handlers)

| Handler ID | Status | Description |
|-----------|--------|-------------|
| `core:trace_upstream` | NEW | Trace entity back through relations to origins |
| `core:trace_downstream` | NEW | Find all entities affected by a source entity |
| `core:find_path` | NEW | Find a path between two nodes satisfying constraints |
| `core:subgraph_extract` | NEW | Extract a subgraph for analysis |
| `core:impact_analysis` | NEW | Calculate cascading impact of a change |
| `core:shortest_path` | NEW | Simple shortest path between two nodes |
| `core:neighbors` | NEW | Get immediate neighbors of a node |
| `core:cycle_detect` | NEW | Detect circular dependencies in graph data |

All graph handlers operate on pre-loaded data in `ExecutionContext.data`. They are pure functions — no Neo4j access. Platform Services pre-loads the graph data before the VM runs.

**ExecutionLoop enhancement required:** Currently pre-loads direct relations only. Must be extended to pre-load multi-hop traversal results from Neo4j for graph handlers to operate on.

### Resolution (8 handlers)

| Handler ID | Status | Description |
|-----------|--------|-------------|
| `core:data_conflict_resolve` | NEW | Resolve conflicting data from multiple sources (strategies: most_recent, highest_confidence, source_hierarchy, most_conservative, most_common, weighted_average) |
| `core:find_substitute` | NEW | Find alternative items meeting functional requirements with constraints |
| `core:rule_resolve` | NEW | Harmonize requirements across multiple rule sets |
| `core:priority_rank` | NEW | Rank items by weighted criteria |
| `core:entity_match` | NEW | Match/deduplicate entities across sources |
| `core:version_select` | NEW | Select appropriate version of an entity or rule |
| `core:threshold_interpolate` | NEW | Calculate threshold when value falls between defined points |
| `core:action_sequence` | NEW | Determine optimal sequence of actions considering dependencies |

### Temporal (2 handlers)

| Handler ID | Status | Description |
|-----------|--------|-------------|
| `core:deadline` | EXISTS | Enforce condition met within time window |
| `core:schedule` | NEW | Define recurring evaluation triggers — returns whether evaluation is due |

### AI / Intelligence (9 handlers)

| Handler ID | Status | Description |
|-----------|--------|-------------|
| `ai:extract` | NEW | Extract structured data from unstructured text/documents |
| `ai:interpret` | NEW | Interpret text and apply to specific data context |
| `ai:gap_analysis` | NEW | Identify what's missing given requirements vs current state |
| `ai:query` | NEW | Answer natural language questions about data |
| `ai:generate` | NEW | Generate documents/text from structured data |
| `ai:classify` | NEW | Classify entity into categories |
| `ai:detect_anomaly` | NEW | Detect unusual patterns indicating data quality issues |
| `ai:explain` | NEW | Generate human-readable explanations for different audiences |
| `ai:score` | NEW | Score entity on weighted factors |

**Execution model:** AI handlers define contracts in kernel-vm (config schema, input/output types). Execution is delegated to Platform Services via the AIBridge. The bridge calls the LLMGateway, which routes to the appropriate tier. Results are injected into `ExecutionContext.data` before the VM evaluates.

---

## 5. Complete MCP Tool Inventory

### Tier A: Wire existing services (5 tools)

| Tool | Service | Method |
|------|---------|--------|
| `relation:define` | RelationService | `defineType()` |
| `relation:create` | RelationService | `create()` |
| `relation:list` | RelationService | `list()` |
| `registry:uninstall` | PackService | `uninstall()` (new method) |
| `registry:diff` | PackService | `diff()` (new method) |

### Tier B: Add methods to existing services (16 tools)

**Entity (6 new methods + MCP wiring):**

| Tool | Method | Description |
|------|--------|-------------|
| `entity:delete` | `delete()` | Soft-delete entity instance |
| `entity:list_types` | `listTypes()` | List all defined entity types |
| `entity:describe` | `describe()` | Return entity type schema + metadata |
| `entity:extend` | `extend()` | Add fields to existing entity type schema |
| `entity:bulk_create` | `bulkCreate()` | Create multiple entities in one transaction |
| `entity:bulk_update` | `bulkUpdate()` | Update multiple entities in one transaction |

**Relation (2 new methods + MCP wiring):**

| Tool | Method | Description |
|------|--------|-------------|
| `relation:delete` | `delete()` | Remove relation instance |
| `relation:update` | `update()` | Update relation properties |

**File (5 new methods + MCP wiring):**

| Tool | Method | Description |
|------|--------|-------------|
| `file:delete` | `delete()` | Remove file from storage + metadata |
| `file:list` | `list()` | List files with filtering |
| `file:attach` | `attach()` | Link file to entity |
| `file:list_attachments` | `listAttachments()` | List files attached to entity |
| `file:parse` | `parse()` | Extract structured data from document (delegates to AI) |

**Job (3 new methods + MCP wiring):**

| Tool | Method | Description |
|------|--------|-------------|
| `job:cancel` | `cancel()` | Cancel pending/running job |
| `job:list` | `list()` | List jobs with status filtering |
| `job:retry` | `retry()` | Re-queue failed job |

### Tier C: New services from scratch (57 tools)

**Search (6 tools) — `SearchService`**

New migration: `search_indexes` table

| Tool | Description |
|------|-------------|
| `search:configure_index` | Create/configure search index on entity type fields |
| `search:query` | Full-text search across entities |
| `search:semantic` | Vector similarity search (pgvector + embeddings via LLM Gateway) |
| `search:similar` | Find entities similar to a given entity |
| `search:save` | Save a search query for reuse |
| `search:list_saved` | List saved searches |

**Permissions (7 tools) — `PermissionService`**

New migration: `roles`, `role_permissions`, `grants`, `groups`, `group_members` tables

| Tool | Description |
|------|-------------|
| `permission:define_role` | Create role with named permissions |
| `permission:grant_role` | Assign role to principal (scoped: global, per type, per instance) |
| `permission:revoke_role` | Remove role from principal |
| `permission:check` | Runtime guard — check if principal has permission |
| `permission:list_grants` | List all grants for a principal |
| `permission:list_principals` | List principals with a specific role |
| `permission:define_group` | Create group of principals for bulk assignment |

MCP middleware integration: every tool call runs `permission:check` before dispatching.

**Version Control (6 tools) — `VersionService`**

No new migration — `entity_versions` table already exists.

| Tool | Description |
|------|-------------|
| `version:history` | List version history for an entity |
| `version:get` | Get specific version snapshot |
| `version:compare` | JSON diff between two versions |
| `version:restore` | Create new version with old data (append-only) |
| `version:branch` | Create parallel version for draft/review |
| `version:merge` | Merge branch back with conflict detection |

**Tasks (6 tools) — `TaskService`**

New migration: `tasks` table (task_id, tenant_id, title, description, status, assignee, due_date, entity_type, entity_id, parent_task_id, created_by, created_at, updated_at)

| Tool | Description |
|------|-------------|
| `task:create` | Create task, optionally linked to entity |
| `task:update` | Update task fields |
| `task:complete` | Mark task completed |
| `task:list` | List/filter tasks |
| `task:reassign` | Transfer assignment |
| `task:set_delegation` | Out-of-office reassignment with date range |

Status workflow: `open` → `in_progress` → `completed` / `cancelled`. Subtasks via `parent_task_id`.

**Comments (5 tools) — `CommentService`**

New migration: `comments` table (comment_id, tenant_id, entity_type, entity_id, task_id, parent_comment_id, author_id, body, resolved, created_at, updated_at)

| Tool | Description |
|------|-------------|
| `comment:add` | Add comment to entity or task |
| `comment:list` | List comments (threaded) |
| `comment:edit` | Edit comment body |
| `comment:delete` | Remove comment |
| `comment:resolve` | Mark thread as resolved |

Threading via `parent_comment_id`. Comments attach to entities OR tasks.

**Notifications (6 tools) — `NotificationService`**

New migrations: `notification_channels`, `notifications`, `notification_preferences` tables

| Tool | Description |
|------|-------------|
| `notify:define_channel` | Create notification channel (in_app, webhook) |
| `notify:send` | Send notification (respects recipient preferences) |
| `notify:set_preferences` | Set recipient channel preferences |
| `notify:get_preferences` | Get recipient preferences |
| `notify:list` | List notifications for recipient |
| `notify:mark_read` | Mark notification as read |

Channel types: `in_app` and `webhook` initially. Email deferred. Integrates with EventService — events can trigger notifications.

**Events (2 tools) — `EventService`**

New migration: `event_subscriptions` table (subscription_id, tenant_id, event_type, handler_tool, filter, active)

| Tool | Description |
|------|-------------|
| `events:subscribe` | Register MCP tool to call when event fires |
| `events:emit` | Dispatch event to matching subscriptions |

In-process event bus. Event types are strings (e.g., `entity:created`, `task:completed`).

**Templates (4 tools) — `TemplateService`**

New migration: `templates` table (template_id, tenant_id, name, entity_type, template_data, created_at)

| Tool | Description |
|------|-------------|
| `template:define` | Create entity template (snapshot with placeholders) |
| `template:instantiate` | Create entity from template with values |
| `template:list` | List templates |
| `entity:clone` | Deep copy entity with optional overrides |

**i18n (4 tools) — `I18nService`**

New migration: `translations` table (tenant_id, entity_type, entity_id, field, locale, value, created_at)

| Tool | Description |
|------|-------------|
| `i18n:define_translations` | Set translations for entity fields |
| `i18n:translate` | Translate field value to locale |
| `i18n:get` | Get translation with fallback chain |
| `i18n:set_ui_strings` | Set UI string translations |

**Audit (1 tool — extend existing AuditLogger):**

| Tool | Description |
|------|-------------|
| `audit:export` | Export audit log to JSON/CSV |

**UI Blueprint (6 tools) — `UIService`**

New migration: `ui_views` table (view_id, tenant_id, name, entity_type, blueprint_json, layer, created_at), `ui_actions` table (action_id, view_id, name, tool, input_mapping)

| Tool | Description |
|------|-------------|
| `ui:define_view` | Store a JSON blueprint describing a page layout |
| `ui:get_view` | Get blueprint for rendering |
| `ui:list_views` | List available views |
| `ui:delete_view` | Remove view |
| `ui:register_action` | Bind UI action to MCP tool call |
| `ui:merge_views` | Merge system + company + user layers into final blueprint |

**AI Runtime (7 MCP tools — extend LLMGateway):**

| Tool | Description |
|------|-------------|
| `ai:run_extract` | Run document extraction outside rule evaluation |
| `ai:run_interpret` | Run text interpretation outside rule evaluation |
| `ai:run_classify` | Run classification outside rule evaluation |
| `ai:run_generate` | Run text generation outside rule evaluation |
| `ai:run_query` | Run NL question answering outside rule evaluation |
| `ai:run_explain` | Run explanation generation outside rule evaluation |
| `ai:run_score` | Run scoring outside rule evaluation |

These are direct MCP tools for ad-hoc AI operations (not within rule evaluation). They call the same LLMGateway but are invoked directly by agents, not via the kernel-vm bridge.

---

## 6. UI Architecture

### The Three-Tier Model

**Tier 0: Kernel Primitives (Headless Logic)**
- Tech: Radix UI + Tailwind CSS
- Role: Accessibility, focus management, keyboard navigation, screen readers
- This layer has zero visual styling
- Not built — it's a dependency (Radix is consumed by shadcn)

**Tier 1: Standard Library (Industrial Skin)**
- Tech: shadcn + Figma design tokens
- Location: `packages/ui-library` (new package in `eurocomply-os`)
- Workflow:
  1. Use shadcn MCP to scaffold base component code
  2. Use Figma MCP to extract design tokens (colors, spacing, radius, shadows)
  3. Skin shadcn components with Figma tokens for industrial density
- Result: A library of typed, accessible, branded components

**Tier 2: Generative Layer (Blueprints)**
- Tech: JSON metadata + `ui:*` MCP tools
- The AI agent calls `ui:define_view` to describe pages as JSON blueprints
- The OS reads the blueprint and renders Tier 1 components
- View cascade: system layer (pack-defined mandatory elements) + company layer (branding, layout) + user layer (personal customization) → merged into final view

### Core Component Set (~10 components)

| Component | Purpose | shadcn Base |
|-----------|---------|-------------|
| `Shell` | App layout — sidebar + header + content area | layout primitives |
| `Sidebar` | Navigation with collapsible sections | `navigation-menu` |
| `DataGrid` | Sortable, filterable, paginated tables | `table` + `data-table` |
| `Form` | Dynamic form generation from entity schemas | `form` + `input` + `select` |
| `StatusBadge` | Configurable status indicator (any label + color) | `badge` |
| `ScoreGauge` | Numeric score on a visual scale | custom on `progress` |
| `ActionPanel` | Grouped action buttons with confirmation dialogs | `button` + `dialog` |
| `DetailCard` | Entity detail view — field groups, metadata | `card` |
| `Timeline` | Chronological event/version display | custom on `scroll-area` |
| `CommandBar` | Command palette for power users | `command` |

### Blueprint JSON Schema

```json
{
  "layout": "detail",
  "sections": [
    {
      "component": "StatusBadge",
      "bind": { "status": "$.status", "label": "$.status_label" }
    },
    {
      "component": "DataGrid",
      "bind": { "source": "entity:list", "entity_type": "material" },
      "columns": ["name", "cas_number", "concentration_pct"]
    },
    {
      "component": "ScoreGauge",
      "bind": { "value": "$.score", "max": 100 }
    }
  ],
  "actions": [
    {
      "label": "Run Evaluation",
      "tool": "evaluate",
      "input": { "entity_id": "$.entity_id" }
    }
  ]
}
```

### Monorepo Structure Changes

```
apps/
  hub-control-plane/         # SaaS backend (unchanged)
  hub-dashboard/             # Account management (RENAMED from web-portal, build deferred)
  spoke-runtime/             # Customer OS backend (unchanged)
  universal-shell/           # Generic UI runtime (NEW)

packages/
  ui-library/                # Tier 1 components (NEW)
  kernel-vm/                 # Pure computation (unchanged)
  platform-services/         # Stateful layer (unchanged)
  registry-sdk/              # Pack installer (unchanged)
  network-protocol/          # A2A primitives (unchanged)
  cli/                       # Developer tools (unchanged)
  types/                     # Shared schemas (unchanged)
```

### Universal Shell Architecture

`apps/universal-shell` is a domain-agnostic React app:

- Hosted once (e.g., `shell.eurocomply.com`)
- On load, determines which spoke to connect to (via URL parameter or custom domain lookup)
- Fetches blueprints from the spoke's MCP endpoint (`ui:get_view`, `ui:list_views`)
- Renders Tier 1 components from `packages/ui-library`
- All data flows through the spoke's MCP endpoint
- Supports custom domains: CNAME `plm.acme.com` → Shell CDN, Shell asks Hub "which spoke owns this domain?", connects to that spoke

The same Shell code renders a textile PLM, a cosmetics safety platform, or any other product — the spoke's blueprints determine everything.

---

## 7. AI / LLM Integration

### Provider Architecture

```
AI Handler (kernel-vm)
  → AIBridge.preEvaluateAINodes() (platform-services)
    → LLMGateway.generate() or .extract()
      → Tier classification
        → Tier A: OllamaProvider (self-hosted, data stays local)
        → Tier B: AnthropicProvider (cloud, schema/rules only)
```

### Tier Classification Enforcement

| Context Contains | Tier | Provider |
|-----------------|------|----------|
| Entity data (customer data) | A | Ollama (self-hosted) |
| Schema/rules only (no customer data) | B | Anthropic (cloud API) |
| Ambiguous | A | Ollama (default safe) |

Classification is automatic based on input inspection. If the input references `entity_data` or contains values from `ExecutionContext.entity_data`, route to Tier A.

### LLM Providers

**AnthropicProvider (Tier B):**
- Uses `@anthropic-ai/sdk`
- Structured output via tool use for all AI handlers
- Model: configurable (default: Claude Sonnet)
- Used for: schema design, rule interpretation, gap analysis over rules

**OllamaProvider (Tier A):**
- OpenAI-compatible API (Ollama serves this natively)
- Structured output via JSON mode
- Model: configurable (default: whatever is pulled locally)
- Used for: document extraction, entity classification, scoring — anything touching customer data

### AI Handler Contracts

Each AI handler in kernel-vm defines:
- `config` schema (what the rule author specifies in the AST)
- `input` contract (what entity data is available)
- `output` contract (what structured result is returned)
- `explanation` format (human-readable breakdown)

The handler's `execute()` reads the pre-evaluated result from `context.data[data_key]` and wraps it in a `HandlerResult` with tracing. The actual LLM call happened before the VM ran.

---

## 8. Platform Hardening

### Evaluator Error Handling

Current: handler exceptions crash the evaluator.
Fix: wrap handler execution in try/catch, return structured `HandlerResult` with `success: false` and error details.

### Evaluator Timeout

Current: no timeout — handlers can hang indefinitely.
Fix: add configurable timeout per evaluation. If exceeded, return `HandlerResult` with `success: false` and timeout error.

### MCP Input Validation

Current: tools accept any input without validation.
Fix: every MCP tool defines a Zod schema for its input. The router validates input against the schema before dispatching. Invalid input returns a structured error with field-level details.

### MCP Error Codes

Current: everything returns 400.
Fix: proper HTTP status differentiation:
- 400: invalid input (validation failure)
- 401: unauthenticated
- 403: forbidden (permission check failed)
- 404: resource not found
- 409: conflict (version mismatch, duplicate)
- 500: internal error

### MCP Tool Discovery

Current: `GET /mcp/tools` returns tool names only.
Fix: return full tool metadata — name, description, input schema (JSON Schema from Zod), output schema. Agents use this to understand what tools expect.

### Boot Failure Handling

Current: pack load failures are silent — boot "succeeds" with missing logic.
Fix: fail fast. If any required pack fails to install, boot aborts with clear error. Optional packs can warn and continue.

---

## 9. Phase Definitions

### Phase 5.1: Foundation Hardening + Handler Rename

**Repo:** `eurocomply-os` (primary), `eurocomply-registry` (CLAUDE.md update)

**Deliverables:**
1. Rename `core:bom_sum` → `core:collection_sum` (handler file, registry, tests, E2E fixtures, seed data)
2. Update design docs in `eurocomply-os` with all generic handler names
3. Update CLAUDE.md in both repos with complete handler inventory
4. Evaluator try/catch around handler execution
5. Evaluator timeout enforcement (configurable, default 5s)
6. Zod input validation on all 16 existing MCP tools
7. Proper HTTP error codes (400/401/403/404/409/500)
8. Tool schema descriptions in `GET /mcp/tools` response
9. Boot failure: fail fast on required pack load failure

**Tests:**
- Evaluator returns structured error on handler exception
- Evaluator returns timeout error on slow handler
- MCP rejects invalid input with field-level error details
- MCP returns correct HTTP status codes
- Boot aborts on pack load failure

---

### Phase 5.2: Complete Kernel-VM Handlers

**Repo:** `eurocomply-os`

**Deliverables — 29 new handlers:**

*Computation (6):*
- `core:collection_max` — find maximum value in collection
- `core:collection_min` — find minimum value in collection
- `core:weighted_sum` — weighted calculation through hierarchy
- `core:count` — count items matching criteria
- `core:rollup` — aggregate values from children to parent
- `core:average` — calculate mean across items

*Validation (6):*
- `core:presence_check` — verify required item exists
- `core:date_check` — validate dates (expiry, range, age)
- `core:document_check` — verify documents attached, valid, current
- `core:credential_check` — validate verifiable credentials
- `core:enum_check` — validate value in allowed set
- `core:pattern_check` — validate format (regex, standard patterns)

*Temporal (1):*
- `core:schedule` — recurring evaluation trigger

*Graph (8):*
- `core:trace_upstream` — trace entity back through relations
- `core:trace_downstream` — find all entities affected by source
- `core:find_path` — find path between nodes with constraints
- `core:subgraph_extract` — extract subgraph for analysis
- `core:impact_analysis` — cascading impact of change
- `core:shortest_path` — shortest path between nodes
- `core:neighbors` — immediate neighbors of node
- `core:cycle_detect` — circular dependency detection

*Resolution (8):*
- `core:data_conflict_resolve` — resolve conflicting data
- `core:find_substitute` — find alternatives meeting requirements
- `core:rule_resolve` — harmonize conflicting rule sets
- `core:priority_rank` — rank by weighted criteria
- `core:entity_match` — match/deduplicate entities
- `core:version_select` — select appropriate version
- `core:threshold_interpolate` — interpolate between defined points
- `core:action_sequence` — optimal action ordering

**Platform Services changes:**
- Extend ExecutionLoop to pre-load multi-hop graph data from Neo4j
- Update `collectDataKeys()` to recognize graph handler data requirements
- Register all new handlers in default registry

**Tests:**
- Unit tests for each handler (happy path, edge cases, error conditions)
- Integration tests for graph handlers with pre-loaded graph data
- Evaluator integration tests with composite rules using new handlers

---

### Phase 5.3: Wire + Fill MCP Tool Gaps

**Repo:** `eurocomply-os`

**Deliverables — 21 MCP tools:**

*Relations (5 tools):*
- Wire `relation:define` to existing `RelationService.defineType()`
- Wire `relation:create` to existing `RelationService.create()`
- Wire `relation:list` to existing `RelationService.list()`
- Add `relation:delete` method + wire
- Add `relation:update` method + wire

*Entity gaps (6 tools):*
- Add `entity:delete` (soft-delete with audit)
- Add `entity:list_types` (return all defined types)
- Add `entity:describe` (return type schema + field metadata)
- Add `entity:extend` (add fields to type schema)
- Add `entity:bulk_create` (batch create in transaction)
- Add `entity:bulk_update` (batch update in transaction)

*File gaps (5 tools):*
- Add `file:delete` (remove from storage + metadata)
- Add `file:list` (list with filtering)
- Add `file:attach` (link file to entity)
- Add `file:list_attachments` (list files for entity)
- Add `file:parse` (extract structured data — delegates to AI)

*Job gaps (3 tools):*
- Add `job:cancel` (cancel pending/running)
- Add `job:list` (list with status filter)
- Add `job:retry` (re-queue failed)

*Audit (1 tool):*
- Add `audit:export` (JSON/CSV export)

*Registry (1 tool):*
- Add `registry:uninstall` (remove pack + update lock)

**Tests:**
- Each new tool tested via MCP HTTP endpoint
- Relation tools tested with Neo4j
- Bulk operations tested with transaction rollback on partial failure
- File parse tested with mock AI provider

---

### Phase 5.4a: Search + Version Control

**Repo:** `eurocomply-os`

**New migration:** `003-search-indexes.sql`
- `search_indexes` table (index_id, tenant_id, entity_type, fields, config, created_at)
- `saved_searches` table (search_id, tenant_id, name, query, created_at)
- GIN index on `entities.data` for JSONB full-text search
- Enable pgvector extension for semantic search

**SearchService** (new):
- `configureIndex()` — create/update search index config
- `query()` — full-text search using PostgreSQL `to_tsvector` / `ts_query`
- `semantic()` — vector similarity via pgvector (embeddings generated by LLMGateway)
- `similar()` — find entities similar to reference entity
- `save()` — persist search query
- `listSaved()` — list saved searches

**VersionService** (new, uses existing `entity_versions` table):
- `history()` — list versions for entity (paginated)
- `get()` — get specific version snapshot
- `compare()` — JSON diff between versions (field-level adds/removes/changes)
- `restore()` — create new version with old snapshot data (append-only)
- `branch()` — create parallel version for draft/review workflow
- `merge()` — merge branch back with conflict detection

**MCP tools:** 12 total (6 search + 6 version)

**Tests:**
- Full-text search across entity JSONB data
- Semantic search with mock embeddings
- Version history, diff, restore roundtrip
- Branch/merge with conflict detection

---

### Phase 5.4b: Permissions

**Repo:** `eurocomply-os`

**New migration:** `004-permissions.sql`
- `roles` table (role_id, tenant_id, name, description, created_at)
- `role_permissions` table (role_id, permission) — e.g., `entity:create`, `evaluate`
- `grants` table (grant_id, tenant_id, principal_id, role_id, scope_type, scope_id, created_at)
  - scope_type: `global`, `entity_type`, `entity_instance`
  - scope_id: null (global), entity_type string, or entity_id
- `groups` table (group_id, tenant_id, name)
- `group_members` table (group_id, principal_id)

**PermissionService** (new):
- `defineRole()` — create role with permission list
- `grantRole()` — assign role to principal with scope
- `revokeRole()` — remove grant
- `check()` — runtime check: does principal X have permission Y on resource Z?
- `listGrants()` — list grants for principal
- `listPrincipals()` — list who has a given role
- `defineGroup()` — create principal group

**MCP middleware:**
- Every tool call runs `permission:check` before dispatch
- Context must include authenticated principal
- Missing principal → 401
- Insufficient permission → 403

**MCP tools:** 7 total

**Tests:**
- Role definition and grant assignment
- Permission check at different scopes (global, type, instance)
- MCP middleware blocks unauthorized calls
- Group membership grants inherited permissions

---

### Phase 5.4c: Tasks + Comments

**Repo:** `eurocomply-os`

**New migration:** `005-tasks.sql`
- `tasks` table (task_id, tenant_id, title, description, status, assignee, due_date, entity_type, entity_id, parent_task_id, created_by, created_at, updated_at)

**New migration:** `006-comments.sql`
- `comments` table (comment_id, tenant_id, resource_type, resource_id, parent_comment_id, author_id, body, resolved, created_at, updated_at)
  - `resource_type`: `entity` or `task`
  - `resource_id`: entity_id or task_id

**TaskService** (new):
- `create()`, `update()`, `complete()`, `list()`, `reassign()`, `setDelegation()`
- Status: `open` → `in_progress` → `completed` / `cancelled`
- Subtasks via `parent_task_id`
- Delegation: `delegations` column (JSON: `{ delegate_to, from_date, to_date }`)
- Audit on every mutation

**CommentService** (new):
- `add()`, `list()`, `edit()`, `delete()`, `resolve()`
- Threading via `parent_comment_id`
- Attach to entities or tasks (polymorphic via `resource_type`/`resource_id`)
- Mention extraction from body (for notification triggers)
- Audit on every mutation

**MCP tools:** 11 total (6 task + 5 comment)

**Tests:**
- Task lifecycle (create → assign → complete)
- Subtask hierarchy
- Comment threading and resolution
- Comments on entities and tasks
- Delegation with date range

---

### Phase 5.4d: Notifications + Events

**Repo:** `eurocomply-os`

**New migration:** `007-events.sql`
- `event_subscriptions` table (subscription_id, tenant_id, event_type, handler_tool, filter, active, created_at)

**New migration:** `008-notifications.sql`
- `notification_channels` table (channel_id, tenant_id, type, config, created_at)
  - type: `in_app`, `webhook`
- `notifications` table (notification_id, tenant_id, recipient_id, channel_id, subject, body, read, created_at)
- `notification_preferences` table (tenant_id, principal_id, channel_id, enabled)

**EventService** (new):
- `subscribe()` — register handler_tool for event_type with optional filter
- `emit()` — dispatch to matching subscriptions (calls handler_tool via MCP router)
- In-process bus, synchronous dispatch
- Event types: strings like `entity:created`, `entity:updated`, `task:completed`, `evaluation:completed`

**NotificationService** (new):
- `defineChannel()` — create channel (in_app stores in DB, webhook POSTs to URL)
- `send()` — send notification (checks preferences, dispatches to channel)
- `setPreferences()` / `getPreferences()` — per-principal channel settings
- `list()` — list notifications for recipient (paginated, filterable)
- `markRead()` — mark as read

Integration: EventService subscriptions can trigger `notify:send` — e.g., "when `task:created`, send notification to assignee."

**MCP tools:** 8 total (2 events + 6 notifications)

**Tests:**
- Event subscription and dispatch
- Notification send with preference check
- Webhook delivery (mock HTTP)
- Event → notification integration

---

### Phase 5.4e: Templates + i18n

**Repo:** `eurocomply-os`

**New migration:** `009-templates.sql`
- `templates` table (template_id, tenant_id, name, entity_type, template_data, description, created_at)

**New migration:** `010-i18n.sql`
- `translations` table (tenant_id, entity_type, entity_id, field, locale, value, created_at, updated_at)
- `ui_strings` table (tenant_id, key, locale, value, created_at)

**TemplateService** (new):
- `define()` — create template from entity snapshot with placeholder markers
- `instantiate()` — create entity from template, replacing placeholders with values
- `list()` — list templates (filterable by entity_type)

EntityService extension:
- `clone()` — deep copy entity with optional field overrides (new entity_id, preserves all data)

**I18nService** (new):
- `defineTranslations()` — set translations for entity fields (batch)
- `translate()` — write single field translation
- `get()` — resolve translation with fallback: requested locale → default locale → original value
- `setUIStrings()` — set/update UI string translations

**MCP tools:** 8 total (4 template + 4 i18n)

**Tests:**
- Template create, instantiate, list
- Entity clone with overrides
- Translation set, get with fallback chain
- UI strings CRUD

---

### Phase 5.5: UI Foundation

**Repo:** `eurocomply-os`

**Step 1: `packages/ui-library` (new package)**
- Initialize with shadcn CLI + Tailwind + Radix
- Design token system: `tokens.json` consumed by Tailwind as CSS custom properties
  - Token categories: colors (status states, severity levels, brand), spacing (industrial density), typography, radius, shadows
- Workflow: shadcn MCP scaffolds component → Figma MCP extracts tokens → AI skins component
- Export typed React components with props interfaces

**Step 2: Core Component Set (~10)**
- `Shell` — app layout frame (sidebar + header + content)
- `Sidebar` — collapsible navigation
- `DataGrid` — sortable, filterable, paginated tables (the workhorse)
- `Form` — dynamic form from entity schema (inputs, selects, validation feedback)
- `StatusBadge` — configurable label + color status indicator
- `ScoreGauge` — numeric score on visual scale
- `ActionPanel` — grouped buttons with confirmation dialogs
- `DetailCard` — entity detail with field groups and metadata
- `Timeline` — chronological event/version display
- `CommandBar` — command palette

Each component: scaffolded via shadcn, skinned with design tokens, typed props, exported from package.

**Step 3: `apps/universal-shell` (new app)**
- Next.js app, domain-agnostic
- Spoke connection: reads spoke endpoint from URL param (`?spoke=spoke-123`) or custom domain lookup via Hub
- `ViewRenderer` component: takes blueprint JSON, maps component names to `ui-library` exports, renders
- Data binding: `$.field_name` expressions resolved against entity data fetched from spoke MCP
- Action binding: button clicks dispatch MCP tool calls to spoke
- Authentication: OAuth/SSO via spoke (Shell is stateless presentation layer)
- Custom domain support: CNAME → Shell CDN, Shell asks Hub for spoke mapping

**Step 4: Blueprint MCP tools**

New migration: `011-ui-views.sql`
- `ui_views` table (view_id, tenant_id, name, entity_type, blueprint_json, layer, created_at, updated_at)
  - layer: `system`, `company`, `user`
- `ui_actions` table (action_id, tenant_id, view_id, label, tool, input_mapping, created_at)

**UIService** (new):
- `defineView()` — store blueprint JSON
- `getView()` — retrieve blueprint (with optional cascade merge)
- `listViews()` — list views (filterable by entity_type)
- `deleteView()` — remove view
- `registerAction()` — bind action to MCP tool
- `mergeViews()` — merge system + company + user layers

MCP tools: 6 total

**Step 5: Component manifest**
- `ui-library` exports a `components.json` manifest listing all available components with their props schemas
- `ui:list_components` tool in MCP (1 additional tool) — agent queries what bricks are available before creating blueprints
- Total: 7 MCP tools

**Tests:**
- Component rendering (unit tests per component)
- ViewRenderer renders blueprint correctly
- Data binding resolves `$.field` expressions
- Action binding dispatches MCP calls
- View cascade merge (system + company + user layers)
- Blueprint validation (unknown component name → error)

---

### Phase 5.6: AI Handlers + Real LLM Integration

**Repo:** `eurocomply-os`

**Deliverables — 9 AI handler contracts in kernel-vm:**

| Handler | Config | Output |
|---------|--------|--------|
| `ai:extract` | `{ document, schema, format }` | `{ fields: Record<string, unknown>, confidence }` |
| `ai:interpret` | `{ text, context, question }` | `{ interpretation, confidence, references[] }` |
| `ai:gap_analysis` | `{ requirements, current_state }` | `{ gaps[], readiness_score, priorities[] }` |
| `ai:query` | `{ question, data_context }` | `{ answer, references[], confidence }` |
| `ai:generate` | `{ template, data, format, audience }` | `{ content, format }` |
| `ai:classify` | `{ data, categories, criteria }` | `{ classification, confidence, reasoning }` |
| `ai:detect_anomaly` | `{ dataset, baseline, sensitivity }` | `{ anomalies[], severity_scores }` |
| `ai:explain` | `{ decision, context, audience }` | `{ explanation, summary }` |
| `ai:score` | `{ data, factors[], weights }` | `{ score, breakdown, normalized }` |

**LLM Provider implementations:**

*AnthropicProvider (Tier B — cloud):*
- Package: `@anthropic-ai/sdk`
- Structured output via tool use
- Model: configurable (default Sonnet)
- Rate limiting + retry with exponential backoff

*OllamaProvider (Tier A — self-hosted):*
- OpenAI-compatible REST API (`/api/generate`, `/api/chat`)
- Structured output via JSON mode
- Model: configurable
- Health check on boot

**Tier A/B classification:**
- Inspect input for entity data references → Tier A
- Schema/rules only → Tier B
- Ambiguous → Tier A (safe default)
- Classification runs in LLMGateway before provider dispatch

**AIBridge enhancements:**
- Pre-evaluate all `ai:*` nodes in AST before VM runs
- Inject results into `ExecutionContext.data` keyed by node data_key
- Parallel pre-evaluation when AI nodes are independent

**MCP tools:** 7 direct AI tools (see Section 5)

**Tests:**
- Each AI handler with mock provider
- Anthropic provider integration test (live API, guarded by env var)
- Ollama provider integration test (requires running instance)
- Tier classification logic
- AIBridge pre-evaluation with multiple AI nodes
- MCP direct AI tools

---

### Phase 5.7: Agent Readiness Test

**Repo:** `eurocomply-os` (primary), `eurocomply-registry` (pack authoring test)

**The test scenario:**
1. Boot spoke locally: PostgreSQL + Neo4j in Docker Compose
2. Connect AI agent (Claude) to spoke MCP endpoint
3. Agent builds a PLM:
   - Defines entity types: `product`, `material`, `supplier`, `document`
   - Defines relation types: `contains`, `supplies`, `certifies`
   - Creates sample entities and relations
   - Defines evaluation rules (ASTs using the 52 handlers)
   - Creates views via `ui:define_view`
   - Runs evaluations and checks results
   - Searches for entities
   - Uses AI tools (extract data from document, classify materials)
   - Creates tasks and comments
4. Boot Universal Shell, connect to spoke
5. Verify blueprints render correctly with real data
6. Document gaps and friction points

**Success criteria:**
- Agent can build complete data model via MCP (zero raw code)
- All 52 handlers available and composable in rule ASTs
- Error messages are clear and actionable
- Views render correctly in Universal Shell
- AI handlers return structured results from real LLM calls
- Audit trail captures all operations
- No silent failures anywhere in the stack

**Deliverable:** Gap report documenting anything that needs fixing before Phase 6 (A2A Network).

---

## 10. Dependency Order

```
Phase 5.1: Hardening + Rename
    ↓
Phase 5.2: Kernel-VM Handlers (depends on: hardened evaluator)
    ↓
Phase 5.3: MCP Tool Gaps (depends on: hardened MCP server)
    ↓
Phase 5.4a: Search + Version Control (depends on: entity tools complete)
    ↓
Phase 5.4b: Permissions (depends on: MCP server ready for middleware)
    ↓
Phase 5.4c: Tasks + Comments (depends on: permissions for access control)
    ↓
Phase 5.4d: Notifications + Events (depends on: tasks/comments for event sources)
    ↓
Phase 5.4e: Templates + i18n (independent, but ordered after core services)
    ↓
Phase 5.5: UI Foundation (depends on: all MCP tools available for blueprint actions)
    ↓
Phase 5.6: AI Handlers + LLM (depends on: hardened evaluator + AI bridge)
    ↓
Phase 5.7: Agent Readiness Test (depends on: everything above)
```

Note: Phases 5.2 and 5.3 can partially overlap (handlers don't depend on MCP tools). Phases 5.5 and 5.6 can partially overlap (UI doesn't depend on AI handlers). Phase 5.7 requires everything.

---

## 11. Impact on Existing Execution Plan

These phases insert between the current Phase 5 (Hub provisioning + billing) and Phase 6 (A2A Network). The original phases 6–9 remain unchanged:

| Original Phase | Status |
|---------------|--------|
| Phase 1: kernel-vm | COMPLETE |
| Phase 2: platform-services | COMPLETE |
| Phase 3: Vertical slice | COMPLETE |
| Phase 4: Registry | COMPLETE |
| Phase 5: Hub | COMPLETE |
| **Phase 5.1–5.7: Platform completion** | **THIS DOCUMENT** |
| Phase 6: A2A Network | UNCHANGED (next after 5.7) |
| Phase 7: GSR Spoke | UNCHANGED |
| Phase 8: First Product | UNCHANGED |
| Phase 9: Scale | UNCHANGED |

---

## 12. Cross-Repo Changes Summary

### `eurocomply-os`

| Area | Changes |
|------|---------|
| `packages/kernel-vm` | Rename 1 handler, add 38 handlers, harden evaluator |
| `packages/platform-services` | Add 10 services, 10 migrations, ~78 MCP tools, middleware, validation |
| `packages/ui-library` | NEW — shadcn + Figma tokens + 10 core components |
| `packages/types` | New Zod schemas for all new MCP tool inputs/outputs |
| `apps/spoke-runtime` | Boot hardening, wire new services |
| `apps/universal-shell` | NEW — ViewRenderer + spoke connection + custom domain |
| `apps/web-portal` | RENAME to `apps/hub-dashboard` (build deferred) |
| `design/docs/` | Update handler names in VM design doc |
| `CLAUDE.md` | Update handler inventory, new packages/apps, tool counts |

### `eurocomply-registry`

| Area | Changes |
|------|---------|
| `CLAUDE.md` | Update with complete 52-handler inventory (generic names) and full MCP tool list |
| `packs/` | No AST changes needed (no packs reference renamed handlers) |
| `docs/` | Handler reference documentation for pack authors |

---

**Document Control**

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-02-04 | Initial platform completion design: phases 5.1–5.7 |
