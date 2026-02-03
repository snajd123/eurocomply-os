# EuroComply OS Execution Plan

**Status:** Active
**Last Updated:** 2026-02-03

---

## 1. Repository Architecture

### The Principle: Engine vs Content

The system splits into two monorepos separated by a fundamental boundary: **Infrastructure** (the machinery that runs compliance) and **Intelligence** (the regulatory knowledge that drives it).

| Repo | Role | Language | Cadence |
|------|------|----------|---------|
| `eurocomply-os` | The Platform (Engine) | TypeScript | Slow, stable releases |
| `eurocomply-registry` | The Content (Intelligence) | YAML, JSON, AST | Continuous delivery |

### Why Two Repos

- **Different change rates.** The Kernel changes monthly. Packs change daily.
- **Different authors.** Engineers build the OS. Regulatory experts author Packs.
- **Different tooling.** The OS needs TypeScript compilation, Docker builds, Helm charts. The Registry needs Pack validation and publishing.
- **Clean dependency direction.** The Registry depends on the OS (via the CLI). The OS never depends on the Registry. Content flows one way: authored → published → installed.

---

## 2. Repository Structure

### Repo 1: `eurocomply-os` (The Platform)

Architecture: Monorepo (pnpm + Turbo)

Mission: Build the binary that runs the company.

```
eurocomply-os/
├── apps/
│   ├── spoke-runtime/           # The Customer OS
│   │   # The Node.js process that boots a Spoke.
│   │   # Wires kernel-vm + platform-services together.
│   │   # Mounts the MCP endpoint (HTTP/SSE + stdio).
│   │   # Serves the Hono REST API.
│   │
│   ├── hub-control-plane/       # The SaaS Backend
│   │   ├── billing/             # Stripe subscriptions, usage metering, invoicing
│   │   ├── provisioning/        # 5-phase pipeline (Claim → Provision → Boot → Install → Handoff)
│   │   ├── registry-api/        # Pack publishing, search, versioning
│   │   ├── fleet/               # Spoke health monitoring, resource tracking
│   │   └── network-directory/   # DID → Spoke endpoint resolution for A2A discovery
│   │
│   └── web-portal/              # Next.js Frontend
│       ├── marketing/           # Landing pages, pricing (driven by product catalog API)
│       ├── onboarding/          # Sign up, select product, pay, provision
│       └── dashboard/           # Customer Spoke management, compliance overview
│
├── packages/
│   ├── kernel-vm/               # THE PURE COMPUTATION ENGINE
│   │   # Constraints: ZERO dependencies. No network. No filesystem. No I/O.
│   │   # Input: ExecutionContext (data + Rule Logic AST)
│   │   # Output: ComplianceResult (pass/fail + evidence + handler trace)
│   │   # Can run in: Node.js, browser, Lambda, CLI, anywhere.
│   │
│   ├── platform-services/       # THE STATEFUL LAYER
│   │   # Dependencies: PostgreSQL, Neo4j, Object Storage, LLM Gateway
│   │   # Exposes: ~90 Platform Services MCP tools (entity, relation, search, file, job, events, ai, etc.)
│   │   # Imports kernel-vm to trigger compliance evaluations.
│   │   # Assembles ExecutionContext, invokes VM, persists results.
│   │
│   ├── network-protocol/        # THE A2A PRIMITIVES
│   │   # The 5 primitives: Identity, Claims, Requests, Evidence, Subscriptions
│   │   # DID management, signature verification, trust model
│   │
│   ├── registry-sdk/            # THE PACK INSTALLER
│   │   # Signature verification, dependency resolution, Compliance Lock validation
│   │   # Simulator integration (run before install, catch regressions)
│   │   # Hydrates Spoke database from Pack artifacts
│   │
│   ├── cli/                     # THE DEVELOPER TOOLS
│   │   # eurocomply lint      → validates Pack YAML/JSON/AST
│   │   # eurocomply test      → runs Simulator locally
│   │   # eurocomply publish   → signs Pack and pushes to Hub Registry
│   │   # eurocomply simulate  → dry-run a Pack install against existing state
│   │
│   └── types/                   # SHARED SCHEMAS
│       # Zod schemas for Pack manifests, ExecutionContext, ComplianceResult,
│       # MCP tool definitions, A2A message formats
│
└── infra/
    ├── helm/
    │   ├── spoke/               # Spoke Helm chart (PostgreSQL, Neo4j, runtime)
    │   └── hub/                 # Hub Helm chart (control plane, registry, portal)
    └── terraform/
        ├── modules/             # Cloud-agnostic resource modules
        └── environments/        # AWS, GCP, Azure provider configs
```

### Repo 2: `eurocomply-registry` (The Content)

Architecture: Data Repository

Mission: Store the regulatory intelligence and product definitions.

```
eurocomply-registry/
├── packs/
│   ├── logic/                   # RULE ASTs
│   │   ├── clp-basic/          # CLP Annex VI restriction checks
│   │   ├── eu-cosmetics/       # EU Cosmetics Regulation 1223/2009
│   │   ├── espr-textiles/      # ESPR DPP rules for textiles
│   │   └── ...
│   │
│   ├── environment/             # ENTITY SCHEMAS
│   │   ├── cosmetics/          # Formulations, INCI names, concentrations
│   │   ├── textiles/           # Garments, fibers, fabric blends
│   │   └── ...
│   │
│   ├── drivers/                 # INTEGRATION CODE
│   │   ├── echa-clp/           # ECHA CLP Annex VI scraper
│   │   ├── echa-reach/         # REACH candidate list scraper
│   │   ├── cosing/             # EU Cosmetics ingredient database
│   │   ├── efsa/               # EFSA food additive data
│   │   ├── cpnp/               # CPNP notification filing
│   │   ├── scip/               # ECHA SCIP database submission
│   │   └── ...
│   │
│   └── intelligence/            # AI & DATA
│       ├── substance-resolver/  # LLM-powered substance name normalization
│       └── global-substances/   # Output: the GSR data artifact
│
├── products/                    # COMMERCIAL BUNDLES (Manifests)
│   ├── cosmetics-starter.yaml
│   ├── cosmetics-pro.yaml
│   ├── textiles-starter.yaml
│   ├── textiles-pro.yaml
│   └── ...
│
├── eurocomply.yaml              # Workspace config (registry endpoint, signing keys)
│
└── .github/
    └── workflows/
        └── publish.yml          # CI: npx @eurocomply/cli lint && npx @eurocomply/cli publish
```

### The Integrated Workflow

```
1. Engineers push code to eurocomply-os.
   → CI builds spoke-runtime and hub-control-plane Docker images.
   → CI publishes Helm charts.

2. Regulatory experts push Packs to eurocomply-registry.
   → CI runs: npx @eurocomply/cli lint (validates AST, schema, manifest)
   → CI runs: npx @eurocomply/cli test (Simulator validates against test data)
   → CI runs: npx @eurocomply/cli publish (signs and pushes to Hub Registry)

3. Customer visits web-portal (served from eurocomply-os).
   → Selects "EuroComply Cosmetics Pro"
   → Pays via Stripe
   → Hub reads cosmetics-pro.yaml manifest (synced from eurocomply-registry)
   → Provisioner deploys a Spoke (Helm chart from eurocomply-os/infra)
   → Spoke boots, pulls and installs Packs listed in the manifest
   → Customer gets a running compliance platform
```

---

## 3. Implementation Phases

### Phase 1: The Core (`kernel-vm`)

**Goal:** Build the pure computation engine. Zero dependencies. Zero I/O.

**Why first:** Everything depends on this. It has no dependencies itself, so it can be built, tested, and validated in complete isolation. If the VM is wrong, everything above it is wrong.

**Deliverables:**
- `ExecutionContext` type definition (the input contract)
- `ComplianceResult` type definition (the output contract)
- Rule Logic AST parser and evaluator
- 5-10 foundational handlers (minimum to express one real compliance rule):
  - `substance.lookup`
  - `threshold.check`
  - `list.match`
  - `logic.and`, `logic.or`
- The Simulator: runs a handler chain against test data, asserts expected results
- 100% test coverage

**Constraints:**
- No dependencies in `package.json` (except dev dependencies for testing)
- No network access, no filesystem access, no database access
- Every handler is a pure function: `(ExecutionContext) → ComplianceResult`
- Must be runnable in Node.js, browser, and Lambda

---

### Phase 2: The State Layer (`platform-services`)

**Goal:** Bridge the pure VM to the real world. Build the execution loop.

**Why second:** The VM can compute, but it needs data. Platform Services provides the data and persists the results.

**Deliverables (minimum viable set, not all 88 tools):**
- Entity management: `entity:create`, `entity:get`, `entity:list`, `entity:update`
- Graph operations: `relation:create`, `relation:list`
- File storage: `file:upload`, `file:get`
- Job queue: `job:submit`, `job:status`
- LLM Gateway: `ai:generate`, `ai:extract`
- MCP server scaffold exposing these tools via the MCP protocol
- The execution loop:

```
MCP Request
  → Platform Services assembles ExecutionContext
  → kernel-vm evaluates handlers
  → Platform Services persists results
  → MCP Response
```

**Test strategy:** Integration tests with real PostgreSQL and Neo4j. No mocks. Tests prove the execution loop works end-to-end.

---

### Phase 3: The First Vertical Slice

**Goal:** One real compliance rule running end-to-end. The architecture proof point.

**The candidate:** CLP Annex VI substance restriction check.

*"Given a product formulation containing Substance X at concentration Y%, is it compliant with CLP classification rules?"*

**What this exercises:**

| Step | Operation | Layer |
|------|-----------|-------|
| 1. Ingest | Load CLP substance data | Platform Services (`entity:create`) |
| 2. Define rule | Author a Rule Logic AST | kernel-vm (AST parser) |
| 3. Submit product | Create product with formulation | Platform Services (`entity:create`, `relation:create`) |
| 4. Evaluate | Run the rule against the product | kernel-vm (handler chain) |
| 5. Result | ComplianceResult with evidence trail | kernel-vm → Platform Services persists |

**Deliverables:**
- A working `spoke-runtime` that boots, connects to PostgreSQL and Neo4j, and serves MCP
- A seed script loading a small subset of CLP Annex VI data (10-20 substances)
- One Logic Pack in `eurocomply-registry`: `packs/logic/clp-basic/`
- The Rule Logic AST for the restriction check in the Pack format
- An end-to-end test: boot spoke → install pack → submit product → get compliance result
- CLI commands: `eurocomply lint` and `eurocomply test`

**MCP universality validated:** The same MCP endpoint serves:
- The CLI (`eurocomply test` over stdio)
- An AI agent (Claude/GPT over HTTP/SSE)
- The web portal (REST API that calls MCP tools internally)
- Another Spoke (A2A protocol wrapping MCP)
- A Driver Pack (MCP calls from inside the Spoke)

**Success criteria:** After this phase, a developer can write a Logic Pack, test it locally with the CLI, and run it on a Spoke. The platform loop is closed.

---

### Phase 4: The Registry (Pack lifecycle)

**Goal:** Make Packs installable, versioned, and manageable.

**Why now:** Phase 3 hardcoded a Pack. Now we build the machinery to install, update, and rollback Packs dynamically.

**Deliverables:**
- `registry-sdk` package: Pack verification, dependency resolution, installation
- Pack format specification enforced: manifest schema, signature verification, Compliance Lock
- All four Pack types working: Logic, Environment, Driver, Intelligence
- `hub-control-plane` scaffold with Registry API: `pack:publish`, `pack:search`, `pack:versions`
- Spoke-side pack lifecycle: `pack:install`, `pack:update`, `pack:rollback`
- Simulator integration: before installing on an existing Spoke, the Simulator validates that no existing compliance results change unexpectedly
- CLI commands: `eurocomply lint`, `eurocomply test`, `eurocomply publish`

**The workflow this phase proves:**

```
Developer authors a Pack in eurocomply-registry
  → eurocomply lint (validates AST, schema, manifest)
  → eurocomply test (runs Simulator locally)
  → eurocomply publish (signs, pushes to Hub Registry API)
  → Hub stores the artifact
  → Spoke pulls the Pack
  → Simulator validates (auto-approve on fresh install)
  → Pack is live
```

**Success criteria:** The `eurocomply-registry` repo is functional. CI validates and publishes Packs. Running Spokes can install them. The Compliance Lock invariant holds.

---

### Phase 5: The Hub (provisioning and billing)

**Goal:** Automate Spoke creation. Make the product sellable.

**Why now:** Everything before this assumes a Spoke already exists. Now we build the machinery that creates them on demand.

**Deliverables:**
- Provisioning Orchestrator: 5-phase pipeline (Claim → Provision → Boot → Install → Handoff)
- Kubernetes namespace creation and Helm chart deployment for new Spokes
- PostgreSQL and Neo4j provisioning per tenant
- Stripe integration: subscriptions, payment webhooks, tier management, usage metering
- Product catalog API: reads product manifests from the Registry, serves to web portal
- Spoke Registry in Hub database: all active Spokes, health, installed Packs, resource usage
- Network Directory: maps tenant DIDs to Spoke MCP endpoints for A2A discovery
- Pull-only communication: Spoke heartbeat agent that phones home to Hub for updates
- `web-portal`: marketing pages, pricing, onboarding flow, customer dashboard

**The workflow this phase proves:**

```
Customer selects "EuroComply Cosmetics" on web portal
  → Stripe payment succeeds
  → Hub reads cosmetics-pro.yaml manifest from Registry
  → Provisioner creates Kubernetes namespace
  → Provisioner deploys Spoke via Helm chart
  → Spoke boots, connects to dedicated PostgreSQL + Neo4j
  → Spoke pulls and installs Packs from manifest
  → Simulator auto-approves (fresh install, verified manifest)
  → Customer receives MCP endpoint + web dashboard URL
  → Spoke heartbeat confirms healthy
```

**Success criteria:** A customer can sign up, pay, and get a running Spoke with their vertical's Packs installed -- fully automated, no human in the loop.

---

### Phase 6: The Network (A2A Protocol)

**Goal:** Connect Spokes together for cross-company compliance.

**Why now:** Individual Spokes work. Now we enable the multi-party compliance workflows that create the network moat.

**Deliverables:**
- `network-protocol` package: the 5 A2A primitives (Identity, Claims, Requests, Evidence, Subscriptions)
- DID provisioning: each Spoke gets a DID at boot, registered in Hub's Network Directory
- Claims exchange: Spoke A publishes a compliance claim, Spoke B discovers and verifies it
- Requests: Spoke A requests compliance evidence from Spoke B
- Evidence: Spoke B runs compliance rules, produces signed result, sends it back
- Subscriptions: Spoke A subscribes to Spoke B's compliance status changes
- Network Directory lookups: resolve trading partner DID → Spoke MCP endpoint
- Trust model: verification levels (self-declared → peer-verified → authority-certified)

**The workflow this phase proves:**

```
Brand (Spoke A) creates a product with Supplier X's ingredient
  → Spoke A calls network:request to Supplier X (Spoke B)
  → Hub Network Directory resolves Supplier X's DID → Spoke B endpoint
  → Spoke B receives the request
  → Spoke B runs substance compliance rules
  → Spoke B returns signed Evidence (ComplianceResult + handler trace)
  → Spoke A verifies signature, stores Evidence
  → Spoke A's compliance evaluation includes supplier proof
  → Both sides have cryptographic audit trail
```

**Success criteria:** Two Spokes can exchange compliance data. The network flywheel has its foundation.

---

### Phase 7: The GSR Spoke (dogfooding the OS)

**Goal:** Run the Global Substance Registry pipeline on the OS itself. The ultimate architecture validation.

**Why now:** The OS is feature-complete. If it can't solve its own hardest data problem, it can't solve anyone else's.

**Deliverables:**
- A dedicated GSR Spoke provisioned internally (privileged tenant)
- Driver Packs in `eurocomply-registry`:
  - `@drivers/echa-clp` -- CLP Annex VI scraper
  - `@drivers/echa-reach` -- REACH candidate list scraper
  - `@drivers/cosing` -- EU Cosmetics ingredient database
  - `@drivers/efsa` -- EFSA food additive data
- Intelligence Pack:
  - `@agents/substance-resolver` -- LLM-powered substance name normalization, CAS/EC/InChIKey matching
- The GSR pipeline as a scheduled job:
  - `job:submit` triggers the ingestion workflow
  - Drivers fetch and parse source data using `ai:extract` and `file:upload`
  - Resolver deduplicates using `entity:create`, `relation:create`, and graph traversal
  - Output: versioned Intelligence Pack `@data/global-substances@YYYY.MM.DD`
- Publishing: GSR Spoke publishes output Pack to Hub Registry, available for all customer Spokes

**The workflow this phase proves:**

```
Scheduled job fires on GSR Spoke
  → @drivers/echa-clp fetches latest Annex VI PDF
  → Platform Services ai:extract parses the PDF
  → @agents/substance-resolver normalizes and deduplicates
  → Entities created in GSR Spoke's graph database
  → GSR Spoke packages result as @data/global-substances@2026.02.15
  → eurocomply publish pushes to Hub Registry
  → Customer Spokes pull the updated Intelligence Pack
  → Existing compliance rules automatically re-evaluate against new data
```

**Success criteria:** 100,000+ substances across dozens of regulatory sources, ingested and distributed using only the OS's own tools. No external ETL. No Python. The OS dogfoods itself.

---

### Phase 8: The First Product (EuroComply Cosmetics)

**Goal:** Ship the first revenue-generating vertical product.

**Why cosmetics:** The value gap is largest (EUR 15 vs EUR 500 for a safety assessment). Regulations are already in force. No "we'll deal with it later."

**Deliverables:**
- Cosmetics Logic Packs:
  - `@logic/eu-cosmetics-1223` -- EU Cosmetics Regulation 1223/2009
  - `@logic/clp-cosmetics` -- CLP classification for cosmetic formulations
  - `@logic/cosmetics-cpsr` -- Safety assessment generation
- Cosmetics Environment Pack:
  - `@environment/cosmetics` -- formulations, INCI names, concentrations
- Cosmetics Driver Packs:
  - `@drivers/cpnp` -- CPNP notification filing
  - `@drivers/cosing-lookup` -- real-time COSING ingredient verification
- Product manifest: `products/cosmetics-pro.yaml`
- Deliverable generation wired end-to-end:
  - Safety Assessment (CPSR): formulation → screening → hazard evaluation → report via `ai:generate`
  - CPNP Notification: product data → validation → filing package
  - Substance Screening: formulation → CLP/REACH check → compliance result with evidence
- Metered billing: Hub tracks deliverable executions, reports to Stripe for usage invoicing
- Customer onboarding tailored to cosmetics

**The workflow this phase proves:**

```
Cosmetics SME signs up for EuroComply Cosmetics (Growth tier)
  → Hub provisions Spoke, installs cosmetics-pro.yaml Packs
  → Customer uploads product formulations via web portal
  → Platform Services parses formulations, creates entities
  → @logic/eu-cosmetics-1223 evaluates each formulation
  → Customer sees: "3 products compliant, 1 needs review"
  → Customer clicks "Generate Safety Assessment"
  → Deliverable produced, billed at EUR 15
  → Customer downloads CPSR, files with notified body
```

**Success criteria:** Real revenue, real customers, real compliance value. The business model is proven.

---

### Phase 9: Scale (second vertical + marketplace)

**Goal:** Prove the OS thesis -- the second product is dramatically cheaper than the first.

**Deliverables:**
- **EuroComply Textiles:**
  - `@logic/espr-textiles` -- ESPR DPP rules for textiles
  - `@logic/textile-composition` -- fiber composition verification
  - `@logic/circularity-assessment` -- durability and recyclability scoring
  - `@environment/textiles` -- garments, fibers, fabric blends
  - `@drivers/scip` -- ECHA SCIP database submission
  - `products/textiles-pro.yaml` manifest
- **Marketplace:**
  - Publisher onboarding in web portal
  - Pack review workflow: automated validation (CLI lint + Simulator) → human review → approval → publish
  - Commission tracking and payout via Stripe Connect
  - Publisher dashboard: downloads, revenue, ratings
- **Multi-product customers:**
  - Add a second product to an existing Spoke
  - 50% base fee discount applied automatically
  - Shared substance data across verticals

**Success metric:** If EuroComply Cosmetics Pack development took 3 months, EuroComply Textiles should take 3-4 weeks. The OS, infrastructure, billing, onboarding, GSR data -- all reused. Only the regulatory Logic Packs and Environment schemas are new. If the second product takes as long as the first, the OS failed its promise.

---

## 4. Phase Dependencies

```
Phase 1: kernel-vm
    ↓
Phase 2: platform-services (depends on: kernel-vm)
    ↓
Phase 3: vertical slice (depends on: kernel-vm + platform-services + spoke-runtime)
    ↓
Phase 4: registry (depends on: spoke-runtime + hub-control-plane scaffold)
    ↓
Phase 5: hub (depends on: registry + spoke-runtime + infra)
    ↓
Phase 6: network ──────────────┐
    ↓                          │
Phase 7: GSR spoke ────────────┤ (these three can partially overlap)
    ↓                          │
Phase 8: first product ────────┘
    ↓
Phase 9: scale
```

Phases 6, 7, and 8 have some independence. The network (Phase 6) can be built while the GSR pipeline (Phase 7) is being authored. The first product (Phase 8) needs substance data from Phase 7 but doesn't need the full network from Phase 6 -- single-company compliance works without A2A.

---

## Related Documents

| Document | Purpose |
|----------|---------|
| [Kernel VM](./2026-02-02-compliance-handler-vm.md) | kernel-vm design: handlers, AST, Simulator |
| [Platform Services](./2026-02-03-platform-services-layer.md) | platform-services design: ~90 MCP tools |
| [Registry](./2026-02-03-registry-design.md) | registry-sdk design: Pack types, Compliance Lock |
| [Compliance Network](./2026-02-02-compliance-network-design.md) | network-protocol design: A2A primitives |
| [Infrastructure](./2026-02-03-infrastructure-design.md) | Hub & Spoke deployment, provisioning pipeline |
| [Business Model](./2026-02-03-business-model.md) | Pricing, unit economics, GTM strategy |

---

**Document Control**

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-02-03 | Initial execution plan: two-repo architecture, 9 implementation phases |
