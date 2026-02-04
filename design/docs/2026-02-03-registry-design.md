# The Registry

> **Status:** DRAFT
> **Created:** 2026-02-03
> **Authors:** Human + Claude (Brainstorming Session)
> **Depends On:** [Kernel VM Design](./2026-02-02-compliance-handler-vm.md), [Compliance Network Design](./2026-02-02-compliance-network-design.md), [Platform Services Layer](./2026-02-03-platform-services-layer.md)

---

## Executive Summary

The Registry is the package management System Service of the EuroComply Compliance OS. It sits alongside the A2A Protocol as a peer System Service, above the Kernel (Kernel VM + Platform Services) and below the Applications.

```
┌───────────────────────────────────────────────────────┐
│                    APPLICATIONS                        │
├───────────────────────────────────────────────────────┤
│                  SYSTEM SERVICES                       │
│  ┌──────────────────┐  ┌──────────────────────┐       │
│  │  THE REGISTRY    │  │  A2A Protocol        │       │
│  │  ← THIS DOC      │  │                      │       │
│  └──────────────────┘  └──────────────────────┘       │
├───────────────────────────────────────────────────────┤
│                      KERNEL                            │
│  ┌──────────────┐       ┌──────────────────────┐      │
│  │  Kernel VM  │◄─────►│  Platform Services   │      │
│  │  (Compute)   │       │  (State)             │      │
│  └──────────────┘       └──────────────────────┘      │
├───────────────────────────────────────────────────────┤
│                  INFRASTRUCTURE                        │
│       PostgreSQL  Neo4j  R2  LLM Gateway               │
└───────────────────────────────────────────────────────┘
```

The Registry is the single point of truth for all executable compliance content. An AI agent building a new vertical fetches everything it needs -- schemas, rules, connectors, validation suites -- from one place.

What makes it different from npm or Docker Hub: every package is executable compliance logic backed by cryptographic guarantees. Installing a pack doesn't just add code -- it adds auditable, replayable, liability-traceable regulatory intelligence. The Simulator validates before install. The Compliance Lock pins exact versions at evaluation time. The Cascade resolves conflicts transparently. Together they create **Compliance Determinism** -- compliance as an immutable, reproducible state rather than an opinion.

### Core Insight

```
The Kernel = Kernel VM (computation) + Platform Services (state).
The Registry is the unified repository that houses the drivers,
data models, and application logic that run on the Kernel.

- Kernel VM = CPU instructions (pure computation)
- Platform Services = Syscalls (stateful operations)
- Registry = Package Manager (programs, drivers, data)
- Simulator = Compiler (validates before deployment)
- Compliance Lock = Binary (the exact executable state)
```

---

## Table of Contents

1. [Package Hierarchy](#1-package-hierarchy)
2. [The Manifest](#2-the-manifest)
3. [Compliance Determinism & The Simulator](#3-compliance-determinism--the-simulator)
4. [The Rule Cascade & Conflict Resolution](#4-the-rule-cascade--conflict-resolution)
5. [The Trust Model](#5-the-trust-model)
6. [Registry Integration with the Compliance OS](#6-registry-integration-with-the-compliance-os)
7. [Implementation Roadmap](#7-implementation-roadmap)

---

## 1. Package Hierarchy

The Registry organizes content into four package types, each serving a distinct role in the OS metaphor.

### 1.1 Logic Packs -- "The Libraries"

The most common unit. A Logic Pack contains the Rule Logic ASTs -- the actual composed handler programs -- along with its mandatory Validation Suite. You cannot publish a rule without the tests that prove it works in the Simulator.

Examples: `@eu/reach-svhc-article-33`, `@eu/clp-classification-labeling`, `@us/tsca-inventory-check`

### 1.2 Environment Packs -- "The Distros"

Bundles that tell the OS how to set up the room for a specific industry. An Environment Pack groups multiple Logic Packs together with the Entity Schemas and Workspace configurations needed to run them.

- **Verticals:** High-level manifests grouping Logic Packs (e.g., `@eu/cosmetics-vertical`)
- **Entity Schemas:** Data blueprints the Graph must store for the rules to execute (e.g., `cosmetics:inci-listing`, `batteries:cell-chemistry`)
- **Workspaces:** Pre-configured UI layouts and role-based access controls

Examples: `@eu/biocides-vertical`, `@eu/batteries-regulation-vertical`

### 1.3 Driver Packs -- "The Connectors"

I/O modules that translate between external systems and EuroComply's Entity Schemas. SAP IDocs, Salesforce objects, EDI messages -- Driver Packs normalize them into the Graph.

Also includes Agent Templates: pre-tuned AI prompts for specific document types (e.g., a "German SDS Parser" agent).

Examples: `@connectors/sap-material-sync`, `@connectors/edi-edifact`, `@agents/sds-parser-de`

### 1.4 Intelligence Packs -- "The Oracles"

Reference data and analytical baselines. Registry Mappings provide official cross-walks between identifier systems. Benchmarking Data provides anonymized industry averages used by `ai:anomaly_detect` to flag suspicious claims.

Examples: `@data/sku-to-gsr-mapping`, `@data/cosmetics-industry-benchmarks`

### Summary

| Pack Type | OS Analogy | Contains |
|-----------|------------|----------|
| **Logic** | Libraries | Rule ASTs + Validation Suites |
| **Environment** | Distros | Verticals + Schemas + Workspaces |
| **Driver** | Device Drivers | Connectors + Agent Templates |
| **Intelligence** | Data Packages | Mappings + Benchmarks |

---

## 2. The Manifest

Every package in the Registry declares itself through a manifest (`pack.json`). This is the development-time contract -- what the pack is, what it needs, and what it's compatible with.

```json
{
  "name": "@eu/cosmetics-regulation-1223",
  "version": "2.1.0",
  "type": "logic",
  "author": {
    "name": "TUV SUD",
    "did": "did:web:tuvsud.com"
  },
  "trust_tier": "certified",

  "handler_vm_version": "^1.0.0",

  "dependencies": {
    "@eu/reach-svhc": "^1.4.0",
    "@eurocomply/clp-classification": "^3.0.0"
  },

  "required_schemas": [
    { "id": "core:product_composition", "version": "^1.0.0" },
    { "id": "cosmetics:inci_listing", "version": "^1.2.0" }
  ],

  "scope": {
    "verticals": ["cosmetics"],
    "markets": ["EU"],
    "entity_types": ["cosmetic_product"]
  },

  "regulation_ref": "gsr:reg:EU_1223_2009",

  "logic_root": "rules/main.ast.json",
  "validation_suite": "tests/validation_suite.json",
  "validation_hash": "sha256:a1b2c3...",
  "documentation_root": "docs/",

  "conflict_resolution": {
    "strategy": "most_restrictive",
    "overridable": true
  }
}
```

### Field Reference

| Field | Purpose |
|-------|---------|
| `type` | Which of the four pack types: `logic`, `environment`, `driver`, `intelligence` |
| `trust_tier` | `community`, `verified`, or `certified` |
| `handler_vm_version` | Semver range for VM compatibility. The Compliance Lock pins the exact version at evaluation time |
| `scope` | Defines where this pack's rules fire. Primary defense against conflicts -- rules only execute when vertical, market, and entity type match |
| `regulation_ref` | Links the pack to a specific regulation in the GSR. Enables the Graph to show exactly which law is automated. Enables `ai:explain` to cite the source regulation |
| `validation_hash` | Cryptographic hash of the validation suite. If tests are tampered with, the Simulator refuses to run the pack |
| `documentation_root` | Human-readable guidance the `ai:explain` handler draws from when generating failure explanations |
| `conflict_resolution` | The pack's default strategy when collisions occur. Tenants can override in their local policy |
| `logic_root` | Entry point to the Logic AST -- the composed handler tree |
| `required_schemas` | Entity Schemas the Graph must have for the rules to execute |

---

## 3. Compliance Determinism & The Simulator

The Registry transitions from a passive library to an active operating system through the Simulator. This is the process that converts the development-time Manifest into the runtime Compliance Lock.

### 3.1 The Two-Layer Versioning Model

| File | Purpose | Versions | Mutability | Audit Value |
|------|---------|----------|------------|-------------|
| **Manifest** (`pack.json`) | "What I'm compatible with" | Semver ranges | Mutable during development | Discovery: "Can I install this?" |
| **Compliance Lock** (`compliance-lock.json`) | "What actually ran" | Exact pins + content hashes | Immutable after evaluation | Replay: "Prove exactly why this passed" |

Without the exact pin in the Compliance Lock, the replay guarantee evaporates -- a minor patch in the Kernel VM could theoretically change a rounding behavior or a unit conversion, altering the final result.

### 3.2 The Shadow Test Workflow

When an AI agent or admin initiates an install or update:

1. **Dependency Resolution** -- The Registry fetches pinned versions of all dependencies and required schemas.
2. **Shadow Schema Creation** -- The Simulator forks the tenant's data into a temporary shadow schema.
3. **Validation Playback** -- Runs the pack's validation suite against its own logic to verify it isn't broken on arrival.
4. **Portfolio Diff** -- Runs the new logic against the tenant's actual products. Generates an Impact Analysis: *"3 products will lose compliance status."*
5. **Human Approval** -- The diff report is presented. Only after explicit approval does the system proceed.
6. **Lock Commit** -- The `compliance-lock.json` is updated with exact pins and content hashes.

### 3.3 The Compliance Lock

The cryptographic root of trust for all future audits:

```json
{
  "evaluation_id": "eval_88231",
  "timestamp": "2026-03-15T10:00:00Z",
  "handler_vm_exact": "1.0.3-build.442",
  "root_pack": {
    "id": "@eu/cosmetics-regulation-1223",
    "version": "2.1.0",
    "cid": "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3..."
  },
  "packs": {
    "@eu/reach-svhc@1.4.2": {
      "cid": "bafybeihkoviema7g3gxyt6la7vd5ho32...",
      "signature": "z3FXQje...",
      "publisher_did": "did:web:echa.europa.eu",
      "trust_tier": "certified"
    },
    "@eurocomply/clp-classification@3.0.1": {
      "cid": "bafybeiemxf5abjwjbikoz4mc3a3dla6ual...",
      "signature": "y8KLMnp...",
      "publisher_did": "did:web:eurocomply.com",
      "trust_tier": "verified"
    }
  },
  "schemas": {
    "core:product_composition@1.0.0": {
      "cid": "bafybeif7ztnhq65lumvvqextoem3gkoi..."
    },
    "cosmetics:inci_listing@1.2.0": {
      "cid": "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3..."
    }
  }
}
```

### 3.4 Deterministic Replay

Because every handler is a pure function, any auditor with the same input data and the same Compliance Lock will arrive at the exact same pass/fail result, down to the last decimal.

**Transitive Integrity:** If `@eu/cosmetics` depends on `@eu/reach`, and the REACH pack is updated, the product's status doesn't change. It stays pinned to the version used for certification until the tenant chooses to "bump" the version and pass the Simulator again.

**The Evidence Chain:** The Explanation and ExecutionTrace generated by the handlers are hashed and attached to the Verifiable Credential (VC). The proof isn't a PDF -- it's a machine-readable map of every handler instruction executed to reach that decision.

### 3.5 Liability Proofing

If a regulator finds a banned substance in a product that EuroComply marked as "Compliant," the audit trail reveals exactly where the failure occurred:

| Failure Type | Root Cause | The Trace Points To |
|--------------|------------|---------------------|
| **Data Failure** | Input data from the supplier was wrong | The supplier's signed VC |
| **Logic Failure** | The Logic Pack's AST missed a check | The specific Rule Pack version and CID |
| **Platform Failure** | A handler computed incorrectly | The Kernel VM version |

This turns an audit from a months-long investigation into a graph query that identifies the root cause in seconds:

```cypher
MATCH (p:Product {id: "X"})-[:EVALUATED_BY]->(lock:ComplianceLock)
RETURN lock.vm_version, lock.rule_pack_hash, lock.timestamp
```

---

## 4. The Rule Cascade & Conflict Resolution

A product can exist in multiple jurisdictions and industry categories, triggering rules from multiple Logic Packs simultaneously. The system resolves overlaps through a structured Cascade -- CSS for regulations.

### 4.1 Cascade Layers

When the Kernel VM evaluates a product, it assembles a Rule Stack based on the product's metadata in the Graph. Lower layers provide the baseline; higher layers can override.

```
+---------------------------------------------------+
|  LOCAL POLICY (Highest Priority)                  |
|  Tenant-specific rules from Private Registry      |
|  "Our company bans X even if the law allows it"  |
+---------------------------------------------------+
|  REGIONAL OVERRIDES                               |
|  Market-specific restrictions                     |
|  "In Sweden, this substance is further limited"   |
+---------------------------------------------------+
|  ENVIRONMENT PACKS (Verticals)                    |
|  Industry-wide rules                              |
|  "EU Cosmetics 1223 standard checks"              |
+---------------------------------------------------+
|  SYSTEM BASE (Lowest Priority)                    |
|  Cross-cutting rules for all products             |
|  "Basic data completeness, format validation"     |
+---------------------------------------------------+
```

### 4.2 Scope Isolation (Primary Defense)

Every Rule Pack defines its Application Scope in the manifest. A rule is not a global variable; it is a function that only executes when the Entity Schema and Context match.

- **Vertical Tagging:** A product in the Graph is tagged by the user or an AI Agent (e.g., `type: "Cosmetic"` or `type: "Biocide"`).
- **Scoped Execution:** The Kernel VM filters the active rules based on these tags. A hand sanitizer tagged as only a biocide will never trigger the cosmetics check.

This prevents 90% of accidental conflicts by design.

### 4.3 Conflict Detection at Install Time

For products that straddle verticals (like a cosmetic cream with biocidal claims), the Simulator performs a **Logic Overlap Analysis** during the Shadow Test -- static analysis of the installed Logic ASTs to find rules targeting the same GSR ID within overlapping scopes.

When a new Logic Pack introduces an overlap, the Simulator generates an **Interaction Map** in the Diff Report:

> *"Warning: Installing `@us/pfas-act` creates a collision with `@internal/green-policy` on 12 substances. Default strategy: Most Restrictive. 2 products affected."*

The tenant resolves the collision before the lock is committed.

### 4.4 Conflict Strategies

The `conflict_resolution` strategy in each manifest dictates behavior when two rules in the stack target the same substance or field. Tenants can override the default in their registry policy.

| Strategy | Logic | Audit Trace Example |
|----------|-------|---------------------|
| **Most Restrictive** | `min(threshold_a, threshold_b)` | "Applied 0.1% limit: Cosmetics Pack (0.1%) vs. Biocides Pack (0.2%)" |
| **Explicit Priority** | Weight defined in tenant policy | "Applied 0.2% limit: Biocides PT6 prioritized per Tenant Policy v2" |
| **Merge** | Aggregate results (rare, used for risk scores) | "Calculated mean risk score (3.5) from environmental and safety packs" |

**Most Restrictive** is the default -- in the absence of a manual override, the system defaults to the choice that minimizes liability.

### 4.5 Resolution Handler: `core:rule_resolve`

When a collision is detected, the system invokes the existing `core:rule_resolve` handler. The tenant configures their preferred resolution strategy. The audit trace captures which rule won and why -- transparency is what makes it liability-proof.

### 4.6 Why the Cascade Matters

The cascade makes the system uniquely interoperable:

- A company adopts public EU rules today
- They layer private policies on top without breaking the public audit trail
- They share their Liability Trace through the A2A Protocol, and the recipient's Registry knows exactly how to interpret the cascade that produced the result

---

## 5. The Trust Model

The Registry must answer two questions for every package: **who published this**, and **should I trust them**?

### 5.1 Trust Tiers

Every package carries a trust tier that reflects its verification status.

| Tier | Who Can Publish | Verification | Use Case |
|------|----------------|--------------|----------|
| **`community`** | Anyone with a DID | None -- self-published, self-signed | Internal experiments, early-stage rules, niche verticals |
| **`verified`** | Verified organizations | EuroComply reviews the Logic AST and Validation Suite for correctness | Production-ready rules from known companies |
| **`certified`** | Accredited bodies | Independent third-party audit of logic against the source regulation (e.g., TUV, SGS, Bureau Veritas signs the pack) | Regulated industries where liability demands external validation |

### 5.2 Tenant Trust Policy

Tenants configure which tiers they accept:

```json
{
  "trust_policy": {
    "minimum_tier": "verified",
    "exceptions": [
      { "scope": "@internal/*", "tier": "community" },
      { "scope": "@eu/reach-*", "tier": "certified" }
    ]
  }
}
```

A pharmaceutical company might require `certified` for everything. A startup might accept `community` packs from their own private registry while requiring `verified` for public packs.

### 5.3 Identity: DIDs as Publisher Credentials

Every publisher is identified by a Decentralized Identifier (DID). The DID is the cryptographic root that links a package to its author.

```
Publisher: TUV SUD
DID:       did:web:tuvsud.com
Public Key: Registered in DID Document

Pack Signature Flow:
1. Author creates Logic Pack
2. Author signs pack.json with their DID's private key
3. Registry stores the signature
4. At install time, Simulator verifies signature against DID Document
5. If signature is invalid -> install blocked
```

Trust is not granted by EuroComply -- it is cryptographically proven by the publisher's own identity. EuroComply is a verifier, not a gatekeeper.

### 5.4 Public vs Private Registries

The Registry operates as a federated system. There is one public registry and any number of private registries.

```
+------------------------------------------------------+
|                   PUBLIC REGISTRY                     |
|                                                      |
|  @eu/reach-svhc           (certified, TUV)           |
|  @eu/cosmetics-1223       (certified, SGS)           |
|  @eu/biocides-528         (verified)                 |
|  @community/textile-oeko  (community)                |
|                                                      |
+---------------+--------------------------+-----------+
                |                          |
                v                          v
+----------------------+  +------------------------+
|  PRIVATE REGISTRY    |  |  PRIVATE REGISTRY      |
|  Acme Corp           |  |  ChemCo GmbH           |
|                      |  |                        |
|  @internal/green-    |  |  @internal/battery-    |
|    policy            |  |    chemistry-rules     |
|  @internal/supplier- |  |  @internal/de-market   |
|    overrides         |  |    overrides           |
|                      |  |                        |
|  Can depend on       |  |  Can depend on         |
|  public packs        |  |  public packs          |
|  Invisible to other  |  |  Invisible to other    |
|  registries          |  |  registries            |
+----------------------+  +------------------------+
```

**Key rules:**

- Private packs can depend on public packs (e.g., `@internal/green-policy` depends on `@eu/reach-svhc`)
- **Public packs can never depend on private CIDs** -- if a public rule depends on a private one, the audit trail goes dark for the entire industry. The `registry:publish` tool enforces that all dependencies are reachable at the same visibility level or higher
- Private packs are invisible to other registries -- proprietary logic stays proprietary
- The Compliance Lock records which registry each pack came from, so auditors can verify the full chain

### 5.5 Negotiated Disclosure in A2A

When a claim crosses company boundaries, total transparency is not realistic -- companies will never share their most valuable IP by default. The system uses a **Negotiated Disclosure** model aligned with the A2A Protocol's Evidence Primitive.

When Company B calls `a2a:request_claim` with a specific evidence depth, Company A's system checks each CID in the compliance lock:

| Pack Visibility | Disclosure Level | What Company B Receives |
|-----------------|------------------|-------------------------|
| **Public** | Automatic | CID reference only (Company B fetches it themselves) |
| **Private, Full** | Peer trust: high | Actual Logic AST JSON included in the response |
| **Private, Grant** | Peer trust: medium | Temporary DID-scoped access token to fetch from Company A's Registry |
| **Private, Opaque** | Peer trust: low | CID and signature only |

### 5.6 Reproducibility Score

The system calculates a `reproducibility_score` based on what was actually shared:

| Score | Meaning | Implication |
|-------|---------|-------------|
| **100%** | All CIDs are public or fully disclosed | Company B can replay the evaluation in their own Simulator. Zero trust required |
| **50%** | Some CIDs are private/opaque | Company B can verify the public rules but must trust the certified signature for private logic |
| **0%** | Logic is entirely hidden | Verification is a pure assertion |

The score is a functional constraint for the recipient's risk engine. A buyer's procurement policy can require "80%+ reproducibility from tier-1 suppliers" and the system enforces it automatically.

### 5.7 Trust Verification in A2A

When Company A shares a Liability Trace with Company B:

1. Read the `compliance-lock.json` from the trace
2. For each pack: resolve the publisher's DID, verify the signature
3. Check the trust tier against Company B's own Trust Policy
4. Calculate reproducibility score from what was disclosed
5. Result: *"This evaluation used 3 certified packs and 1 verified pack. All publishers verified. Reproducibility: 85%. Acceptable per procurement policy."*

---

## 6. Registry Integration with the Compliance OS

### 6.1 MCP as the Universal Interface

The Registry is exposed as first-class MCP tools using the `registry:` namespace, alongside `entity:`, `meta:`, `a2a:`, and other namespaces defined in the Platform Services Layer design. AI agents interact with the Registry through the same MCP protocol they use for everything else.

```
+-----------------------------------------------------------------------+
|                    AI AGENT (Claude, GPT, etc.)                        |
+-----------------------------------------------------------------------+
                              |
                              | MCP Protocol
                              v
+-----------------------------------------------------------------------+
|                    SPOKE MCP SERVER                                    |
+-----------------------------------------------------------------------+
|                                                                       |
|  +---------+ +---------+ +---------+ +---------+ +---------+ +-----+ |
|  |registry:| |  meta:  | | entity: | |  a2a:   | | devel:  | | ui: | |
|  |  Tools  | |  Tools  | |  Tools  | |  Tools  | |  Tools  | |Tools| |
|  +---------+ +---------+ +---------+ +---------+ +---------+ +-----+ |
|  |search   | |create_  | |create   | |resolve_ | |scaffold | |def_ | |
|  |inspect  | | vertical| |read     | | identity| |lint     | | view| |
|  |install  | |create_  | |update   | |issue_   | |test     | |reg_ | |
|  |publish  | | rule    | |list     | | claim   | |compile  | | act | |
|  |bump     | |define_  | |define   | |verify_  | |         | |     | |
|  |lock     | | workflow| |         | | claim   | |         | |     | |
|  |diff     | |transit. | |         | |request_ | |         | |     | |
|  |         | |         | |         | | claim   | |         | |     | |
|  +---------+ +---------+ +---------+ +---------+ +---------+ +-----+ |
|       |            |                                  |               |
|       | Registry   | Simulator           Compile-time |               |
|       | feeds ---> | validates  <------- validation   |               |
|       v            v                                                  |
|  +-----------------------------------------------------+             |
|  |                    SIMULATOR                         |             |
|  |  Shadow Schema -> Validate -> Diff -> Human Approve  |             |
|  +-----------------------------------------------------+             |
|                           |                                           |
|                           v                                           |
|  +-----------------------------------------------------+             |
|  |                       KERNEL                         |             |
|  | Kernel VM (pure computation) + Platform Services     |             |
|  +-----------------------------------------------------+             |
|                           |                                           |
|                           v                                           |
|  +-----------------------------------------------------+             |
|  |                  INFRASTRUCTURE                      |             |
|  |  PostgreSQL    Neo4j    Object Storage   LLM Gateway |             |
|  +-----------------------------------------------------+             |
|                                                                       |
+-----------------------------------------------------------------------+
```

### 6.2 The Relationship: Registry -> META -> Simulator

Registry tools and META tools are connected but distinct:

- **Registry tools** manage packages as artifacts -- search, inspect, install, publish
- **META tools** manage the tenant's live configuration -- create verticals, define rules, configure workspaces
- **The Simulator** sits between them, validating before anything reaches production

Installing a pack is a batch META operation -- the pack's manifest declares the verticals, rules, schemas, and workspaces, and the Simulator validates them all as a single atomic change.

```
registry:search -> registry:inspect -> registry:install
                                            |
                                            v
                                      SIMULATOR
                                      (Shadow Test)
                                            |
                                            v
                                      META tools fire
                                      (create_vertical,
                                       create_rule, etc.)
                                            |
                                            v
                                      compliance-lock.json
                                      updated with CIDs
```

### 6.3 Registry MCP Tools

```typescript
// Discover packs
"registry:search": {
  input: {
    query?: string,                    // "cosmetics regulation EU"
    type?: "logic" | "environment" | "driver" | "intelligence",
    scope?: {
      vertical?: string,
      market?: string
    },
    trust_tier_minimum?: "community" | "verified" | "certified",
    limit?: number
  },
  output: {
    packs: Array<{
      name: string,
      version: string,
      type: string,
      trust_tier: string,
      publisher: { name: string, did: string },
      description: string,
      dependencies: string[],
      cid: string
    }>
  }
}

// Examine a pack before installing
"registry:inspect": {
  input: {
    pack: string,                      // "@eu/cosmetics-1223@2.1.0"
    include?: {
      manifest?: boolean,
      dependency_tree?: boolean,
      validation_suite_summary?: boolean,
      logic_ast_summary?: boolean,
      conflict_preview?: boolean       // Check against currently installed packs
    }
  },
  output: {
    manifest: PackManifest,
    dependency_tree?: DependencyNode[],
    validation_suite?: { test_count: number, pass_rate: number },
    logic_summary?: { rules: number, handlers_used: string[] },
    potential_conflicts?: Array<{
      installed_pack: string,
      overlap_type: string,
      affected_substances: number
    }>
  }
}

// Install a pack (triggers Simulator)
"registry:install": {
  input: {
    pack: string,                      // "@eu/cosmetics-1223@2.1.0"
    conflict_strategy?: "most_restrictive" | "explicit_priority" | "merge",
    auto_approve?: boolean             // false for META changes
  },
  output: {
    simulation_id: string,
    status: "simulating" | "awaiting_approval" | "failed",
    diff_preview?: {
      packs_to_install: number,
      schemas_to_create: number,
      rules_to_add: number,
      products_affected: number,
      compliance_status_changes: number
    }
  }
}

// Publish a pack to a registry
"registry:publish": {
  input: {
    registry: "public" | string,       // "public" or private registry DID
    manifest: PackManifest,
    content_root: string,              // Path to pack content
    sign_with: string                  // DID key reference for signing
  },
  output: {
    cid: string,                       // Content-addressed ID
    signature: string,
    published_to: string,
    trust_tier: string                 // Starts as "community" on public
  }
}

// Check for updates and preview impact
"registry:bump": {
  input: {
    pack?: string,                     // Specific pack, or omit for all
    target_version?: string,           // Specific version, or "latest"
    dry_run?: boolean                  // Preview only, don't trigger Simulator
  },
  output: {
    available_updates: Array<{
      pack: string,
      current_version: string,
      current_cid: string,
      available_version: string,
      available_cid: string,
      changelog_summary: string,
      breaking_changes: boolean
    }>,
    simulation_id?: string             // If dry_run is false
  }
}

// View, export, verify, or prove the current compliance lock
"registry:lock": {
  input: {
    action: "view" | "export" | "verify" | "prove",
    product_id?: string,               // Lock for specific product evaluation

    // For selective disclosure (Merkle proof)
    prove?: {
      substance_gsr_id?: string,       // Prove rules for specific substance
      rule_ids?: string[],             // Prove specific rules were applied
      pack_names?: string[]            // Prove specific packs were installed
    }
  },
  output: {
    lock: ComplianceLock,
    reproducibility_score: number,     // 0-1

    verification?: {
      all_cids_valid: boolean,
      all_signatures_valid: boolean,
      all_publishers_resolved: boolean
    }
  }
}

// Generate diff between two lock states
"registry:diff": {
  input: {
    lock_a: string,                    // evaluation_id or timestamp
    lock_b: string,
    include_impact?: boolean
  },
  output: {
    changes: Array<{
      pack: string,
      version_a: string,
      version_b: string,
      cid_a: string,
      cid_b: string,
      rules_added: number,
      rules_removed: number,
      rules_modified: number
    }>,
    impact?: {
      products_with_status_change: number,
      details: Array<{
        product_id: string,
        before: string,
        after: string
      }>
    }
  }
}
```

### 6.4 How A2A Uses the Registry

When Company A shares a Liability Trace with Company B via `a2a:verify_claim`, the verification path goes through the Registry:

```
Company B receives VC from Company A
        |
        v
a2a:verify_claim
        |
        +---> Signature check (DID verification)
        +---> Expiration check
        +---> Revocation check
        |
        +---> Evidence verification
                |
                v
            registry:lock (verify)
                |
                +---> Resolve each CID from the lock
                +---> Verify publisher signatures
                +---> Check trust tiers against
                |     Company B's Trust Policy
                +---> Calculate reproducibility score
                +---> Optionally: replay evaluation
                      with same inputs + same CIDs
                      to confirm deterministic result
```

The Registry is what makes A2A claims independently verifiable -- not just "Company A says this passed" but "here are the exact CIDs of every rule that ran, signed by their publishers, and you can replay it yourself."

### 6.5 The Compile Step (`registry:compile`)

The `registry:compile` tool bridges the gap between raw Logic ASTs (authored by AI agents or human developers) and the validated, executable form that the Simulator runs. It acts as the "compiler" step performed at install time, but exposed as an MCP tool for development-time feedback.

```typescript
"registry:compile": {
  input: {
    logic_ast: ASTNode,                    // Raw Logic AST to compile
    vertical_id?: string,                  // Scope context for resolution

    resolve_identities?: boolean,          // Resolve GSR IDs via Identity Ladder
    validate_schemas?: boolean,            // Check required_schemas are available
    run_hello_world?: boolean,             // Execute against synthetic test cases

    gsr_version?: string                   // Pin to specific GSR version (default: latest)
  },
  output: {
    status: "compiled" | "errors",

    ast_validation: {
      valid: boolean,
      handlers_used: string[],
      unknown_handlers: string[],
      config_errors: Array<{
        path: string,                      // JSON path: "config.conditions[0].handler"
        error: string,                     // "Unknown handler: core:invalid"
        suggestion?: string                // "Did you mean core:threshold_check?"
      }>
    },

    identity_resolution?: {
      identities_resolved: number,
      identities_not_found: Array<{
        identifier: string,
        identifier_type: string,
        suggestions?: string[]
      }>,
      gsr_version_pinned: string
    },

    schema_validation?: {
      schemas_available: string[],
      schemas_missing: string[]
    },

    hello_world_results?: Array<{
      test_case: string,
      input: object,
      expected: 'pass' | 'fail',
      actual: 'pass' | 'fail',
      explanation_generated: boolean,
      trace_hash: string
    }>,

    compiled_ast?: ASTNode,               // Resolved, validated AST ready for Simulator
    estimated_complexity: number           // For execution planning
  }
}
```

**The compile pipeline:**

```
Raw Logic AST (from AI agent or human)
        ↓
registry:compile
        ↓
Step 1: AST Validation
  → All handlers exist in registry?
  → All configs match handler schemas?
  → No circular references?
        ↓
Step 2: Identity Resolution (via Identity Ladder)
  → Resolve substance names/CAS/EC to canonical GSR IDs
  → Pin to specific GSR version
        ↓
Step 3: Schema Validation
  → Are required Entity Schemas installed or declared?
        ↓
Step 4: Hello World Tests
  → Execute against synthetic pass/fail cases
  → Verify explanations are generated
        ↓
Compiled AST (ready for Simulator)
```

### 6.6 Developer Experience Toolset (`devel:*`)

The `devel:*` toolset enables AI agents to operate as full-cycle developers within the Compliance OS. These tools handle the "compile-time" of compliance logic -- everything between ideation and `registry:publish`.

#### `devel:scaffold`

Generates the initial package structure for a new Logic Pack or Environment Pack.

```typescript
"devel:scaffold": {
  input: {
    pack_type: "logic" | "environment" | "driver" | "intelligence",
    name: string,                          // "@eu/agec-anti-waste"
    vertical_id?: string,                  // "cosmetics", "chemicals"
    regulation_id?: string,                // "gsr:reg:EU_AGEC_2020"
    markets?: string[],                    // ["EU", "FR"]

    include?: {
      example_rules?: boolean,             // Generate example rule ASTs
      validation_suite_skeleton?: boolean, // Generate test case placeholders
      readme?: boolean                     // Generate README from regulation
    }
  },
  output: {
    created_files: Array<{
      path: string,
      description: string
    }>,
    pack_json: PackManifest,               // Generated pack.json
    next_steps: string[]                   // Guided instructions for the agent
  }
}
```

**Generated structure:**

```
@eu/agec-anti-waste/
├── pack.json                  # Manifest with scope, dependencies, regulation_ref
├── rules/
│   ├── main.ast.json          # Entry point for Logic AST
│   └── examples/
│       └── example-rule.ast.json
├── schemas/
│   └── (entity schemas if environment pack)
├── tests/
│   ├── validation_suite.json  # Skeleton test cases
│   └── fixtures/
│       └── sample-product.json
└── docs/
    └── README.md              # Generated from regulation reference
```

#### `devel:lint`

Static analysis of Logic ASTs to catch common errors before compilation.

```typescript
"devel:lint": {
  input: {
    ast: ASTNode,                          // The Logic AST to analyze
    pack_manifest?: PackManifest,          // For context-aware linting
    severity_filter?: "error" | "warning" | "info"
  },
  output: {
    valid: boolean,
    diagnostics: Array<{
      severity: "error" | "warning" | "info",
      rule: string,                        // Lint rule ID
      path: string,                        // JSON path to issue
      message: string,
      suggestion?: string,
      auto_fixable?: boolean
    }>
  }
}
```

**Lint rules include:**

| Rule | Severity | Description |
|------|----------|-------------|
| `unit-mismatch` | error | `core:threshold_check` compares values with incompatible units without `core:unit_convert` |
| `missing-normalization` | error | Weighted calculation feeds into threshold without unit normalization |
| `unbounded-for-each` | warning | `core:for_each` without `max_concurrency` on large collections |
| `orphan-handler` | warning | Handler output is never consumed by parent composition |
| `missing-explanation` | info | Handler composition lacks `label` fields for human-readable trace |
| `dead-branch` | warning | `core:if_then` with unreachable `else` branch |
| `infinite-recursion` | error | `core:bom_weighted` with `recurse: true` but no `max_depth` |
| `temporal-without-workflow` | warning | `core:deadline` used outside a workflow definition |
| `stale-gsr-reference` | info | GSR ID references a version older than 6 months |

#### `devel:test`

Runs a local Simulator pass against the developer's Logic AST without affecting any tenant data.

```typescript
"devel:test": {
  input: {
    ast: ASTNode,                          // Logic AST to test
    test_cases: Array<{
      id: string,
      description: string,
      product_data: object,                // Synthetic or fixture data
      expected_result: 'pass' | 'fail',
      expected_guard_failures?: string[],  // Labels of guards that should fail
      expected_warnings?: string[]
    }>,

    options?: {
      fast_forward?: {                     // Virtual time advancement for temporal handlers
        advance_by: { value: number; unit: string }
      },
      mock_gsr_data?: Record<string, unknown>,  // Override GSR lookups for testing
      verbose_trace?: boolean,             // Full execution trace in output
      coverage?: boolean                   // Report which handlers were exercised
    }
  },
  output: {
    summary: {
      total: number,
      passed: number,
      failed: number,
      errors: number
    },

    results: Array<{
      test_id: string,
      status: 'pass' | 'fail' | 'error',
      expected: string,
      actual: string,
      explanation?: Explanation,
      trace?: ExecutionTrace,
      duration_ms: number,
      error_message?: string
    }>,

    coverage?: {
      handlers_exercised: string[],
      handlers_not_exercised: string[],
      coverage_percent: number
    }
  }
}
```

**The `--fast-forward` option** enables testing temporal handlers. When an AI agent defines a deadline of 30 days, `devel:test` with `fast_forward: { advance_by: { value: 31, unit: 'days' } }` verifies the escalation path fires correctly without waiting for real time.

#### `devel:trace_path`

Tests chained workflow transitions by computing a feasibility trace from a starting state to a target state. Instead of testing individual transitions in isolation, this tool answers: "Can this product reach `on_market` from `draft`, and if not, what's blocking each step?"

```typescript
"devel:trace_path": {
  input: {
    workflow_id: string,                   // "workflow:cosmetic_product_lifecycle"
    entity_data: object,                   // Current product data (synthetic or fixture)
    from_state: string,                    // "draft"
    to_state: string,                      // "on_market"

    options?: {
      fast_forward?: {                     // Virtual time for deadline/schedule evaluation
        advance_by: { value: number; unit: string }
      },
      simulate_events?: Array<{            // Inject synthetic events along the path
        after_transition: string,          // After this transition completes
        event: {
          event_type: string,
          claim_type?: string,
          data?: object
        }
      }>,
      max_paths?: number                   // Limit explored paths (default: 5)
    }
  },
  output: {
    reachable: boolean,
    paths: Array<{
      transitions: Array<{
        transition_id: string,
        from_state: string,
        to_state: string,
        trigger: TransitionTrigger,

        guard_evaluation: {
          pass: boolean,
          results: ValidationResult[],
          blockers: Array<{
            label: string,
            reason: string,
            missing_data?: string[],       // Fields the product is missing
            missing_documents?: string[],  // Documents not yet attached
            missing_claims?: string[],     // Upstream credentials needed
            remediation?: string
          }>
        },

        effects_preview?: string[]         // What effects would fire
      }>,

      total_blockers: number,
      estimated_steps: number,
      critical_path: boolean               // Shortest path to target?
    }>,

    summary: {
      shortest_path_length: number,
      total_unique_blockers: number,
      blockers_by_category: {
        data_completeness: number,
        document_requirements: number,
        upstream_claims: number,
        rule_failures: number,
        role_requirements: number
      },
      recommended_next_action: string      // "Complete INCI listing to unblock 'submit_for_safety'"
    }
  }
}
```

**Example:** AI agent building a new vertical tests whether the workflow is navigable:

```typescript
const trace = await mcp.call('devel:trace_path', {
  workflow_id: 'workflow:cosmetic_product_lifecycle',
  entity_data: {
    id: 'test_prod_1',
    name: 'Test Moisturizer',
    intended_use: 'facial moisturizer',
    // Deliberately missing: inci_listing, composition.substances
  },
  from_state: 'draft',
  to_state: 'on_market'
});

// Result:
// {
//   reachable: false,
//   paths: [{
//     transitions: [{
//       transition_id: 'submit_for_safety',
//       from_state: 'draft',
//       to_state: 'safety_assessment',
//       guard_evaluation: {
//         pass: false,
//         blockers: [
//           { label: 'Formulation data complete',
//             missing_data: ['inci_listing', 'composition.substances'],
//             remediation: 'Add INCI ingredient list and full substance breakdown' }
//         ]
//       }
//     }],
//     total_blockers: 1
//   }],
//   summary: {
//     total_unique_blockers: 1,
//     blockers_by_category: { data_completeness: 1 },
//     recommended_next_action: 'Complete INCI listing to unblock submit_for_safety'
//   }
// }
```

### 6.7 UI Meta-Programming Toolset (`ui:*`)

> **Moved to Platform Services Layer.** The `ui:*` toolset (`ui:define_view`, `ui:register_action`) is now defined in the [Platform Services Layer design](./2026-02-03-platform-services-layer.md#17-tier-2-generative-ui). UI declarations are stateful (stored in the database), contributed by Packs at install time, and consumed by Applications at render time -- making them a Kernel Platform Service, not a Registry concern.

### 6.8 The Integrated Agent Workflow

By combining all toolsets, an AI agent can build a complete compliance vertical from a regulatory PDF to a production-ready application:

```
1. INTERPRET
   ai:interpret → extracts requirements from regulatory text

2. SCAFFOLD
   devel:scaffold → creates pack structure with boilerplate

3. COMPOSE
   AI writes Logic ASTs (rules) and Workflow AST (lifecycle)

4. LINT
   devel:lint → catches unit mismatches, missing normalization, orphan handlers

5. COMPILE
   registry:compile → resolves GSR identities, validates schemas, runs hello world

6. TEST
   devel:test → runs validation suite against synthetic data
   devel:test --fast-forward → verifies temporal handlers fire correctly
   devel:trace_path → verifies workflow is navigable end-to-end

7. VISUALIZE
   ui:define_view → creates dashboards mapping entity data to widgets
   ui:register_action → binds UI buttons to workflow transitions and drivers

8. PUBLISH
   registry:publish → signs pack with publisher DID, stores in registry

9. INSTALL
   registry:install → triggers full Simulator shadow test → human approves
```

---

## 7. Implementation Roadmap

The Registry builds on top of the Kernel VM and integrates with the A2A Protocol. Implementation follows the existing v2 platform migration sequence.

### Phase 1: Core Registry Infrastructure

| Deliverable | Description |
|-------------|-------------|
| Pack manifest schema | Zod schema for `pack.json` with all fields (type, scope, integrity, conflict_resolution) |
| Pack storage layer | Content-addressed storage, index mapping `name@version` to CID |
| Pack validation | Manifest parsing, dependency resolution, signature verification |
| `registry:publish` | Publish to public or private registry with DID signing. Enforces: public packs cannot depend on private CIDs |
| `registry:search` | Discovery by type, scope, trust tier, keyword |
| `registry:inspect` | Full manifest view, dependency tree, conflict preview |

### Phase 2: Simulator Integration

| Deliverable | Description |
|-------------|-------------|
| `registry:install` | Triggers Simulator Shadow Test workflow |
| Shadow Test pipeline | Dependency fetch, shadow schema, validation playback, portfolio diff |
| Compliance Lock generation | Lock construction from resolved CIDs with exact version pins |
| `registry:bump` | Update detection, dry-run diff, Safe Bump workflow |
| Conflict detection | Static analysis of Logic ASTs for overlapping scope + same GSR ID |
| Rule Cascade engine | Layer resolution (System, Vertical, Regional, Local) with configurable strategy |

### Phase 3: Trust & Identity

| Deliverable | Description |
|-------------|-------------|
| DID integration | Publisher identity via `did:web`, signature verification against DID Documents |
| Trust tier system | `community` / `verified` / `certified` with tenant Trust Policy configuration |
| Trust Policy enforcement | Minimum tier checks at install time |
| `registry:lock` | View, export, verify, selective proof generation |
| Reproducibility score | Calculated from CID visibility (public vs private vs opaque) |

### Phase 4: Developer Experience & UI Tooling

| Deliverable | Description |
|-------------|-------------|
| `registry:compile` | AST validation, Identity Ladder resolution, schema checks, hello world tests |
| `devel:scaffold` | Pack scaffolding with boilerplate manifest, directory structure, test skeletons |
| `devel:lint` | Static analysis lint rules (unit mismatch, unbounded iteration, orphan handlers, missing normalization) |
| `devel:test` | Local Simulator sandbox with synthetic data, `--fast-forward` for temporal handler testing |
| `devel:trace_path` | Workflow feasibility trace -- compute blockers across chained transitions from start to target state |
| `ui:define_view` | Entity schema to widget mapping, conditional visibility, graph data sources |
| `ui:register_action` | Custom action buttons bound to workflow transitions and Driver Packs |

### Phase 5: A2A Integration & Federation

| Deliverable | Description |
|-------------|-------------|
| Negotiated disclosure | A2A verification bundles with full/grant/opaque per CID |
| Private registry federation | Sync protocol between public and private registries |
| Temporary access grants | DID-scoped tokens for private CID fetch |
| `registry:diff` | Compare two lock states, show rule and compliance status changes |
| Persistence guarantees | Immutable storage for certified tier, deprecation workflow for verified |


## Invariants

These rules are enforced by the system at all times:

1. **Public packs cannot depend on private CIDs** -- audit trails must not go dark for the industry
2. **Certified CIDs are permanent** -- immutable storage, no deletion, only deprecation
3. **No lock update without Simulator approval** -- the Simulator is the only path to changing `compliance-lock.json`
4. **Every evaluation records its lock** -- no unversioned compliance decisions exist in the system
5. **Signatures are verified at install time** -- tampered packs are rejected before they reach the Simulator
6. **Most Restrictive is the default conflict strategy** -- in the absence of explicit configuration, the system minimizes liability

---

**Document Control**

| Version | Date | Changes |
|---------|------|---------|
| 0.1 | 2026-02-03 | Initial design from brainstorming session |
| 0.2 | 2026-02-03 | Added registry:compile, devel:* toolset (scaffold, lint, test), ui:* toolset (define_view, register_action), integrated agent workflow, lint rule reference |
| 0.3 | 2026-02-03 | Added devel:trace_path for workflow feasibility tracing across chained transitions |

---

*The Registry transforms EuroComply from a compliance tool into a compliance operating system -- where regulatory logic is versioned, signed, composable, and deterministically reproducible. Compliance becomes an immutable state, not an opinion.*
