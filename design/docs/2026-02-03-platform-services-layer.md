# Platform Services Layer

> **Status:** DRAFT
> **Created:** 2026-02-03
> **Authors:** Human + Claude (Brainstorming Session)
> **Depends On:** [Kernel VM Design](./2026-02-02-compliance-handler-vm.md) (peer Kernel component), [Compliance Network Design](./2026-02-02-compliance-network-design.md) (unified event system), [Registry Design](./2026-02-03-registry-design.md) (Simulator integration)

---

## Executive Summary

The Platform Services Layer is the **stateful half of the EuroComply Kernel**. While the Kernel VM provides pure, deterministic compliance computation, Platform Services provides the state management primitives that every application, pack, and agent requires: entity CRUD, file storage, search, permissions, tasks, notifications, and more.

Together, Kernel VM and Platform Services form the Kernel of the Compliance OS. They are co-equal peers with a bidirectional dependency: handlers read entity data through the execution context; platform services trigger handlers for validation and computed fields.

### The Corrected Architecture

The architecture uses a **ring model** inspired by real operating system design:

```
┌───────────────────────────────────────────────────────────────┐
│                       APPLICATIONS                            │
│   Compliance Cockpit, Supplier Portal, AI Agent Interfaces    │
├───────────────────────────────────────────────────────────────┤
│                     SYSTEM SERVICES                           │
│   ┌─────────────────────┐    ┌─────────────────────────┐     │
│   │      Registry       │    │     A2A Protocol        │     │
│   │  (Package Mgmt,     │    │  (Identity, Claims,     │     │
│   │   Marketplace,      │    │   Requests, Evidence,   │     │
│   │   Simulator)        │    │   Subscriptions)        │     │
│   └─────────────────────┘    └─────────────────────────┘     │
├───────────────────────────────────────────────────────────────┤
│                         KERNEL                                │
│   ┌─────────────────┐        ┌─────────────────────────┐     │
│   │   Kernel VM    │◄──────►│   Platform Services     │     │
│   │   (Compute)     │        │   (State)               │     │
│   │                 │        │                         │     │
│   │   ~53 pure,     │        │   Entity CRUD, Files,   │     │
│   │   deterministic │        │   Search, Permissions,  │     │
│   │   primitives    │        │   Tasks, Audit, Jobs    │     │
│   └─────────────────┘        └─────────────────────────┘     │
├───────────────────────────────────────────────────────────────┤
│                     INFRASTRUCTURE                            │
│   PostgreSQL    Neo4j    Cloudflare R2    LLM Gateway         │
└───────────────────────────────────────────────────────────────┘
```

### Why This Architecture

**Kernel VM and Platform Services are peers, not stacked:**
- Kernel VM needs Platform Services: handlers read entity data via `ExecutionContext`
- Platform Services needs Kernel VM: computed fields, validation-on-write, workflow guards
- This bidirectional dependency means neither is "above" the other

**Registry and A2A are peer System Services:**
- Both orchestrate the Kernel -- Registry manages packages, A2A manages cross-company protocol
- Neither depends on the other in a way that implies hierarchy
- Both depend on the Kernel (Kernel VM for evaluation, Platform Services for storage)

**Infrastructure is surfaced explicitly:**
- PostgreSQL, Neo4j, R2, and LLM providers are real systems requiring configuration and monitoring
- Previous designs hid them inside Layer 0, creating ambiguity about what the Kernel VM actually owns

### Core Principle

```
Platform Services is to EuroComply what syscalls are to an operating system.

- Platform Services = Syscalls (open, read, write, mkdir, chmod)
- Kernel VM = CPU instructions (ADD, MOV, CMP)
- Together they form the KERNEL
- Packs are PROGRAMS that call both
- AI Agents are PROGRAMMERS that orchestrate both
- The REGISTRY is the Package Manager
- APPLICATIONS are the User Interface
```

### Kernel vs. Driver: What Ships Built-in

Platform Services are **Kernel primitives** -- they ship with the platform binary. You cannot "uninstall" the ability to create an entity or upload a file, just as you cannot uninstall `open()` or `write()` from Linux.

Complex, opinionated, or vendor-specific capabilities are **Driver Packs** -- installable from the Registry.

| | **Kernel (Platform Services)** | **Driver Packs** |
|---|---|---|
| **Examples** | `entity:create`, `file:upload`, `search:query` | `@connectors/sap-sync`, `@services/dpp-generator` |
| **Delivery** | Ships with EuroComply instance | Installed from Registry |
| **Versioning** | Tied to OS version (e.g., 2.0.3), which includes both Kernel VM and Platform Services | Tied to pack version (e.g., 1.0.4) |
| **Compliance Lock** | Pinned as `handler_vm_exact` (the Kernel VM build determines computation results) | Recorded as `packs` with CID |
| **Can be uninstalled?** | No | Yes |
| **OS Analogy** | Syscalls | Applications |

---

## Table of Contents

1. [Architecture & Contracts](#1-architecture--contracts)
2. [MCP Namespace Convention](#2-mcp-namespace-convention)
3. [Tier 1: Entity Management](#3-tier-1-entity-management)
4. [Tier 1: Relations & Graph Structure](#4-tier-1-relations--graph-structure)
5. [Tier 1: Search & Discovery](#5-tier-1-search--discovery)
6. [Tier 1: Permissions & Access Control](#6-tier-1-permissions--access-control)
7. [Tier 1: File Management](#7-tier-1-file-management)
8. [Tier 2: Version Control & History](#8-tier-2-version-control--history)
9. [Tier 2: Tasks & Assignments](#9-tier-2-tasks--assignments)
10. [Tier 2: Comments & Collaboration](#10-tier-2-comments--collaboration)
11. [Tier 2: Notifications](#11-tier-2-notifications)
12. [Tier 2: Audit Log](#12-tier-2-audit-log)
13. [Tier 2: Jobs & Background Processing](#13-tier-2-jobs--background-processing)
14. [Tier 2: Templates & Cloning](#14-tier-2-templates--cloning)
15. [Tier 2: Localization (i18n Engine)](#15-tier-2-localization-i18n-engine)
16. [Tier 2: AI Runtime](#16-tier-2-ai-runtime)
17. [Tier 2: Generative UI](#17-tier-2-generative-ui)
18. [Tier 2: Events](#18-tier-2-events)
19. [The Bridge: How Handlers Reach Platform Services](#19-the-bridge-how-handlers-reach-platform-services)
20. [Kernel Service Summary](#20-kernel-service-summary)

---

## 1. Architecture & Contracts

### 1.1 Platform Service Contract

Unlike Kernel VM primitives (which are pure functions), Platform Services are **stateful operations with side effects**. They have a different contract:

```typescript
interface PlatformService<TInput, TOutput> {
  readonly id: string;                    // e.g., "entity:create"
  readonly category: ServiceCategory;
  readonly inputSchema: JsonSchema;
  readonly outputSchema: JsonSchema;

  execute(
    input: TInput,
    context: ServiceContext
  ): Promise<ServiceResult<TOutput>>;
}

interface ServiceContext {
  tenant_id: string;                      // Multi-tenant isolation
  principal: Principal;                   // Who is calling (user, agent, handler effect)
  correlation_id: string;                 // Request tracing
  em: EntityManager;                      // Database access (forked per tenant)
}

interface ServiceResult<T> {
  success: boolean;
  data: T;
  audit_entry?: AuditEntry;              // Every mutation is auditable
  events_emitted?: string[];              // Side effects that occurred
}
```

### 1.2 Key Differences from Kernel VM

| Property | Kernel VM | Platform Services |
|----------|-----------|-------------------|
| **Pure function** | Yes -- same input, same output | No -- depends on database state |
| **Side effects** | None | Yes -- writes to DB, emits events, sends notifications |
| **In Compliance Lock** | Yes -- pinned version with CID | No -- platform version only |
| **Deterministic replay** | Yes | No |
| **Execution trace** | Full trace with explanation | Audit log entry |
| **Composable via AST** | Yes -- Logic Packs compose handlers | No -- called directly by agents or effects |
| **Stateless** | Yes | No -- reads/writes persistent state |
| **Schema** | Config + Input + Output | Input + Output (no config -- services are singletons) |

### 1.3 The Bidirectional Bridge

```
┌─────────────────────────────────────────────────────────┐
│                        KERNEL                            │
│                                                          │
│  Kernel VM                    Platform Services         │
│  ┌──────────────┐              ┌──────────────────┐     │
│  │              │   context    │                  │     │
│  │  core:       │──────────►  │  entity:read     │     │
│  │  threshold   │   reads     │  (get entity     │     │
│  │  _check      │   entity    │   data for       │     │
│  │              │   data      │   evaluation)    │     │
│  └──────────────┘              └──────────────────┘     │
│                                                          │
│  ┌──────────────┐              ┌──────────────────┐     │
│  │              │   triggers  │                  │     │
│  │  entity:     │◄────────── │  entity:create   │     │
│  │  computed    │   computed  │  (after insert,  │     │
│  │  field eval  │   field     │   evaluate       │     │
│  │              │   handler   │   computed       │     │
│  └──────────────┘              │   fields)       │     │
│                                └──────────────────┘     │
│                                                          │
│  ┌──────────────┐              ┌──────────────────┐     │
│  │              │   effects   │                  │     │
│  │  workflow:   │────────────►│  task:create     │     │
│  │  transition  │   creates   │  notify:send     │     │
│  │  (effect     │   tasks,    │  (side effects   │     │
│  │   phase)     │   sends     │   of state       │     │
│  │              │   notifs    │   transition)    │     │
│  └──────────────┘              └──────────────────┘     │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

Three interaction patterns:

1. **Context reads**: Kernel VM reads entity data through `ExecutionContext.entityData` -- Platform Services resolves this
2. **Computed fields**: Platform Services triggers Kernel VM to recalculate computed fields after entity mutations
3. **Workflow effects**: When a workflow transition fires, its effects can call Platform Services (create tasks, send notifications, generate documents)

---

## 2. MCP Namespace Convention

The Kernel VM and Platform Services share the MCP tool namespace but use a natural semantic split:

| Namespace Owner | Prefix Style | Examples |
|----------------|-------------|----------|
| **Kernel VM** | Verb/adjective-based | `core:*`, `ai:*`, `meta:*`, `devel:*`, `a2a:*` |
| **Platform Services** | Noun-based | `entity:*`, `relation:*`, `file:*`, `task:*`, `search:*`, `permission:*`, `audit:*`, `notify:*`, `comment:*`, `version:*`, `job:*`, `template:*`, `i18n:*` |

To an AI agent, they look the same -- just MCP tools:

```typescript
// Kernel VM tool (pure computation)
await mcp.call('core:threshold_check', { value: 0.05, threshold: 0.1 });

// Platform Service tool (stateful operation)
await mcp.call('entity:create', { entity_type: 'product', data: { name: 'Hand Cream' } });
```

The agent doesn't need to know which is pure and which is stateful. The Kernel handles the difference internally.

### Reserved Namespaces

| Namespace | Owner | Purpose |
|-----------|-------|---------|
| `core:` | Kernel VM | Computation, validation, logic gates, graph analysis, resolution |
| `graph:` | *(reserved)* | Reserved for future separation of graph handlers from `core:` namespace |
| `ai:` | Platform Services (AI Runtime) | AI handler contracts defined in Kernel VM, execution delegated to Platform Services via Bridge |
| `meta:` | Kernel VM (Simulator-gated) | Platform programming tools: workflow definition, rule creation, vertical setup. Contracts defined in Kernel VM, execution routed through Simulator for validation before state changes are persisted by Platform Services |
| `devel:` | Kernel VM | Development-time tools (scaffold, lint, test) |
| `a2a:` | A2A Protocol | Cross-company protocol primitives |
| `ui:` | Platform Services | Generative UI declarations (views, actions) |
| `entity:` | Platform Services | Entity definition and CRUD |
| `relation:` | Platform Services | Relation type definition and instance management |
| `search:` | Platform Services | Full-text, semantic, and structured search |
| `permission:` | Platform Services | RBAC, role definition, access checks |
| `file:` | Platform Services | File upload, download, attachment, versioning |
| `version:` | Platform Services | Entity version history, comparison, restore |
| `task:` | Platform Services | Task creation, assignment, completion |
| `comment:` | Platform Services | Entity comments, threads, resolution |
| `notify:` | Platform Services | Notification delivery and preferences |
| `audit:` | Platform Services | Audit log query and export |
| `job:` | Platform Services | Background job submission and monitoring |
| `template:` | Platform Services | Entity templates and cloning |
| `i18n:` | Platform Services | Translation storage and retrieval |
| `events:` | Platform Services | Internal event subscription and emission |
| `registry:` | Registry SDK | Pack installation, compilation, versioning |

---

## 3. Tier 1: Entity Management

Entity Management is the filesystem of the Compliance OS. Every product, material, substance, formulation, and document in the system is an entity. AI agents define entity types at runtime and perform CRUD operations against them.

### 3.1 `entity:define` -- Define Entity Type

Creates a new entity type with schema, behaviors, and compliance bindings.

```typescript
"entity:define": {
  input: {
    entity_type: string,                    // "formulation", "battery_cell", "cosmetic_product"

    schema: {
      fields: Array<{
        name: string,
        type: FieldType,                    // string, number, boolean, date, enum,
                                            // array, object, reference

        // Constraints (type-dependent)
        required?: boolean,
        unique?: boolean,
        indexed?: boolean,
        default?: unknown,

        // Enum
        enum_values?: string[],

        // Array
        items_type?: FieldType,
        min_items?: number,
        max_items?: number,

        // Number
        min?: number,
        max?: number,
        precision?: number,

        // String
        pattern?: string,                   // regex
        min_length?: number,
        max_length?: number,

        // Reference (foreign key to another entity type)
        references?: string,                // target entity type

        // Computed fields (evaluated by Kernel VM)
        computed?: {
          handler: string,                  // handler ID, e.g., "core:bom_sum"
          config: unknown,                  // handler config
          recompute_on?: string[]           // field changes that trigger recompute
        },

        // Display hints (for Generative UI)
        display_name?: string,
        description?: string,
        ui_widget?: string,                 // "text", "textarea", "select", "date_picker"
        ui_group?: string                   // form section grouping
      }>,

      // Compound constraints
      unique_together?: string[][],

      // Compound indexes
      indexes?: Array<{
        fields: string[],
        type: 'btree' | 'fulltext' | 'vector'
      }>
    },

    // Entity behaviors
    behaviors?: {
      versioned?: boolean,                  // track revision history
      soft_delete?: boolean,                // mark deleted vs hard delete
      audit_log?: boolean,                  // log all changes
      temporal?: boolean,                   // valid_from / valid_to
    },

    // Lifecycle binding
    lifecycle?: {
      workflow_id?: string,                 // bind to a workflow state machine
      initial_state?: string
    },

    // Compliance binding
    compliance?: {
      evaluation_rules?: string[],          // Logic Pack IDs to auto-run on change
      evaluation_trigger?: 'on_change' | 'on_transition' | 'manual'
    }
  },

  output: {
    entity_type: string,
    schema_version: string,
    graph_labels_created: string[],
    indexes_created: string[]
  }
}
```

### 3.2 `entity:extend` -- Modify Entity Schema

Adds, modifies, or deprecates fields on an existing entity type. Handles data migration.

```typescript
"entity:extend": {
  input: {
    entity_type: string,

    add_fields?: FieldDefinition[],

    modify_fields?: Array<{
      name: string,
      changes: Partial<FieldDefinition>
    }>,

    deprecate_fields?: string[],            // soft deprecation (field remains, marked obsolete)

    migration?: {
      handler: string,                      // handler to transform existing data
      config: unknown
    }
  },

  output: {
    schema_version: string,                 // incremented
    migration_status?: {
      entities_migrated: number,
      entities_failed: number
    }
  }
}
```

### 3.3 `entity:describe` -- Introspect Entity Type

Returns the full schema and statistics for an entity type.

```typescript
"entity:describe": {
  input: {
    entity_type: string,

    include?: {
      field_statistics?: boolean,           // count of null, distinct values per field
      instance_count?: boolean,
      relations?: boolean,                  // relation types connected to this entity
      bound_workflows?: boolean,
      bound_rules?: boolean
    }
  },

  output: {
    schema: EntitySchema,
    statistics?: Record<string, FieldStatistics>,
    instance_count?: number,
    relations?: RelationDefinition[],
    workflows?: string[],
    rules?: string[]
  }
}
```

### 3.4 `entity:list_types` -- List All Entity Types

```typescript
"entity:list_types": {
  input: {
    filter?: {
      has_workflow?: boolean,
      has_compliance_rules?: boolean,
      created_by?: string
    }
  },

  output: {
    entity_types: Array<{
      entity_type: string,
      schema_version: string,
      instance_count: number,
      created_at: string
    }>
  }
}
```

### 3.5 `entity:create` -- Create Entity Instance

```typescript
"entity:create": {
  input: {
    entity_type: string,
    data: Record<string, unknown>,

    relations?: Array<{
      relation_type: string,                // "contains", "supplied_by"
      target_id: string,
      properties?: Record<string, unknown>  // edge properties
    }>,

    options?: {
      validate?: boolean,                   // run schema validation (default: true)
      evaluate_compliance?: boolean,        // run bound rules immediately
      skip_workflow_init?: boolean          // don't initialize workflow state
    }
  },

  output: {
    entity_id: string,
    entity_type: string,
    version: number,
    workflow_state?: string,
    compliance_status?: {
      evaluated: boolean,
      result?: 'compliant' | 'non_compliant' | 'pending'
    },
    validation_errors?: Array<{ field: string, error: string }>
  }
}
```

### 3.6 `entity:read` -- Read Entity Instance

```typescript
"entity:read": {
  input: {
    entity_type: string,
    entity_id: string,

    include?: {
      relations?: string[] | boolean,       // which relations to expand, or all
      relation_depth?: number,              // traversal depth (default: 1)
      history?: boolean,                    // include version history
      compliance_status?: boolean,
      workflow_state?: boolean,
      audit_log?: boolean,
      computed_fields?: boolean             // recalculate computed fields live
    }
  },

  output: {
    entity_id: string,
    entity_type: string,
    version: number,
    data: Record<string, unknown>,
    relations?: Record<string, Entity[]>,
    history?: VersionEntry[],
    compliance_status?: ComplianceStatus,
    workflow_state?: WorkflowState,
    audit_log?: AuditEntry[]
  }
}
```

### 3.7 `entity:update` -- Update Entity Instance

```typescript
"entity:update": {
  input: {
    entity_type: string,
    entity_id: string,

    data: Record<string, unknown>,          // partial update (merge semantics)

    options?: {
      expected_version?: number,            // optimistic locking
      create_if_missing?: boolean,          // upsert behavior
      validate?: boolean,
      evaluate_compliance?: boolean,
      change_reason?: string                // for audit log
    }
  },

  output: {
    entity_id: string,
    version: number,                        // incremented
    changed_fields: string[],
    compliance_status?: ComplianceStatus,
    triggered_events?: string[]
  }
}
```

### 3.8 `entity:delete` -- Delete Entity Instance

```typescript
"entity:delete": {
  input: {
    entity_type: string,
    entity_id: string,

    options?: {
      hard_delete?: boolean,                // default: soft delete if behavior enabled
      cascade?: boolean,                    // delete related entities
      delete_relations_only?: string[]      // only sever specific relation types
    }
  },

  output: {
    deleted: boolean,
    soft_deleted?: boolean,
    cascade_deleted?: Array<{ entity_type: string, entity_id: string }>
  }
}
```

### 3.9 `entity:list` -- Query Entity Instances

```typescript
"entity:list": {
  input: {
    entity_type: string,

    filter?: FilterExpression,

    sort?: Array<{
      field: string,
      direction: 'asc' | 'desc'
    }>,

    pagination?: {
      limit: number,
      offset?: number,
      cursor?: string                       // cursor-based pagination
    },

    include?: {
      relations?: string[],
      compliance_status?: boolean,
      workflow_state?: boolean
    }
  },

  output: {
    items: Entity[],
    total: number,
    has_more: boolean,
    next_cursor?: string
  }
}
```

### 3.10 `entity:bulk_create` -- Bulk Create

```typescript
"entity:bulk_create": {
  input: {
    entity_type: string,
    items: Array<{
      data: Record<string, unknown>,
      relations?: RelationInput[]
    }>,
    options?: {
      stop_on_error?: boolean,              // default: continue
      validate?: boolean,
      batch_size?: number
    }
  },

  output: {
    created: number,
    failed: number,
    results: Array<{
      index: number,
      entity_id?: string,
      error?: string
    }>
  }
}
```

### 3.11 `entity:bulk_update` -- Bulk Update

```typescript
"entity:bulk_update": {
  input: {
    entity_type: string,
    filter: FilterExpression,               // which entities to update
    data: Record<string, unknown>,          // changes to apply

    options?: {
      limit?: number,                       // safety limit
      dry_run?: boolean
    }
  },

  output: {
    updated: number,
    dry_run_would_update?: number
  }
}
```

### 3.12 Filter Expression Type

Used throughout Platform Services for structured queries:

```typescript
type FilterExpression = {
  // Logical operators
  and?: FilterExpression[],
  or?: FilterExpression[],
  not?: FilterExpression,

  // Field comparison
  field?: string,
  operator?: 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' |
             'in' | 'not_in' | 'contains' | 'starts_with' |
             'is_null' | 'is_not_null',
  value?: unknown
}

// Examples:
// { field: "status", operator: "eq", value: "active" }
// { and: [
//   { field: "concentration", operator: "gt", value: 0.01 },
//   { field: "substance_type", operator: "in", value: ["svhc", "cmr"] }
// ]}
```

---

## 4. Tier 1: Relations & Graph Structure

Relations define how entities connect in the Neo4j knowledge graph. They are the linker of the Compliance OS -- binding products to materials, materials to substances, substances to regulations.

### 4.1 `relation:define` -- Define Relation Type

```typescript
"relation:define": {
  input: {
    relation_type: string,                  // "contains", "supplied_by", "requires"

    from_entity_type: string,               // or "*" for any
    to_entity_type: string,                 // or "*" for any

    cardinality: '1:1' | '1:n' | 'n:1' | 'n:n',

    // Edge properties (data stored on the relationship itself)
    properties?: Array<{
      name: string,
      type: FieldType,
      required?: boolean
    }>,

    constraints?: {
      unique?: boolean,                     // only one edge of this type between two nodes
      acyclic?: boolean,                    // prevent cycles (for hierarchies)
      max_from?: number,                    // max outgoing edges per node
      max_to?: number                       // max incoming edges per node
    },

    inverse?: {
      name: string,                         // "contained_in" is inverse of "contains"
      auto_create?: boolean                 // automatically create inverse edge
    },

    cascade?: {
      on_delete?: 'cascade' | 'restrict' | 'set_null' | 'detach'
    }
  },

  output: {
    relation_type: string,
    inverse_relation_type?: string
  }
}
```

### 4.2 `relation:create` -- Create Relation Instance

```typescript
"relation:create": {
  input: {
    relation_type: string,
    from: { entity_type: string, entity_id: string },
    to: { entity_type: string, entity_id: string },
    properties?: Record<string, unknown>
  },

  output: {
    relation_id: string,
    inverse_created?: boolean
  }
}
```

### 4.3 `relation:update` -- Update Relation Properties

```typescript
"relation:update": {
  input: {
    relation_type: string,
    from: { entity_type: string, entity_id: string },
    to: { entity_type: string, entity_id: string },
    properties: Record<string, unknown>
  },

  output: {
    updated: boolean
  }
}
```

### 4.4 `relation:delete` -- Delete Relation

```typescript
"relation:delete": {
  input: {
    relation_type: string,
    from: { entity_type: string, entity_id: string },
    to: { entity_type: string, entity_id: string }
  },

  output: {
    deleted: boolean,
    cascade_effects?: Array<{
      entity_type: string,
      entity_id: string,
      action: string
    }>
  }
}
```

### 4.5 `relation:list` -- Query Relations

```typescript
"relation:list": {
  input: {
    from?: { entity_type: string, entity_id: string },
    to?: { entity_type: string, entity_id: string },
    relation_type?: string,
    filter?: FilterExpression,              // on edge properties
    include_entities?: boolean              // return full entity data
  },

  output: {
    relations: Array<{
      relation_type: string,
      relation_id: string,
      from: EntityRef,
      to: EntityRef,
      properties: Record<string, unknown>,
      from_entity?: Entity,
      to_entity?: Entity
    }>
  }
}
```

### 4.6 `relation:list_types` -- Introspect Relation Types

```typescript
"relation:list_types": {
  input: {
    entity_type?: string                    // filter by connected entity type
  },

  output: {
    relation_types: Array<{
      relation_type: string,
      from_entity_type: string,
      to_entity_type: string,
      cardinality: string,
      instance_count: number
    }>
  }
}
```

### 4.7 Relationship to Kernel VM Graph Tools

Platform Services `relation:*` tools manage the graph structure (create/update/delete edges). Kernel VM graph handlers (under `core:` namespace, e.g. `core:find_path`, `core:impact_analysis`) analyze the graph (traverse, find paths, impact analysis). They operate on the same Neo4j graph but serve different purposes:

| Tool Family | Purpose | Examples |
|-------------|---------|---------|
| `relation:*` (Platform) | Structural mutations | Create edge, delete edge, define relation type |
| `core:` graph handlers (Kernel VM) | Analytical queries | Traverse supply chain, find substitutes, impact analysis |

---

## 5. Tier 1: Search & Discovery

Search is the `grep` of the Compliance OS. It provides full-text, structured, and semantic search across all entities.

### 5.1 `search:configure_index` -- Configure Search Index

```typescript
"search:configure_index": {
  input: {
    entity_type: string,

    fields: Array<{
      field: string,
      index_type: 'text' | 'keyword' | 'numeric' | 'date' | 'geo' | 'vector',

      // Text-specific
      analyzer?: string,                    // "standard", "chemical_names"
      weight?: number,                      // relevance boost

      // Vector-specific (for semantic search via pgvector)
      embedding_model?: string,
      dimensions?: number
    }>,

    // Include related entity fields in the index
    include_relations?: Array<{
      relation_type: string,
      fields: string[],
      depth?: number
    }>
  },

  output: {
    index_name: string,
    status: 'creating' | 'ready'
  }
}
```

### 5.2 `search:query` -- Full-Text Search

```typescript
"search:query": {
  input: {
    query: string,                          // user's search query

    entity_types?: string[],                // limit to specific types

    filters?: FilterExpression,             // combine with structured filters

    options?: {
      fuzzy?: boolean,                      // typo tolerance
      synonyms?: boolean,                   // expand to synonyms
      semantic?: boolean,                   // use vector similarity
      highlight?: boolean,                  // highlight matches in results
      explain?: boolean                     // explain why each result matched
    },

    facets?: string[],                      // return aggregations (e.g., by status, by type)

    pagination?: {
      limit: number,
      offset?: number
    }
  },

  output: {
    results: Array<{
      entity_type: string,
      entity_id: string,
      score: number,
      highlight?: Record<string, string[]>,
      explanation?: string
    }>,

    facets?: Record<string, Array<{
      value: string,
      count: number
    }>>,

    total: number,
    query_time_ms: number
  }
}
```

### 5.3 `search:semantic` -- Vector Similarity Search

```typescript
"search:semantic": {
  input: {
    query: string,                          // natural language query
    entity_types?: string[],
    min_similarity?: number,                // 0-1 threshold
    limit?: number
  },

  output: {
    results: Array<{
      entity_type: string,
      entity_id: string,
      similarity: number,
      explanation?: string
    }>
  }
}
```

### 5.4 `search:similar` -- Find Similar Entities

```typescript
"search:similar": {
  input: {
    entity_type: string,
    entity_id: string,
    similarity_fields?: string[],           // which fields to compare
    limit?: number
  },

  output: {
    similar: Array<{
      entity_id: string,
      similarity: number,
      matching_aspects: string[]
    }>
  }
}
```

### 5.5 `search:save` -- Saved Searches

```typescript
"search:save": {
  input: {
    name: string,
    query: string,
    entity_types?: string[],
    filters?: FilterExpression,
    notify_on_new?: boolean,                // alert when new results appear
    schedule?: string                       // cron expression for periodic execution
  },

  output: {
    saved_search_id: string
  }
}
```

### 5.6 `search:list_saved` -- List Saved Searches

```typescript
"search:list_saved": {
  input: {},

  output: {
    saved_searches: Array<{
      id: string,
      name: string,
      query: string,
      result_count: number,
      last_run?: string
    }>
  }
}
```

---

## 6. Tier 1: Permissions & Access Control

Permissions are the `chmod` of the Compliance OS. The security model must be explicit -- ambiguity in who can do what to which data is unacceptable in a compliance platform.

### 6.1 `permission:define_role` -- Define Role

```typescript
"permission:define_role": {
  input: {
    role_id: string,                        // "formulator", "safety_assessor", "admin"

    display_name: string,
    description?: string,

    // What this role can do
    grants: Array<{
      entity_type: string | '*',            // which entity type(s)

      actions: Array<                       // which operations
        'create' | 'read' | 'update' | 'delete' |
        'transition' | 'evaluate' | '*'
      >,

      // Field-level restrictions
      fields?: {
        allow?: string[],                   // whitelist (only these fields)
        deny?: string[]                     // blacklist (all except these)
      },

      // Conditional access
      condition?: {
        type: 'handler',
        handler: string,                    // returns boolean
        config: unknown
      } | {
        type: 'expression',
        expression: FilterExpression        // e.g., { field: 'department', operator: 'eq', value: '$user.department' }
      }
    }>,

    // Role inheritance
    inherits_from?: string[],

    // Workflow-specific permissions
    workflow_permissions?: Array<{
      workflow_id: string,
      allowed_transitions?: string[],
      allowed_states_view?: string[]
    }>
  },

  output: {
    role_id: string,
    effective_grants: Grant[]               // resolved including inheritance
  }
}
```

### 6.2 `permission:grant_role` -- Assign Role to Principal

```typescript
"permission:grant_role": {
  input: {
    principal: {
      type: 'user' | 'group' | 'agent',
      id: string
    },
    role_id: string,

    scope?: {
      entity_type?: string,
      entity_ids?: string[],               // specific entities
      filter?: FilterExpression            // dynamic scope
    },

    valid_from?: string,
    valid_until?: string                   // temporary access
  },

  output: {
    grant_id: string,
    effective_permissions: Permission[]
  }
}
```

### 6.3 `permission:revoke_role` -- Revoke Role

```typescript
"permission:revoke_role": {
  input: {
    principal: { type: string, id: string },
    role_id: string,
    scope?: Scope
  },

  output: {
    revoked: boolean
  }
}
```

### 6.4 `permission:check` -- Check Permission

The runtime guard. Called by Platform Services before every mutation and by workflow guards before transitions.

```typescript
"permission:check": {
  input: {
    principal: { type: string, id: string },
    action: string,
    resource: {
      entity_type: string,
      entity_id?: string,                  // optional for 'create' action
      field?: string                       // for field-level check
    }
  },

  output: {
    allowed: boolean,
    reason?: string,                       // why denied
    granted_by?: string                    // which role/grant allowed it
  }
}
```

### 6.5 `permission:list_grants` -- List Permissions for Principal

```typescript
"permission:list_grants": {
  input: {
    principal: { type: string, id: string }
  },

  output: {
    roles: Array<{
      role_id: string,
      scope?: Scope,
      valid_until?: string
    }>,
    effective_permissions: Permission[]
  }
}
```

### 6.6 `permission:list_principals` -- List Who Has Access

```typescript
"permission:list_principals": {
  input: {
    resource: {
      entity_type: string,
      entity_id?: string
    },
    action?: string
  },

  output: {
    principals: Array<{
      type: string,
      id: string,
      role_id: string,
      granted_at: string
    }>
  }
}
```

### 6.7 `permission:define_group` -- Define Principal Group

```typescript
"permission:define_group": {
  input: {
    group_id: string,
    display_name: string,

    members: Array<{ type: 'user' | 'agent', id: string }>,

    // Dynamic membership based on user attributes
    auto_membership?: {
      condition: FilterExpression
    }
  },

  output: {
    group_id: string,
    member_count: number
  }
}
```

### 6.8 Relationship to Existing Auth System

Platform Services RBAC extends (does not replace) the existing Clerk-based authentication and workspace-scoped authorization. The existing system handles:

- **Authentication**: Clerk JWT verification
- **Workspace authorization**: `authorize('design', 'edit')` middleware
- **Tenant isolation**: Schema-based multi-tenancy

Platform Services RBAC adds:

- **Entity-level permissions**: Who can modify which entity instances
- **Field-level permissions**: Which fields a role can see/edit
- **Conditional access**: Dynamic rules based on entity state or user attributes
- **Pack-defined roles**: Logic Packs can define roles specific to their vertical

---

## 7. Tier 1: File Management

File Management is the storage subsystem of the Compliance OS. Safety data sheets, test reports, certificates, CAD files -- compliance demands extensive document management.

### 7.1 `file:upload` -- Upload File

```typescript
"file:upload": {
  input: {
    filename: string,
    content: Buffer | string,               // binary or base64
    content_type: string,

    metadata?: Record<string, unknown>,

    options?: {
      scan_for_viruses?: boolean,
      extract_text?: boolean,               // for search indexing
      generate_preview?: boolean            // thumbnail/preview image
    }
  },

  output: {
    file_id: string,
    size_bytes: number,
    content_hash: string,                   // SHA-256 for deduplication/integrity
    preview_url?: string,
    extracted_text?: string
  }
}
```

### 7.2 `file:attach` -- Attach File to Entity

```typescript
"file:attach": {
  input: {
    file_id: string,
    entity_type: string,
    entity_id: string,

    attachment_type: string,                // "safety_data_sheet", "test_report", "certificate"

    metadata?: {
      description?: string,
      effective_date?: string,
      expiry_date?: string,
      language?: string,
      version_label?: string
    }
  },

  output: {
    attachment_id: string,
    entity_id: string,
    file_id: string
  }
}
```

### 7.3 `file:get` -- Get File

```typescript
"file:get": {
  input: {
    file_id: string,

    options?: {
      include_content?: boolean,            // default: return signed URL only
      as_format?: string                    // request format conversion
    }
  },

  output: {
    file_id: string,
    filename: string,
    content_type: string,
    size_bytes: number,
    url: string,                            // signed URL for download
    url_expires_at: string,
    content?: Buffer
  }
}
```

### 7.4 `file:list_attachments` -- List Entity Attachments

```typescript
"file:list_attachments": {
  input: {
    entity_type: string,
    entity_id: string,
    attachment_type?: string
  },

  output: {
    attachments: Array<{
      attachment_id: string,
      file_id: string,
      attachment_type: string,
      filename: string,
      content_type: string,
      uploaded_at: string,
      uploaded_by: string,
      metadata: Record<string, unknown>
    }>
  }
}
```

### 7.5 `file:delete` -- Delete File

```typescript
"file:delete": {
  input: {
    file_id: string,

    options?: {
      force?: boolean                       // delete even if attached to entities
    }
  },

  output: {
    deleted: boolean,
    detached_from?: Array<{ entity_type: string, entity_id: string }>
  }
}
```

### 7.6 `file:create_version` -- Version a File

```typescript
"file:create_version": {
  input: {
    file_id: string,                        // existing file
    content: Buffer | string,
    version_label?: string,
    change_notes?: string
  },

  output: {
    file_id: string,                        // same ID
    version: number,
    previous_version: number
  }
}
```

### 7.7 `file:list_versions` -- List File Versions

```typescript
"file:list_versions": {
  input: {
    file_id: string
  },

  output: {
    versions: Array<{
      version: number,
      version_label?: string,
      uploaded_at: string,
      uploaded_by: string,
      size_bytes: number,
      change_notes?: string
    }>
  }
}
```

### 7.8 `file:parse` -- Parse Document (Extract Structured Data)

Delegates to a parser (which may be a Driver Pack agent like `@agents/sds-parser-de`).

```typescript
"file:parse": {
  input: {
    file_id: string,
    parser: string,                         // "sds_parser", "coa_parser", "invoice_parser"
    options?: Record<string, unknown>
  },

  output: {
    parsed_data: Record<string, unknown>,
    confidence: number,
    warnings?: string[],
    unmapped_sections?: string[]
  }
}
```

### 7.9 Infrastructure: Cloudflare R2

Files are stored in Cloudflare R2 (S3-compatible). The `file:*` tools abstract the storage backend -- agents never interact with R2 directly.

---

## 8. Tier 2: Version Control & History

Version Control provides entity-level revision history, comparison, and restore capabilities. Think `git` for entity data.

### Capabilities

| Tool | Purpose |
|------|---------|
| `version:history` | Get revision history for an entity (who changed what, when, why) |
| `version:get` | Retrieve an entity at a specific version |
| `version:compare` | Diff two versions of an entity (field-level changes + relation changes) |
| `version:restore` | Restore an entity to a previous version (creates new version with old data) |
| `version:branch` | Create a branch for parallel work on the same entity |
| `version:merge` | Merge a branch back, with conflict detection and resolution |

### Key Design Decisions

- **Versioning is opt-in per entity type** via `behaviors.versioned: true` in `entity:define`
- **Versions are immutable snapshots** -- you cannot edit a previous version, only restore it (which creates a new version)
- **Branching is for human collaboration workflows** -- e.g., two formulators working on the same product simultaneously
- **Merge conflict resolution** supports `source_wins`, `target_wins`, or `manual` strategies
- **The Compliance Lock records entity versions** used at evaluation time, enabling audit replay

### Integration with Kernel VM

When the Kernel VM evaluates compliance, the `ExecutionContext` includes the entity version number. The Compliance Lock pins this version, ensuring the evaluation can be replayed against exactly the data that was evaluated.

---

## 9. Tier 2: Tasks & Assignments

Tasks provide a unified inbox for human work items. Every vertical, rule, and workflow can create tasks that appear in a single dashboard.

### Capabilities

| Tool | Purpose |
|------|---------|
| `task:create` | Create a task (review, approval, data entry, investigation) |
| `task:update` | Update task status, priority, assignee, or checklist |
| `task:complete` | Complete a task with outcome, optionally triggering workflow transitions |
| `task:list` | Query tasks by assignee, status, type, entity, priority |
| `task:reassign` | Move a task to a different assignee with audit trail |
| `task:set_delegation` | Set up out-of-office delegation rules |

### Key Design Decisions

- **Unified inbox**: All tasks -- regardless of which Logic Pack or workflow created them -- appear in one place. This is why Tasks are Kernel, not a Driver Pack.
- **Linked to entities and workflows**: Tasks can be bound to an entity (e.g., "Review Product X") and/or a workflow transition (e.g., "Approve transition from `testing` to `on_market`"). Completing the task can trigger the transition.
- **Auto-assignment strategies**: `round_robin`, `least_loaded`, `by_expertise` -- configurable per task type
- **Checklists**: Tasks can include required checklist items that must be completed before the task can be marked done
- **Priority + due date**: Standard urgency controls with escalation support

### Integration with Kernel VM

Workflow effects create tasks:

```
workflow:transition("review" → "approved")
  └── effect: task:create({ title: "Review SVHC Assessment", assignee: "role:regulatory_manager" })
```

When the task is completed with `outcome: 'approved'`, the Platform Services can trigger the next workflow transition.

---

## 10. Tier 2: Comments & Collaboration

Comments provide a unified activity stream for entity-level discussion.

### Capabilities

| Tool | Purpose |
|------|---------|
| `comment:add` | Add a comment to an entity (with mentions, replies, attachments) |
| `comment:list` | List comments on an entity (threaded, with replies) |
| `comment:edit` | Edit a comment |
| `comment:delete` | Delete a comment |
| `comment:resolve` | Resolve a comment thread (for review workflows) |

### Key Design Decisions

- **Unified activity stream**: Like Tasks, all comments across all verticals appear in one system. A user can see all discussions they're involved in regardless of entity type.
- **Threaded replies**: Comments support reply-to for threading
- **@mentions**: Mentioning a user or group triggers a notification
- **Visibility levels**: `internal` (within tenant) and `external` (visible to supplier/partner) for cross-company collaboration
- **Resolvable threads**: Comment threads can be marked "resolved" -- useful for review workflows where issues must be addressed before approval

---

## 11. Tier 2: Notifications

Notifications deliver human-facing alerts through configurable channels.

### Capabilities

| Tool | Purpose |
|------|---------|
| `notify:define_channel` | Configure a delivery channel (email, in-app, Slack, Teams, SMS, webhook) |
| `notify:send` | Send a notification to users/groups/roles |
| `notify:set_preferences` | Set user notification preferences (channels, frequency, quiet hours) |
| `notify:get_preferences` | Get user notification preferences |
| `notify:list` | List a user's notifications with read/unread status |
| `notify:mark_read` | Mark notifications as read |

### Key Design Decisions

- **Channel abstraction**: The `notify:send` tool routes to the correct channel based on user preferences. The caller doesn't need to know how the user wants to receive notifications.
- **Digest support**: Users can choose `immediate`, `hourly_digest`, `daily_digest`, or `weekly_digest` per notification type
- **Template system**: Each channel defines templates per notification type, with variable interpolation
- **Aggregation**: Similar notifications within a short window can be aggregated (e.g., "5 products need review" instead of 5 separate notifications)
- **Quiet hours**: Users can set quiet hours with timezone support

---

## 12. Tier 2: Audit Log

The Audit Log provides a queryable, exportable record of all system actions. Unlike the Kernel VM execution trace (which records compliance evaluations), the Audit Log records platform operations.

### Capabilities

| Tool | Purpose |
|------|---------|
| `audit:query` | Query audit entries by entity, actor, action type, time range |
| `audit:export` | Export audit log as CSV, JSON, or PDF |
| `audit:set_retention` | Configure retention policies |

### Key Design Decisions

- **Every Platform Service mutation generates an audit entry** -- entity creates, updates, deletes, role grants, file uploads, task completions
- **Immutable**: Audit entries cannot be modified or deleted (except by retention policy)
- **Correlation IDs**: Every audit entry includes a `correlation_id` linking it to the originating request, enabling end-to-end tracing
- **Actor types**: `user`, `agent`, `system`, `handler_effect` -- distinguishing who initiated the action
- **Exportable for regulators**: Audit logs can be exported in standard formats for regulatory submission

### Relationship to Kernel VM Traces

| | Audit Log (Platform Services) | Execution Trace (Kernel VM) |
|---|---|---|
| **Records** | CRUD operations, permission changes, login events | Compliance evaluations, rule execution |
| **Purpose** | "Who did what when" | "Why did the system decide this" |
| **Immutability** | Immutable (retention policy only) | Immutable (Compliance Lock) |
| **Query tool** | `audit:query` | Compliance Lock replay |

---

## 13. Tier 2: Jobs & Background Processing

Jobs manage long-running operations that shouldn't block the MCP request/response cycle.

### Capabilities

| Tool | Purpose |
|------|---------|
| `job:submit` | Submit a background job (bulk evaluation, import, export, sync) |
| `job:status` | Get job status with progress (current/total, percent, current item) |
| `job:cancel` | Cancel a running job |
| `job:list` | List jobs by status, type, time range |
| `job:retry` | Retry a failed job |

### Key Design Decisions

- **Job types are extensible**: Any handler or platform service can be run as a job
- **Progress tracking**: Jobs report `current`, `total`, `percent`, and `current_item` for UI progress bars
- **Priority queuing**: `low`, `normal`, `high` -- higher priority jobs execute first
- **Scheduling**: Jobs can be scheduled for a specific time or run on a cron schedule
- **Notification on completion**: Jobs can notify specified users/groups when done
- **Idempotency**: Retrying a failed job should be safe (no duplicate side effects)

### Common Job Types

| Job Type | Description |
|----------|-------------|
| `bulk_evaluation` | Run compliance rules against all products |
| `import` | Import data from uploaded file |
| `export` | Generate export file (CSV, XLSX, JSON) |
| `sync` | Sync data with external system via Driver Pack |
| `reindex` | Rebuild search indexes |
| `migration` | Run entity schema migration |

---

## 14. Tier 2: Templates & Cloning

Templates provide the `copy()` primitive for rapid entity creation.

### Capabilities

| Tool | Purpose |
|------|---------|
| `template:define` | Define an entity template with default values, auto-fill rules, and required overrides |
| `template:instantiate` | Create a new entity from a template |
| `template:list` | List available templates by entity type, category, or tags |
| `entity:clone` | Deep-copy an existing entity (optionally including relations) |

### Key Design Decisions

- **Templates are Kernel because the Kernel knows the schema**: A Driver Pack cannot reliably deep-clone an entity without knowing every field and relation type. The Kernel has this knowledge.
- **Auto-fill from context**: Templates can auto-populate fields from user attributes, current date, sequence counters, or custom handlers
- **Required overrides**: Template authors specify which fields the user must provide (preventing blind copy-paste)
- **Deep clone with relation control**: `entity:clone` can selectively clone related entities, reset workflow state, and append a suffix to name fields

---

## 15. Tier 2: Localization (i18n Engine)

The i18n Engine provides the mechanism for multi-language support. The Kernel provides the storage and serving API; the content (actual translations) lives in Packs.

### Capabilities

| Tool | Purpose |
|------|---------|
| `i18n:define_translations` | Configure which fields on an entity type support translation |
| `i18n:translate` | Set translations for an entity instance (manual or AI-assisted) |
| `i18n:get` | Get translated values for an entity in a specific language |
| `i18n:set_ui_strings` | Set UI label translations |

### Key Design Decisions

- **Kernel provides the engine, Packs provide the content**: The `i18n:*` tools store and serve translations. The actual translated strings for regulation names, hazard statements, and UI labels come from Logic Packs and Environment Packs.
- **Fallback chain**: If a translation doesn't exist for the requested language, the system falls back to a configured default language (typically English)
- **AI-assisted translation**: The `i18n:translate` tool can optionally auto-translate from a source language using the AI Runtime, with human review flags
- **Supported languages per entity type**: Not all entity types need all languages. The configuration specifies which languages are supported for which entity types.

---

## 16. Tier 2: AI Runtime

The AI Runtime is the orchestration layer for AI agent execution. The Kernel provides the runtime; specific agents are Driver Packs.

### Capabilities

The `ai:` namespace is shared between two layers. **Kernel VM contracts** define composable AI tools used within compliance evaluations (Rule Logic ASTs). **Platform Services interactive tools** provide standalone AI capabilities for human users and AI agents.

**Kernel VM Contracts** (interface defined in [Kernel VM Section 9](./2026-02-02-compliance-handler-vm.md#9-aiintelligence-handlers), executed here via Bridge):

| Tool | Purpose |
|------|---------|
| `ai:document_extract` | Extract structured data from unstructured documents (SDS, CoA, test reports) |
| `ai:compliance_interpret` | Interpret regulatory text and apply to specific product/substance |
| `ai:gap_analysis` | Identify what's missing for compliance |
| `ai:query` | Natural language question answering about compliance data |
| `ai:document_generate` | Generate compliance documents from structured data |
| `ai:classify` | Classify into regulatory categories (GHS hazard, customs HS code) |
| `ai:anomaly_detect` | Detect unusual patterns indicating data quality or compliance risks |
| `ai:risk_score` | Score compliance risk for entities |
| `ai:explain` | Generate human-readable explanations for compliance decisions |

**Platform Services Interactive Tools** (defined and executed here):

| Tool | Purpose |
|------|---------|
| `ai:execute` | Natural language command execution with confirmation |
| `ai:explain_entity` | Generate human-readable explanation of an entity's state and compliance |
| `ai:suggest_actions` | Suggest next actions for an entity based on its state and goals |
| `ai:design_entity` | AI-assisted entity type design from natural language description |
| `ai:design_workflow` | AI-assisted workflow design from natural language description |
| `ai:conversation` | Multi-turn conversation with context |

### Data Sovereignty Architecture

**Customer data MUST NOT leave EuroComply infrastructure.** The AI Runtime uses a two-tier model that separates data-touching operations from pure reasoning:

```
┌─────────────────────────────────────────────────────────────────┐
│                    AI RUNTIME - TWO TIERS                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  TIER A: DATA-TOUCHING (Self-Hosted, Mandatory)                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Fine-tuned 7B-13B model on own infrastructure            │  │
│  │                                                           │  │
│  │  Used by:                                                 │  │
│  │  • Kernel VM AI tools (ai:classify, ai:document_extract,│  │
│  │    ai:anomaly_detect, ai:risk_score, ai:explain)          │  │
│  │  • AI Runtime entity ops (ai:explain_entity,             │  │
│  │    ai:suggest_actions, ai:query)                          │  │
│  │                                                           │  │
│  │  These tools receive REAL customer data:                   │  │
│  │  formulations, concentrations, supplier names,            │  │
│  │  trade secrets, pre-market submissions                    │  │
│  │                                                           │  │
│  │  ✓ Data never leaves infrastructure                       │  │
│  │  ✓ GDPR compliant by design                              │  │
│  │  ✓ No third-party data processing agreements needed       │  │
│  │  ✓ Fine-tuned on compliance/chemistry domain              │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
│  TIER B: REASONING-ONLY (Cloud API Permitted)                    │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Frontier model via enterprise API (Azure OpenAI,         │  │
│  │  AWS Bedrock, or self-hosted 70B+)                        │  │
│  │                                                           │  │
│  │  Used by:                                                 │  │
│  │  • Schema design (ai:design_entity, ai:design_workflow)  │  │
│  │  • Rule composition (Logic AST generation)                │  │
│  │  • Regulation interpretation                              │  │
│  │                                                           │  │
│  │  These tools receive ONLY:                                │  │
│  │  schemas, rule structures, regulation text,               │  │
│  │  handler signatures -- NEVER customer data                │  │
│  │                                                           │  │
│  │  ✓ No customer data exposure                              │  │
│  │  ✓ Stronger reasoning for complex design tasks            │  │
│  │  ✓ Can use frontier models without liability              │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  THE RULE: The LLM designs the program.                         │
│            The Kernel VM executes it against real data.         │
│            The model never sees the data.                        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Tool Classification by Tier

| Tool | Tier | Sees Customer Data? | Model Requirement |
|------|------|--------------------|--------------------|
| `ai:document_extract` | A (self-hosted) | **Yes** — SDS content, formulations | Fine-tuned 7B-13B |
| `ai:classify` | A (self-hosted) | **Yes** — substance names, properties | Fine-tuned 7B-13B |
| `ai:anomaly_detect` | A (self-hosted) | **Yes** — concentrations, certificates | Fine-tuned 7B-13B |
| `ai:risk_score` | A (self-hosted) | **Yes** — product composition data | Fine-tuned 7B-13B |
| `ai:explain` | A (self-hosted) | **Yes** — evaluation results, entity data | Fine-tuned 7B-13B |
| `ai:query` | A (self-hosted) | **Yes** — answers questions about tenant data | Fine-tuned 7B-13B |
| `ai:gap_analysis` | A (self-hosted) | **Yes** — entity state, compliance requirements | Fine-tuned 7B-13B |
| `ai:explain_entity` | A (self-hosted) | **Yes** — full entity state | Fine-tuned 7B-13B |
| `ai:suggest_actions` | A (self-hosted) | **Yes** — entity state, compliance status | Fine-tuned 7B-13B |
| `ai:conversation` | A (self-hosted) | **Yes** — multi-turn with entity context | Fine-tuned 7B-13B |
| `ai:document_generate` | A (self-hosted) | **Yes** — product data for document generation | Fine-tuned 7B-13B |
| `ai:design_entity` | B (cloud permitted) | **No** — schemas and descriptions only | Frontier 70B+ |
| `ai:design_workflow` | B (cloud permitted) | **No** — workflow logic only | Frontier 70B+ |
| `ai:compliance_interpret` | B (cloud permitted) | **No** — regulation text and schemas only | Frontier 70B+ |
| `ai:execute` | **Mixed** | Plan phase: B (no data). Execute phase: Kernel VM (local) | Both |

### Infrastructure Cost Estimate

| Component | Setup | Monthly Cost |
|-----------|-------|-------------|
| **Tier A** (self-hosted) | 1-2x GPU (A100/H200) running quantized 7B-13B via vLLM | EUR 1,000 - 3,000 |
| **Tier B** (cloud API) | Enterprise API for schema/rule design (low volume, user-initiated) | EUR 500 - 2,000 |
| **Total AI infrastructure** | | **EUR 1,500 - 5,000/mo** |

At scale (50+ tenants), Tier A cost is amortized across all tenants. Tier B is bursty and low-volume (rule design happens infrequently).

### Model Gateway Architecture

The AI Runtime routes requests to the correct tier through a **Model Gateway**:

```typescript
interface ModelGateway {
  // Routes to correct model based on data sensitivity
  route(request: AIRequest): Promise<AIResponse>;
}

// The gateway enforces the tier classification:
// - If request.context contains entity data → Tier A (self-hosted)
// - If request.context contains only schemas/rules → Tier B (cloud permitted)
// - If ambiguous → Tier A (fail safe to self-hosted)
```

The gateway is a Kernel component. It cannot be bypassed. Even if a Driver Pack agent attempts to send customer data to a cloud API, the gateway intercepts and routes to self-hosted.

### Key Design Decisions

- **Self-hosted for data-touching operations**: All AI tools that receive customer entity data run on self-hosted models. Non-negotiable.
- **Cloud API permitted for reasoning-only**: Schema design, rule composition, and regulation interpretation can use frontier models because they never receive customer data.
- **Model Gateway enforces routing**: The gateway classifies requests by data sensitivity and routes to the correct tier. Fail-safe defaults to self-hosted.
- **Kernel provides the runtime**: Model gateway, context management, tool execution, and conversation state
- **Agents are Driver Packs**: Specific agents (SDS parser, regulatory advisor, formulation assistant) are installed from the Registry with their prompts, tool bindings, and specialized logic
- **Tool access control**: The AI Runtime enforces which MCP tools an agent can call, based on its Pack manifest and the user's permissions
- **Human-in-the-loop**: `ai:execute` supports a `confirm_before_execute` flag that shows the planned actions before executing them
- **Conversation context**: `ai:conversation` maintains multi-turn context, enabling follow-up questions and progressive refinement
- **Fine-tuning on domain data**: Tier A models are fine-tuned on compliance/chemistry/regulatory domain data to compensate for smaller model size

### Relationship to Kernel VM AI Handlers

| | AI Runtime (Platform Services) | AI Handlers (Kernel VM) |
|---|---|---|
| **Purpose** | Agent orchestration, NL interface | Specific intelligence primitives |
| **Examples** | `ai:query`, `ai:execute`, `ai:conversation` | `ai:classify`, `ai:anomaly_detect`, `ai:risk_score` |
| **Stateful?** | Yes (conversation context) | No (pure function) |
| **In Compliance Lock?** | No | Yes |
| **Who calls them?** | Users, applications | Logic ASTs, rules |
| **Data sovereignty** | Tier A: self-hosted. Tier B: cloud permitted | Always Tier A (self-hosted) |

---

## 17. Tier 2: Generative UI

The Generative UI system stores view definitions and action bindings that Applications render dynamically. Packs contribute UI declarations at install time; Applications consume them at render time.

> **Moved here from the Registry design.** UI declarations are stateful (stored in the database), making them a Kernel Platform Service rather than a Registry concern.

### Capabilities

| Tool | Purpose |
|------|---------|
| `ui:define_view` | Map entity schemas to visual components (dashboards, detail views, tables, kanban, graph explorers) |
| `ui:register_action` | Bind UI buttons to workflow transitions, handlers, drivers, or external URLs |
| `ui:list_views` | List all view definitions for an entity type or vertical |
| `ui:delete_view` | Remove a view definition |

### Key Design Decisions

- **Declarative, not imperative**: AI agents declare *what* the UI should show, not *how* to render it. Applications choose the rendering technology.
- **Widget type system**: Standard widget types (`text`, `number`, `gauge`, `pie_chart`, `bar_chart`, `table`, `graph_explorer`, `compliance_summary`, `credential_card`, etc.) that any Application can implement
- **Conditional visibility**: Components can be shown/hidden based on field values or workflow state
- **Data binding**: Components can bind to entity fields, handler results, or graph queries (Cypher)
- **Workflow integration**: Views can include state badges, transition buttons, and workflow timelines
- **Action guards**: UI actions can have visibility guards (workflow state checks, handler-based guards) that control when buttons appear

### `ui:define_view` Schema

```typescript
"ui:define_view": {
  input: {
    vertical_id: string,
    entity_type: string,                   // "battery_cell", "cosmetic_product"
    view_id: string,                       // "dashboard", "detail", "comparison"
    layout: "dashboard" | "detail" | "table" | "kanban" | "graph",

    components: Array<{
      field: string,                       // Entity schema path: "chemistry.anode"
      widget: WidgetType,
      title?: string,
      config?: Record<string, unknown>,    // Widget-specific config

      visible_when?: {
        field: string,
        operator: 'eq' | 'ne' | 'in' | 'not_empty';
        value?: unknown
      },

      data_source?: {
        type: 'field' | 'handler' | 'graph_query';
        handler?: { handler: string; config: unknown };
        cypher?: string;
      }
    }>,

    workflow_integration?: {
      show_state_badge: boolean,
      show_transition_buttons: boolean,
      show_timeline: boolean
    }
  },
  output: {
    view_id: string,
    status: "created" | "updated"
  }
}
```

### `ui:register_action` Schema

```typescript
"ui:register_action": {
  input: {
    vertical_id: string,
    action_id: string,
    label: string,
    icon?: string,

    placement: {
      entity_type: string,
      view_ids?: string[],
      position?: 'toolbar' | 'context_menu' | 'inline';
    },

    visible_when?: {
      workflow_state?: string[],
      guard?: ASTNode
    },

    on_click: {
      type: 'workflow_transition' | 'handler' | 'driver' | 'external_url';
      transition_id?: string,
      handler?: string,
      handler_config?: unknown,
      url_template?: string,
      confirm_message?: string
    }
  },
  output: {
    action_id: string,
    status: "registered"
  }
}
```

---

## 18. Tier 2: Events

The internal event system provides publish/subscribe within a tenant. It is the **internal projection** of the unified event architecture described in the [Compliance Network Design](./2026-02-02-compliance-network-design.md#7-primitive-5-subscriptions). External cross-company events use `a2a:subscribe` / `a2a:publish`; internal tenant events use `events:*`. Both operate on the same `UniversalEvent` object.

### Capabilities

| Tool | Purpose |
|------|---------|
| `events:subscribe` | Subscribe to internal events by type, entity, severity, with callback/webhook/queue delivery and reactive automations |
| `events:emit` | Emit an event (used as workflow effect handler, also callable directly) |

### Key Design Decisions

- **Unified with A2A**: A single `events:emit` call with `visibility: "both"` simultaneously notifies internal subscribers (via `events:subscribe`) and external subscribers (via `a2a:subscribe`). The event object is identical; only delivery and trust verification differ.
- **Reactive automations**: Subscriptions can trigger handlers, notify users/roles, or fire workflow transitions when events arrive.
- **Application hooks**: The event system provides hook points in the Kernel VM execution lifecycle (`kernel_vm.pre_evaluation`, `kernel_vm.post_evaluation`, `workflow.pre_transition`, `workflow.post_transition`, `temporal.deadline_warning`, `temporal.deadline_expired`, `registry.pack_installed`, `registry.lock_updated`).
- **Full spec in Network Design**: The `UniversalEvent` schema, internal MCP tool signatures, and application hook reference are fully specified in the [Compliance Network Design, Section 7](./2026-02-02-compliance-network-design.md#7-primitive-5-subscriptions).

---

## 19. The Bridge: How Handlers Reach Platform Services

The bridge between Kernel VM and Platform Services operates through three well-defined channels:

### 18.1 ExecutionContext (VM → Services)

When the Kernel VM evaluates a rule, the `ExecutionContext` provides read-only access to entity data. Platform Services resolves this:

```typescript
interface ExecutionContext {
  // Entity data (resolved by Platform Services)
  entityData: Record<string, unknown>;
  relatedEntities: Record<string, Entity[]>;

  // Graph access (resolved by Platform Services + Neo4j)
  graph: GraphQueryInterface;

  // Tenant context
  tenant_id: string;
  evaluation_id: string;
}
```

The Kernel VM never calls `entity:read` directly. The Kernel pre-loads the required data into the context before evaluation begins. This maintains the handler's purity -- it receives data, it doesn't fetch it.

### 18.2 Computed Fields (Services → VM)

When an entity is created or updated, Platform Services checks for computed fields and delegates to the Kernel VM:

```
entity:update(product_id, { materials: [...] })
  └── Platform Services detects computed field: "total_lead_concentration"
      └── Kernel VM evaluates: core:bom_sum({ source: "materials", field: "lead_ppm" })
          └── Result written back to entity
```

### 18.3 Workflow Effects (VM → Services)

When a workflow transition fires, its effects can call Platform Services:

```
meta:transition(product_id, "review" → "approved")
  └── Guard phase: Kernel VM evaluates guards (pure)
  └── Transition phase: State updated
  └── Effect phase: Platform Services called
      ├── task:create({ title: "Schedule production", assignee: "role:production_manager" })
      ├── notify:send({ to: [{ type: "role", id: "quality_lead" }], notification_type: "product_approved" })
      └── file:generate_certificate(product_id)  // via Driver Pack
```

The effect phase is explicitly **not** part of the compliance evaluation. It is logged in the Audit Log, not the Compliance Lock.

---

## 20. Kernel Service Summary

### Tier 1: Full Schema Specification (This Document)

| Service | Tool Count | Purpose |
|---------|-----------|---------|
| **Entity Management** | 11 | Define entity types, CRUD instances, bulk operations |
| **Relations & Graph** | 6 | Define relation types, manage edges, query connections |
| **Search & Discovery** | 6 | Full-text, semantic, and structured search |
| **Permissions (RBAC)** | 7 | Role definition, grant/revoke, access checks, groups |
| **File Management** | 8 | Upload, attach, version, parse documents |
| **Subtotal** | **38** | |

### Tier 2: Capability Specification (This Document)

| Service | Tool Count | Purpose |
|---------|-----------|---------|
| **Version Control** | 6 | History, compare, restore, branch, merge |
| **Tasks & Assignments** | 6 | Create, update, complete, assign, delegate |
| **Comments & Collaboration** | 5 | Add, list, edit, delete, resolve threads |
| **Notifications** | 6 | Channels, send, preferences, inbox |
| **Audit Log** | 3 | Query, export, retention |
| **Jobs** | 5 | Submit, status, cancel, list, retry |
| **Templates & Cloning** | 4 | Define, instantiate, list, clone |
| **Localization** | 4 | Define translations, translate, get, UI strings |
| **AI Runtime** | 7 | Query, execute, explain, suggest, design, conversation |
| **Generative UI** | 4 | Define views, register actions, list, delete |
| **Events** | 2 | Subscribe to internal events, emit events |
| **Subtotal** | **52** | |

### Grand Total

| Component | Tool Count |
|-----------|-----------|
| Kernel VM | ~53 |
| Platform Services Tier 1 | 38 |
| Platform Services Tier 2 | 52 |
| **Total Kernel Surface** | **~143** |

### What Lives Outside the Kernel (Driver Packs)

| Category | Examples | Registry Namespace |
|----------|---------|-------------------|
| Document Generation | PDF reports, certificates | `@services/pdf-report-builder` |
| DPP Generation | Battery passports, product passports | `@services/dpp-generator` |
| Integrations | SAP sync, Salesforce CRM | `@connectors/sap-material-sync` |
| Import Pipelines | CSV importers, EDI parsers | `@services/csv-importer` |
| Analytics Dashboards | Compliance dashboards, trend reports | `@services/analytics-engine` |
| Specialized Agents | SDS parser, regulatory advisor | `@agents/sds-parser-de` |
| Translation Content | German hazard statements, French labels | `@i18n/eu-clp-de` |

---

*This document is part of the EuroComply Compliance OS design series:*
- *[Kernel VM Design](./2026-02-02-compliance-handler-vm.md) -- The compute half of the Kernel*
- *[Compliance Network Design](./2026-02-02-compliance-network-design.md) -- A2A Protocol (System Services)*
- *[Registry Design](./2026-02-03-registry-design.md) -- Package management (System Services)*
- ***Platform Services Layer (this document) -- The state half of the Kernel***
