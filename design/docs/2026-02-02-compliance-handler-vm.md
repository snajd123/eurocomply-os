# Kernel VM Design

> **Status:** DRAFT
> **Created:** 2026-02-02
> **Authors:** Human + Claude (Brainstorming Session)
> **Depends On:** [Platform Services Layer](./2026-02-03-platform-services-layer.md) (peer Kernel component), [Compliance Network Design](./2026-02-02-compliance-network-design.md) (A2A and events tools), [Registry Design](./2026-02-03-registry-design.md) (registry tools, Simulator)

---

## Executive Summary

The Kernel VM is the **pure computation engine** of the EuroComply Compliance OS. Its ~53 handlers are the immutable, tested, audited primitives that:

- AI agents **compose** but cannot modify
- Form the rock-solid foundation that makes AI programming safe
- Provide detailed **explanations** alongside results for trust and auditability
- Enable the platform to be an **AI-Programmable Industrial Operating System**

### Architectural Context

The Kernel VM (`packages/kernel-vm/` in the `eurocomply-os` repo) is the **compute half** of the EuroComply Kernel. It provides pure, deterministic compliance computation with **zero dependencies and zero I/O**. Its peer is the **Platform Services Layer** ([design doc](./2026-02-03-platform-services-layer.md)), which provides stateful operations (entity CRUD, files, search, permissions). The Kernel VM can run in Node.js, a browser, a Lambda function, or a CLI -- anywhere JavaScript runs.

```
┌───────────────────────────────────────────────────────┐
│                    APPLICATIONS                        │
├───────────────────────────────────────────────────────┤
│                  SYSTEM SERVICES                       │
│          (Registry + A2A Protocol)                     │
├───────────────────────────────────────────────────────┤
│                      KERNEL                            │
│  ┌──────────────┐       ┌──────────────────────┐      │
│  │  Kernel VM  │◄─────►│  Platform Services   │      │
│  │  (Compute)   │       │  (State)             │      │
│  │  THIS DOC    │       │                      │      │
│  └──────────────┘       └──────────────────────┘      │
├───────────────────────────────────────────────────────┤
│                  INFRASTRUCTURE                        │
│       PostgreSQL  Neo4j  R2  LLM Gateway               │
└───────────────────────────────────────────────────────┘
```

### Core Principle

```
The Kernel VM is to EuroComply what CPU instructions are to a computer.

- Handlers are IMMUTABLE primitives (like ADD, MOV, CMP)
- Rules are PROGRAMS composed from handlers (like assembly code)
- The Registry COMPILES rules into executable form (via registry:compile)
- AI agents PROGRAM the platform by composing handlers into rules
- The SIMULATOR validates AI-generated rules before deployment
- Platform Services are SYSCALLS (open, read, write) -- the stateful peer
- The kernel-vm has ZERO dependencies, ZERO I/O -- pure computation only
```

---

## Table of Contents

1. [Design Principles](#1-design-principles)
2. [Handler Categories](#2-handler-categories)
3. [Computation Handlers](#3-computation-handlers)
4. [Validation Handlers](#4-validation-handlers)
5. [Logic Gate Handlers](#5-logic-gate-handlers)
6. [Graph Handlers](#6-graph-handlers)
7. [Resolution Handlers](#7-resolution-handlers)
8. [Temporal Handlers](#8-temporal-handlers)
9. [AI/Intelligence Handlers](#9-aiintelligence-handlers)
10. [**AI-Programmable Platform**](#10-ai-programmable-platform) *(Core Innovation)*
11. [**The Workflow Primitive**](#11-the-workflow-primitive) *(Lifecycle as Handler Program)*
12. [MCP Tool Interface](#12-mcp-tool-interface)
13. [The Simulator](#13-the-simulator)
14. [Implementation Plan](#14-implementation-plan)

---

## 1. Design Principles

### 1.1 Every Handler is a Pure Function

```typescript
// Every handler implements this interface
interface Handler<TConfig, TInput, TOutput> {
  readonly id: string;           // e.g., "core:collection_sum"
  readonly version: string;      // e.g., "1.0.0"
  readonly category: HandlerCategory;

  readonly configSchema: JsonSchema;
  readonly inputSchema: JsonSchema;
  readonly outputSchema: JsonSchema;

  readonly description: string;
  readonly examples: HandlerExample[];

  execute(
    config: TConfig,
    input: TInput,
    context: ExecutionContext
  ): HandlerResult<TOutput>;  // Synchronous -- kernel-vm has zero I/O
}
```

### 1.2 Every Handler Returns Explanations

The **Explanation** interface is key to trust. Every handler result includes human-readable reasoning.

```typescript
interface HandlerResult<T> {
  success: boolean;
  value: T;
  explanation: Explanation;      // Human-readable breakdown
  trace: ExecutionTrace;         // For debugging/audit
  warnings?: Warning[];
}

interface Explanation {
  summary: string;               // One-line result
  steps: ExplanationStep[];      // Step-by-step reasoning
  references?: Reference[];      // Regulations, data sources cited
}

interface ExplanationStep {
  action: string;                // What was done
  result: string;                // What was found
  data?: Record<string, unknown>; // Supporting data
}

interface Reference {
  type: 'regulation' | 'gsr' | 'document' | 'calculation';
  id: string;
  title?: string;
  excerpt?: string;
}
```

### 1.3 Design Principles Summary

| Principle | Description |
|-----------|-------------|
| **Pure Functions** | Same input always produces same output |
| **Typed Contracts** | JSON Schema for config, input, output |
| **Self-Documenting** | Description, examples, explanation built-in |
| **Composable** | Output of one handler feeds input of another |
| **Versioned** | Breaking changes require new version |
| **Testable** | Every handler has comprehensive test suite |
| **Explainable** | Every result includes human-readable reasoning |

---

## 2. Handler Categories

| Category | Count | Purpose |
|----------|-------|---------|
| **Computation** | 9 | Calculate values from BOM and data |
| **Validation** | 10 | Pass/fail checks against requirements |
| **Logic Gates** | 7 | Compose validations (AND, OR, IF_THEN, PIPE) |
| **Graph** | 8 | Traverse supply chain knowledge graph |
| **Resolution** | 8 | Resolve conflicts, find alternatives |
| **Temporal** | 2 | Deadlines, scheduling, time-based logic |
| **AI/Intelligence** | 9 | LLM-powered reasoning and generation |
| **Total** | **~53** | |

---

## 3. Computation Handlers

These handlers calculate values from collections of items (e.g., materials, components, line items).

### 3.1 `core:collection_sum`

Sum a field across all items in a collection.

```typescript
interface CollectionSumConfig {
  source: {
    entity: 'materials' | 'components' | 'substances';
    path?: string;                 // Nested path: 'materials.substances'
  };
  field: string;                   // Field to sum: 'concentration', 'weight'
  filter?: {
    field: string;
    operator: 'eq' | 'ne' | 'in' | 'not_in' | 'gt' | 'lt';
    value: unknown;
  };
  normalize_to?: string;           // Target unit for normalization
}

interface CollectionSumOutput {
  total: number;
  unit: string;
  item_count: number;
  items_included: Array<{ id: string; name: string; value: number }>;
}
```

**Use Cases:**
- Total concentration of all substances in a material
- Sum of weights for shipping calculation
- Total recycled content percentage

### 3.2 `core:collection_max`

Find maximum value in a collection - identify worst-case item.

```typescript
interface CollectionMaxConfig {
  source: { entity: string; path?: string };
  field: string;
  filter?: { field: string; operator: string; value: unknown };
}

interface CollectionMaxOutput {
  max_value: number;
  max_item: { id: string; name: string; value: number };
  all_values: Array<{ id: string; name: string; value: number }>;
}
```

### 3.3 `core:collection_min`

Find minimum value in a collection - find lowest purity, earliest expiration.

### 3.4 `core:bom_weighted`

**Critical for chemical compliance.** Cascading weighted calculation through BOM hierarchy.

```typescript
interface BomWeightedConfig {
  source: { entity: string; path?: string };
  value_field: string;             // e.g., 'concentration'
  weight_field: string;            // e.g., 'percentage_in_parent'
  accumulation: 'multiply' | 'add';

  // For nested BOMs
  recurse?: boolean;
  max_depth?: number;
}

interface BomWeightedOutput {
  final_value: number;
  calculation_path: Array<{
    level: number;
    item: string;
    local_value: number;
    weight: number;
    cumulative: number;
  }>;
}
```

**Example:** A substance is 5% in a raw material, that raw material is 10% of the product.
Actual concentration = 5% × 10% = 0.5% in final product.

### 3.5 `core:count`

Count items matching criteria.

```typescript
interface CountConfig {
  source: { entity: string; path?: string };
  filter?: { field: string; operator: string; value: unknown };
  distinct_by?: string;            // Count unique values of this field
}

interface CountOutput {
  count: number;
  items: Array<{ id: string; name: string }>;
}
```

### 3.6 `core:rollup`

Aggregate values from children to parent - for hierarchical BOMs.

```typescript
interface RollupConfig {
  source: { entity: string };
  aggregation: 'sum' | 'max' | 'min' | 'avg' | 'count';
  field: string;
  group_by?: string;               // Create subtotals
}
```

### 3.7 `core:average`

Calculate mean value across items.

### 3.8 `core:ratio`

Calculate ratio between two values (e.g., water/oil phase ratio).

```typescript
interface RatioConfig {
  numerator: number | { handler: string; config: unknown };
  denominator: number | { handler: string; config: unknown };
  format?: 'decimal' | 'percentage' | 'fraction';
}
```

### 3.9 `core:unit_convert`

Convert between units - critical for normalizing data from different sources.

```typescript
interface UnitConvertConfig {
  source_value: number | { field: string };
  source_unit: string | { field: string };
  target_unit: string;
  decimal_places?: number;
  rounding?: 'floor' | 'ceil' | 'round';
}

interface UnitConvertOutput {
  converted_value: number;
  source_value: number;
  source_unit: string;
  target_unit: string;
  conversion_factor: number;
}
```

**Supported Dimensions:**

| Dimension | Base Unit | Supported Units |
|-----------|-----------|-----------------|
| Concentration | FRACTION | PERCENT, PPM, PPB, MG_KG, MG_L |
| Mass | KG | G, MG, UG, LB, OZ |
| Volume | L | ML, M3, GAL |
| Temperature | KELVIN | CELSIUS, FAHRENHEIT |
| Dose | MG_KG_BW_DAY | (for ADI values) |

---

## 4. Validation Handlers

These handlers return boolean pass/fail with detailed explanations. They output a standardized `ValidationResult` that logic gates can compose.

### Validation Result Contract

```typescript
// Every validation handler outputs this - enables composition
interface ValidationResult {
  pass: boolean;
  handler_id: string;
  handler_version: string;
  explanation: Explanation;
  trace: ExecutionTrace;
  details: Record<string, unknown>;
  confidence?: number;             // 0-1, only for AI handlers
  warnings?: Warning[];
}
```

### 4.1 `core:threshold_check`

Compare value against limit - the most fundamental compliance check.

```typescript
interface ThresholdCheckConfig {
  value: number | { handler: string; config: unknown };
  operator: 'lt' | 'lte' | 'gt' | 'gte' | 'eq' | 'ne' | 'between' | 'outside';
  threshold: number | { field: string };
  threshold_upper?: number;        // For 'between' and 'outside'

  tolerance?: {
    type: 'absolute' | 'relative';
    value: number;
  };

  substance_name?: string;         // For explanation
  regulation_ref?: string;         // For explanation
}

interface ThresholdCheckOutput {
  pass: boolean;
  actual_value: number;
  threshold_value: number;
  margin: number;                  // Negative = failed by this much
  margin_percent: number;
}
```

### 4.2 `core:presence_check`

Verify required item exists.

```typescript
interface PresenceCheckConfig {
  source: { entity: string; path?: string };
  match: { field: string; operator: string; value: unknown };
  minimum_count?: number;
  item_description?: string;
  requirement_reason?: string;
}
```

### 4.3 `core:absence_check`

Verify prohibited item does NOT exist - critical for banned substance checking.

```typescript
interface AbsenceCheckConfig {
  source: { entity: string; path?: string };
  prohibited: { field: string; operator: string; value: unknown };

  unless?: {
    concentration_below?: number;  // Trace allowance
    has_exemption_code?: string[];
  };

  item_description?: string;
  regulation_ref?: string;
}

interface AbsenceCheckOutput {
  pass: boolean;
  found_prohibited: Array<{
    id: string;
    name: string;
    concentration?: number;
    exemption_applied?: string;
  }>;
  exemptions_applied: number;
}
```

### 4.4 `core:list_check`

Check against reference list (positive list, negative list, restricted list).

```typescript
interface ListCheckConfig {
  value: string | { field: string };
  list_type: 'positive' | 'negative' | 'restricted';
  list_source: {
    type: 'context';               // Data must be pre-loaded into ExecutionContext
    context_key: string;           // Key in ExecutionContext.data (e.g., 'reach_svhc_list')
    lookup_field?: string;
    inline_values?: string[];      // Alternative: inline values in the rule AST
  };
  restriction_fields?: string[];   // What to extract from restricted lists
}
```

### 4.5 `core:date_check`

Validate dates for expiration, effectiveness, compliance windows.

```typescript
interface DateCheckConfig {
  date: string | Date | { field: string };
  check_type: 'not_expired' | 'not_before' | 'not_after' | 'within_range' | 'age_max' | 'age_min';
  reference_date?: string | Date | { field: string };
  max_age?: { value: number; unit: 'days' | 'months' | 'years' };
  grace_period?: { value: number; unit: 'days' | 'months' };
}
```

### 4.6 `core:document_check`

Verify required documents are attached and valid.

```typescript
interface DocumentCheckConfig {
  required_documents: Array<{
    type: string;                  // 'sds', 'coa', 'test_report'
    description: string;
    must_be_current?: boolean;
    max_age?: { value: number; unit: string };
    required_fields?: string[];
    issuer_requirements?: {
      must_be_accredited?: boolean;
      accepted_issuers?: string[];
    };
  }>;
  source: { entity: string; documents_field: string };
}
```

### 4.7 `core:credential_check`

Validate verifiable credentials - signatures, expiration, revocation.

```typescript
interface CredentialCheckConfig {
  credential: { field: string } | string;
  checks: {
    signature?: boolean;
    expiration?: boolean;
    revocation?: boolean;
    issuer?: {
      trusted_issuers?: string[];
      issuer_type?: string[];
    };
    schema?: {
      required_type?: string;
      required_claims?: string[];
    };
  };
}
```

### 4.8 `core:enum_check`

Validate value is in allowed set.

### 4.9 `core:pattern_check`

Validate format (regex, GTIN, CAS number, EC number).

```typescript
interface PatternCheckConfig {
  value: string | { field: string };
  pattern_type: 'regex' | 'gtin' | 'cas' | 'ec_number' | 'email' | 'url' | 'custom';
  regex?: string;
  error_message?: string;
}
```

### 4.10 `core:completeness_check`

Verify all required fields are populated - critical for compliance dossiers.

```typescript
interface CompletenessCheckConfig {
  entity: string | { field: string };
  required_fields: Array<{
    path: string;                  // Dot notation: 'supplier.contact.email'
    description: string;
    condition?: {                  // Conditionally required
      if_field: string;
      operator: string;
      value?: unknown;
    };
    validation?: {
      not_empty?: boolean;
      min_length?: number;
      min_items?: number;
    };
  }>;
  minimum_completion?: number;     // 0-100, default 100
}
```

---

## 5. Logic Gate Handlers

These handlers compose validation results - the "glue" that builds complex rules from simple checks.

### 5.1 `core:and`

All conditions must pass.

```typescript
interface AndConfig {
  conditions: Array<{
    handler: string;
    config: unknown;
    label?: string;
  }>;
  short_circuit?: boolean;         // Stop on first failure (default true)
  minimum_pass?: number;           // For weighted AND: 3 of 4 must pass
}

interface AndOutput {
  pass: boolean;
  results: ValidationResult[];
  passed_count: number;
  failed_count: number;
  first_failure?: { index: number; label: string; reason: string };
}
```

### 5.2 `core:or`

At least one condition must pass - enables exemption patterns.

```typescript
interface OrConfig {
  conditions: Array<{
    handler: string;
    config: unknown;
    label?: string;
    priority?: number;             // Try higher priority first
  }>;
  short_circuit?: boolean;
  minimum_pass?: number;           // Default 1
}
```

**Example: Exemption Pattern**

```typescript
// Substance banned OR has exemption certificate
const rule = {
  handler: 'core:or',
  config: {
    conditions: [
      {
        handler: 'core:absence_check',
        config: { prohibited: { field: 'cas_number', operator: 'eq', value: '50-00-0' } },
        label: 'Substance not present',
        priority: 1
      },
      {
        handler: 'core:credential_check',
        config: { checks: { schema: { required_type: 'SubstanceExemptionCredential' } } },
        label: 'Valid exemption certificate',
        priority: 2
      }
    ]
  }
};
```

### 5.3 `core:not`

Invert a validation result.

### 5.4 `core:if_then`

Conditional validation - only check B if A is true.

```typescript
interface IfThenConfig {
  if: { handler: string; config: unknown; label?: string };
  then: { handler: string; config: unknown; label?: string };
  else?: { handler: string; config: unknown; label?: string };
  default_when_skipped?: boolean;  // Default true
}
```

**Example:** IF product contains nanomaterials THEN must have nano safety assessment.

### 5.5 `core:for_each`

Apply validation to every item in a collection.

```typescript
interface ForEachConfig {
  source: { entity: string; path?: string; filter?: object };
  validation: { handler: string; config: unknown };
  require: 'all' | 'any' | 'none' | { minimum: number } | { minimum_percent: number };
  parallel?: boolean;
  max_concurrency?: number;
}

interface ForEachOutput {
  pass: boolean;
  total_items: number;
  passed_items: number;
  failed_items: number;
  item_results: Array<{ item_id: string; item_name?: string; result: ValidationResult }>;
  failures?: Array<{ item_id: string; item_name: string; reason: string }>;
}
```

---

## 6. Graph Handlers

These handlers perform graph analysis on data provided through the `ExecutionContext`. The graph data is pre-loaded by Platform Services before handler execution -- the kernel-vm never accesses Neo4j directly. Platform Services resolves the graph query, injects the result into `ExecutionContext.data`, and the handler operates on the in-memory graph structure.

### 6.1 `core:trace_upstream`

Trace substance/material back through supply chain to origins.

```typescript
interface TraceUpstreamConfig {
  start_node: { type: string; id: string | { field: string } };
  trace_target?: { type: string; filter?: object };
  max_depth?: number;
  relationships?: string[];        // 'CONTAINS', 'MADE_FROM', 'SUPPLIED_BY'
  include_quantities?: boolean;
  stop_at?: { node_type?: string[]; node_property?: object };
}

interface TraceUpstreamOutput {
  paths: Array<{
    nodes: Array<{ id: string; type: string; name: string; properties: object }>;
    relationships: Array<{ type: string; properties: object }>;
    cumulative_concentration?: number;
    total_depth: number;
  }>;
  origin_nodes: Array<{ id: string; type: string; name: string; path_count: number }>;
  suppliers_involved: Array<{ id: string; name: string; supplies: string[] }>;
}
```

### 6.2 `core:trace_downstream`

Find all products/customers affected by a substance, material, or supplier.

### 6.3 `core:find_path`

Find compliance paths - how does a certification satisfy a requirement?

```typescript
interface FindPathConfig {
  from_node: { type: string; id: string | { field: string } };
  to_node: { type: string; id?: string; filter?: object };
  relationship_types?: string[];
  max_depth?: number;
  prefer?: 'shortest' | 'most_recent' | 'highest_trust' | 'lowest_cost';
  waypoints?: Array<{ type: string; filter?: object }>;
  blocked_nodes?: Array<{ type: string; filter?: object }>;
}
```

### 6.4 `core:subgraph_extract`

Extract a subgraph for analysis - the product's "compliance universe."

### 6.5 `core:impact_analysis`

Calculate cascading impact of a change (substance ban, supplier loss).

```typescript
interface ImpactAnalysisConfig {
  change: {
    type: 'substance_ban' | 'supplier_loss' | 'regulation_change' | 'threshold_change';
    target_node?: { type: string; id: string };
    old_value?: unknown;
    new_value?: unknown;
  };
  scope: { node_types: string[]; max_depth?: number };
  suggest_alternatives?: boolean;
  include_financials?: boolean;
}

interface ImpactAnalysisOutput {
  impact_summary: {
    severity: 'critical' | 'high' | 'medium' | 'low';
    affected_products: number;
    affected_suppliers: number;
    compliance_gaps_created: number;
  };
  affected_entities: Array<{
    id: string; type: string; name: string;
    impact_type: 'direct' | 'indirect';
    impact_description: string;
  }>;
  alternatives?: Array<{
    type: string;
    description: string;
    feasibility: 'high' | 'medium' | 'low';
    affected_products: string[];
  }>;
  financials?: {
    revenue_at_risk: number;
    reformulation_cost_estimate: number;
  };
}
```

### 6.6 `core:shortest_path`

Simple shortest path between two nodes.

### 6.7 `core:neighbors`

Get immediate neighbors - for UI graph exploration.

### 6.8 `core:cycle_detect`

Detect circular dependencies - critical for BOM validation.

---

## 7. Resolution Handlers

These handlers resolve conflicts and make rule-based decisions. Deterministic but intelligent.

### 7.1 `core:data_conflict_resolve`

When multiple sources provide conflicting data, determine which to trust.

```typescript
interface DataConflictResolveConfig {
  values: Array<{
    value: unknown;
    source: string;
    timestamp?: string;
    confidence?: number;
  }>;
  strategy: 'most_recent' | 'highest_confidence' | 'source_hierarchy' |
            'most_conservative' | 'most_common' | 'weighted_average';
  source_priority?: string[];
  tolerance?: number;
  flag_threshold?: number;
}

interface DataConflictResolveOutput {
  resolved_value: unknown;
  resolution_method: string;
  confidence: number;
  conflict_detected: boolean;
  conflict_severity: 'none' | 'minor' | 'significant' | 'critical';
  requires_review?: boolean;
}
```

### 7.2 `core:find_substitute`

Find alternative substances/materials meeting functional requirements.

```typescript
interface FindSubstituteConfig {
  original: { type: string; id: string | { field: string } };
  required_functions: string[];
  constraints: {
    must_not_be_on_lists?: string[];
    must_be_on_lists?: string[];
    max_hazard_class?: string[];
    max_cost_increase_percent?: number;
    min_supplier_count?: number;
  };
  rank_by?: Array<{ factor: string; weight: number }>;
  max_results?: number;
}
```

### 7.3 `core:rule_resolve`

Resolve conflicts between competing rules.

```typescript
interface RuleResolveConfig {
  substance_or_product: { type: string; id: string };
  target_markets: string[];
  analyze: {
    concentration_limits?: boolean;
    labeling_requirements?: boolean;
    documentation_requirements?: boolean;
  };
  resolution_strategy: 'most_restrictive' | 'market_specific' | 'hybrid';
}
```

### 7.4 `core:priority_rank`

Rank items by weighted criteria - for action prioritization.

### 7.5 `core:entity_match`

Match/deduplicate entities across sources - critical for data integration.

```typescript
interface EntityMatchConfig {
  source_entity: { type: string; data: object | { field: string } };
  target_pool: { type: string; source: 'gsr' | 'tenant'; table?: string };
  match_fields: Array<{
    source_field: string;
    target_field: string;
    match_type: 'exact' | 'fuzzy' | 'phonetic' | 'numeric_tolerance' | 'synonym';
    weight: number;
    required?: boolean;
    min_similarity?: number;
  }>;
  minimum_match_score: number;
}
```

### 7.6 `core:version_select`

Select appropriate version (regulations, documents, formulations).

### 7.7 `core:threshold_interpolate`

Calculate threshold when value falls between defined points.

### 7.8 `core:action_sequence`

Determine optimal sequence of actions considering dependencies.

---

## 8. Temporal Handlers

These handlers provide time-based logic for deadlines, scheduling, and recurring evaluation. They enable workflows to enforce time constraints and trigger re-assessments automatically. Like all handlers, they are pure functions -- they evaluate temporal conditions against provided timestamps rather than reading system clocks directly, ensuring deterministic replay.

### 8.1 `core:deadline`

Enforce that a condition must be met within a time window. Used as workflow guards and compliance monitoring.

```typescript
interface DeadlineConfig {
  condition: {
    handler: string;
    config: unknown;
  };
  window: {
    duration: { value: number; unit: 'hours' | 'days' | 'months' | 'years' };
    started_at: string | { field: string };  // ISO date or field reference
  };
  on_expired: 'fail' | 'escalate' | 'auto_transition';
  escalation?: {
    notify_roles?: string[];
    emit_event?: string;
    auto_transition_to?: string;  // Target state in workflow
  };
}

interface DeadlineOutput {
  status: 'within_window' | 'expired' | 'condition_met';
  time_remaining?: { value: number; unit: string };
  time_overdue?: { value: number; unit: string };
  condition_result?: ValidationResult;
}
```

**Use Cases:**
- "Product must be reviewed within 30 days of submission"
- "Supplier must respond to credential request within 14 days"
- "Re-certification required within 12 months of last approval"

**Graph Persistence:** When a `core:deadline` is active within a workflow, the resulting `expiry_date` is stored as a property on the `:IN_STATE` edge in Neo4j. Expiry events are emitted as `UniversalEvent` objects through the unified event system, enabling both internal application reactions (e.g., turning a UI status badge red) and A2A notifications.

### 8.2 `core:schedule`

Define recurring evaluation triggers. Returns whether an evaluation is due.

```typescript
interface ScheduleConfig {
  frequency: {
    every: { value: number; unit: 'hours' | 'days' | 'weeks' | 'months' | 'years' };
    anchor?: string;         // ISO date: when the schedule started
  };
  last_executed?: string | { field: string };  // ISO date of last run
  evaluation: {
    handler: string;
    config: unknown;
  };
  skip_if?: {               // Don't re-evaluate if nothing changed
    handler: string;
    config: unknown;
  };
}

interface ScheduleOutput {
  due: boolean;
  next_due: string;          // ISO date
  last_executed?: string;
  evaluation_result?: HandlerResult<unknown>;  // Only present if due and executed
}
```

**Use Cases:**
- "Re-evaluate REACH compliance every 90 days"
- "Check credential expiration weekly"
- "Recalculate carbon footprint monthly"

**Graph Persistence:** When a `core:schedule` is active within a workflow, the `next_due` timestamp is stored on the `:IN_STATE` edge by Platform Services. The scheduler service (Platform Services `job:*` tools) polls these edges and invokes the Kernel VM when evaluations are due.

**Agentic Testing:** AI agents use `devel:test --fast-forward` to virtually "age" temporal handlers during simulation, verifying that escalation paths and recurring evaluations fire correctly without waiting for real time to elapse.

---

## 9. AI/Intelligence Handlers

These handlers define the **interface contracts** for AI-powered operations. They return **confidence scores** and support **human-in-the-loop**.

**Purity note:** AI handlers are defined in the kernel-vm as type signatures and contracts, but their execution is **delegated to Platform Services** via the Bridge mechanism. When the kernel-vm encounters an `ai:*` handler during evaluation, it emits a **Bridge Request** to Platform Services, which invokes the LLM Gateway, and returns the result for the handler to process. The kernel-vm itself never makes network calls -- it defines what data to extract, what to interpret, what to classify, but the actual LLM invocation happens in Platform Services.

**Scope clarification:** The `ai:` namespace is shared between two layers. The 9 handlers defined here are **Kernel VM contracts** -- composable within Rule Logic ASTs and used during compliance evaluations. Platform Services defines additional `ai:*` tools (`ai:execute`, `ai:explain_entity`, `ai:suggest_actions`, `ai:design_entity`, `ai:design_workflow`, `ai:conversation`) that are **interactive tools** for human users and AI agents, not composable within Rule ASTs. See the [Platform Services AI Runtime](./2026-02-03-platform-services-layer.md#16-tier-2-ai-runtime) for the full taxonomy.

### AI Handler Base Output

```typescript
interface AIHandlerOutput<T> {
  result: T;
  confidence: number;              // 0-1, REQUIRED

  reasoning: {
    chain: ReasoningStep[];
    evidence: Evidence[];
    alternatives_considered?: Alternative[];
  };

  requires_review: boolean;
  review_reason?: string;

  model_version: string;
  tokens_used: { input: number; output: number };
}
```

### 9.1 `ai:document_extract`

Extract structured data from unstructured documents (SDS, CoA, test reports).

```typescript
interface DocumentExtractConfig {
  document: {
    type: 'sds' | 'coa' | 'test_report' | 'declaration' | 'regulation';
    content: string;               // Pre-loaded content (Platform Services resolves file/URL before invocation)
  };
  extraction_schema: {
    fields: Array<{
      name: string;
      description: string;
      type: string;
      required: boolean;
      section_hint?: string;
      pattern_hint?: string;
    }>;
  };
  min_confidence: number;
  source_language?: string;
  translate_to?: string;
}
```

### 9.2 `ai:interpret`

Interpret structured or unstructured text and apply to a specific context.

```typescript
interface InterpretConfig {
  regulation: { text: string | { regulation_id: string }; jurisdiction: string };
  context: { product?: object; substance?: object; use_case?: string };
  questions: Array<{
    id: string;
    question: string;
    answer_type: 'boolean' | 'threshold' | 'category' | 'action_required';
  }>;
  search_precedents?: boolean;
  min_confidence: number;
}
```

### 9.3 `ai:gap_analysis`

Identify what's missing for compliance.

```typescript
interface GapAnalysisConfig {
  current_state: { entity_type: string; entity_id: string; include_related?: boolean };
  target: { regulation?: string; certification?: string; market?: string };
  depth: 'summary' | 'detailed' | 'actionable';
  estimate_effort?: boolean;
  prioritize_by?: 'deadline' | 'effort' | 'risk' | 'cost';
}

interface GapAnalysisResult {
  overall_readiness: number;       // 0-100%
  overall_status: 'ready' | 'minor_gaps' | 'significant_gaps' | 'major_work_needed';
  gaps: Array<{
    id: string;
    category: string;
    severity: 'critical' | 'major' | 'minor';
    requirement: string;
    current_state: string;
    gap_description: string;
    remediation: { actions: string[]; estimated_effort: string };
  }>;
  strengths: Array<{ requirement: string; status: string; evidence: string }>;
}
```

### 9.4 `ai:query`

Answer natural language questions about compliance data. This tool is shared with Platform Services -- the contract is defined here in the Kernel VM (composable within Rule Logic ASTs), and the implementation runs in the Platform Services AI Runtime.

### 9.5 `ai:document_generate`

Generate compliance documents from structured data.

### 9.6 `ai:classify`

Classify into regulatory categories (GHS hazard, customs HS code).

### 9.7 `ai:anomaly_detect`

Detect unusual patterns indicating data quality or compliance risks.

### 9.8 `ai:explain`

Generate human-readable explanations for compliance decisions.

```typescript
interface ExplainConfig {
  target: { type: string; data: object; handler_trace?: ExecutionTrace };
  audience: 'regulatory_expert' | 'product_manager' | 'executive' | 'consumer';
  depth: 'summary' | 'detailed' | 'technical';
  focus?: string[];
  language: string;
  avoid_jargon?: boolean;
}
```

### 9.9 `ai:score`

Score an entity by weighing multiple factors.

```typescript
interface RiskScoreConfig {
  entity: { type: string; id: string };
  factors: Array<{
    category: string;                // 'substance_hazard' | 'data_completeness' | 'credential_age' | 'regulatory_change'
    weight: number;                  // 0-1, must sum to 1
  }>;
  include_breakdown: boolean;
  benchmark?: string;                // Intelligence Pack benchmark dataset ID
  min_confidence: number;
}

interface RiskScoreResult {
  score: number;                     // 0-100 (higher = more risk)
  rating: 'low' | 'medium' | 'high' | 'critical';
  breakdown: Array<{
    category: string;
    score: number;
    weight: number;
    weighted_score: number;
    contributing_factors: string[];
  }>;
  benchmark_comparison?: {
    percentile: number;
    industry_average: number;
  };
}
```

---

## 10. AI-Programmable Platform

This is the **core innovation** of EuroComply v2: the platform is not fixed software - it's a **Generative Operating System** that AI agents can program at runtime.

### 10.1 The Vision: Software That Programs Itself

Traditional compliance software:
```
Developer writes code → Deploys → Users use fixed features
```

EuroComply v2:
```
Handlers are the instruction set (immutable, tested, audited)
     ↓
AI Agent composes handlers into rules/verticals/workflows
     ↓
Simulator validates the composition (shadow test)
     ↓
Human approves → Production deployment
     ↓
Platform gains new capability WITHOUT code deployment
```

**This means:**
- New regulation? AI reads it and creates rules.
- New industry vertical? AI defines it from existing handlers.
- Customer-specific workflow? AI configures it.
- No developer in the loop for capability expansion.

### 10.2 What AI Agents Can Program

| Programmable Element | What It Is | Example |
|---------------------|------------|---------|
| **Vertical** | Industry-specific configuration | "Biocides", "Medical Devices", "Batteries" |
| **Workspace** | Role-based view within vertical | "Formulation", "Regulatory Affairs", "QA" |
| **Rule** | Compliance check composed from handlers | "SVHC > 0.1% requires notification" |
| **Entity Schema** | Data structure for vertical-specific data | Cosmetic formulation fields, battery cell chemistry |
| **Workflow** | State machine for product lifecycle | Draft → Review → Approved → Published |
| **UI Configuration** | How data is displayed/edited | Field order, required fields, conditional visibility |

### 10.3 MCP as the Universal Interface

**MCP (Model Context Protocol)** is how AI agents interact with the platform. Every programmable action is an MCP tool.

```
┌─────────────────────────────────────────────────────────────────┐
│                     AI AGENT (Claude, GPT, etc.)                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ MCP Protocol
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    EUROCOMPLY MCP SERVER                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │   META      │  │    OPS      │  │ INTELLIGENCE│             │
│  │   Tools     │  │    Tools    │  │    Tools    │             │
│  ├─────────────┤  ├─────────────┤  ├─────────────┤             │
│  │create_      │  │get_product  │  │analyze_gap  │             │
│  │  vertical   │  │update_      │  │interpret_   │             │
│  │create_rule  │  │  material   │  │  regulation │             │
│  │define_      │  │evaluate_    │  │explain_     │             │
│  │  workspace  │  │  compliance │  │  decision   │             │
│  │define_      │  │trace_       │  │classify     │             │
│  │  entity     │  │  substance  │  │             │             │
│  └──────┬──────┘  └─────────────┘  └─────────────┘             │
│         │                                                       │
│         │ Requires Simulator Approval                           │
│         ▼                                                       │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    SIMULATOR                             │   │
│  │  Shadow Schema → Validate → Diff Report → Human Approve  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       KERNEL VM                                 │
│            (~53 immutable, tested, audited primitives)           │
└─────────────────────────────────────────────────────────────────┘
```

### 10.4 Example: AI Creates a "Biocides" Vertical

Here's the complete flow of an AI agent creating a new industry vertical:

**Step 1: AI Reads the Regulation**

```typescript
// AI uses intelligence tools to understand EU Biocidal Products Regulation
const interpretation = await mcp.call('ai:interpret', {
  regulation: { id: 'EU_BPR_528_2012' },
  questions: [
    { id: 'product_types', question: 'What are the 22 biocidal product types?', answer_type: 'category' },
    { id: 'approval_requirements', question: 'What are the active substance approval requirements?', answer_type: 'action_required' },
    { id: 'efficacy_requirements', question: 'What efficacy data is required?', answer_type: 'freeform' }
  ]
});
```

**Step 2: AI Defines the Vertical**

```typescript
// AI composes a vertical definition
const verticalDefinition = await mcp.call('meta:create_vertical', {
  vertical: {
    id: 'biocides',
    name: 'Biocidal Products',
    description: 'EU BPR 528/2012 compliance for biocidal products',

    // Which GSR personas does this vertical use?
    gsr_personas: ['substance_biocide', 'substance_hazard_classification'],

    // Vertical-specific configuration
    config: {
      product_types: [1, 2, 3, 4, 5, /* ... 22 types */],
      requires_active_substance_approval: true,
      efficacy_data_required: true
    }
  }
});
// Returns: { status: 'pending_simulation', simulation_id: 'sim_123' }
```

**Step 3: AI Defines Workspaces**

```typescript
// AI creates workspaces for different roles
await mcp.call('meta:define_workspace', {
  vertical_id: 'biocides',
  workspaces: [
    {
      code: 'formulation',
      name: 'Product Formulation',
      description: 'Define biocidal product composition',
      available_roles: ['VIEWER', 'CONTRIBUTOR', 'EDITOR', 'MANAGER'],
      icon: 'flask',
      color: 'green'
    },
    {
      code: 'regulatory',
      name: 'Regulatory Dossier',
      description: 'Prepare and manage authorization dossiers',
      available_roles: ['VIEWER', 'CONTRIBUTOR', 'EDITOR', 'MANAGER'],
      icon: 'document',
      color: 'blue'
    },
    {
      code: 'efficacy',
      name: 'Efficacy Testing',
      description: 'Manage efficacy studies and claims',
      available_roles: ['VIEWER', 'CONTRIBUTOR', 'EDITOR'],
      icon: 'microscope',
      color: 'purple'
    }
  ]
});
```

**Step 4: AI Defines Entity Schemas**

```typescript
// AI creates vertical-specific data structures
await mcp.call('entity:define', {
  entity_type: 'biocidal_product',

  schema: {
    fields: [
      {
        name: 'product_type',
        type: 'number',
        description: 'BPR Product Type (PT1-PT22)',
        required: true,
        ui_widget: 'select'
      },
      {
        name: 'active_substances',
        type: 'array',
        description: 'Active biocidal substances with concentrations',
        required: true,
        items_type: 'object',
        min_items: 1
      },
      {
        name: 'target_organisms',
        type: 'array',
        description: 'Target harmful organisms',
        required: true,
        items_type: 'string'
      },
      {
        name: 'application_method',
        type: 'string'
      },
      {
        name: 'authorization_status',
        type: 'enum',
        enum_values: ['NOT_SUBMITTED', 'UNDER_REVIEW', 'AUTHORIZED', 'REFUSED', 'WITHDRAWN']
      },
      {
        name: 'authorization_number',
        type: 'string'
      },
      {
        name: 'authorization_expiry',
        type: 'date'
      }
    ]
  },

  behaviors: {
    versioned: true,
    audit_log: true
  },

  lifecycle: {
    workflow_id: 'workflow:biocidal_product_lifecycle',
    initial_state: 'draft'
  },

  compliance: {
    evaluation_rules: ['BPR_ACTIVE_SUBSTANCE_APPROVED', 'BPR_PT_VALID', 'BPR_CMR_PROHIBITION'],
    evaluation_trigger: 'on_change'
  }
});
```

**Step 5: AI Creates Rules by Composing Handlers**

```typescript
// AI creates compliance rules using handler composition
await mcp.call('meta:create_rule', {
  vertical_id: 'biocides',
  rules: [
    {
      code: 'BPR_ACTIVE_SUBSTANCE_APPROVED',
      name: 'Active Substance Must Be Approved',
      description: 'All active substances must be on the Union list of approved substances',
      regulation_id: 'EU_BPR_528_2012',
      severity: 'BLOCKER',

      // Rule logic composed from handlers
      logic: {
        handler: 'core:for_each',
        config: {
          source: { entity: 'biocidal_product', path: 'active_substances' },
          validation: {
            handler: 'core:list_check',
            config: {
              value: { field: 'substance_id' },
              list_type: 'positive',
              list_source: {
                type: 'context',
                context_key: 'approved_biocidal_substances',
                lookup_field: 'substance_id'
              }
            }
          },
          require: 'all'
        }
      },

      applies_to: {
        entity_types: ['biocidal_product'],
        markets: ['EU']
      }
    },
    {
      code: 'BPR_PT_VALID',
      name: 'Product Type Must Be Valid',
      description: 'Product must declare a valid BPR product type (PT1-PT22)',
      severity: 'BLOCKER',

      logic: {
        handler: 'core:enum_check',
        config: {
          value: { field: 'product_type' },
          allowed_values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]
        }
      }
    },
    {
      code: 'BPR_CMR_PROHIBITION',
      name: 'CMR Substances Restricted',
      description: 'CMR 1A/1B substances not allowed unless essential use exemption',
      severity: 'BLOCKER',

      logic: {
        handler: 'core:for_each',
        config: {
          source: { entity: 'biocidal_product', path: 'active_substances' },
          validation: {
            handler: 'core:or',
            config: {
              conditions: [
                {
                  handler: 'core:absence_check',
                  config: {
                    source: { entity: 'substance_hazard_classification' },
                    prohibited: {
                      field: 'hazard_class_code',
                      operator: 'in',
                      value: ['Carc. 1A', 'Carc. 1B', 'Muta. 1A', 'Muta. 1B', 'Repr. 1A', 'Repr. 1B']
                    }
                  },
                  label: 'Substance is not CMR 1A/1B'
                },
                {
                  handler: 'core:document_check',
                  config: {
                    required_documents: [{ type: 'cmr_essential_use_exemption' }]
                  },
                  label: 'Has essential use exemption'
                }
              ]
            }
          },
          require: 'all'
        }
      }
    }
  ]
});
```

**Step 6: Handler Logic Verification (Compile-Time)**

Before simulation, the Registry **compiles** the rule AST and runs verification:

```typescript
// The Registry compile step validates AST before execution
const compilationResult = await mcp.call('registry:compile', {
  vertical_id: 'biocides',
  rules: proposedRules
});

// Compilation performs:
// 1. AST Validation - all handlers exist, configs match schemas
// 2. Dependency Resolution - resolve substance IDs via Identity Ladder
// 3. "Hello World" Test - execute each rule against synthetic data

// Result:
{
  status: 'compiled',
  ast_validation: {
    valid: true,
    handlers_used: ['core:for_each', 'core:list_check', 'core:enum_check', 'core:or', 'core:absence_check', 'core:document_check'],
    unknown_handlers: [],
    config_errors: []
  },
  dependency_resolution: {
    substances_resolved: 847,        // Active substances found in GSR
    substances_not_found: 0,
    gsr_version_pinned: '2026.02.03'
  },
  hello_world_tests: {
    rules_tested: 3,
    rules_passed: 3,
    rules_failed: 0,
    test_cases: [
      {
        rule: 'BPR_ACTIVE_SUBSTANCE_APPROVED',
        input: { active_substances: [{ substance_id: 'uuid-approved' }] },
        expected: 'pass',
        actual: 'pass',
        explanation_generated: true
      },
      {
        rule: 'BPR_ACTIVE_SUBSTANCE_APPROVED',
        input: { active_substances: [{ substance_id: 'uuid-not-on-list' }] },
        expected: 'fail',
        actual: 'fail',
        explanation_generated: true
      }
    ]
  }
}
```

If compilation fails, the process stops before reaching the Simulator - fast feedback for the AI agent.

**Step 7: Simulator Validates (Run-Time)**

The Simulator runs the **full simulation** against the validation dataset:
1. Creates shadow schema with new vertical
2. Runs validation dataset (50+ synthetic biocidal products)
3. Checks for conflicts with existing rules
4. Generates diff report

```typescript
// Simulator returns diff report
const simulationResult = await mcp.call('registry:get_simulation_result', {
  simulation_id: 'sim_123'
});

// Result:
{
  status: 'ready_for_review',
  diff_report: {
    proposed_changes: [
      { type: 'vertical', action: 'create', id: 'biocides' },
      { type: 'workspace', action: 'create', count: 3 },
      { type: 'entity', action: 'create', count: 1 },
      { type: 'rule', action: 'create', count: 3 }
    ],
    validation_results: {
      test_products_evaluated: 50,
      expected_compliant: 35,
      actual_compliant: 35,
      expected_non_compliant: 15,
      actual_non_compliant: 15,
      accuracy: 1.0
    },
    conflict_check: {
      conflicts_found: 0
    },
    recommendation: 'approve',
    recommendation_reason: 'All validation tests passed, no conflicts with existing rules'
  }
}
```

**Step 8: Human Approves**

Human reviews the diff report in the admin UI and approves. The vertical goes live.

### 10.5 META vs OPS: The Safety Boundary

| Category | What It Changes | Approval Required | Rollback |
|----------|-----------------|-------------------|----------|
| **META** | Platform structure | Full Simulator + Human | Complex (migration) |
| **OPS** | Tenant data | Auto if within rules | Easy (event replay) |

**META Changes (Require Simulator):**
- Create/modify vertical
- Create/modify workspace
- Create/modify rule
- Create/modify entity schema
- Change workflow definition
- Modify UI configuration

**OPS Changes (Auto-Approve if Valid):**
- Create/update product
- Add/modify material
- Upload document
- Run compliance evaluation
- Generate report
- Request credential

### 10.6 The Four "God-Tier" User Stories

These user stories demonstrate the full power of the AI-Programmable Platform:

#### Story 1: "Read this PDF and make me compliant"

```
User uploads regulatory PDF
     ↓
AI: ai:document_extract → extracts requirements
     ↓
AI: meta:create_rule → creates rules for each requirement
     ↓
Simulator validates rules against test products
     ↓
Human approves
     ↓
AI: ai:gap_analysis → identifies gaps in user's products
     ↓
AI: ai:explain → explains what needs to change in plain language
```

#### Story 2: "What happens if the EU bans PFAS?"

```
User asks impact question
     ↓
AI: core:impact_analysis → graph traversal finds all affected products
     ↓
AI: core:find_substitute → identifies alternatives for each use case
     ↓
AI: core:action_sequence → optimal reformulation sequence
     ↓
AI: ai:document_generate → creates impact report for management
```

#### Story 3: "Get me proof my suppliers are compliant"

```
User requests supplier compliance verification
     ↓
AI: core:trace_upstream → identifies all suppliers in chain
     ↓
AI: a2a:request_claim → A2A: asks each supplier's AI for VCs
     ↓
AI: core:credential_check → validates received credentials
     ↓
AI: ai:document_generate → creates verified supplier compliance report
```

#### Story 4: "We're entering the medical devices market"

```
User declares new market entry
     ↓
AI: ai:interpret → reads MDR regulation
     ↓
AI: meta:create_vertical → defines medical_devices vertical
     ↓
AI: meta:define_workspace → creates Clinical, QMS, RA workspaces
     ↓
AI: meta:create_rule → creates MDR compliance rules
     ↓
Simulator validates
     ↓
Human approves
     ↓
AI: ai:gap_analysis → shows user what they need for certification
```

### 10.7 Why This Matters: The Competitive Moat

This architecture creates an **insurmountable competitive advantage**:

1. **Network Effects**: Every rule created by AI makes the platform smarter
2. **Data Flywheel**: More usage → better AI → more capability → more usage
3. **Composability**: 50 handlers combine into unlimited rules
4. **Safety**: Simulator ensures AI can't break production
5. **Trust**: Explanations make every decision auditable
6. **Speed**: New regulations → new rules in hours, not months
7. **Customization**: Each tenant gets AI-configured workflows

**The result:** EuroComply becomes an **industrial infrastructure** that gets better with every customer, every regulation, every AI interaction.

---

## 11. The Workflow Primitive

Workflows are **State Machine ASTs** executed directly by the Kernel VM. Because lifecycle movements are defined as handler compositions, they inherit the VM's core features: **Compliance Locks**, **Execution Traces**, and **Human-Readable Explanations**. A product cannot move from "Draft" to "Approved" unless the guard handlers return `PASS` -- and that decision is cryptographically pinned in the Compliance Lock.

### 11.1 Workflow AST Specification

```typescript
interface WorkflowDefinition {
  readonly id: string;                    // "workflow:cosmetic_product_lifecycle"
  readonly version: string;               // "1.0.0"
  readonly entity_type: string;           // "cosmetic_product"
  readonly vertical_id: string;           // "cosmetics"

  readonly initial_state: string;         // "draft"
  readonly terminal_states: string[];     // ["published", "withdrawn", "rejected"]

  readonly states: Record<string, StateDefinition>;

  readonly temporal?: {
    deadlines: Array<{
      state: string;                      // Which state this deadline applies to
      handler: 'core:deadline';
      config: DeadlineConfig;
    }>;
    schedules: Array<{
      applies_to: string[] | 'all';       // Which states trigger re-evaluation
      handler: 'core:schedule';
      config: ScheduleConfig;
    }>;
  };
}

interface StateDefinition {
  readonly label: string;                 // "Under Review"
  readonly description?: string;
  readonly on_enter?: EffectComposition;   // Effects when entering state
  readonly on_exit?: EffectComposition;    // Effects when leaving state
  readonly transitions: Transition[];
  readonly ui_hints?: {
    color: string;                        // For status badges
    icon?: string;
    show_in_board?: boolean;              // Kanban view
  };
}

interface Transition {
  readonly id: string;                    // "submit_for_review"
  readonly target_state: string;          // "under_review"
  readonly trigger: TransitionTrigger;
  readonly label: string;                 // "Submit for Review"

  readonly guards: GuardComposition;      // Must pass before transition
  readonly effects?: EffectComposition;   // Execute after transition

  readonly ui_hints?: {
    button_style?: 'primary' | 'secondary' | 'danger';
    confirm_message?: string;
    required_comment?: boolean;
  };
}

type TransitionTrigger =
  | { type: 'manual'; allowed_roles: string[] }
  | { type: 'event'; event_type: string; filter?: Record<string, unknown> }
  | { type: 'deadline_expired'; deadline_id: string }
  | { type: 'schedule_due'; schedule_id: string }
  | { type: 'rule_change'; rule_ids: string[] }
  | { type: 'claim_updated';                    // A2A upstream data change
      claim_types: string[];                    // Which claim types trigger this
      change: 'revoked' | 'expired' | 'updated' | 'any';
      source_filter?: {
        supplier_did?: string;                  // Specific supplier, or omit for any
        relationship?: string;                  // "direct_supplier", "tier_2", "any"
      }
    };
```

### 11.2 Guards and Effects as Handler Compositions

Guards and effects reuse the existing AST node structure from the Kernel VM. No new execution model -- the VM doesn't distinguish between "evaluating a rule" and "evaluating a workflow guard."

```typescript
// Guards are validation handler compositions -- must return ValidationResult
type GuardComposition = ASTNode;  // Same as Rule Logic AST

// Effects are handler compositions that produce side-effects
type EffectComposition = ASTNode; // Can include a2a:*, events:*, graph mutations
```

**Example guard:** "All REACH rules must pass AND reviewer has signed off"

```typescript
const guard: GuardComposition = {
  handler: 'core:and',
  config: {
    conditions: [
      {
        handler: 'core:for_each',
        config: {
          source: { entity: 'installed_rules', filter: { regulation: 'REACH' } },
          validation: { handler: 'core:evaluate_rule', config: {} },
          require: 'all'
        },
        label: 'All REACH rules pass'
      },
      {
        handler: 'core:presence_check',
        config: {
          source: { entity: 'approvals' },
          match: { field: 'role', operator: 'eq', value: 'regulatory_reviewer' },
          minimum_count: 1
        },
        label: 'Regulatory reviewer has approved'
      }
    ]
  }
};
```

### 11.3 Rules-as-Data Resolution

When a guard or schedule references `installed_rules`, the Kernel VM performs a deterministic resolution through the Identity Ladder and Compliance Lock:

```
Guard AST references:
  source: { entity: 'installed_rules', filter: { vertical: 'cosmetics' } }

        ↓ Identity Ladder resolves

Step 1: Compliance Lock lookup
  → tenant's compliance-lock.json lists installed packs:
    @eu/cosmetics-1223@2.1.0 (cid: bafybei...)
    @eu/reach-svhc@1.4.2 (cid: bafybei...)

Step 2: Scope filter
  → filter { vertical: 'cosmetics' } matches packs whose
    manifest.scope.verticals includes 'cosmetics'
  → @eu/cosmetics-1223@2.1.0 matches
  → @eu/reach-svhc@1.4.2 matches (scope includes cosmetics)

Step 3: Rule extraction
  → each pack's logic_root is dereferenced by CID
  → yields concrete Rule AST nodes with pinned versions

Step 4: Cascade ordering
  → rules are ordered by the Rule Cascade layers:
    System Base → Environment Pack → Regional → Local Policy

Result: deterministic, ordered list of Rule ASTs
  → same Compliance Lock + same product data = same evaluation
```

```typescript
// The VM's internal resolution (not an MCP tool -- internal to the executor)
interface InstalledRulesResolution {
  resolved_from: {
    compliance_lock_id: string;
    lock_timestamp: string;
  };
  packs_matched: Array<{
    pack_name: string;
    pack_version: string;
    pack_cid: string;
    rules_extracted: number;
    cascade_layer: 'system' | 'environment' | 'regional' | 'local';
  }>;
  total_rules: number;
  evaluation_order: string[];     // Rule IDs in cascade order
}
```

The execution trace for any guard that evaluates `installed_rules` includes the full resolution path -- which lock was active, which packs matched the scope filter, and which cascade layer each rule came from. An auditor can verify that the correct rules were evaluated without ambiguity.

### 11.4 Graph Persistence

Workflow state lives in the Graph as edges and properties on entity nodes:

```cypher
(:Product {id: "prod_123"})
    -[:IN_STATE {
        state: "under_review",
        entered_at: "2026-02-01T10:00:00Z",
        transition_id: "submit_for_review",
        transitioned_by: "user:alice",

        // Temporal handler state
        deadline_expires_at: "2026-03-03T10:00:00Z",
        next_scheduled_evaluation: "2026-05-01T10:00:00Z"
    }]->
    (:WorkflowState {
        workflow_id: "workflow:cosmetic_product_lifecycle",
        workflow_version: "1.0.0",
        state: "under_review"
    })
```

Every transition creates an immutable audit edge:

```cypher
(:Product {id: "prod_123"})
    -[:TRANSITIONED {
        from_state: "draft",
        to_state: "under_review",
        transition_id: "submit_for_review",
        triggered_by: "user:alice",
        timestamp: "2026-02-01T10:00:00Z",
        guard_trace_hash: "sha256:abc...",
        compliance_lock_id: "lock_442"
    }]->
    (:WorkflowState { state: "under_review" })
```

Every state transition is auditable -- the `guard_trace_hash` links back to the full handler execution trace, and the `compliance_lock_id` pins the exact workflow version and rule versions that were active.

### 11.5 Workflow in the Compliance Lock

The Compliance Lock pins workflows alongside rules. When a product transitions state, the lock records the exact workflow version, so auditors can replay the guard evaluation:

```json
{
  "evaluation_id": "eval_88231",
  "timestamp": "2026-03-15T10:00:00Z",
  "handler_vm_exact": "1.0.3-build.442",

  "workflows": {
    "workflow:cosmetic_product_lifecycle@1.0.0": {
      "cid": "bafybeigworkflow123...",
      "signature": "z4ABCde...",
      "publisher_did": "did:web:eurocomply.com"
    }
  },

  "packs": {
    "@eu/reach-svhc@1.4.2": { "cid": "bafybeihkoviema7g3gxyt6la7vd5ho32..." },
    "@eu/cosmetics-1223@2.1.0": { "cid": "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3..." }
  },

  "transition_record": {
    "entity": "product:prod_123",
    "transition": "approve_for_market",
    "from_state": "under_review",
    "to_state": "approved",
    "guard_trace_cid": "bafybeitrace456...",
    "all_rules_evaluated": [
      "REACH_ART33_SVHC@1.4.2",
      "COSMETICS_1223_ANNEX_II@2.1.0"
    ]
  }
}
```

### 11.6 MCP Tools

#### `meta:define_workflow`

```typescript
"meta:define_workflow": {
  input: {
    vertical_id: string,
    workflow: WorkflowDefinition,

    validation_dataset?: Array<{
      id: string;
      description: string;
      initial_state: string;
      transitions_to_test: Array<{
        transition_id: string;
        product_data: object;
        expected_result: 'allowed' | 'blocked';
        expected_guard_failures?: string[];
      }>;
    }>
  },
  output: {
    simulation_id: string,
    status: "pending_simulation" | "compiled" | "failed",
    compilation: {
      states_defined: number,
      transitions_defined: number,
      guards_validated: boolean,
      handlers_used: string[],
      temporal_handlers: number,
      ast_errors?: Array<{ path: string; error: string }>,
      hello_world_tests?: {
        transitions_tested: number,
        passed: number,
        failed: number,
        results: Array<{
          transition_id: string,
          input: object,
          expected: string,
          actual: string,
          guard_trace: ExecutionTrace
        }>
      }
    }
  }
}
```

#### `meta:transition`

The runtime tool for executing a state transition. This is what Applications call when a user clicks a button.

```typescript
"meta:transition": {
  input: {
    entity_type: string,
    entity_id: string,
    transition_id: string,
    context?: {
      comment?: string,
      attachments?: string[],
      override_reason?: string       // For admin overrides (logged, never silent)
    }
  },
  output: {
    success: boolean,
    previous_state: string,
    new_state: string,

    guard_results: {
      pass: boolean,
      results: ValidationResult[],
      first_failure?: {
        label: string,
        reason: string,
        remediation?: string
      }
    },

    effects_executed?: Array<{
      handler: string,
      status: 'completed' | 'failed' | 'queued',
      result?: HandlerResult<unknown>
    }>,

    events_emitted?: Array<{
      event_type: string,
      event_id: string
    }>,

    compliance_lock_id: string,
    transition_trace_hash: string
  }
}
```

#### `meta:get_workflow_state`

Query current state and available transitions for an entity.

```typescript
"meta:get_workflow_state": {
  input: {
    entity_type: string,
    entity_id: string,
    include?: {
      available_transitions?: boolean,
      guard_preview?: boolean,
      temporal_status?: boolean,
      transition_history?: boolean
    }
  },
  output: {
    workflow_id: string,
    workflow_version: string,
    current_state: string,
    entered_at: string,

    available_transitions?: Array<{
      transition_id: string,
      label: string,
      target_state: string,
      trigger: TransitionTrigger,
      ui_hints: object,
      guard_preview?: {
        would_pass: boolean,
        blockers?: Array<{ label: string; reason: string }>
      }
    }>,

    temporal_status?: {
      active_deadlines: Array<{
        deadline_id: string,
        expires_at: string,
        time_remaining: { value: number; unit: string },
        status: 'active' | 'warning' | 'expired'
      }>,
      next_scheduled_evaluation: string | null
    },

    transition_history?: Array<{
      from_state: string,
      to_state: string,
      transition_id: string,
      triggered_by: string,
      timestamp: string,
      guard_trace_hash: string
    }>
  }
}
```

### 11.7 End-to-End Example: Cosmetics Product Lifecycle

This example demonstrates an AI agent creating a complete product lifecycle workflow for the EU Cosmetics Regulation 1223/2009.

```typescript
await mcp.call('meta:define_workflow', {
  vertical_id: 'cosmetics',
  workflow: {
    id: 'workflow:cosmetic_product_lifecycle',
    version: '1.0.0',
    entity_type: 'cosmetic_product',
    vertical_id: 'cosmetics',
    initial_state: 'draft',
    terminal_states: ['on_market', 'withdrawn'],

    states: {
      'draft': {
        label: 'Draft',
        description: 'Product formulation in progress',
        on_enter: {
          handler: 'events:emit',
          config: { event_type: 'product.created', severity: 'info' }
        },
        transitions: [
          {
            id: 'submit_for_safety',
            target_state: 'safety_assessment',
            trigger: { type: 'manual', allowed_roles: ['CONTRIBUTOR', 'EDITOR', 'MANAGER'] },
            label: 'Submit for Safety Assessment',
            guards: {
              handler: 'core:and',
              config: {
                conditions: [
                  {
                    handler: 'core:completeness_check',
                    config: {
                      required_fields: [
                        { path: 'inci_listing', description: 'INCI ingredient list' },
                        { path: 'composition.substances', description: 'Full substance breakdown' },
                        { path: 'intended_use', description: 'Product intended use' }
                      ]
                    },
                    label: 'Formulation data complete'
                  },
                  {
                    handler: 'core:for_each',
                    config: {
                      source: { entity: 'cosmetic_product', path: 'composition.substances' },
                      validation: {
                        handler: 'core:absence_check',
                        config: {
                          prohibited: {
                            field: 'gsr_id',
                            operator: 'in',
                            value: { list_source: { type: 'context', context_key: 'cosmetics_annex_ii' } }
                          }
                        }
                      },
                      require: 'all'
                    },
                    label: 'No Annex II prohibited substances'
                  }
                ]
              }
            },
            effects: {
              handler: 'core:and',
              config: {
                conditions: [
                  {
                    handler: 'events:emit',
                    config: {
                      event_type: 'product.submitted_for_safety',
                      severity: 'medium',
                      recommended_action: 'Safety assessor should review within 30 days'
                    }
                  },
                  {
                    handler: 'a2a:request_claim',
                    config: {
                      to: { field: 'safety_assessor_did' },
                      request: {
                        claim_type: 'CosmeticSafetyAssessment',
                        about: { product_id: { field: 'id' } },
                        context: { why_needed: 'EU Cosmetics Regulation 1223/2009 Article 10' }
                      }
                    }
                  }
                ]
              }
            },
            ui_hints: {
              button_style: 'primary',
              confirm_message: 'This will send the formulation to the safety assessor. Continue?'
            }
          }
        ],
        ui_hints: { color: '#94a3b8', icon: 'pencil', show_in_board: true }
      },

      'safety_assessment': {
        label: 'Safety Assessment',
        description: 'Awaiting safety assessor review per Article 10',
        transitions: [
          {
            id: 'safety_approved',
            target_state: 'regulatory_review',
            trigger: {
              type: 'event',
              event_type: 'claim.received',
              filter: { claim_type: 'CosmeticSafetyAssessment', status: 'compliant' }
            },
            label: 'Safety Assessment Passed',
            guards: {
              handler: 'core:credential_check',
              config: {
                credential: { field: 'received_safety_credential' },
                checks: {
                  signature: true,
                  expiration: true,
                  issuer: { issuer_type: ['qualified_safety_assessor'] }
                }
              }
            },
            effects: {
              handler: 'events:emit',
              config: { event_type: 'product.safety_cleared', severity: 'info' }
            }
          },
          {
            id: 'safety_rejected',
            target_state: 'draft',
            trigger: {
              type: 'event',
              event_type: 'claim.received',
              filter: { claim_type: 'CosmeticSafetyAssessment', status: 'non_compliant' }
            },
            label: 'Safety Assessment Failed',
            guards: {
              handler: 'core:presence_check',
              config: {
                source: { entity: 'claims' },
                match: { field: 'claim_type', operator: 'eq', value: 'CosmeticSafetyAssessment' }
              }
            },
            effects: {
              handler: 'events:emit',
              config: {
                event_type: 'product.safety_failed',
                severity: 'high',
                recommended_action: 'Reformulate and resubmit'
              }
            }
          },
          {
            id: 'safety_deadline_expired',
            target_state: 'draft',
            trigger: { type: 'deadline_expired', deadline_id: 'safety_review_deadline' },
            label: 'Review Deadline Expired',
            guards: {
              handler: 'core:deadline',
              config: {
                condition: {
                  handler: 'core:presence_check',
                  config: {
                    source: { entity: 'approvals' },
                    match: { field: 'type', operator: 'eq', value: 'safety_assessment' }
                  }
                },
                window: { duration: { value: 30, unit: 'days' }, started_at: { field: 'state_entered_at' } },
                on_expired: 'auto_transition',
                escalation: { notify_roles: ['MANAGER'], emit_event: 'product.safety_review_overdue' }
              }
            }
          }
        ],
        ui_hints: { color: '#f59e0b', icon: 'shield-check', show_in_board: true }
      },

      'regulatory_review': {
        label: 'Regulatory Review',
        description: 'Internal regulatory affairs review before CPNP notification',
        transitions: [
          {
            id: 'approve_for_market',
            target_state: 'on_market',
            trigger: { type: 'manual', allowed_roles: ['EDITOR', 'MANAGER'] },
            label: 'Approve for Market',
            guards: {
              handler: 'core:and',
              config: {
                conditions: [
                  {
                    handler: 'core:for_each',
                    config: {
                      source: { entity: 'installed_rules', filter: { vertical: 'cosmetics' } },
                      validation: { handler: 'core:evaluate_rule', config: {} },
                      require: 'all'
                    },
                    label: 'All cosmetics rules pass'
                  },
                  {
                    handler: 'core:document_check',
                    config: {
                      required_documents: [
                        { type: 'safety_assessment_report', must_be_current: true },
                        { type: 'cpnp_notification', must_be_current: true },
                        { type: 'product_label_proof', must_be_current: true }
                      ]
                    },
                    label: 'All required documents present'
                  }
                ]
              }
            },
            effects: {
              handler: 'core:and',
              config: {
                conditions: [
                  {
                    handler: 'events:emit',
                    config: { event_type: 'product.approved_for_market', severity: 'info' }
                  },
                  {
                    handler: 'a2a:issue_claim',
                    config: {
                      subject: { product_id: { field: 'id' } },
                      claim_type: 'CosmeticsRegulation1223Compliance',
                      claim_data: { status: 'compliant', regulation: 'EU_1223_2009' }
                    }
                  }
                ]
              }
            },
            ui_hints: {
              button_style: 'primary',
              confirm_message: 'This will mark the product as market-ready and issue a compliance credential. Continue?',
              required_comment: true
            }
          }
        ],
        ui_hints: { color: '#3b82f6', icon: 'clipboard-check', show_in_board: true }
      },

      'on_market': {
        label: 'On Market',
        description: 'Product is authorized for sale in the EU',
        on_enter: {
          handler: 'a2a:issue_claim',
          config: {
            subject: { product_id: { field: 'id' } },
            claim_type: 'MarketPlacementDeclaration',
            claim_data: { market: 'EU', regulation: 'EU_1223_2009' }
          }
        },
        transitions: [
          {
            id: 'withdraw',
            target_state: 'withdrawn',
            trigger: { type: 'manual', allowed_roles: ['MANAGER'] },
            label: 'Withdraw from Market',
            guards: {
              handler: 'core:presence_check',
              config: {
                source: { entity: 'context' },
                match: { field: 'comment', operator: 'ne', value: '' },
                item_description: 'Withdrawal reason'
              }
            },
            effects: {
              handler: 'core:and',
              config: {
                conditions: [
                  {
                    handler: 'a2a:revoke_claim',
                    config: {
                      claim_type: 'MarketPlacementDeclaration',
                      subject: { product_id: { field: 'id' } }
                    }
                  },
                  {
                    handler: 'events:emit',
                    config: { event_type: 'product.withdrawn', severity: 'high' }
                  }
                ]
              }
            },
            ui_hints: {
              button_style: 'danger',
              confirm_message: 'This will revoke the market placement credential. Continue?',
              required_comment: true
            }
          },
          {
            id: 'rule_change_triggers_review',
            target_state: 'regulatory_review',
            trigger: { type: 'rule_change', rule_ids: ['COSMETICS_*'] },
            label: 'Re-review Required (Rule Change)',
            guards: {
              handler: 'core:not',
              config: {
                condition: {
                  handler: 'core:for_each',
                  config: {
                    source: { entity: 'installed_rules', filter: { vertical: 'cosmetics' } },
                    validation: { handler: 'core:evaluate_rule', config: {} },
                    require: 'all'
                  }
                }
              }
            },
            effects: {
              handler: 'events:emit',
              config: {
                event_type: 'product.compliance_invalidated',
                severity: 'critical',
                recommended_action: 'Product must be re-evaluated against updated rules'
              }
            }
          },
          {
            id: 'supplier_claim_revoked',
            target_state: 'regulatory_review',
            trigger: {
              type: 'claim_updated',
              claim_types: ['REACHCompliance', 'CosmeticSafetyAssessment', 'SVHCFree'],
              change: 'revoked',
              source_filter: { relationship: 'direct_supplier' }
            },
            label: 'Supplier Credential Revoked',
            guards: {
              handler: 'core:presence_check',
              config: {
                source: { entity: 'upstream_claims' },
                match: { field: 'status', operator: 'eq', value: 'revoked' },
                item_description: 'Revoked upstream credential'
              }
            },
            effects: {
              handler: 'core:and',
              config: {
                conditions: [
                  {
                    handler: 'events:emit',
                    config: {
                      event_type: 'product.upstream_claim_revoked',
                      severity: 'critical',
                      recommended_action: 'Request updated credential from supplier or reformulate'
                    }
                  },
                  {
                    handler: 'a2a:request_claim',
                    config: {
                      to: { field: 'revoked_claim.issuer_did' },
                      request: {
                        claim_type: { field: 'revoked_claim.claim_type' },
                        context: { why_needed: 'Previous credential was revoked' }
                      }
                    }
                  }
                ]
              }
            }
          }
        ],
        ui_hints: { color: '#22c55e', icon: 'check-circle', show_in_board: true }
      },

      'withdrawn': {
        label: 'Withdrawn',
        description: 'Product removed from market',
        transitions: [],
        ui_hints: { color: '#ef4444', icon: 'x-circle', show_in_board: false }
      }
    },

    temporal: {
      deadlines: [
        {
          state: 'safety_assessment',
          handler: 'core:deadline',
          config: {
            condition: {
              handler: 'core:presence_check',
              config: {
                source: { entity: 'approvals' },
                match: { field: 'type', operator: 'eq', value: 'safety_assessment' }
              }
            },
            window: { duration: { value: 30, unit: 'days' }, started_at: { field: 'state_entered_at' } },
            on_expired: 'auto_transition',
            escalation: { notify_roles: ['MANAGER'], emit_event: 'product.safety_review_overdue' }
          }
        }
      ],
      schedules: [
        {
          applies_to: ['on_market'],
          handler: 'core:schedule',
          config: {
            frequency: { every: { value: 90, unit: 'days' } },
            evaluation: {
              handler: 'core:for_each',
              config: {
                source: { entity: 'installed_rules', filter: { vertical: 'cosmetics' } },
                validation: { handler: 'core:evaluate_rule', config: {} },
                require: 'all'
              }
            }
          }
        }
      ]
    }
  }
});
```

---

## 12. MCP Tool Interface

The Kernel VM handlers and Platform Services tools are exposed via **MCP (Model Context Protocol)** as the Universal Interface. All tools use the namespace convention defined in the Platform Services Layer design (`entity:`, `relation:`, `meta:`, `ai:`, `a2a:`, `registry:`, etc.).

### 12.1 MCP Tool Categories

```typescript
// MCP exposes tools grouped by namespace (see Platform Services Layer design)
const mcpTools = {
  // ENTITY - working with products, materials, substances
  'entity:create': { /* create entity */ },
  'entity:read': { /* read product/material data */ },
  'entity:update': { /* modify material */ },
  'entity:list': { /* list entities with filters */ },

  // RELATION - graph operations
  'relation:create': { /* create graph relationship */ },
  'relation:list': { /* query relations */ },

  // AI - intelligence tools (delegated to Platform Services LLM Gateway)
  'ai:gap_analysis': { /* identify compliance gaps */ },
  'ai:interpret': { /* interpret text */ },
  'ai:explain': { /* explain decisions in plain language */ },
  'ai:document_extract': { /* extract structured data from documents */ },

  // META - programming the platform (requires Simulator approval)
  'meta:create_rule': { /* compose handlers into rule */ },
  'meta:create_vertical': { /* define new vertical */ },
  'meta:define_workspace': { /* configure workspace */ },

  // A2A - cross-company protocol
  'a2a:request_claim': { /* A2A credential exchange */ },
  'a2a:issue_claim': { /* publish compliance claim */ },

  // REGISTRY - pack management
  'registry:install': { /* install pack on spoke */ },
  'registry:compile': { /* validate and compile rule AST */ },
};
```

### 12.2 META vs OPS Changes

| Change Type | Examples | Approval Required |
|-------------|----------|-------------------|
| **META** | Create vertical, define rule, modify schema | Full Simulator approval |
| **OPS** | Update product, add material, run evaluation | Auto-approve if within rules |

---

## 13. The Simulator

The Simulator provides **human-in-the-loop safety** for META changes.

### 13.1 Simulator Flow

```
AI Agent proposes META change (e.g., new rule)
        ↓
┌─────────────────────────────────┐
│         SIMULATOR               │
├─────────────────────────────────┤
│ 1. Shadow Schema                │  ← Copy current state
│ 2. Apply Proposed Change        │  ← In shadow only
│ 3. Run Validation Dataset       │  ← Known products/scenarios
│ 4. Generate Diff Report         │  ← What changed?
│ 5. Risk Assessment              │  ← Impact analysis
└─────────────────────────────────┘
        ↓
Human Reviews Diff Report
        ↓
APPROVE → Apply to Production
REJECT  → Discard, AI learns why
```

### 13.2 Diff Report Contents

```typescript
interface SimulatorDiffReport {
  proposed_change: {
    type: 'rule' | 'vertical' | 'workspace' | 'handler_config';
    description: string;
    proposed_by: string;           // AI agent ID
  };

  validation_results: {
    products_tested: number;
    status_changes: Array<{
      product_id: string;
      product_name: string;
      before: 'compliant' | 'non_compliant' | 'unknown';
      after: 'compliant' | 'non_compliant' | 'unknown';
      reason: string;
    }>;
  };

  impact_assessment: {
    products_newly_non_compliant: number;
    products_newly_compliant: number;
    false_positive_risk: 'low' | 'medium' | 'high';
    false_negative_risk: 'low' | 'medium' | 'high';
  };

  recommendation: 'approve' | 'review_carefully' | 'reject';
  recommendation_reason: string;
}
```

### 13.3 Validation Dataset

Each vertical maintains a validation dataset:

```typescript
interface ValidationDataset {
  vertical_id: string;

  test_cases: Array<{
    id: string;
    description: string;
    product_data: object;          // Synthetic or anonymized real data
    expected_status: 'compliant' | 'non_compliant';
    expected_reasons?: string[];
    edge_case_type?: string;       // 'boundary', 'exemption', 'multi-rule'
  }>;

  coverage: {
    rules_covered: string[];
    scenarios_covered: string[];
  };
}
```

---

## 14. Implementation Plan

### Phase 1: Core Infrastructure (Week 1)

1. Handler base interfaces and types
2. Explanation/Trace system
3. Handler registry
4. Unit test framework for handlers

### Phase 2: Computation Handlers (Week 1)

1. `core:collection_sum`, `core:collection_max`, `core:collection_min`
2. `core:bom_weighted` (critical)
3. `core:count`, `core:rollup`, `core:average`, `core:ratio`
4. `core:unit_convert`

### Phase 3: Validation Handlers (Week 2)

1. `core:threshold_check`, `core:presence_check`, `core:absence_check`
2. `core:list_check`, `core:date_check`
3. `core:document_check`, `core:credential_check`
4. `core:enum_check`, `core:pattern_check`, `core:completeness_check`

### Phase 4: Logic Gates (Week 2)

1. `core:and`, `core:or`, `core:not`
2. `core:if_then`, `core:for_each`
3. Composition tests (complex rule scenarios)

### Phase 5: Graph Handlers (Week 3)

1. In-memory graph data structures for ExecutionContext (Platform Services pre-loads from Neo4j)
2. `core:trace_upstream`, `core:trace_downstream`
3. `core:find_path`, `core:impact_analysis`
4. `core:subgraph_extract`, `core:shortest_path`, `core:neighbors`, `core:cycle_detect`

### Phase 6: Resolution Handlers (Week 3)

1. `core:data_conflict_resolve`, `core:entity_match`
2. `core:find_substitute`, `core:rule_resolve`
3. `core:priority_rank`, `core:version_select`
4. `core:threshold_interpolate`, `core:action_sequence`

### Phase 7: AI Handlers (Week 4)

1. LLM integration infrastructure
2. `ai:document_extract`, `ai:classify`
3. `ai:interpret`, `ai:gap_analysis`
4. `ai:natural_query`, `ai:document_generate`
5. `ai:anomaly_detect`, `ai:explain`

### Phase 8: Temporal Handlers (Week 4)

1. `core:deadline` - time-window enforcement
2. `core:schedule` - recurring evaluation triggers
3. Graph persistence for temporal state (`:IN_STATE` edge properties)
4. Scheduler service for polling due evaluations

### Phase 9: Workflow Primitive (Week 4-5)

1. Workflow AST specification and validator
2. `meta:define_workflow` MCP tool
3. `meta:transition` MCP tool with guard evaluation
4. `meta:get_workflow_state` MCP tool with guard preview
5. Graph persistence (`:IN_STATE`, `:TRANSITIONED` edges)
6. Workflow integration with Compliance Lock
7. Rules-as-Data resolution via Identity Ladder

### Phase 10: MCP & Simulator (Week 5-6)

1. MCP tool definitions
2. Simulator shadow schema
3. Validation dataset infrastructure
4. Diff report generation
5. Human approval workflow

---

## Appendix A: Complete Handler Reference

| ID | Category | Purpose |
|----|----------|---------|
| `core:collection_sum` | Computation | Sum field across collection |
| `core:collection_max` | Computation | Find maximum value |
| `core:collection_min` | Computation | Find minimum value |
| `core:bom_weighted` | Computation | Cascading weighted calculation |
| `core:count` | Computation | Count items matching criteria |
| `core:rollup` | Computation | Aggregate children to parent |
| `core:average` | Computation | Calculate mean |
| `core:ratio` | Computation | Calculate ratio |
| `core:unit_convert` | Computation | Convert between units |
| `core:threshold_check` | Validation | Compare against limit |
| `core:presence_check` | Validation | Verify item exists |
| `core:absence_check` | Validation | Verify item NOT present |
| `core:list_check` | Validation | Check against reference list |
| `core:date_check` | Validation | Validate dates |
| `core:document_check` | Validation | Verify attachments |
| `core:credential_check` | Validation | Validate VCs |
| `core:enum_check` | Validation | Value in allowed set |
| `core:pattern_check` | Validation | Format validation |
| `core:completeness_check` | Validation | All fields populated |
| `core:and` | Logic | All conditions pass |
| `core:or` | Logic | At least one passes |
| `core:not` | Logic | Invert result |
| `core:if_then` | Logic | Conditional validation |
| `core:for_each` | Logic | Apply to collection |
| `core:pipe` | Logic | Sequential handler chain |
| `core:evaluate_rule` | Logic | Evaluate installed rule AST |
| `core:trace_upstream` | Graph | Trace to origins |
| `core:trace_downstream` | Graph | Find all affected |
| `core:find_path` | Graph | Find compliance path |
| `core:subgraph_extract` | Graph | Extract for analysis |
| `core:impact_analysis` | Graph | Cascading change impact |
| `core:shortest_path` | Graph | Simple path finding |
| `core:neighbors` | Graph | Immediate connections |
| `core:cycle_detect` | Graph | Find circular refs |
| `core:data_conflict_resolve` | Resolution | Choose between conflicts |
| `core:find_substitute` | Resolution | Find replacements |
| `core:rule_resolve` | Resolution | Resolve rule conflicts |
| `core:priority_rank` | Resolution | Rank by criteria |
| `core:entity_match` | Resolution | Match/deduplicate |
| `core:version_select` | Resolution | Select version |
| `core:threshold_interpolate` | Resolution | Calculate between points |
| `core:action_sequence` | Resolution | Optimal ordering |
| `core:deadline` | Temporal | Enforce time-window conditions |
| `core:schedule` | Temporal | Recurring evaluation triggers |
| `ai:document_extract` | AI | Extract from documents |
| `ai:interpret` | AI | Interpret text |
| `ai:gap_analysis` | AI | Identify gaps |
| `ai:query` | AI | Answer questions |
| `ai:document_generate` | AI | Generate documents |
| `ai:classify` | AI | Classify categories |
| `ai:anomaly_detect` | AI | Find patterns |
| `ai:score` | AI | Score entity by weighted factors |
| `ai:explain` | AI | Generate explanations |

---

## Appendix B: Example Rule Composition

### REACH Article 33: SVHC Communication Obligation

```typescript
const reachArticle33Rule = {
  id: 'REACH_ART33_SVHC',
  name: 'REACH Article 33 SVHC Communication',
  vertical_id: 'chemicals',
  regulation_id: 'REACH',

  logic: {
    handler: 'core:for_each',
    config: {
      source: {
        entity: 'materials',
        path: 'substances',
        filter: { field: 'on_svhc_list', operator: 'eq', value: true }
      },
      validation: {
        handler: 'core:or',
        config: {
          conditions: [
            // Path A: Below threshold
            {
              handler: 'core:threshold_check',
              config: {
                value: { handler: 'core:bom_weighted', config: { /* ... */ } },
                operator: 'lt',
                threshold: 0.001
              },
              label: 'Concentration below 0.1% w/w'
            },
            // Path B: Above threshold but obligations met
            {
              handler: 'core:and',
              config: {
                conditions: [
                  {
                    handler: 'core:document_check',
                    config: { required_documents: [{ type: 'echa_scip_notification' }] },
                    label: 'SCIP notification submitted'
                  },
                  {
                    handler: 'core:completeness_check',
                    config: {
                      required_fields: [{ path: 'svhc_safety_info', description: 'SVHC safety info' }]
                    },
                    label: 'Customer safety info provided'
                  }
                ]
              },
              label: 'Communication obligations met'
            }
          ]
        }
      },
      require: 'all'
    }
  }
};
```

---

## Appendix C: Technology Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| **API Gateway** | Hono (Node.js) | REST/GraphQL endpoints |
| **MCP Server** | `@modelcontextprotocol/server` | **Exposes ~53 handlers as AI-callable tools** |
| **ORM** | MikroORM | PostgreSQL entity management |
| **Relational DB** | PostgreSQL 15 | GSR + Tenant data |
| **Graph DB** | Neo4j 5.x | Compliance knowledge graph |
| **Vector Store** | pgvector | AI embeddings, semantic search |
| **Auth** | Clerk | User authentication |
| **File Storage** | Cloudflare R2 | Document storage |
| **Event Bus** | Unified Event System | Internal events (events:*) + A2A events (a2a:*) |
| **Credentials** | walt.id | Verifiable Credential signing |
| **LLM** | Claude API | AI handler execution |

### MCP Server Architecture

The MCP Server is what makes the platform **programmable**. It exposes all handlers as tools that AI agents can discover and invoke.

```typescript
// apps/spoke-runtime/src/mcp-server.ts
import { McpServer } from '@modelcontextprotocol/server';
import { handlerRegistry } from '@eurocomply-os/kernel-vm';
import { platformServices } from '@eurocomply-os/platform-services';

const server = new McpServer({
  name: 'eurocomply-os',
  version: '1.0.0',
});

// Register kernel-vm handlers as MCP tools (namespaced by category)
for (const handler of handlerRegistry.getAll()) {
  server.tool({
    name: handler.id,  // e.g., 'core:collection_sum', 'core:threshold_check'
    description: handler.description,
    inputSchema: handler.configSchema,

    async execute(config) {
      // Platform Services assembles ExecutionContext (loads data, resolves graph)
      const context = await platformServices.buildContext(handler.id, config);

      // meta:* tools (create_vertical, create_rule, define_workflow, etc.) are NOT
      // pure computation -- they're platform programming tools whose contracts live
      // in the Kernel VM but whose execution creates state. Route through the
      // Simulator for shadow testing and human approval before persisting.
      if (handler.category === 'meta') {
        return await platformServices.simulator.propose(handler.id, config, context);
      }

      // kernel-vm executes synchronously (pure computation)
      const result = handler.execute(config, config.input, context);

      // Platform Services persists result
      await platformServices.persistResult(result);
      return result;
    }
  });
}

// Also register Platform Services tools (entity:*, relation:*, ai:*, etc.)
platformServices.registerMcpTools(server);

// AI agents connect via HTTP+SSE (network) or stdio (local CLI)
server.listen({ port: 3002, transport: 'sse' });
```

### Tool Discovery

AI agents discover available tools via MCP's standard discovery protocol:

```typescript
// What the AI agent sees when connecting
const tools = await mcpClient.listTools();
// Returns:
// [
//   { name: 'core:collection_sum', description: 'Sum field across collection', inputSchema: {...} },
//   { name: 'core:threshold_check', description: 'Compare value against limit', inputSchema: {...} },
//   { name: 'entity:create', description: 'Create entity', inputSchema: {...} },
//   { name: 'meta:create_vertical', description: 'Create new industry vertical', inputSchema: {...} },
//   { name: 'ai:gap_analysis', description: 'Identify compliance gaps', inputSchema: {...} },
//   ... ~143 total tools (kernel-vm handlers + Platform Services tools)
// ]
```

---

## Appendix D: Rule Logic AST Specification

The `rules.logic` field contains an **Abstract Syntax Tree (AST)** that defines the compliance check as a composable program.

### AST Node Types

Every AST node has this structure:

```typescript
interface ASTNode {
  handler: string;           // Handler ID: "core:threshold_check", "core:and", etc.
  config: Record<string, unknown>;  // Handler-specific configuration
  label?: string;            // Human-readable label for explanations
}
```

### Composition Patterns

**1. Single Handler (Leaf Node)**

```json
{
  "handler": "core:threshold_check",
  "config": {
    "value": { "field": "concentration" },
    "operator": "lt",
    "threshold": 0.001
  },
  "label": "Concentration below 0.1%"
}
```

**2. Handler Chain (Sequential Execution)**

```json
{
  "handler": "core:pipe",
  "config": {
    "steps": [
      {
        "handler": "core:bom_weighted",
        "config": { "source": { "entity": "materials" }, "value_field": "concentration" }
      },
      {
        "handler": "core:unit_convert",
        "config": { "target_unit": "PPM" }
      },
      {
        "handler": "core:threshold_check",
        "config": { "operator": "lt", "threshold": 1000 }
      }
    ]
  }
}
```

**3. Handler Tree (Conditional Logic)**

```json
{
  "handler": "core:or",
  "config": {
    "conditions": [
      {
        "handler": "core:absence_check",
        "config": { "prohibited": { "field": "cas", "value": "50-00-0" } },
        "label": "Substance not present"
      },
      {
        "handler": "core:and",
        "config": {
          "conditions": [
            {
              "handler": "core:threshold_check",
              "config": { "value": { "field": "concentration" }, "operator": "lt", "threshold": 0.001 },
              "label": "Below threshold"
            },
            {
              "handler": "core:credential_check",
              "config": { "checks": { "schema": { "required_type": "ExemptionCredential" } } },
              "label": "Has exemption"
            }
          ]
        },
        "label": "Threshold + Exemption path"
      }
    ]
  }
}
```

**4. Collection Iteration**

```json
{
  "handler": "core:for_each",
  "config": {
    "source": { "entity": "materials", "path": "substances" },
    "validation": {
      "handler": "core:list_check",
      "config": { "list_type": "negative", "list_source": { "type": "context", "context_key": "svhc_substances" } }
    },
    "require": "all"
  }
}
```

### AST Execution Model

```
┌─────────────────────────────────────────────────────────────┐
│                    AST EXECUTOR                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. Parse AST root node                                     │
│  2. Resolve handler from registry                           │
│  3. If handler is composition (and/or/for_each/pipe):       │
│     a. Recursively execute child AST nodes                  │
│     b. Aggregate results per handler semantics              │
│  4. If handler is leaf (threshold_check/list_check/etc):    │
│     a. Execute handler with config                          │
│     b. Return ValidationResult                              │
│  5. Build explanation chain from all executed handlers      │
│  6. Return final result with full trace                     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Type Safety

The AST is validated at compile time (seeding) and runtime:

```typescript
// packages/handlers/src/ast/validator.ts
interface ASTValidationResult {
  valid: boolean;
  errors: Array<{
    path: string;           // JSON path to error: "config.conditions[0].handler"
    error: string;          // "Unknown handler: core:invalid"
    suggestion?: string;    // "Did you mean core:threshold_check?"
  }>;
  handlers_used: string[];  // For dependency tracking
  estimated_complexity: number;  // For execution planning
}

function validateAST(ast: ASTNode): ASTValidationResult {
  // 1. Verify handler exists in registry
  // 2. Validate config against handler's configSchema
  // 3. Recursively validate nested AST nodes
  // 4. Check for circular references
  // 5. Estimate execution complexity
}
```

---

**Document Control**

| Version | Date | Changes |
|---------|------|---------|
| 0.1 | 2026-02-02 | Initial design from brainstorming session |
| 0.2 | 2026-02-02 | Added AI-Programmable Platform section |
| 0.3 | 2026-02-02 | Added MCP Server to tech stack, Rule Logic AST spec |
| 0.4 | 2026-02-03 | Added Temporal Handlers (core:deadline, core:schedule), Workflow Primitive (meta:define_workflow, meta:transition, meta:get_workflow_state), Rules-as-Data resolution via Identity Ladder |
| 0.5 | 2026-02-03 | Added `claim_updated` TransitionTrigger for A2A upstream data changes, supplier credential revocation example in cosmetics lifecycle |

---

*This document is part of the EuroComply Compliance OS design series:*
- ***Kernel VM Design (this document) -- The compute half of the Kernel***
- *[Compliance Network Design](./2026-02-02-compliance-network-design.md) -- A2A Protocol (System Services)*
- *[Registry Design](./2026-02-03-registry-design.md) -- Package management (System Services)*
- *[Platform Services Layer](./2026-02-03-platform-services-layer.md) -- The state half of the Kernel*
- *[Infrastructure Design](./2026-02-03-infrastructure-design.md) -- Hub & Spoke deployment model*

---

*The Kernel VM transforms EuroComply from a "compliance checking tool" into an "AI-Programmable Compliance Operating System" - where AI agents can safely program regulatory logic while humans maintain oversight through the Simulator.*
