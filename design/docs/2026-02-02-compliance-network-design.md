# Compliance Network Design

> **Status:** DRAFT
> **Created:** 2026-02-02
> **Authors:** Human + Claude (Brainstorming Session)
> **Depends On:** [Kernel VM Design](./2026-02-02-compliance-handler-vm.md), [Platform Services Layer](./2026-02-03-platform-services-layer.md)

---

## Executive Summary

The Compliance Network transforms EuroComply from a single-tenant compliance tool into the **Industrial Trust Layer of the Internet**. It defines how companies trust each other's compliance claims through a federated network of AI agents communicating via MCP.

### Core Insight

```
EuroComply isn't a tool. It's the operating system for an industrial trust network.

- The Kernel VM is the CPU (pure computation)
- Platform Services are the syscalls (stateful operations -- CRUD, files, search)
- Together they form the KERNEL
- MCP is the system call interface (how agents talk to the OS)
- The A2A Protocol is the network stack (how instances talk to each other)
- The Registry is the package manager (how logic is distributed)
```

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [The A2A Protocol](#2-the-a2a-protocol)
3. [Primitive 1: Identity](#3-primitive-1-identity)
4. [Primitive 2: Claims](#4-primitive-2-claims)
5. [Primitive 3: Requests](#5-primitive-3-requests)
6. [Primitive 4: Evidence](#6-primitive-4-evidence)
7. [Primitive 5: Subscriptions](#7-primitive-5-subscriptions)
8. [Graph-Based Trust Model](#8-graph-based-trust-model)
9. [Interoperability Strategy](#9-interoperability-strategy)
10. [MCP Integration](#10-mcp-integration)
11. [Implementation Roadmap](#11-implementation-roadmap)

---

## 1. Architecture Overview

### The Architecture

The Compliance Network operates across all layers of the EuroComply OS. The architecture uses a ring model (not a linear stack) because the dependency graph between components is bidirectional, not strictly hierarchical.

```
┌─────────────────────────────────────────────────────────────────────┐
│                    THE COMPLIANCE NETWORK                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   APPLICATIONS                                                      │
│   ┌─────────────┐ ┌─────────────┐ ┌─────────────┐                  │
│   │ Compliance  │ │ Supplier    │ │ Regulatory  │  ← Killer apps   │
│   │ Cockpit     │ │ Portal      │ │ Radar       │    users live in │
│   └─────────────┘ └─────────────┘ └─────────────┘                  │
│                                                                     │
│   SYSTEM SERVICES                                                   │
│   ┌──────────────────────┐ ┌──────────────────────┐                 │
│   │ Registry /           │ │ A2A Protocol         │  ← THIS DOC    │
│   │ Marketplace          │ │ (Identity, Claims,   │    defines the  │
│   │ (Packs, Simulator,   │ │  Requests, Evidence, │    A2A Protocol │
│   │  Compliance Lock)    │ │  Subscriptions)      │                 │
│   └──────────────────────┘ └──────────────────────┘                 │
│                                                                     │
│   KERNEL                                                            │
│   ┌──────────────────┐    ┌──────────────────────────┐              │
│   │ Kernel VM       │◄──►│ Platform Services        │              │
│   │ (~53 pure        │    │ (Entity CRUD, Files,     │              │
│   │  primitives)     │    │  Search, Permissions,    │              │
│   └──────────────────┘    │  Tasks, Audit, Jobs)     │              │
│                            └──────────────────────────┘              │
│                                                                     │
│   INFRASTRUCTURE                                                    │
│   ┌─────────────────────────────────────────────────────────────┐  │
│   │  PostgreSQL │ Neo4j │ Cloudflare R2 │ LLM Gateway           │  │
│   └─────────────────────────────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### The Flywheel

1. **Applications** attract users (solve real daily pain)
2. **Marketplace** lets domain experts contribute (scales without us)
3. **Protocol** makes switching impossible (your suppliers are on it too)
4. More companies → more shared rules → better applications → more companies

---

## 2. The A2A Protocol

### Design Principles

**Fully Decentralized:** No central authority. Companies verify each other directly via DIDs/VCs. EuroComply is just software.

```
┌─────────────────────────────────────────────────────────────────────┐
│                   DECENTRALIZED TRUST ARCHITECTURE                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│                  ┌─────────────────────┐                            │
│                  │   GSR Spoke         │  ← Privileged OS tenant   │
│                  │   (Identity         │    Publishes @data/global │
│                  │    Rosetta Stone)   │    -substances as an      │
│                  │                     │    Intelligence Pack.     │
│                  │                     │    Read-only reference    │
│                  │                     │    data, no trust here.   │
│                  └─────────────────────┘                            │
│                              │                                      │
│              ┌───────────────┼───────────────┐                      │
│              ▼               ▼               ▼                      │
│     ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│     │ Company A   │  │ Company B   │  │ Company C   │              │
│     │             │  │             │  │             │              │
│     │ DID:a:123   │  │ DID:b:456   │  │ DID:c:789   │              │
│     │ MCP Server  │  │ MCP Server  │  │ MCP Server  │              │
│     │ Kernel VM   │  │ Kernel VM   │  │ Kernel VM   │              │
│     └──────┬──────┘  └──────┬──────┘  └──────┬──────┘              │
│            │                │                │                      │
│            └────── P2P ─────┴────── P2P ─────┘                      │
│                                                                     │
│     No central authority. Each company:                             │
│     • Owns their DID (self-sovereign identity)                     │
│     • Signs their own credentials                                   │
│     • Decides who to trust                                          │
│     • Verifies credentials directly                                 │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### MCP as Dual Interface

MCP serves two roles:

| Role | Description |
|------|-------------|
| **Internal** | AI agents programming their own company's platform |
| **External** | AI agents communicating across company boundaries (A2A) |

```
┌─────────────────────────────────────────────────────────────────────┐
│                         MCP AS UNIVERSAL INTERFACE                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   INTERNAL (Kernel VM)             EXTERNAL (A2A Protocol)        │
│   ┌─────────────────────────┐      ┌─────────────────────────┐     │
│   │                         │      │                         │     │
│   │  Human ←→ AI Agent      │      │  Company A's AI Agent   │     │
│   │       ↓                 │      │         ↓               │     │
│   │  MCP Server             │  ←→  │  MCP Server             │     │
│   │       ↓                 │      │         ↓               │     │
│   │  Kernel VM             │      │  Company B's AI Agent   │     │
│   │                         │      │                         │     │
│   └─────────────────────────┘      └─────────────────────────┘     │
│                                                                     │
│   "AI programs my platform"        "AI agents talk to each         │
│                                     other across companies"        │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### The Five Primitives

| # | Primitive | Purpose |
|---|-----------|---------|
| 1 | **Identity** | We agree what we're talking about (GSR data as Rosetta Stone, distributed via Intelligence Pack) |
| 2 | **Claims** | Signed assertions - Verifiable Credentials |
| 3 | **Requests** | Structured asks for proof |
| 4 | **Evidence** | The proof chain (docs, traces, witnesses) |
| 5 | **Subscriptions** | Stay in sync when things change |

---

## 3. Primitive 1: Identity

**Problem:** Company A calls it "Formaldehyde", Company B calls it "CAS 50-00-0", Company C calls it "EC 200-001-8". Are they the same thing?

**Solution:** The GSR data (distributed as the `@data/global-substances` Intelligence Pack installed on every Spoke) is the Rosetta Stone. All identity resolution goes through canonical substance IDs from the GSR.

```
┌─────────────────────────────────────────────────────────────────────┐
│                      IDENTITY RESOLUTION                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Company A                 GSR                      Company B       │
│  ┌─────────┐         ┌───────────┐              ┌─────────┐        │
│  │ "Our    │         │           │              │ "Our    │        │
│  │ Material│  ──→    │ Substance │    ←──       │ Raw     │        │
│  │ X-500"  │ resolve │ gsr:12345 │  resolve     │ RM-42"  │        │
│  │         │         │           │              │         │        │
│  │ CAS:    │         │ Canonical │              │ EC:     │        │
│  │ 50-00-0 │         │ Identity  │              │200-001-8│        │
│  └─────────┘         └───────────┘              └─────────┘        │
│                            │                                        │
│                            ▼                                        │
│                    Same substance.                                  │
│                    Credentials about X-500                          │
│                    apply to RM-42.                                  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### MCP Tools

```typescript
// Resolve any identifier to canonical GSR identity
"a2a:resolve_identity": {
  input: {
    identifier: string,           // "50-00-0", "EC 200-001-8", "formaldehyde"
    identifier_type?: string,     // "cas", "ec", "name", "inchi", "auto"
    context?: {
      domain: string              // "cosmetics", "biocides" - for persona hints
    }
  },
  output: {
    gsr_id: string,               // "gsr:substance:12345"
    confidence: number,           // 0-1
    resolved_via: string,         // "cas_exact", "name_fuzzy", "inchi_match"
    canonical: {
      cas: string,
      ec: string,
      iupac_name: string,
      molecular_formula: string
    },
    personas: string[]            // ["clp", "reach_svhc", "cosing"]
  }
}

// Assert identity equivalence (for proprietary materials)
"a2a:assert_identity": {
  input: {
    local_identifier: string,     // Your internal ID
    gsr_id: string,               // Canonical GSR ID
    evidence?: {
      coa_document_hash: string,
      analytical_method: string
    }
  },
  output: {
    assertion_vc: VerifiableCredential  // Signed identity assertion
  }
}
```

---

## 4. Primitive 2: Claims

**The unit of trust.** A claim is a signed assertion that something is true. Implemented as Verifiable Credentials (VCs).

### Claim Structure

```
┌─────────────────────────────────────────────────────────────────────┐
│                   VERIFIABLE CREDENTIAL                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  issuer: "did:web:supplier-corp.com"                               │
│  issuance_date: "2026-02-02T10:00:00Z"                             │
│  expiration_date: "2027-02-02T10:00:00Z"                           │
│                                                                     │
│  subject: {                                                         │
│    id: "gsr:substance:12345",        ← What this is about          │
│    type: "Material"                                                 │
│  }                                                                  │
│                                                                     │
│  claim: {                                                           │
│    type: "REACHCompliance",          ← What we're asserting        │
│    regulation: "REACH",                                             │
│    article: "33",                                                   │
│    status: "compliant",                                             │
│    svhc_concentration: 0.0003,       ← Specific data               │
│    threshold: 0.001,                                                │
│    determination: "below_threshold"                                 │
│  }                                                                  │
│                                                                     │
│  evidence: {                         ← How we know                 │
│    handler_trace_hash: "sha256:abc...",                            │
│    source_documents: ["sds:v3.2", "coa:2026-01-15"],               │
│    evaluated_by: "core:threshold_check@1.0.0"                      │
│  }                                                                  │
│                                                                     │
│  proof: {                            ← Signature                   │
│    type: "Ed25519Signature2020",                                    │
│    verificationMethod: "did:web:supplier-corp.com#key-1",          │
│    signature: "z3FXQje..."                                          │
│  }                                                                  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Claim Types (Extensible)

| Category | Example Claims |
|----------|----------------|
| **Substance** | SVHC status, CLP classification, REACH registered |
| **Material** | Composition verified, origin country, recycled content % |
| **Product** | DPP compliant, CE marked, market authorized |
| **Process** | GMP certified, ISO 14001, audit passed |
| **Organization** | Accredited lab, authorized representative, licensed manufacturer |

### MCP Tools

```typescript
// Issue a claim about something you control
"a2a:issue_claim": {
  input: {
    subject: {
      gsr_id?: string,            // For substances/materials
      product_id?: string,        // For products
      organization_did?: string   // For org claims
    },
    claim_type: string,           // "REACHCompliance", "SVHCFree", etc.
    claim_data: Record<string, unknown>,

    evidence: {
      handler_trace?: string,     // Link to handler execution
      documents?: string[],       // Hashes of supporting docs
      valid_until?: string
    },

    delegation?: {                // For third-party issuance
      on_behalf_of: string,       // DID of delegator
      delegation_vc: string       // Proof of authority
    }
  },
  output: {
    credential: VerifiableCredential,
    credential_id: string,
    revocation_endpoint: string
  }
}

// Verify a received claim
"a2a:verify_claim": {
  input: {
    credential: VerifiableCredential
  },
  output: {
    valid: boolean,
    checks: {
      signature: "valid" | "invalid",
      expiration: "valid" | "expired",
      revocation: "active" | "revoked",
      issuer_trusted: boolean,
      evidence_verifiable: boolean
    },
    trust_chain?: TrustChainNode[],
    warnings?: string[]
  }
}
```

---

## 5. Primitive 3: Requests

**How you ask for proof.** A structured, context-aware request that the receiver's AI agent can process automatically.

### Request Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│                         REQUEST FLOW                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   BUYER                                              SUPPLIER       │
│   ┌─────────────┐                               ┌─────────────┐    │
│   │             │   1. REQUEST                  │             │    │
│   │  "I need    │ ─────────────────────────────→│  AI Agent   │    │
│   │   proof of  │   structured ask +            │  receives   │    │
│   │   REACH     │   why I need it               │             │    │
│   │   compliance│                               │             │    │
│   │   for       │                               │             │    │
│   │   material  │                               │             │    │
│   │   RM-42"    │                               │             │    │
│   │             │                               │             │    │
│   │             │   2. AUTO-EVALUATE            │  ┌───────┐  │    │
│   │             │                               │  │Handler│  │    │
│   │             │                               │  │  VM   │  │    │
│   │             │                               │  └───────┘  │    │
│   │             │                               │      │      │    │
│   │             │   3. RESPOND                  │      ▼      │    │
│   │  AI Agent   │ ←─────────────────────────────│  Credential │    │
│   │  validates  │   signed VC + evidence        │  + Evidence │    │
│   │             │   (or: denial + reason)       │             │    │
│   └─────────────┘                               └─────────────┘    │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Automation Levels

```
┌─────────────────────────────────────────────────────────────────────┐
│                   REQUEST AUTOMATION SPECTRUM                       │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  FULL AUTO          SEMI-AUTO              MANUAL                   │
│  ───────────────────────────────────────────────────────────────   │
│                                                                     │
│  "If trusted buyer   "Queue for review,    "Always require         │
│   requests claim I    pre-fill response,    human approval          │
│   already have,       human clicks          before responding"      │
│   respond             approve"                                      │
│   immediately"                                                      │
│                                                                     │
│  Configured per:                                                    │
│  • Claim type (SVHC = auto, trade secrets = manual)                │
│  • Requester trust level                                            │
│  • Confidentiality scope requested                                  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### MCP Tools

```typescript
// Request a claim from another party
"a2a:request_claim": {
  input: {
    to: string,                   // "did:web:supplier-corp.com"

    request: {
      claim_type: string,         // "REACHCompliance"
      about: {
        gsr_id?: string,          // Resolved identity
        your_reference?: string   // "PO-2026-1234 line item 3"
      },

      requirements: {
        regulation?: string,
        specific_articles?: string[],
        minimum_evidence?: string[],
        max_age_days?: number
      },

      context: {
        why_needed: string,       // "Customer audit", "Market surveillance"
        your_use_case?: string,
        end_market?: string[]
      },

      confidentiality: {
        scope: "full" | "summary" | "pass_fail_only",
        can_share_with?: string[],
        retention_days?: number
      },

      deadline?: string,
      callback_endpoint?: string
    }
  },
  output: {
    request_id: string,
    status: "sent" | "queued" | "failed",
    expected_response_time?: string
  }
}

// Respond to a received request
"a2a:respond_to_request": {
  input: {
    request_id: string,

    response: {
      status: "fulfilled" | "partial" | "denied" | "pending_approval",
      credentials?: VerifiableCredential[],
      denial_reason?: string,
      alternative_offered?: string,
      requires_human_approval?: boolean,
      estimated_response_date?: string,
      notes?: string,
      contact?: string
    }
  },
  output: {
    response_id: string,
    delivered: boolean
  }
}
```

---

## 6. Primitive 4: Evidence

**What makes a claim believable.** Machine-verifiable proof that links claims to their source.

### Evidence Chain

```
┌─────────────────────────────────────────────────────────────────────┐
│                       EVIDENCE CHAIN                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  LEVEL 4: CLAIM                                                     │
│  "Material X is REACH compliant"                                    │
│                              ↑                                      │
│                    derived from                                     │
│                              │                                      │
│  LEVEL 3: COMPUTATION                                               │
│  "Kernel VM evaluated: 0.0003 < 0.001 → PASS"                     │
│                              ↑                                      │
│                    computed from                                    │
│                              │                                      │
│  LEVEL 2: EXTRACTED DATA                                            │
│  "Concentration: 0.0003 (from CoA page 3)"                         │
│                              ↑                                      │
│                    extracted from                                   │
│                              │                                      │
│  LEVEL 1: DOCUMENTS                                                 │
│  "Certificate of Analysis PDF"                                      │
│                              ↑                                      │
│                    generated from                                   │
│                              │                                      │
│  LEVEL 0: GROUND TRUTH                                              │
│  "The actual measurement from the actual instrument"                │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Evidence Levels

| Level | What's Included | Use Case |
|-------|-----------------|----------|
| **Assertion only** | Just the claim, no evidence | Low-stakes, trusted relationship |
| **Summary** | Handler trace + document hashes | Normal B2B transactions |
| **Full** | Everything + retrievable documents | Audits, regulatory submission |
| **Reproducible** | Full + raw input data | Re-verification, disputes |

### MCP Tools

```typescript
// Package evidence for a claim
"a2a:package_evidence": {
  input: {
    claim_id: string,
    level: "assertion" | "summary" | "full" | "reproducible",

    include: {
      handler_traces: boolean,
      document_hashes: boolean,
      document_content: boolean,
      upstream_credentials: boolean,
      raw_input_data: boolean
    },

    redactions?: {
      fields_to_redact: string[],
      hash_redacted: boolean
    }
  },
  output: {
    evidence_package: EvidencePackage,
    package_hash: string,
    size_bytes: number,
    retrieval_urls: string[]
  }
}

// Verify evidence package
"a2a:verify_evidence": {
  input: {
    evidence_package: EvidencePackage,
    verification_depth: "hashes_only" | "retrieve_and_verify" | "full_replay"
  },
  output: {
    valid: boolean,

    verification_results: {
      handler_traces: "valid" | "invalid" | "not_included",
      document_hashes: "valid" | "tampered" | "not_retrievable",
      upstream_credentials: "valid" | "invalid" | "expired",

      replay_result?: {
        original_output: unknown,
        replayed_output: unknown,
        match: boolean,
        differences?: string[]
      }
    },

    trust_assessment: {
      evidence_strength: "strong" | "moderate" | "weak",
      weakest_link: string,
      recommendations?: string[]
    }
  }
}
```

---

## 7. Primitive 5: Subscriptions

**Stay in sync without polling.** Push notifications across company boundaries.

### Subscription Model

```
┌─────────────────────────────────────────────────────────────────────┐
│                   CASCADING CHANGE PROPAGATION                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ECHA adds substance      Your SUPPLIER           YOUR COMPANY      │
│  to SVHC list             uses that substance     uses that material│
│       │                          │                       │          │
│       ▼                          ▼                       ▼          │
│  ┌─────────┐              ┌─────────────┐         ┌───────────┐    │
│  │  GSR    │──publish────→│  Material   │─publish─→│  Product  │    │
│  │  Spoke  │  new Pack    │  now SVHC   │          │  affected │    │
│  └─────────┘              └─────────────┘         └───────────┘    │
│                                                          │          │
│                                                          ▼          │
│                                                 ┌───────────────┐   │
│                                                 │ Auto-trigger: │   │
│                                                 │ • Re-evaluate │   │
│                                                 │ • Alert user  │   │
│                                                 │ • Request new │   │
│                                                 │   credential  │   │
│                                                 └───────────────┘   │
│                                                                     │
│  1 regulatory change → N supplier impacts → M product impacts       │
│  All automated. Minutes, not months.                                │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Subscribable Events

| Category | Events |
|----------|--------|
| **Document** | SDS updated, CoA issued, cert expired |
| **Claim** | Credential revoked, status changed |
| **Substance** | Reclassified, added to SVHC list |
| **Relationship** | Supplier discontinued material |
| **Regulatory** | New regulation, deadline approaching |

### MCP Tools

```typescript
// Subscribe to changes
"a2a:subscribe": {
  input: {
    to: string,                   // "did:web:supplier-corp.com" or "gsr:regulatory"

    subscriptions: [{
      event_type: string,

      filter: {
        subject_gsr_id?: string,
        document_type?: string,
        claim_type?: string,
        severity?: string[]
      },

      delivery: {
        method: "webhook" | "mcp_push" | "email_digest",
        endpoint?: string,
        frequency?: string
      },

      on_receive?: {
        auto_request_updated_claim?: boolean,
        auto_re_evaluate_products?: boolean,
        notify_users?: string[]
      }
    }],

    duration?: {
      until?: string,
      auto_renew?: boolean
    }
  },
  output: {
    subscription_ids: string[],
    status: "active",
    confirmation_from_publisher?: boolean
  }
}

// Publish an event to subscribers
"a2a:publish": {
  input: {
    event: {
      type: string,
      subject: { gsr_id?: string, document_id?: string, credential_id?: string },
      summary: string,
      severity: "info" | "low" | "medium" | "high" | "critical",
      changes?: { field: string, old_value?: unknown, new_value?: unknown }[],
      recommended_action?: string,
      breaking_change?: boolean
    },
    audience: "all_subscribers" | string[]
  },
  output: {
    event_id: string,
    delivered_to: number,
    delivery_failures?: string[]
  }
}
```

### The Unified Event System

The A2A subscription tools (`a2a:subscribe`, `a2a:publish`) defined above are the **external projection** of a single unified event system. Internally, the same event primitive operates at tenant scope via the `events:*` toolset. One event system, two scopes:

```
┌─────────────────────────────────────────────────────────────────────┐
│                    UNIFIED EVENT ARCHITECTURE                        │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  INTERNAL SCOPE (events:*)          EXTERNAL SCOPE (a2a:*)         │
│  ┌──────────────────────────┐      ┌──────────────────────────┐    │
│  │                          │      │                          │    │
│  │  Tenant apps, workflows, │      │  Cross-company A2A       │    │
│  │  UI components, Driver   │      │  with DID verification,  │    │
│  │  Packs react to changes  │      │  credential-scoped       │    │
│  │                          │      │  delivery                │    │
│  │  events:subscribe        │      │  a2a:subscribe           │    │
│  │  events:emit             │      │  a2a:publish             │    │
│  │                          │      │                          │    │
│  └────────────┬─────────────┘      └────────────┬─────────────┘    │
│               │                                  │                  │
│               └──────────┬───────────────────────┘                  │
│                          │                                          │
│                          ▼                                          │
│               ┌──────────────────┐                                  │
│               │  UniversalEvent  │  ← Same event object             │
│               │                  │    Different delivery scope       │
│               └──────────────────┘                                  │
│                                                                     │
│  A workflow effect emits an event.                                  │
│  Internal subscribers see it immediately.                           │
│  External subscribers see it after DID/credential verification.    │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Why unify?** A single `events:emit` call in a workflow effect can simultaneously notify an internal dashboard (via `events:subscribe`) and an external supplier (via `a2a:subscribe`). The event is the same object; only the delivery and trust verification differ.

#### The UniversalEvent Object

Every event in the system -- whether emitted by a workflow transition, a Kernel VM evaluation, a temporal deadline expiry, or a manual trigger -- uses the same structure:

```typescript
interface UniversalEvent {
  event_id: string;                     // Unique ID
  event_type: string;                   // "product.compliance_invalidated"
  source: {
    type: 'workflow' | 'kernel_vm' | 'temporal' | 'manual' | 'a2a_inbound';
    workflow_id?: string;
    transition_id?: string;
    handler_id?: string;
    schedule_id?: string;
  };

  subject: {
    entity_type?: string;               // "cosmetic_product"
    entity_id?: string;                 // "prod_123"
    gsr_id?: string;                    // For substance events
    credential_id?: string;
  };

  severity: 'info' | 'low' | 'medium' | 'high' | 'critical';
  summary: string;
  timestamp: string;

  changes?: Array<{
    field: string;
    old_value?: unknown;
    new_value?: unknown;
  }>;

  recommended_action?: string;
  breaking_change?: boolean;

  // Scope control
  visibility: 'internal' | 'external' | 'both';

  // Audit
  compliance_lock_id?: string;         // Lock active when event was emitted
  trace_hash?: string;                 // Handler trace that caused this event
}
```

#### Internal Event MCP Tools (`events:*`)

```typescript
// Subscribe to internal events
"events:subscribe": {
  input: {
    subscriptions: Array<{
      event_type: string,              // "product.*", "workflow.transition.*"
      filter?: {
        entity_type?: string,
        entity_id?: string,
        severity?: string[],
        source_type?: string
      },

      delivery: {
        method: "callback" | "webhook" | "queue",
        endpoint?: string
      },

      // Reactive automations
      on_receive?: {
        trigger_handler?: {            // Execute a handler when event fires
          handler: string,
          config: unknown
        },
        notify_users?: string[],
        notify_roles?: string[]
      }
    }>
  },
  output: {
    subscription_ids: string[],
    status: "active"
  }
}

// Emit an internal event (also used as workflow effect handler)
"events:emit": {
  input: {
    event_type: string,
    subject?: {
      entity_type?: string,
      entity_id?: string,
      gsr_id?: string
    },
    severity: "info" | "low" | "medium" | "high" | "critical",
    summary?: string,
    changes?: Array<{ field: string, old_value?: unknown, new_value?: unknown }>,
    recommended_action?: string,
    breaking_change?: boolean,
    visibility?: "internal" | "external" | "both"  // Default: "internal"
  },
  output: {
    event_id: string,
    delivered_to_internal: number,
    delivered_to_external: number       // Only if visibility includes "external"
  }
}
```

When `visibility` is `"both"` or `"external"`, the event is also delivered through the A2A channel -- subject to the receiver's DID verification and subscription filters.

#### Application Hooks

The unified event system provides hook points in the Kernel VM execution lifecycle. Driver Packs and applications register for these to inject logic at well-defined moments:

| Hook Point | Event Type | Use Case |
|------------|------------|----------|
| `kernel_vm.pre_evaluation` | Before any rule evaluation starts | Fetch real-time data (exchange rates, updated substance lists) |
| `kernel_vm.post_evaluation` | After evaluation completes | Update dashboards, trigger notifications |
| `workflow.pre_transition` | Before a workflow guard is evaluated | Validate external prerequisites |
| `workflow.post_transition` | After a transition succeeds | Sync state to ERP, update supplier portal |
| `temporal.deadline_warning` | When deadline enters warning window | UI badge color changes, email alerts |
| `temporal.deadline_expired` | When deadline expires | Escalation triggers, auto-transitions |
| `temporal.schedule_due` | When a scheduled evaluation is due | Trigger re-evaluation of compliance |
| `registry.pack_installed` | After a Logic Pack is installed | Re-evaluate affected products |
| `registry.lock_updated` | After Compliance Lock changes | Notify stakeholders of rule changes |

```typescript
// Example: Driver Pack registers a hook to fetch exchange rates before cost calculations
await mcp.call('events:subscribe', {
  subscriptions: [{
    event_type: 'kernel_vm.pre_evaluation',
    filter: { source_type: 'kernel_vm' },
    delivery: { method: 'callback' },
    on_receive: {
      trigger_handler: {
        handler: 'driver:ecb_exchange_rate_fetch',
        config: { currencies: ['EUR', 'USD', 'GBP'] }
      }
    }
  }]
});
```

---

## 8. Graph-Based Trust Model

### The Core Insight

Trust isn't a property of a claim - it's a **path** through the graph.

```
┌─────────────────────────────────────────────────────────────────────┐
│                    TRUST AS A PATH                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  YOU                                                                │
│   │                                                                 │
│   │ "Do I trust this claim about Material X?"                       │
│   │                                                                 │
│   ▼                                                                 │
│  ┌─────────┐   supplies    ┌─────────┐   tested by   ┌─────────┐   │
│  │ YOUR    │──────────────→│SUPPLIER │──────────────→│  LAB    │   │
│  │ PRODUCT │               │    A    │               │  SGS    │   │
│  └─────────┘               └─────────┘               └────┬────┘   │
│                                                           │        │
│                                                    accredited by   │
│                                                           │        │
│                                                           ▼        │
│                                                     ┌──────────┐   │
│                                                     │ NATIONAL │   │
│                                                     │ BODY     │   │
│                                                     └──────────┘   │
│                                                                     │
│  Trust isn't a number.                                              │
│  Trust is: "Can I trace a path to something I already trust?"       │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Trust Anchors

Different companies define their own trust anchors:

| Company Type | Their Trust Anchors |
|--------------|---------------------|
| Conservative pharma | Only FDA/EMA-approved labs |
| Fast-moving startup | Any ISO 17025 accredited lab |
| Government contractor | Government bodies only |
| Small brand | "My suppliers" (direct relationships) |

```typescript
// Tenant configuration
tenant_config: {
  trust_anchors: [
    { node_type: "AccreditationBody", ids: ["DAkkS", "UKAS", "COFRAC"] },
    { node_type: "Company", relationship: "direct_supplier", min_age: "1y" },
    { node_type: "CertificationScheme", ids: ["ISO_17025", "GLP"] }
  ]
}
```

### Trust Verification via Graph Traversal

```typescript
// When verifying any claim, the VM executes:
core:find_path({
  from: credential_node,
  to: { any_of: tenant.trust_anchors },
  relationships: ["ISSUED_BY", "TESTED_BY", "ACCREDITED_BY", "CERTIFIED_BY"],
  max_depth: 5
})

// Returns:
{
  trusted: true,
  trust_path: [credential, supplier_a, lab_sgs, DAkkS],
  anchor_reached: "DAkkS",
  path_length: 3
}
```

### Liability Flows the Same Way

If trust flows forward through the graph, **liability flows backward**.

```
┌─────────────────────────────────────────────────────────────────────┐
│                    LIABILITY FLOW                                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Regulator finds your product non-compliant                         │
│         │                                                           │
│         │ "Who gave you bad data?"                                  │
│         ▼                                                           │
│  ┌─────────────┐                                                    │
│  │ YOUR        │                                                    │
│  │ PRODUCT     │ You have the credential. Who issued it?            │
│  └──────┬──────┘                                                    │
│         │ credential.issuer                                         │
│         ▼                                                           │
│  ┌─────────────┐                                                    │
│  │ Supplier A  │ They signed it. They're liable.                    │
│  └──────┬──────┘                                                    │
│         │ evidence.tested_by                                        │
│         ▼                                                           │
│  ┌─────────────┐                                                    │
│  │ SGS Lab     │ They did the test. They're liable to Supplier.     │
│  └──────┬──────┘                                                    │
│         │ accredited_by                                             │
│         ▼                                                           │
│  ┌─────────────┐                                                    │
│  │ DAkkS       │ They vouched for the lab. Ultimate backstop.       │
│  └─────────────┘                                                    │
│                                                                     │
│  LIABILITY CHAIN = TRUST CHAIN IN REVERSE                           │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Fraud Detection via Graph Anomalies

```
┌─────────────────────────────────────────────────────────────────────┐
│                    FRAUD SHOWS UP IN THE GRAPH                      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  NORMAL GRAPH                      FRAUDULENT GRAPH                 │
│                                                                     │
│  Supplier → Lab → Accreditor       Supplier → ??? → "Lab"           │
│      ↓                                  ↓                           │
│  Many customers                    Only 1 customer                  │
│  Years of history                  Created yesterday                │
│  Multiple labs used                Always same "lab"                │
│  Consistent results                Results always "perfect"         │
│                                                                     │
│  DETECTION: Graph patterns reveal fraud                             │
│                                                                     │
│  • No path to trust anchor                                          │
│  • Suspiciously short paths (self-signed)                          │
│  • Node has no other connections (shell company)                   │
│  • Results statistically impossible                                │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### The Simplification

| Before (Complex) | After (Graph) |
|------------------|---------------|
| Trust coefficients | Path to trust anchor |
| Staking/slashing | Liability follows edges |
| Oracle handlers | Witnesses are nodes |
| Economic bonds | Contracts on edges |
| Fraud detection | Graph anomaly patterns |

**One primitive (the graph) replaces five complex systems.**

---

## 9. Interoperability Strategy

### The Challenge

You can't wait for 100% adoption. You need to work with everyone - including suppliers on SAP, Excel, or just email.

### Three-Phase Approach

```
┌─────────────────────────────────────────────────────────────────────┐
│                    SEQUENCING STRATEGY                              │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  PHASE 1               PHASE 2                  PHASE 3             │
│  NOW                   +6 MONTHS                +18 MONTHS          │
│  ─────────────────────────────────────────────────────────────────  │
│                                                                     │
│  ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────┐   │
│  │ GATEWAY BRIDGES │   │ LIGHTWEIGHT     │   │ OPEN PROTOCOL   │   │
│  │                 │   │ EDGE            │   │                 │   │
│  │ • Email/PDF     │   │                 │   │ • A2A spec      │   │
│  │ • Supplier      │   │ • Free agent    │   │   published     │   │
│  │   portals       │   │ • Responds to   │   │ • Reference     │   │
│  │ • EDI/API       │   │   requests      │   │   implementation│   │
│  │   translation   │   │ • Issues basic  │   │ • Certification │   │
│  │                 │   │   credentials   │   │   program       │   │
│  │ Solve: "My      │   │                 │   │                 │   │
│  │ suppliers       │   │ Solve: "Grow    │   │ Solve: "Become  │   │
│  │ aren't on it"   │   │ the network"    │   │ the standard"   │   │
│  └─────────────────┘   └─────────────────┘   └─────────────────┘   │
│                                                                     │
│  CRITICAL: Design for open protocol from day one.                   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Phase 1: Gateway Bridges

Translate between A2A protocol and legacy systems:

| Channel | Inbound | Outbound |
|---------|---------|----------|
| **Email** | Parse attachments, extract data | Templated request emails |
| **Portal** | Supplier uploads to branded portal | Portal shows what's needed |
| **EDI** | Translate EDIFACT/X12 | Generate EDI messages |
| **API** | Connect to supplier's existing API | Webhook to their system |

Gateway-sourced claims have **lower trust** (marked as `trust_level: "gateway_extracted"`).

### Phase 2: Lightweight Edge

Free, minimal agent for suppliers:

| Included (Free) | Not Included (Upgrade) |
|-----------------|------------------------|
| Receive requests | Product management |
| Store documents | Rule evaluation |
| Issue basic credentials | Supplier management |
| Answer automatically | AI features |
| Own your DID | Marketplace access |

**The adoption funnel:**
1. Gateway handles supplier (passive)
2. Supplier sees value, signs up for free Edge
3. Supplier realizes they need data from THEIR suppliers
4. Supplier upgrades to full EuroComply
5. Network grows upstream

### Phase 3: Open Protocol

Publish the A2A spec under open license:

| Component | Role |
|-----------|------|
| **The Spec** | The "Grammar" (How we talk) |
| **The Handlers** | The "Instruction Set" (The logic we run) |
| **The Marketplace** | The "Library" (The programs we share) |
| **EuroComply OS** | The "Kernel" (The most powerful implementation) |

**The moat:** When the protocol is open, adoption becomes unstoppable. Competitors implement your protocol. You win because your Kernel VM remains the gold standard.

---

## 10. MCP Integration

### The Complete System

```
┌─────────────────────────────────────────────────────────────────────┐
│                    THE COMPLIANCE OS                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                         MCP LAYER                            │   │
│  │              (How AI agents talk to the OS)                  │   │
│  │                                                              │   │
│  │   a2a:request_claim    a2a:verify_claim    a2a:subscribe    │   │
│  │         │                    │                   │          │   │
│  └─────────┼────────────────────┼───────────────────┼──────────┘   │
│            │                    │                   │              │
│            ▼                    ▼                   ▼              │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                         KERNEL                               │   │
│  │                                                              │   │
│  │  ┌───────────────────┐      ┌───────────────────────────┐   │   │
│  │  │  Kernel VM        │      │  Platform Services        │   │   │
│  │  │  (~53 pure        │◄────►│  (Stateful: DB, Graph,    │   │   │
│  │  │   handlers, zero  │      │   Files, LLM Gateway)     │   │   │
│  │  │   I/O)            │      │                           │   │   │
│  │  └───────────────────┘      └───────────────────────────┘   │   │
│  │                                       │                     │   │
│  └───────────────────────────────────────┼─────────────────────┘   │
│                                          ▼                         │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                   INFRASTRUCTURE                             │   │
│  │           (The state layer of the OS)                        │   │
│  │                                                              │   │
│  │   PostgreSQL   Neo4j (Graph)   Object Storage   LLM Gateway │   │
│  │   Nodes: Companies, Materials, Substances, Labs, Certs      │   │
│  │   Edges: supplies, tested_by, accredited_by, contains       │   │
│  │                                                              │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### A2A Tools are Graph Operations

| A2A Primitive | Graph Operation |
|---------------|-----------------|
| `a2a:resolve_identity` | Find/create node |
| `a2a:issue_claim` | Create credential node + edges |
| `a2a:request_claim` | Trigger cross-boundary traversal |
| `a2a:verify_claim` | `core:find_path` to trust anchors |
| `a2a:subscribe` | Graph watch on node/edge changes |

### Complete Verification Flow

```
1. CLAIM ARRIVES (via MCP)
   a2a:verify_claim({ credential: vc_12345 })

2. VM PARSES CREDENTIAL, ADDS TO GRAPH
   (vc_12345)-[ISSUED_BY]->(supplier_a)
   (vc_12345)-[ABOUT]->(material_x)
   (vc_12345)-[TESTED_BY]->(lab_sgs)

3. VM EXECUTES TRUST CHECK (Handler)
   core:find_path({
     from: "vc_12345",
     to: tenant.trust_anchors,
     relationships: ["ISSUED_BY", "TESTED_BY", "ACCREDITED_BY"]
   })

4. PATH FOUND
   vc_12345 → supplier_a → lab_sgs → DAkkS (TRUST ANCHOR)

5. RETURN RESULT (via MCP)
   { trusted: true, trust_path: [...], anchor_reached: "DAkkS" }
```

---

## 11. Implementation Roadmap

### Phase 1: Foundation (Weeks 1-4)

| Component | Deliverable |
|-----------|-------------|
| Graph Schema | Neo4j schema for entities, credentials, relationships |
| Trust Anchors | Tenant configuration for trust anchor definitions |
| Basic A2A Tools | `resolve_identity`, `issue_claim`, `verify_claim` |
| Path Finding | `core:find_path` trust verification |

### Phase 2: Request/Response (Weeks 5-8)

| Component | Deliverable |
|-----------|-------------|
| Request Tools | `request_claim`, `respond_to_request` |
| Evidence Packaging | `package_evidence`, `verify_evidence` |
| Automation Config | Per-claim-type auto-response rules |
| Gateway: Email | Inbound/outbound email translation |

### Phase 3: Unified Event System & Subscriptions (Weeks 9-12)

| Component | Deliverable |
|-----------|-------------|
| UniversalEvent schema | Shared event object for internal and external scopes |
| Internal event tools | `events:subscribe`, `events:emit` with callback/webhook/queue delivery |
| External subscription tools | `a2a:subscribe`, `a2a:publish`, `a2a:unsubscribe` with DID verification |
| Application hooks | Pre/post evaluation, workflow transition, temporal, and registry hooks |
| Event propagation | Cross-company event delivery with visibility scoping |
| Gateway: Portal | Supplier upload portal |
| Lightweight Edge | Free tier agent (respond + store) |

### Phase 4: Open Protocol (Weeks 13-16)

| Component | Deliverable |
|-----------|-------------|
| A2A Spec v1.0 | Published specification |
| Reference SDK | Python/JS libraries |
| Certification | Compliance test suite |
| Documentation | Integration guides |

---

## Appendix A: Complete MCP Tool Reference

### Identity Tools

| Tool | Purpose |
|------|---------|
| `a2a:resolve_identity` | Resolve identifier to GSR canonical ID |
| `a2a:assert_identity` | Assert equivalence for proprietary materials |

### Claim Tools

| Tool | Purpose |
|------|---------|
| `a2a:issue_claim` | Issue a verifiable credential |
| `a2a:verify_claim` | Verify a received credential |
| `a2a:revoke_claim` | Revoke a previously issued credential |
| `a2a:list_claims` | List claims issued or received |

### Request Tools

| Tool | Purpose |
|------|---------|
| `a2a:request_claim` | Request proof from another party |
| `a2a:respond_to_request` | Respond to a received request |
| `a2a:list_requests` | List pending/completed requests |

### Evidence Tools

| Tool | Purpose |
|------|---------|
| `a2a:package_evidence` | Package evidence for a claim |
| `a2a:verify_evidence` | Verify an evidence package |
| `a2a:request_evidence` | Request deeper evidence for a claim |

### Subscription Tools (External Scope)

| Tool | Purpose |
|------|---------|
| `a2a:subscribe` | Subscribe to cross-company changes |
| `a2a:publish` | Publish event to external subscribers |
| `a2a:unsubscribe` | Remove external subscription |
| `a2a:list_subscriptions` | List active external subscriptions |
| `a2a:list_subscribers` | List who subscribes to you externally |

### Internal Event Tools (Internal Scope)

| Tool | Purpose |
|------|---------|
| `events:subscribe` | Subscribe to internal tenant events |
| `events:emit` | Emit event (used as workflow effect handler) |

*Both toolsets operate on the same `UniversalEvent` object. Internal events use `events:*`, external events use `a2a:*`. Events with `visibility: "both"` are delivered through both channels.*

---

## Appendix B: Trust Anchor Examples

### Pharmaceutical Company

```typescript
trust_anchors: [
  { node_type: "RegulatoryBody", ids: ["FDA", "EMA", "PMDA"] },
  { node_type: "AccreditationBody", ids: ["A2LA", "UKAS"], scope: "GLP" },
  { node_type: "CertificationScheme", ids: ["ISO_17025", "GMP"] }
]
```

### Consumer Goods Brand

```typescript
trust_anchors: [
  { node_type: "AccreditationBody", ids: ["DAkkS", "UKAS", "COFRAC"] },
  { node_type: "Company", relationship: "direct_supplier", min_history: "2y" },
  { node_type: "CertificationScheme", ids: ["ISO_17025"] }
]
```

### Startup (Permissive)

```typescript
trust_anchors: [
  { node_type: "Company", relationship: "any_supplier" },
  { node_type: "CertificationScheme", ids: ["ISO_17025", "ISO_9001"] }
]
```

---

**Document Control**

| Version | Date | Changes |
|---------|------|---------|
| 0.1 | 2026-02-02 | Initial design from brainstorming session |
| 0.2 | 2026-02-03 | Added Unified Event System (events:subscribe, events:emit), UniversalEvent schema, Application Hooks, unified internal/external event architecture |

---

*The Compliance Network transforms industrial trust from paper-based, manual processes into a cryptographically-secured, AI-automated network where trust flows through verifiable paths and liability follows the same routes in reverse.*
