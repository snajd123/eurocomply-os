# Infrastructure Design

> **Status:** DRAFT
> **Created:** 2026-02-03
> **Authors:** Human + Claude (Brainstorming Session)
> **Depends On:** [Kernel VM Design](./2026-02-02-compliance-handler-vm.md), [Compliance Network Design](./2026-02-02-compliance-network-design.md), [Registry Design](./2026-02-03-registry-design.md), [Platform Services Layer](./2026-02-03-platform-services-layer.md)

---

## Executive Summary

The Infrastructure Layer defines how the EuroComply Compliance OS is packaged, deployed, and operated as the foundation for multiple commercial products. EuroComply (the company) builds products on top of the OS; customers subscribe to those products and receive dedicated, isolated OS instances.

The architecture follows a **Hub and Spoke** model:

- **The Hub** is a single deployment operated by EuroComply. It distributes software, manages billing, and provides fleet observability. It never touches customer data.
- **Each Spoke** is an independent OS instance dedicated to a single customer. It contains the full Kernel (Kernel VM + Platform Services), its own databases, its own AI infrastructure, and its own Private Registry.

A **Product** is not code -- it's a Pack bundle. The OS is identical for every spoke. Product identity comes from which Packs are pre-installed. Creating a new product is writing a manifest file, not deploying new software.

```
EuroComply (the company)
  builds Products (commercial applications)
    on top of EuroComply OS (the Kernel + System Services)
      which runs on Infrastructure (THIS DESIGN)

Customer signs up for "EuroComply Cosmetics"
  → Infrastructure provisions their spoke
  → OS boots with the cosmetics Pack bundle
  → Product is live
```

### Architectural Context

```
┌───────────────────────────────────────────────────────┐
│                    APPLICATIONS                        │
├───────────────────────────────────────────────────────┤
│                  SYSTEM SERVICES                       │
│  ┌──────────────────┐  ┌──────────────────────┐       │
│  │  THE REGISTRY    │  │  A2A Protocol        │       │
│  └──────────────────┘  └──────────────────────┘       │
├───────────────────────────────────────────────────────┤
│                      KERNEL                            │
│  ┌──────────────┐       ┌──────────────────────┐      │
│  │  Kernel VM  │◄─────►│  Platform Services   │      │
│  │  (Compute)   │       │  (State)             │      │
│  └──────────────┘       └──────────────────────┘      │
├───────────────────────────────────────────────────────┤
│                  INFRASTRUCTURE                        │
│          ← THIS DOC                                    │
│       Hub & Spoke Deployment Model                     │
│       Provisioning, Scaling, Lifecycle                 │
│       Observability, DR, Networking                    │
│       PostgreSQL  Neo4j  Object Storage  GPU Pool      │
└───────────────────────────────────────────────────────┘
```

### Core Insight

```
The Hub distributes software. The Spoke processes data.
These two concerns never mix.

- Hub = Control Plane (billing, provisioning, registry, telemetry)
- Spoke = Data Plane (compliance computation, storage, AI)
- Product = Pack bundle (manifest file, not code)
- Provisioning = Helm install + Pack installation
- The Hub cannot reach into a spoke
- A spoke operates independently of the Hub
```

---

## Table of Contents

1. [The Two Halves](#1-the-two-halves)
2. [The Product Manifest](#2-the-product-manifest)
3. [The Provisioning Pipeline](#3-the-provisioning-pipeline)
4. [The Spoke Anatomy](#4-the-spoke-anatomy)
5. [The Hub Anatomy](#5-the-hub-anatomy)
6. [Hub ↔ Spoke Communication](#6-hub--spoke-communication)
7. [OS Updates & Pack Lifecycle](#7-os-updates--pack-lifecycle)
8. [Observability](#8-observability)
9. [Networking & Connectivity](#9-networking--connectivity)
10. [Scaling & Resource Profiles](#10-scaling--resource-profiles)
11. [Disaster Recovery & Data Durability](#11-disaster-recovery--data-durability)
12. [Tenant Lifecycle](#12-tenant-lifecycle)
13. [Infrastructure as Code](#13-infrastructure-as-code)
14. [Invariants](#14-invariants)

---

## 1. The Two Halves

The infrastructure has two distinct deployment units:

**The Hub** -- a single deployment operated by EuroComply (the company). It runs:
- **Public Registry** (the package repository for all Packs)
- **Provisioning Orchestrator** (creates/destroys customer instances)
- **Product Catalog** (defines which Pack bundles constitute each product)
- **Billing & Subscription** (Stripe or equivalent)
- **Network Directory** (A2A discovery -- maps DIDs to spoke endpoints)
- **Telemetry Collector** (aggregated metrics from all spokes)
- **Marketing site & signup flow**

**The Spoke** -- one per customer, an independent OS instance. It runs:
- **EuroComply OS Kernel** (Kernel VM + Platform Services)
- **Private Registry** (syncs from Hub, stores tenant's private packs)
- **PostgreSQL** (tenant data, entity schemas)
- **Neo4j** (knowledge graph)
- **Object Storage** (files, documents -- R2 or S3-compatible)
- **LLM Gateway** (Tier A: self-hosted model for data-touching AI; Tier B: proxied to cloud API)
- **MCP Server** (AI agent interface)

```
┌─────────────────────────────────────────────────────────┐
│                      THE HUB                             │
│          (Single deployment, operated by EuroComply)      │
│                                                          │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐   │
│  │ Public   │ │Provision │ │ Product  │ │ Billing  │   │
│  │ Registry │ │Orchestr. │ │ Catalog  │ │          │   │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘   │
│  ┌──────────┐ ┌──────────┐                              │
│  │ Network  │ │Telemetry │                              │
│  │Directory │ │Collector │                              │
│  └──────────┘ └──────────┘                              │
│                      │                                   │
└──────────────────────┼───────────────────────────────────┘
                       │ provisions / syncs / monitors
          ┌────────────┼────────────┐
          ▼            ▼            ▼
  ┌──────────┐  ┌──────────┐  ┌──────────┐
  │ Spoke A  │  │ Spoke B  │  │ Spoke C  │
  │ (Acme)   │  │ (ChemCo) │  │ (BrandX) │
  │          │  │          │  │          │
  │ Full OS  │  │ Full OS  │  │ Full OS  │
  │ Own DBs  │  │ Own DBs  │  │ Own DBs  │
  │ Own AI   │  │ Own AI   │  │ Own AI   │
  └──────────┘  └──────────┘  └──────────┘
```

The Hub never touches customer data. It distributes software, collects telemetry, and manages billing. All compliance logic and customer data lives exclusively in the spoke.

### Registry Federation

This split implements the Federated Registry Model from the Registry Design. The Hub hosts the Public Registry (System Level), while each spoke hosts a Private Registry (Customer Level) that syncs from it. Private packs can depend on public packs. Public packs can never depend on private CIDs.

### Data Sovereignty

By keeping the Kernel and all databases exclusively in the spoke, customer data never touches the Hub. This is a structural guarantee, not a policy -- the Hub's database schema physically cannot store compliance data because it has no tables for it.

---

## 2. The Product Manifest

A "product" is not code -- it's a declaration. It defines which Packs get installed on a fresh OS instance to create a specific commercial offering.

The Product Catalog lives in the Hub and contains Product Manifests:

```yaml
# product-manifest.yaml
product:
  id: "eurocomply-cosmetics"
  name: "EuroComply Cosmetics"
  version: "1.0.0"
  description: "EU Cosmetics Regulation 1223/2009 compliance platform"

# The OS image to deploy
os:
  version: "^2.0.0"

# Packs to install after OS boot
packs:
  # Environment Pack (the "distro")
  - name: "@eu/cosmetics-vertical"
    version: "^1.0.0"
    type: environment
    required: true

  # Logic Packs (the rules)
  - name: "@eu/cosmetics-regulation-1223"
    version: "^2.0.0"
    type: logic
    required: true

  - name: "@eu/reach-svhc"
    version: "^1.4.0"
    type: logic
    required: true

  - name: "@eu/clp-classification"
    version: "^3.0.0"
    type: logic
    required: true

  # Driver Packs (connectors)
  - name: "@connectors/cpnp-notification"
    version: "^1.0.0"
    type: driver
    required: false          # optional add-on

  - name: "@agents/sds-parser-de"
    version: "^1.0.0"
    type: driver
    required: false

  # Intelligence Packs (reference data)
  - name: "@data/eu-cosmetics-annexes"
    version: "^2026.1"
    type: intelligence
    required: true

# Tier A model configuration
ai:
  self_hosted_model: "eurocomply-compliance-7b"
  model_version: "^1.0.0"

# Default tenant configuration
defaults:
  trust_policy:
    minimum_tier: "verified"
  workspaces:
    - formulation
    - regulatory
    - safety

# Billing plans
plans:
  - id: "starter"
    max_products: 50
    max_users: 10
    packs: ["required_only"]

  - id: "growth"
    max_products: 200
    max_users: 30
    packs: ["required", "@connectors/cpnp-notification"]

  - id: "scale"
    max_products: 1000
    max_users: 100
    packs: ["all"]

  - id: "enterprise"
    max_products: "unlimited"
    max_users: "unlimited"
    packs: ["all"]
    custom_packs: true       # can install from private registry
```

### Key Insight

A product manifest is to a spoke what a `docker-compose.yml` is to a container stack. It's the complete recipe for standing up a customer's environment. The Provisioning Orchestrator reads it, deploys the OS, then installs the declared Packs via the Registry.

This means **creating a new product is trivial** -- write a new manifest, publish it to the Product Catalog. No new code, no new deployments. "EuroComply Biocides" is just a different manifest pointing to different Packs.

Because Packs are additive, a customer on "EuroComply Cosmetics" who later needs biocide compliance just gets the biocides Packs installed on their existing spoke. No migration, no new instance.

---

## 3. The Provisioning Pipeline

When a customer signs up -- whether through the self-service flow or a sales-assisted trigger -- the same pipeline executes. The difference is only who initiates it and how much configuration is provided upfront.

```
┌─────────────────────────────────────────────────────────────────┐
│                   PROVISIONING PIPELINE                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  TRIGGER                                                         │
│  ┌──────────────┐         ┌──────────────┐                      │
│  │ Self-service │         │ Sales-assist │                      │
│  │ Web signup   │         │ Admin panel  │                      │
│  │ + config     │         │ or API call  │                      │
│  └──────┬───────┘         └──────┬───────┘                      │
│         │                        │                               │
│         └────────┬───────────────┘                               │
│                  ▼                                                │
│  PHASE 1: CLAIM                                                  │
│  • Validate payment / contract                                  │
│  • Resolve product manifest from Product Catalog                │
│  • Resolve plan (starter/growth/scale/enterprise)               │
│  • Assign spoke ID (globally unique)                            │
│  • Select deployment region (EU-West, EU-Central, etc.)         │
│  • Record in Hub database: spoke_id, org, product, plan         │
│                                                                  │
│  PHASE 2: PROVISION                                              │
│  • Create Kubernetes namespace: spoke-{spoke_id}                │
│  • Deploy OS containers (API server, MCP server, workers)       │
│  • Provision PostgreSQL instance (dedicated)                    │
│  • Provision Neo4j instance (dedicated)                         │
│  • Provision object storage bucket                              │
│  • Deploy LLM Gateway (Tier A model endpoint)                   │
│  • Configure networking (ingress, TLS, DNS)                     │
│  • Generate spoke credentials (written to vault, not CLI)       │
│                                                                  │
│  PHASE 3: BOOT                                                   │
│  • OS performs first-boot initialization                        │
│  • Run database migrations (create core schemas)                │
│  • Initialize Private Registry (sync from Hub)                  │
│  • Seed GSR reference data (substances, regulations)            │
│  • Generate tenant DID (self-sovereign identity)                │
│                                                                  │
│  PHASE 4: INSTALL                                                │
│  • Read product manifest                                        │
│  • For each Pack in manifest:                                   │
│    ├─ Fetch from Hub's Public Registry                          │
│    ├─ Verify signature (publisher DID)                          │
│    ├─ Store in Private Registry                                 │
│    └─ Run registry:install (Simulator validates)                │
│  • Apply default tenant configuration                           │
│  • Generate initial Compliance Lock                             │
│                                                                  │
│  PHASE 5: HANDOFF                                                │
│  • Create first admin user (from signup or sales contact)       │
│  • Send welcome email with access URL                           │
│  • Report spoke status to Hub: READY                            │
│  • Begin telemetry heartbeat                                    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Pipeline Properties

**Idempotent.** If any phase fails, the orchestrator can retry from the failed step. Every phase checks whether its work has already been done before executing. A network timeout during Phase 2 doesn't leave a half-provisioned spoke -- the retry picks up where it left off.

**Observable.** Each phase transition emits a provisioning event to the Hub. The admin panel (and the customer, during self-service) sees a real-time status. If something stalls, ops gets alerted.

**The sales-assisted path** differs only in Phase 1 -- instead of a web form + payment, an admin triggers provisioning with custom parameters: specific region, custom plan limits, pre-configured private packs, or a pre-negotiated contract ID. Phases 2-5 are identical.

### Simulator Auto-Approval on Fresh Install

Phase 4 runs `registry:install` which triggers the Simulator. On a fresh install from a verified product manifest, there's no existing state to conflict with -- requiring human approval would add friction with zero safety benefit.

| Scenario | Simulator Behavior |
|---|---|
| **Fresh install from product manifest** | Auto-approve (no existing state to conflict with) |
| **Adding packs to an existing spoke** | Normal flow: simulate, diff, human approves |
| **Fresh install with pre-configured private packs** | Simulate to check for conflicts between product packs and private packs. Auto-approve if no conflicts, require human approval if conflicts detected |

---

## 4. The Spoke Anatomy

Every spoke is a self-contained OS instance running in its own Kubernetes namespace.

```
┌─────────────────────────────────────────────────────────────────┐
│              SPOKE: spoke-acme-corp-eu-west                      │
│              Kubernetes Namespace                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  STATELESS SERVICES (Deployments, horizontally scalable)         │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐            │
│  │  API Server  │ │  MCP Server  │ │   Workers    │            │
│  │  (Hono)      │ │              │ │  (Jobs,      │            │
│  │              │ │  AI agent    │ │   events,    │            │
│  │  REST API    │ │  interface   │ │   schedules) │            │
│  │  for apps    │ │  for agents  │ │              │            │
│  └──────────────┘ └──────────────┘ └──────────────┘            │
│                                                                  │
│  STATEFUL SERVICES (StatefulSets or managed, NOT shared)         │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐            │
│  │  PostgreSQL  │ │    Neo4j     │ │ Object Store │            │
│  │              │ │              │ │              │            │
│  │  • Entities  │ │  • Knowledge │ │  • SDS PDFs  │            │
│  │  • Audit log │ │    graph     │ │  • CoAs      │            │
│  │  • Registry  │ │  • Trust     │ │  • Reports   │            │
│  │    metadata  │ │    paths     │ │  • Exports   │            │
│  │  • Compliance│ │  • Workflow  │ │              │            │
│  │    locks     │ │    state     │ │              │            │
│  └──────────────┘ └──────────────┘ └──────────────┘            │
│                                                                  │
│  AI INFRASTRUCTURE                                               │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                   LLM Gateway                             │   │
│  │  ┌────────────────────┐  ┌────────────────────────────┐  │   │
│  │  │ Tier A (local)     │  │ Tier B (proxied)           │  │   │
│  │  │ Self-hosted 7B-13B │  │ Cloud API for reasoning    │  │   │
│  │  │ Sees customer data │  │ Never sees customer data   │  │   │
│  │  └────────────────────┘  └────────────────────────────┘  │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  SPOKE AGENT                                                     │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Sidecar process that manages the spoke's relationship    │   │
│  │  with the Hub:                                            │   │
│  │                                                           │   │
│  │  • Heartbeat (report health to Hub every 60s)             │   │
│  │  • Registry sync (poll Hub for Pack updates)              │   │
│  │  • Telemetry export (usage metrics, error rates)          │   │
│  │  • License enforcement (validate plan limits)             │   │
│  │  • OS update coordination (pull new OS versions)          │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

**Stateless services scale horizontally.** The API Server, MCP Server, and Workers are stateless Kubernetes Deployments. Under load, you add replicas. They all connect to the same PostgreSQL and Neo4j instances.

**Stateful services are dedicated, not shared.** Each spoke gets its own PostgreSQL and Neo4j. These can be K8s StatefulSets, managed database services (RDS, Cloud SQL), or operator-managed (CloudNativePG, Neo4j Operator) -- the spoke doesn't care, it just needs a connection string.

**The Spoke Agent is the Hub's representative.** It handles all Hub communication. If the Hub goes down, the spoke continues operating -- it just can't sync new Packs or report telemetry until connectivity is restored. The spoke never depends on the Hub for runtime operations.

**Tier A AI is per-spoke.** Each spoke routes through its own LLM Gateway. For Starter, Growth, and Scale plans, the gateway connects to a shared regional GPU pool with strict tenant isolation. Enterprise plans get dedicated GPU allocation. See [Section 10](#10-scaling--resource-profiles) for details.

---

## 5. The Hub Anatomy

The Hub is lean by design. It distributes software and manages commercial operations. It never processes compliance data.

```
┌─────────────────────────────────────────────────────────────────┐
│                         THE HUB                                  │
│              Kubernetes Cluster (single region)                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  PUBLIC-FACING                                                   │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐            │
│  │  Marketing   │ │  Signup &    │ │  Customer    │            │
│  │  Site        │ │  Onboarding  │ │  Portal      │            │
│  └──────────────┘ └──────────────┘ └──────────────┘            │
│                                                                  │
│  CONTROL PLANE                                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │   │
│  │  │ Provisioning│  │  Product    │  │  Spoke      │     │   │
│  │  │ Orchestrator│  │  Catalog    │  │  Registry   │     │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘     │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │   │
│  │  │  Billing    │  │  Update     │  │  Telemetry  │     │   │
│  │  │  Engine     │  │  Manager    │  │  Collector  │     │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘     │   │
│  │  ┌─────────────┐                                        │   │
│  │  │  Network    │                                        │   │
│  │  │  Directory  │                                        │   │
│  │  └─────────────┘                                        │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  PACK DISTRIBUTION                                               │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                  PUBLIC REGISTRY                          │   │
│  │  Content-addressed storage (CIDs)                        │   │
│  │  Signature verification (publisher DIDs)                 │   │
│  │  Trust tier enforcement (community/verified/certified)   │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  INTERNAL OPS                                                    │
│  ┌──────────────┐ ┌──────────────┐                              │
│  │  Admin       │ │  Ops         │                              │
│  │  Panel       │ │  Dashboard   │                              │
│  └──────────────┘ └──────────────┘                              │
│                                                                  │
│  HUB DATABASE                                                    │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  PostgreSQL (single instance)                            │   │
│  │                                                          │   │
│  │  • organizations (customer accounts)                     │   │
│  │  • spokes (id, status, version, region, plan, health)    │   │
│  │  • products (manifests, pricing)                         │   │
│  │  • subscriptions (plan, billing cycle, usage)            │   │
│  │  • pack_registry (CIDs, signatures, metadata)            │   │
│  │  • network_directory (spoke DID, public MCP endpoint,    │   │
│  │    A2A capabilities, visibility preferences)             │   │
│  │  • provisioning_events (pipeline audit trail)            │   │
│  │  • telemetry_snapshots (aggregated spoke metrics)        │   │
│  │                                                          │   │
│  │  NOTE: No customer compliance data. Ever.                │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Hub Data Boundary

| The Hub knows | The Hub does NOT know |
|---|---|
| Spoke ID, region, status | What products the customer has created |
| OS version running | What substances are in their formulations |
| Which Packs are installed (names + versions) | What their compliance status is |
| Plan limits (max users, max products) | Who their suppliers are |
| Usage counts (product count, user count) | Their uploaded documents |
| Error rates and latency (aggregated) | Their knowledge graph contents |
| Last heartbeat timestamp | Their AI conversations |

This boundary is absolute. The Hub's database schema physically cannot store compliance data because it has no tables for it.

### Network Directory

The Network Directory provides A2A discovery -- mapping DIDs to spoke MCP endpoints so spokes can find each other for credential exchange. The Hub answers "where is `did:web:basf.eurocomply.app`?" and then the spokes talk directly. Like DNS for the compliance network.

| Property | Rule |
|---|---|
| **Opt-in** | Spokes choose whether to be discoverable. Private companies can stay unlisted. |
| **Minimal data** | Only DID, endpoint URL, and declared capabilities. No company names unless the spoke publishes one. |
| **Self-maintained** | The Spoke Agent registers and updates its own directory entry. The Hub doesn't infer or fabricate entries. |
| **Open to non-spokes** | Phase 3 of the Compliance Network (Open Protocol) means non-EuroComply instances could register too. |

---

## 6. Hub ↔ Spoke Communication

The spoke is independent but not disconnected. The communication protocol is deliberately asymmetric: **the spoke pulls, the Hub never pushes into the spoke.**

```
                         THE HUB
                           │
              ┌────────────┼────────────┐
              │            │            │
         ◄────┤       ◄────┤       ◄────┤
         PULL │       PULL │       PULL │
              │            │            │
         ┌────▼───┐   ┌────▼───┐   ┌────▼───┐
         │Spoke A │   │Spoke B │   │Spoke C │
         └────┬───┘   └────┬───┘   └────┬───┘
              │            │            │
              ├────────────►────────────►
              PUSH (telemetry, heartbeat)
```

### Spoke → Hub (spoke initiates)

| Call | Method | Frequency |
|---|---|---|
| Heartbeat | `POST /hub/heartbeat` | Every 60s |
| Telemetry | `POST /hub/telemetry` | Every 5min |
| Registry sync | `GET /hub/registry/...` | On schedule |
| Update check | `GET /hub/updates/...` | On schedule |
| License validate | `GET /hub/license/...` | On heartbeat |
| Directory lookup | `GET /hub/directory/...` | On A2A request |
| Directory register | `POST /hub/directory` | On boot + change |

### Hub → Spoke (hub NEVER initiates)

The Hub has no network path into the spoke. Urgent signals (e.g., "critical security update") are conveyed via flags in heartbeat responses.

### Why Pull-Only

1. **Security.** If the Hub can't reach into spokes, a compromised Hub cannot exfiltrate customer data or inject malicious payloads.
2. **Networking simplicity.** Spokes can run behind firewalls, NATs, or in air-gapped environments. They only need outbound HTTPS to the Hub.
3. **Resilience.** If the Hub goes down, spokes don't notice until their next sync attempt fails -- and they just retry later.

### The Heartbeat Response

The heartbeat response is the Hub's only channel to signal the spoke:

```typescript
// Spoke sends heartbeat
POST /hub/api/v1/heartbeat
{
  spoke_id: "spoke-acme-corp-eu-west",
  os_version: "2.0.3",
  status: "healthy",
  uptime_seconds: 864000,
  usage: {
    product_count: 142,
    user_count: 12,
    evaluation_count_24h: 847
  }
}

// Hub responds with signals
{
  acknowledged: true,
  license_valid: true,
  signals: {
    os_update_available: "2.0.4",
    os_update_urgency: "critical",    // "routine" | "recommended" | "critical"
    pack_updates_available: 3,
    registry_sync_recommended: true,
    message: null                      // Optional human-readable message for admin
  }
}
```

### Authentication

| Credential | Purpose |
|---|---|
| **Spoke API key** | Spoke authenticates to Hub (heartbeat, sync, telemetry). Rotatable. |
| **Hub signing key (public)** | Spoke verifies that Packs and OS updates genuinely came from the Hub. Baked into the OS image. |

The spoke never sends its private keys to the Hub. The Hub never stores spoke database credentials.

---

## 7. OS Updates & Pack Lifecycle

Two distinct update channels with different risk profiles, cadences, and rollout strategies.

### Version Terminology

| Term | Example | Where Used | Meaning |
|------|---------|------------|---------|
| `os_version` | `"2.0.3"` | Heartbeat, fleet management | The overall EuroComply OS release. Encompasses Kernel VM, Platform Services, API Server, MCP Server, Worker, Spoke Agent. |
| `handler_vm_exact` | `"1.0.3-build.442"` | Compliance Lock | The exact Kernel VM build. Pinned for deterministic replay -- this is what determines computation results. Each `os_version` maps to exactly one `handler_vm_exact`. |
| `handler_vm_version` | `"^1.0.0"` | Pack manifest (`pack.json`) | Semver range declaring which Kernel VM versions a Pack is compatible with. Checked during OS update pre-flight and Pack install. |

### OS Updates vs Pack Updates

| | OS Updates | Pack Updates |
|---|---|---|
| **Contents** | Kernel VM, Platform Services, API Server, MCP Server, Worker runtime, Spoke Agent | Logic Packs, Environment Packs, Driver Packs, Intelligence Packs, GSR data |
| **Cadence** | Monthly | Continuous |
| **Risk** | High (runtime changes) | Medium (logic changes) |
| **Rollout** | Staged (canary → GA) | Per-spoke, on-demand |
| **Downtime** | Brief (rolling restart) | None (hot install) |

### OS Update Rollout Strategy

```
STAGE 1: INTERNAL (Day 0)
  EuroComply's own test spokes
  Full regression suite against all product manifests

STAGE 2: CANARY (Day 1-3)
  5% of spokes (opt-in early adopters)
  Monitor: error rates, latency, Kernel VM correctness
  Automatic rollback trigger: error rate > 0.1%

STAGE 3: GENERAL AVAILABILITY (Day 3+)
  All spokes eligible
  Spoke Agents pull update on their sync schedule
  Spokes with pinned versions: notified, not updated

CRITICAL SECURITY PATCH: Skip to Stage 3 immediately
  Heartbeat response sets os_update_urgency: "critical"
  Spoke Agent auto-applies without waiting for sync schedule
```

### OS Update Mechanics within a Spoke

```
1. Spoke Agent pulls new OS container images
2. Spoke Agent runs pre-flight check:
   • Database migration compatibility
   • Pack compatibility (all installed Packs declare handler_vm_version
     compatible with new OS version)
3. If pre-flight passes:
   • Apply database migrations (if any)
   • Rolling restart of stateless services (zero-downtime)
   • Verify health checks pass
   • Report new version to Hub
4. If pre-flight fails:
   • Abort update
   • Report failure reason to Hub
   • Spoke continues running on current version
```

### Pack Updates

Pack updates go through the Simulator -- the same system described in the Registry design:

```
1. Hub publishes new Pack version to Public Registry
2. Spoke Agent detects update during registry sync
3. Spoke Agent notifies spoke admin: "3 pack updates available"

4a. MANUAL: Admin reviews changelog, triggers registry:bump
    → Simulator runs shadow test against tenant's products
    → Diff report shows impact
    → Admin approves or rejects

4b. AUTO (configurable per Pack): For Intelligence Packs
    (e.g., updated GSR substance data), the spoke can be
    configured to auto-bump if:
    • Pack trust_tier >= tenant's minimum_tier
    • Simulator diff shows zero compliance status changes
    • Pack is marked "safe_auto_update" in manifest
```

### Version Pinning & the Compliance Lock

| What gets pinned | Where it's recorded | Who controls it |
|---|---|---|
| Kernel VM exact build | Compliance Lock: `handler_vm_exact` | Pinned by OS version; Spoke admin or auto-update policy |
| Pack versions (exact CIDs) | Compliance Lock: `packs` | Simulator approval |
| GSR data version | Compliance Lock: `gsr_version` | Intelligence Pack update |

A compliance evaluation performed today can be replayed in 5 years because the Compliance Lock pins every version.

### Enterprise Version Control

```yaml
# Spoke-level update policy
update_policy:
  os:
    channel: "stable"          # "canary" | "stable" | "pinned"
    pinned_version: null       # set to pin, e.g., "2.0.3"
    maintenance_window:
      day: "sunday"
      hour: "03:00"
      timezone: "Europe/Berlin"

  packs:
    auto_update:
      intelligence_packs: true   # GSR data: auto-bump if safe
      logic_packs: false         # compliance rules: always manual
      driver_packs: false        # connectors: always manual
    require_approval_from:
      - "role:regulatory_manager"
```

---

## 8. Observability

The Hub needs to operate a fleet of spokes without seeing inside them. The telemetry model gives EuroComply enough operational visibility to run a reliable SaaS business while preserving the data sovereignty guarantee.

The principle: **metrics about the system, never about the data in the system.**

### What Spokes Report (every 5 minutes)

**System Health:**
- CPU / memory / disk utilization per service
- PostgreSQL: connection pool usage, query latency p50/p99
- Neo4j: heap usage, query latency, cache hit ratio
- Object storage: bucket size, request count
- LLM Gateway: inference latency, queue depth, GPU utilization

**Platform Metrics (counts, never content):**
- entity_count (by type, no names)
- evaluation_count_24h
- active_user_count
- api_request_count (by endpoint pattern, not parameters)
- mcp_tool_call_count (by tool name, not inputs/outputs)
- job_queue_depth
- event_count (by event_type, not payload)

**Error Signals:**
- error_count (by error_code, not error details)
- failed_evaluation_count (count only, not which products)
- handler_timeout_count (by handler_id)
- migration_failure (boolean + migration version)

**Pack Inventory:**
- installed_packs (name, version, CID)
- compliance_lock_count
- last_simulator_run (timestamp only)

### What Spokes NEVER Report

- Entity names, IDs, or field values
- Substance names, CAS numbers, concentrations
- User names, emails, or activity details
- Document contents or filenames
- Graph structure or relationships
- Evaluation results (pass/fail)
- AI prompts, responses, or conversation content
- Compliance Lock contents (beyond count)
- Anything that could identify a specific product or supplier

### Three Observability Layers

**Layer 1: Spoke-Local (full visibility, stays in spoke)**
- Application logs (structured, with entity context)
- Distributed traces (full request lifecycle)
- Handler execution traces (detailed, per-evaluation)
- Audit log (who did what to which entity)
- Error details with full stack traces
- Stored in: spoke's own PostgreSQL + local log storage
- Accessible to: spoke admin, customer support (via spoke admin granting temporary access)
- Retention: customer-configurable

**Layer 2: Hub Telemetry (aggregated, crosses boundary)**
- System health metrics (CPU, memory, latency)
- Platform counts (entities, evaluations, users)
- Error rates (counts by code, never details)
- Pack inventory (names and versions)
- Stored in: Hub's telemetry database
- Accessible to: EuroComply ops team
- Retention: 90 days rolling

**Layer 3: Ops Dashboard (derived from Layer 2)**
- Fleet health overview (all spokes at a glance)
- Spoke drilldown (one spoke's health over time)
- Alert rules (missed heartbeats, elevated error rates, disk pressure, etc.)
- Capacity planning (growth trends across fleet)
- Update rollout progress

### Customer Support Model

When a customer reports an issue, the support flow respects the data boundary:

1. **EuroComply support checks Layer 2** (Hub telemetry): system health, OS version, Pack inventory
2. **If content-level debugging is needed**, support requests Layer 1 access
3. **Customer's spoke admin grants temporary read access** (time-limited, audit-logged, revocable)
4. **Support connects to spoke's local observability** and diagnoses the issue
5. **Access expires automatically** after the support session

The customer always controls whether EuroComply support can see inside their spoke.

---

## 9. Networking & Connectivity

Three distinct network flows with different security profiles.

### Flow 1: User → Spoke

Each spoke gets a unique hostname:

```
Standard:  acme-corp.eurocomply.app
Custom:    compliance.acme-corp.com  (CNAME to above)

Routes:
  acme-corp.eurocomply.app/api/v1/*  → API Server
  acme-corp.eurocomply.app/mcp       → MCP Server
  acme-corp.eurocomply.app/*         → Frontend (SPA)
```

TLS: automatic via cert-manager (Let's Encrypt). Custom domains: customer provides cert or uses EuroComply's CA.

Authentication: Clerk per spoke. Each spoke has its own Clerk application instance. No shared auth between spokes.

### Flow 2: Spoke → Hub

Covered in [Section 6](#6-hub--spoke-communication). Single endpoint: `hub.eurocomply.com/api/v1/...`

### Flow 3: Spoke ↔ Spoke (A2A)

Two customer instances communicating directly for credential exchange, without the Hub in the data path.

```
1. DISCOVER
   Acme's AI agent needs to verify a credential from BASF
   → Spoke Agent queries Hub Network Directory
   → Hub returns: { endpoint: "basf.eurocomply.app/mcp",
                     capabilities: ["claims", "evidence"] }

2. AUTHENTICATE
   Acme's spoke connects to BASF's MCP endpoint
   → Mutual DID authentication
   → BASF checks its access policy: "Do I talk to Acme?"

3. EXCHANGE
   Acme calls a2a:request_claim on BASF's MCP server
   → Direct spoke-to-spoke, Hub never sees the payload
```

### A2A Access Control

Each spoke controls who can connect to its A2A endpoint:

```yaml
a2a_policy:
  discoverable: true

  inbound:
    default: "deny"

    allow:
      - did: "did:web:acme.eurocomply.app"
        capabilities: ["claims", "requests", "evidence"]
        automation: "semi_auto"

      - did: "did:web:retailer-x.eurocomply.app"
        capabilities: ["claims"]
        automation: "full_auto"

      - relationship: "direct_supplier"
        capabilities: ["claims", "requests"]
        automation: "semi_auto"

  outbound:
    rate_limit: 100
    cache_directory: true
```

### Network Isolation

Spokes cannot reach each other's internal services. The only exposed surface between spokes is the MCP endpoint for A2A, which is explicitly opted into and policy-controlled. Kubernetes NetworkPolicies enforce this at the cluster level -- one spoke cannot reach another spoke's PostgreSQL, Neo4j, or internal API.

---

## 10. Scaling & Resource Profiles

Not every customer needs the same infrastructure footprint. The plan determines the starting point, and autoscaling handles variance.

### Spoke Size Profiles

| Component | Starter | Growth | Scale | Enterprise |
|---|---|---|---|---|
| API Server | 1 replica, 256MB, 0.25 vCPU | 2 replicas, 512MB, 0.5 vCPU | 2 replicas, 1GB, 0.5 vCPU | 3+ replicas, 1GB, 1 vCPU |
| MCP Server | 1 replica, 256MB, 0.25 vCPU | 1 replica, 512MB, 0.5 vCPU | 2 replicas, 512MB, 0.5 vCPU | 3+ replicas, 1GB, 1 vCPU |
| Worker | 1 replica, 256MB, 0.25 vCPU | 1 replica, 512MB, 0.5 vCPU | 2 replicas, 512MB, 0.5 vCPU | 3+ replicas, 1GB, 1 vCPU |
| PostgreSQL | 1 instance, 1GB, 10GB disk | 1 instance, 2GB, 25GB disk | 1 instance, 4GB, 50GB disk | HA cluster, 16GB, 500GB disk |
| Neo4j | 1 instance, 1GB, 10GB disk | 1 instance, 2GB, 25GB disk | 1 instance, 4GB, 50GB disk | HA cluster, 16GB, 500GB disk |
| Object Store | 5GB quota | 25GB quota | 50GB quota | 1TB+ quota |
| LLM | Shared pool, best-effort | Shared pool, best-effort | Shared pool, priority | Dedicated GPU |

### Autoscaling

Stateless services use Kubernetes Horizontal Pod Autoscaler:

| Service | Scale-up trigger | Scale-down trigger |
|---|---|---|
| API Server | CPU > 70% or request latency p99 > 500ms | CPU < 30% for 10 min |
| MCP Server | Active MCP connections > 80% capacity | Connections < 20% for 10 min |
| Workers | Job queue depth > 50 | Queue empty for 10 min |

Stateful services scale vertically -- the Spoke Agent monitors resource utilization and alerts the Hub when a spoke approaches plan capacity limits.

### Shared GPU Pool (Tier A LLM)

Dedicated GPU per customer is ideal for data sovereignty but prohibitive for smaller plans. The solution is a regional shared GPU pool with strict tenant isolation:

```
Region: EU-West
┌──────────────────────────────────────────────────────┐
│  GPU Cluster: 4x A100                                │
│  Model: eurocomply-compliance-7b (quantized)         │
│  Runtime: vLLM with multi-tenant request routing     │
│                                                      │
│  ISOLATION GUARANTEES:                               │
│  • Requests carry spoke_id, never mixed in batches   │
│  • KV cache partitioned per tenant                   │
│  • Request/response encrypted in transit             │
│  • No logging of prompt content at pool level         │
│                                                      │
│  PER-PLAN ALLOCATION:                                │
│  • Starter:       best-effort, 10 req/min            │
│  • Growth:        best-effort, 25 req/min            │
│  • Scale:         priority queue, 50 req/min         │
│  • Enterprise:    dedicated GPU slice or GPU          │
└──────────────────────────────────────────────────────┘
```

### Cost Model per Spoke (approximate infrastructure cost)

| Component | Starter | Growth | Scale | Enterprise |
|---|---|---|---|---|
| Compute (K8s pods) | EUR 25/mo | EUR 40/mo | EUR 80/mo | EUR 400/mo |
| PostgreSQL | EUR 15/mo | EUR 30/mo | EUR 50/mo | EUR 200/mo |
| Neo4j | EUR 20/mo | EUR 40/mo | EUR 60/mo | EUR 250/mo |
| Object storage | EUR 2/mo | EUR 5/mo | EUR 10/mo | EUR 50/mo |
| LLM (pool share) | EUR 10/mo | EUR 20/mo | EUR 40/mo | EUR 200/mo |
| Monitoring & Logs | EUR 3/mo | EUR 5/mo | EUR 10/mo | EUR 30/mo |
| Backups & DR | EUR 5/mo | EUR 10/mo | EUR 15/mo | EUR 70/mo |
| **Total** | **EUR ~80/mo** | **EUR ~150/mo** | **EUR ~265/mo** | **EUR ~1,200/mo** |

---

## 11. Disaster Recovery & Data Durability

A compliance platform cannot lose data. Compliance Locks, audit trails, and evaluation traces have legal weight. The infrastructure must guarantee durability even in the face of region-level failures.

### Backup Strategy

**Per-spoke backups (managed by Spoke Agent):**

| Data Store | Backup Method | Retention | Storage Location |
|---|---|---|---|
| PostgreSQL | Continuous WAL archiving + daily full snapshot | 30 days (configurable) | Object storage, same region |
| Neo4j | Daily full backup + transaction log archiving | 30 days | Object storage, same region |
| Object Storage | Bucket versioning enabled | Indefinite | Same region (cross-region for Enterprise) |
| Compliance Locks & Audit Logs | Append-only tables + cold storage export | 10 years minimum | Same region + cold storage |

**Key principle:** Backups stay in the spoke's region. Customer data never leaves its deployment region, not even as a backup. Cross-region replication is opt-in (Enterprise only).

### Recovery Scenarios

| Scenario | Impact | Recovery | Data Loss | RTO |
|---|---|---|---|---|
| Stateless service crash | Requests fail | K8s auto-restart | None | <30s |
| PostgreSQL failure (single) | Spoke operations halt | Restore from WAL | Last few seconds | <15 min |
| PostgreSQL failure (HA) | Brief connection drop | Auto-failover | None | <30s |
| Neo4j failure | Graph queries fail, CRUD continues | Restore from backup | Last few hours | <30 min |
| Full spoke namespace destroyed | Complete outage | Re-provision + restore | Up to 24h | <2 hours |
| Region-level outage (Starter/Pro) | Unavailable | Wait for region recovery | None | Depends on provider |
| Region-level outage (Enterprise) | Unavailable | Failover to standby region | Minutes | <1 hour |
| Hub outage | No provisioning, no sync | Restore Hub | None at spoke level | <1 hour, zero spoke downtime |

### Immutable Record Classes

| Record Class | Storage | Guarantee |
|---|---|---|
| Compliance Locks | Append-only PG table + cold storage | No UPDATE/DELETE, 10yr retention |
| Audit Log entries | Append-only PG table + cold storage | No UPDATE/DELETE, 10yr retention |
| Handler Execution Traces | Content-addressed store | Immutable by CID, indefinite |
| Signed VCs | Content-addressed store + revocation registry | Immutable by CID, indefinite |
| Pack CIDs (certified tier) | Public Registry | Permanent, never deleted |

**Enforcement:** Append-only tables use GRANT/REVOKE to remove UPDATE and DELETE permissions from the application role. Cold storage uses write-once bucket policy. Content-addressed storage makes tampering detectable (different content = different CID).

### Spoke Reconstruction Guarantee

Given the backups and the Registry, a completely destroyed spoke can be rebuilt:

```
Spoke reconstruction inputs:
  1. Hub's Spoke Registry entry     → OS version, product, plan
  2. Product manifest               → which Packs to install
  3. PostgreSQL backup              → all entity data, audit logs, locks
  4. Neo4j backup                   → knowledge graph
  5. Object storage bucket          → all documents
  6. Compliance Lock history        → exact versions of everything

These six inputs are sufficient to rebuild the spoke entirely.
No other state exists outside these stores.
```

---

## 12. Tenant Lifecycle

Provisioning is Phase 1 of a spoke's life. The infrastructure must also handle plan changes, suspensions, and decommissioning.

### Lifecycle States

```
PROVISIONING ──► ACTIVE ──► SUSPENDED ──► DECOMMISSIONED
                   │            │
                   │            └──► ACTIVE (reactivation)
                   │
                   └──► UPGRADE/DOWNGRADE (scale resources, change plan)
```

### State Transitions

**ACTIVE → SUSPENDED**

Trigger: Payment failure (after grace period), customer-requested pause, or terms of service violation.

Actions:
- API Server switches to read-only mode (GETs succeed, mutations return 403)
- MCP Server rejects new tool calls
- Workers stop processing job queue
- A2A inbound requests return "temporarily_unavailable"
- Scheduled evaluations paused
- LLM Gateway quota set to zero
- Databases remain running (data accessible for reads)

**SUSPENDED → ACTIVE**

Trigger: Payment resolved or admin reactivation. Instant -- no data loss, no re-provisioning.

**ACTIVE → UPGRADE/DOWNGRADE**

Trigger: Customer changes plan. Hub updates plan limits, Spoke Agent picks up new limits on next heartbeat. Upgrade scales immediately; downgrade scales in next maintenance window.

### Decommissioning Pipeline

```
PHASE 1: NOTICE (Day 0)
  Customer notified: "Your instance will be decommissioned in 30 days"
  Reactivation still possible

PHASE 2: EXPORT WINDOW (Day 0-30)
  Spoke switched to export-only mode
  Bulk export tools enabled:
    • Full PostgreSQL dump (SQL or CSV)
    • Neo4j graph export (Cypher or JSON-LD)
    • Object storage download (all files)
    • Compliance Lock archive (all locks + traces)
    • Audit log export (full history)
    • Verifiable Credentials export
  Export receipt generated (hash manifest of all data)

PHASE 3: DESTRUCTION (Day 30)
  Verify export receipt was downloaded (warn if not)
  Delete: K8s namespace, PostgreSQL, Neo4j, object storage, backups
  Revoke spoke credentials
  Remove from Network Directory
  Hub Spoke Registry entry marked: DECOMMISSIONED

PHASE 4: VERIFICATION (Day 30 + 1)
  Automated scan: confirm no resources remain
  Generate destruction certificate
  Send destruction certificate to customer
  (GDPR Article 17 compliance -- right to erasure)
```

### Legal Hold Exception

If a regulatory investigation or legal dispute is active, decommissioning is blocked. The spoke enters LEGAL_HOLD state: no data destruction, read-only access maintained, billing suspended (EuroComply absorbs cost). Released only by explicit legal clearance.

### Product Additions and Removals

| Action | What happens |
|---|---|
| **Add product** | Install additional Packs via `registry:install`. Simulator validates. No infrastructure change unless resource limits are hit. |
| **Remove product** | Uninstall Packs. Simulator validates that removal doesn't break dependencies. Entity data is not deleted -- it becomes orphaned and exportable, but rules/workflows stop executing. |

---

## 13. Infrastructure as Code

Everything is codified, versioned, and reproducible. No manual infrastructure.

### Repository Structure

Infrastructure lives inside the `eurocomply-os` monorepo under `infra/`. Product manifests live in the separate `eurocomply-registry` repo. There is no standalone infrastructure repo -- infrastructure is tightly coupled to the OS code it deploys.

```
eurocomply-os/infra/
├── helm/
│   ├── hub/                    # Control plane, registry, telemetry, portals
│   │   └── configs/            # Alert rules, rollout policies
│   └── spoke/
│       └── eurocomply-os/      # THE spoke Helm chart
│           ├── Chart.yaml
│           ├── values.yaml
│           ├── values-small.yaml
│           ├── values-medium.yaml
│           ├── values-large.yaml
│           └── templates/      # All spoke K8s resources
│
├── terraform/
│   ├── modules/                # Cloud-agnostic resource modules
│   │   ├── kubernetes/         # Cluster provisioning
│   │   ├── database/           # PostgreSQL + Neo4j
│   │   ├── storage/            # Object storage
│   │   ├── gpu-pool/           # Regional GPU cluster + vLLM router
│   │   └── networking/         # DNS, TLS, ingress
│   └── environments/
│       ├── dev/
│       ├── staging/
│       └── production/
│           └── regions/
│               ├── eu-west.yaml
│               ├── eu-central.yaml
│               └── eu-north.yaml
│
├── operators/                  # CloudNativePG, Neo4j operator, cert-manager
└── shared/
    └── cert-manager/           # TLS automation

eurocomply-registry/products/   # Product manifests (separate repo)
├── cosmetics-starter.yaml
├── cosmetics-pro.yaml
├── textiles-starter.yaml
├── textiles-pro.yaml
└── ...
```

### The Spoke Helm Chart

The spoke Helm chart is the single artifact that defines a spoke. The Provisioning Orchestrator calls `helm install` with the appropriate values:

```bash
# Orchestrator writes secrets to vault FIRST, then:
helm install spoke-acme-corp \
  eurocomply-os/ \
  --namespace spoke-acme-corp \
  --create-namespace \
  --values values-medium.yaml \
  --set spoke.id=spoke-acme-corp-eu-west \
  --set spoke.region=eu-west \
  --set spoke.product=eurocomply-cosmetics \
  --set spoke.plan=growth \
  --set spoke.hostname=acme-corp.eurocomply.app

# No secrets in the command. All injected by ESO from vault.
```

### Cloud-Agnostic Abstraction

| Abstraction | AWS | GCP | Hetzner |
|---|---|---|---|
| kubernetes.cluster | EKS | GKE | k3s |
| database.postgresql | RDS | Cloud SQL | CloudNativePG |
| database.neo4j | Neo4j Aura | Neo4j Aura | Neo4j Operator |
| storage.objects | S3 | GCS | MinIO |
| storage.backup | S3 Glacier | Coldline | MinIO |
| compute.gpu | p4d instances | A2 VMs | Dedicated |
| networking.ingress | ALB | Cloud LB | Traefik |
| networking.dns | Route53 | Cloud DNS | External |
| networking.tls | ACM | Managed Cert | cert-manager |

The Terraform modules accept a `provider` variable. The Helm chart accepts a `cloudProvider` value. Same chart, different backends.

### Secrets Management

The `eurocomply-os/infra/` directory contains ZERO secrets. It contains references to secrets, never the values.

**Toolchain: External Secrets Operator (ESO)**

ESO is cloud-agnostic and supports every major vault backend. It syncs secrets as native K8s Secrets at runtime.

| Cloud | Vault Backend |
|---|---|
| AWS | AWS Secrets Manager |
| GCP | Secret Manager |
| Azure | Key Vault |
| Self-hosted | HashiCorp Vault |

**Provisioning flow:**

1. Orchestrator generates spoke credentials (API key, DB passwords, DID key pair)
2. Orchestrator writes secrets to the vault (not to K8s or CLI)
3. Helm chart includes ExternalSecret manifests referencing vault paths
4. ESO syncs vault → K8s Secret → Pod env vars
5. No human ever sees raw values in transit

**Secret rotation:**

| Secret | Rotation Cadence | Mechanism |
|---|---|---|
| Spoke API key | 90 days | Spoke Agent requests new key, 24h overlap |
| Database passwords | 180 days | ESO rotates in vault, rolling restart |
| DID private key | Never (unless compromised) | Key revocation + new DID |
| Clerk app secret | Per Clerk policy | Updated in vault, ESO syncs |
| LLM API keys (Tier B) | 90 days | Updated in vault, ESO syncs |

### CI/CD Pipeline

```
Developer pushes infra changes to eurocomply-os
  → CI: Validate (helm lint, terraform plan, YAML schema check)
  → CI: Test (deploy to dev, run smoke tests, provision + destroy test spoke)
  → PR Review (human approval for infra changes)
  → CD: Staging (deploy, integration tests, soak 24h)
  → CD: Production (hub first, then spokes via Update Manager staged rollout)
```

---

## 14. Invariants

These rules are enforced by the infrastructure at all times. They are structural constraints, not guidelines.

1. **Customer data never leaves the spoke.** The Hub has no tables for compliance data. Telemetry contains counts, never content. Backups stay in the spoke's region. The GPU pool processes but never stores.

2. **The Hub cannot reach into a spoke.** All communication is spoke-initiated (pull model). Hub has no network path to spoke internals. A compromised Hub cannot exfiltrate data.

3. **Spokes operate independently of the Hub.** Hub outage = no new provisioning, no pack sync. All existing spokes continue operating normally. No runtime dependency on Hub availability.

4. **Spokes cannot reach each other's internals.** Only the A2A MCP endpoint is exposed between spokes. NetworkPolicies enforce isolation at the cluster level. Database, internal API, and storage are unreachable.

5. **Every spoke is reconstructable.** Hub Spoke Registry + product manifest + backups + Compliance Lock history = complete spoke rebuild. No state exists outside these stores.

6. **No secrets in git.** The `eurocomply-os/infra/` directory contains references, never values. External Secrets Operator bridges vault to K8s. Provisioning Orchestrator writes to vault, not to CLI.

7. **Infrastructure is code.** No manual cluster configuration. Every spoke provisioned from the same Helm chart. All changes go through PR review and CI/CD pipeline.

8. **Immutable records cannot be destroyed.** Compliance Locks, audit logs, handler traces, and signed VCs are append-only with 10-year retention. Database permissions structurally prevent deletion. Exception: decommissioning after export + legal clearance.

9. **One OS, many products.** The OS image is identical for every spoke. Product identity comes from Pack configuration. New products are manifest files, not code changes.

10. **Fresh installs from verified manifests auto-approve.** No Simulator human approval needed on first boot. Adding packs to existing spokes requires approval. Conflicts between product and private packs require approval even on fresh install.

---

**Document Control**

| Version | Date | Changes |
|---------|------|---------|
| 0.1 | 2026-02-03 | Initial design from brainstorming session |

---

*This document is part of the EuroComply Compliance OS design series:*
- *[Kernel VM Design](./2026-02-02-compliance-handler-vm.md) -- The compute half of the Kernel*
- *[Compliance Network Design](./2026-02-02-compliance-network-design.md) -- A2A Protocol (System Services)*
- *[Registry Design](./2026-02-03-registry-design.md) -- Package management (System Services)*
- *[Platform Services Layer](./2026-02-03-platform-services-layer.md) -- The state half of the Kernel*
- ***Infrastructure Design (this document) -- Hub & Spoke deployment model***

---

*The Infrastructure Layer transforms EuroComply from software into a platform business -- where the OS is a universal foundation, products are Pack configurations, and every customer gets a sovereign, dedicated instance that operates independently while remaining connected to the ecosystem through the Registry and A2A Protocol.*
