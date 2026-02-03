# EuroComply Business Model

**Status:** Active
**Last Updated:** 2026-02-03
**Replaces:** 00-business-model.md (monolithic SaaS model)

---

## 1. Overview

EuroComply sells **vertical compliance products** built on the EuroComply Compliance OS. The OS itself is never sold directly -- it is the engine that powers every product.

| Layer | What It Is | Revenue Role |
|-------|-----------|--------------|
| **EuroComply OS** | Compliance operating system (Kernel + System Services) | Cost center; shared R&D across all products |
| **Products** | Vertical applications (e.g., "EuroComply Cosmetics") | Primary revenue; each is a Pack bundle |
| **Packs** | Installable compliance logic, environments, drivers | Ecosystem revenue; marketplace commission |
| **Network** | A2A cross-company compliance interactions | Network-effect revenue; transaction fees |

The company's moat is the OS. Competitors build one application. EuroComply builds the operating system once, then ships vertical products at marginal cost -- each product is just a different configuration of Packs installed on the same infrastructure.

### Core Principles

| Principle | Implementation |
|-----------|----------------|
| **No sales calls required** | Credit card signup, self-service provisioning |
| **Same-day compliance** | 15 minutes to first deliverable |
| **No IT team needed** | AI-powered data import, managed infrastructure |
| **No lock-in** | Full data export at all times, to all tiers |
| **Price to value** | Deliverables priced relative to consultant equivalent |

---

## 2. Product Portfolio

Each product is a YAML manifest declaring which Packs to install on a fresh Spoke. The OS is identical underneath.

| Product | Vertical | Key Regulations | Core Packs |
|---------|----------|----------------|------------|
| **EuroComply Cosmetics** | Beauty & Personal Care | CLP, REACH, EU Cosmetics Regulation, SCCS Opinions | Substance Registry, CPNP Driver, Safety Assessment Logic, GHS Labeling |
| **EuroComply Textiles** | Fashion & Apparel | ESPR, REACH, EU Ecolabel, OEKO-TEX | Fiber Composition Logic, DPP Environment, Supply Chain Driver, Circularity Assessment |
| **EuroComply Electronics** | Consumer Electronics | RoHS, WEEE, REACH, Batteries Regulation | Restricted Substances Logic, EPR Driver, Conflict Minerals Assessment |
| **EuroComply Food Contact** | Food Packaging | FCM Regulation, REACH, National Measures | Migration Testing Logic, Positive List Checker, EFSA Driver |
| **EuroComply General** | Multi-category | ESPR (baseline) | DPP Environment, Basic Substance Logic, SCIP Driver |

### Launch Strategy

Ship one product first (Cosmetics or Textiles -- whichever vertical has the most urgent regulatory deadline), prove the model, then expand. Each subsequent product is cheaper to build because the OS, infrastructure, and shared Packs already exist.

A customer signs up for a specific product. They don't choose "EuroComply" generically -- they choose "EuroComply Cosmetics" because that's the product that solves their problem. Under the hood, the Hub provisions a Spoke and installs the product's Pack bundle.

---

## 3. Pricing Structure

### Base Fee + Compliance Deliverables

```
BASE FEE (Monthly)
  What they're paying for: The platform, their team, their data
  Includes: Users, storage, API access, supplier connections
  Scales with: Team size

COMPLIANCE DELIVERABLES (Pay-as-you-produce)
  What they're paying for: Finished compliance outputs
  Each product vertical has its own deliverable catalog
  Priced relative to what they'd pay a consultant or do manually
```

### Base Fee Tiers (same across all products)

| Tier | Users | Suppliers | Price | Annual (20% off) |
|------|-------|-----------|-------|------------------|
| **Starter** | 10 | 5 | EUR 149/mo | EUR 1,430/year |
| **Growth** | 30 | 25 | EUR 349/mo | EUR 3,350/year |
| **Scale** | 100 | 100 | EUR 799/mo | EUR 7,670/year |
| **Enterprise** | Unlimited | Unlimited | EUR 1,999+/mo | EUR 19,190+/year |

Everything is included in the base: storage, API access, compute, backups. No per-operation metering on the base fee. No surprise bills.

If a customer exceeds users or suppliers, we nudge them to upgrade tier. No per-unit overage fees.

### Deliverable Catalogs (per vertical)

Each vertical defines 5-10 deliverables that map to things customers already pay for today.

**EuroComply Cosmetics:**

| Deliverable | What They Get | Price | Consultant Equivalent |
|-------------|--------------|-------|----------------------|
| Safety Assessment (CPSR) | Complete report, ready to file | EUR 15 | EUR 500-800 |
| CPNP Notification | Filed notification package | EUR 5 | EUR 100-200 |
| Substance Screening | Full CLP/REACH check per formulation | EUR 2 | EUR 50-100 |
| Product DPP | Issued digital product passport | EUR 0.50 | EUR 20-50 |
| Regulatory Update | Re-evaluation after regulation change | EUR 1 | EUR 50-100 |

**EuroComply Textiles:**

| Deliverable | What They Get | Price | Consultant Equivalent |
|-------------|--------------|-------|----------------------|
| Digital Product Passport | ESPR-compliant DPP with QR | EUR 0.50 | EUR 20-50 |
| Fiber Composition Cert | Verified composition declaration | EUR 3 | EUR 80-150 |
| Circularity Assessment | Durability + recyclability score | EUR 5 | EUR 200-400 |
| SCIP Notification | ECHA SCIP database submission | EUR 2 | EUR 50-100 |
| Supply Chain Verification | Tier-1 supplier compliance proof | EUR 10 | EUR 300-500 |

The "Consultant Equivalent" column is the sales pitch -- it makes the value obvious at a glance.

### Multi-Product Pricing

Customers running multiple verticals on one Spoke get a 50% discount on the base fee for each additional product:

| Setup | Base Fee |
|-------|----------|
| Single product (Growth) | EUR 349/mo |
| Two products (Growth) | EUR 349 + EUR 175 = EUR 524/mo |
| Three products (Growth) | EUR 349 + EUR 175 + EUR 175 = EUR 699/mo |

Deliverables are always full price regardless of how many products are active -- different verticals, different value.

---

## 4. Network Revenue

The A2A Protocol creates a compliance network between companies. Compliance is inherently multi-party: a brand needs ingredient safety data from their supplier, a retailer needs DPP data from the brand. Today this happens via email, PDFs, and phone calls. The network replaces that.

**Network transactions between companies on the same EuroComply product are free.** This drives adoption. Revenue comes from cross-network interactions and premium services.

| Service | What It Is | Price |
|---------|-----------|-------|
| **Inbound claim** | Receive compliance data from a non-EuroComply company | Free |
| **Outbound request** | Request compliance data from a non-EuroComply company | EUR 1/request |
| **Verification proof** | Cryptographic receipt that you verified a claim | EUR 0.50/proof |
| **Continuous monitoring** | Subscribe to a trading partner's compliance status | EUR 5/partner/mo |
| **Network directory listing** | Be discoverable as a verified supplier | Free (included in base) |

**Network flywheel:** More companies on the network -> more data available for free -> more companies join -> more cross-network requests from holdouts -> holdouts join too.

---

## 5. Pack Marketplace Revenue

Third-party developers -- consultancies, labs, industry associations, individual regulatory experts -- can publish Packs to the marketplace. EuroComply takes a commission on third-party Pack sales.

### Pack Types & Publishers

| Pack Type | Who Builds Them | Example | Revenue Model |
|-----------|----------------|---------|---------------|
| **Logic Packs** | Regulatory consultants, law firms | "Swiss Cosmetics Ordinance" rule set | Subscription or per-use |
| **Environment Packs** | Industry associations | "ECHA SCIP Reporter" with custom UI | Subscription |
| **Driver Packs** | System integrators, SaaS vendors | "SAP ERP Connector", "Shopify Sync" | Subscription |
| **Intelligence Packs** | AI/ML specialists, labs | "Allergen Cross-Reactivity Predictor" | Per-use |

### Commission Structure

| Publisher Tier | Commission | Requirements |
|----------------|-----------|-------------|
| **Community** | 30% | Published, reviewed, signed |
| **Verified** | 20% | Track record, SLA commitments |
| **Partner** | 15% | Joint go-to-market, co-development |
| **EuroComply Official** | 0% | Built by us, included in products or sold directly |

### Why Developers Build Packs

- A regulatory consultancy charges EUR 500/hr for advice. A Logic Pack encoding that expertise earns revenue while they sleep.
- A lab offers testing services. A Driver Pack connecting their LIMS to EuroComply makes them the default choice for every customer in that vertical.
- An industry association maintains standards. An Environment Pack keeps their members compliant automatically.

EuroComply maintains the Registry, reviews Packs for security and correctness (Compliance Lock ensures they can't break existing compliance), and handles billing. Publishers focus on domain expertise.

---

## 6. Unit Economics

### Per-Spoke Infrastructure Cost (Monthly)

| Component | Starter | Growth | Scale | Enterprise |
|-----------|---------|--------|-------|------------|
| PostgreSQL (managed) | EUR 15 | EUR 30 | EUR 50 | EUR 200 |
| Neo4j (managed) | EUR 20 | EUR 40 | EUR 60 | EUR 250 |
| Object Storage | EUR 2 | EUR 5 | EUR 10 | EUR 50 |
| Compute (K8s pods) | EUR 25 | EUR 40 | EUR 80 | EUR 400 |
| LLM Gateway (shared pool) | EUR 10 | EUR 20 | EUR 40 | EUR 200 |
| Monitoring & Logs | EUR 3 | EUR 5 | EUR 10 | EUR 30 |
| Backups & DR | EUR 5 | EUR 10 | EUR 15 | EUR 70 |
| **Total Spoke COGS** | **EUR 80** | **EUR 150** | **EUR 265** | **EUR 1,200** |

### Base Fee Margin

| Tier | Base Fee | Spoke COGS | Base Margin |
|------|----------|------------|-------------|
| Starter | EUR 149 | EUR 80 | 46% |
| Growth | EUR 349 | EUR 150 | 57% |
| Scale | EUR 799 | EUR 265 | 67% |
| Enterprise | EUR 1,999 | EUR 1,200 | 40% |

Base fee margins are healthy but not spectacular. That's by design -- the base fee covers infrastructure. The real margin is in deliverables.

### Per-Deliverable Cost (EuroComply Cosmetics)

| Deliverable | Price | Compute | LLM | Data | Total COGS | Margin |
|-------------|-------|---------|-----|------|------------|--------|
| Safety Assessment | EUR 15 | EUR 0.05 | EUR 0.80 | EUR 0.02 | EUR 0.87 | 94% |
| CPNP Notification | EUR 5 | EUR 0.03 | EUR 0.20 | EUR 0.01 | EUR 0.24 | 95% |
| Substance Screening | EUR 2 | EUR 0.02 | EUR 0.30 | EUR 0.01 | EUR 0.33 | 84% |
| Product DPP | EUR 0.50 | EUR 0.01 | EUR 0.00 | EUR 0.01 | EUR 0.02 | 96% |
| Regulatory Update | EUR 1 | EUR 0.02 | EUR 0.15 | EUR 0.01 | EUR 0.18 | 82% |

### Blended Model -- Typical Growth Customer (Cosmetics, 200 products)

| Revenue Source | Monthly | Annual |
|----------------|---------|--------|
| Base fee | EUR 349 | EUR 4,188 |
| ~50 Safety Assessments | EUR 750 | EUR 9,000 |
| ~50 CPNP Notifications | EUR 250 | EUR 3,000 |
| ~200 Substance Screenings | EUR 400 | EUR 4,800 |
| ~200 DPPs | EUR 100 | EUR 1,200 |
| ~20 Network requests | EUR 20 | EUR 240 |
| **Total** | **EUR 1,869** | **EUR 22,428** |
| Spoke COGS | EUR 150 | EUR 1,800 |
| Deliverable COGS | ~EUR 95 | ~EUR 1,140 |
| **Gross Profit** | **EUR 1,624** | **EUR 19,488** |
| **Gross Margin** | **87%** | |

---

## 7. Competitive Positioning

### The Category: Compliance Operating System

Nobody else has this. Competitors build single-purpose compliance tools. EuroComply builds the OS that makes compliance tools trivially composable.

| Competitor Type | Examples | What They Sell | EuroComply Advantage |
|----------------|----------|---------------|---------------------|
| **Regulatory consultancies** | Intertek, SGS, Bureau Veritas | Human expertise, per-project | We encode their expertise into Packs that run instantly at 95% lower cost |
| **Point solutions** | Various DPP startups, CPNP tools | One regulation, one feature | We cover every regulation in a vertical through Pack composition |
| **Enterprise PLM** | SAP, Siemens, Dassault | Massive platforms requiring SI partners | We deploy in 15 minutes, not 18 months |
| **Compliance databases** | Chemwatch, Lisam | Reference data subscriptions | We don't just show data, we execute compliance logic against it |

### Why This Is Defensible

1. **OS moat.** Each new Pack makes the platform more valuable for everyone. Competitors would need to replicate the entire Kernel, not just one feature.
2. **Network moat.** Every company on the network makes it more valuable for every other company. Compliance data flows between trading partners. Impossible to replicate without the network.
3. **Data moat.** The Global Substance Registry, regulatory rule sets, and cross-company compliance graph compound over time. More customers -> more data -> better AI -> better deliverables -> more customers.
4. **Ecosystem moat.** Third-party Pack developers build on EuroComply because that's where the customers are. Customers stay because that's where the Packs are. Classic platform lock-in without data lock-in.

### Cost Comparison (Year 1, cosmetics company with 200 products)

| Option | Annual Cost |
|--------|-----------|
| Regulatory consultancy retainer | EUR 40,000-80,000 |
| Point solutions (3-4 tools stitched together) | EUR 15,000-25,000 |
| Enterprise PLM + compliance module | EUR 100,000+ |
| **EuroComply Cosmetics (Growth)** | **~EUR 22,000** |

The pitch: "Your consultancy charges EUR 500 for a safety assessment we generate for EUR 15, and it updates automatically when regulations change."

---

## 8. Go-to-Market

### Two Motions: Self-Service + Vertical Sales

**Self-service (Starter + Growth):**

```
1. Customer lands on eurocomply.com/cosmetics (or /textiles, /electronics)
2. Signs up with email + company info
3. Selects tier (Starter or Growth)
4. Pays via Stripe (card, SEPA, iDEAL)
5. Hub provisions Spoke, installs product Pack bundle
6. Customer lands in a workspace tailored to their vertical
7. AI-guided import of their product catalog
8. First deliverable (e.g., Substance Screening) within 15 minutes
```

**Vertical sales (Scale + Enterprise):**

| Stage | What Happens |
|-------|-------------|
| **Identify** | Industry events, trade associations, regulatory deadline pressure |
| **Demo** | Product-specific demo showing their exact regulatory workflow |
| **Pilot** | Starter tier, free for 30 days, real products loaded |
| **Convert** | Upgrade to Scale/Enterprise after proving value |
| **Expand** | Add supplier connections, additional verticals, custom Packs |

### Go-to-Market Sequence

| Phase | Timeline | Focus |
|-------|----------|-------|
| **Phase 1** | Launch | Single vertical (Cosmetics or Textiles) |
| **Phase 2** | +6 months | Second vertical, Pack marketplace opens (beta) |
| **Phase 3** | +12 months | Third and fourth verticals, network effects kicking in |
| **Phase 4** | +18 months | Ecosystem flywheel -- third-party Packs generating revenue |

### Why Cosmetics First

The EU Cosmetics Regulation, CLP, and REACH create immediate pain. Companies already pay consultants thousands per product. The deliverable value gap (EUR 15 vs EUR 500 for a safety assessment) is the most dramatic of any vertical. Regulatory deadlines are already in effect, not upcoming.

### Channel Partnerships

| Partner Type | What They Do | What We Do |
|-------------|-------------|-----------|
| **Trade associations** | Endorse to members, co-brand | Discounted member pricing, association-branded Environment Pack |
| **Regulatory consultancies** | Refer complex clients, build Logic Packs | Revenue share on referrals, marketplace commission |
| **Testing labs** | Build Driver Packs connecting their LIMS | Featured placement, co-marketing |
| **ERP/PLM vendors** | Build Driver Packs for their platforms | Integration certification program |

---

## 9. Revenue Projections

### Year 1 (single vertical, self-service + early sales)

| Metric | Target |
|--------|--------|
| Customers | 150 |
| Mix | 70% Starter, 25% Growth, 5% Scale |
| Avg deliverables/customer/mo | 30 (Starter), 120 (Growth), 500 (Scale) |

| Revenue Source | Monthly (Month 12) | Annual |
|----------------|-------------------|--------|
| Base fees | EUR 32,000 | EUR 210,000 |
| Deliverables | EUR 48,000 | EUR 290,000 |
| Network | EUR 2,000 | EUR 10,000 |
| Marketplace | EUR 0 | EUR 0 |
| **Total** | **EUR 82,000** | **EUR 510,000** |

### Year 3 (three verticals, marketplace live, network growing)

| Metric | Target |
|--------|--------|
| Customers | 1,200 |
| Mix | 50% Starter, 30% Growth, 15% Scale, 5% Enterprise |
| Active third-party Packs | 40+ |

| Revenue Source | Monthly (Month 36) | Annual |
|----------------|-------------------|--------|
| Base fees | EUR 310,000 | EUR 2,800,000 |
| Deliverables | EUR 520,000 | EUR 4,700,000 |
| Network | EUR 65,000 | EUR 580,000 |
| Marketplace | EUR 35,000 | EUR 300,000 |
| **Total** | **EUR 930,000** | **EUR 8,380,000** |

### Year 5 (five verticals, ecosystem mature)

| Metric | Target |
|--------|--------|
| Customers | 4,000 |
| Active third-party Packs | 200+ |
| Network participants (incl. non-customers) | 15,000+ |

| Revenue Source | Percentage | Annual |
|----------------|-----------|--------|
| Base fees | 22% | EUR 6,200,000 |
| Deliverables | 45% | EUR 12,600,000 |
| Network | 18% | EUR 5,000,000 |
| Marketplace | 12% | EUR 3,400,000 |
| Services & custom | 3% | EUR 800,000 |
| **Total** | **100%** | **EUR 28,000,000** |

### Revenue Composition Over Time

```
Year 1:  [████████████ Base 41%  ][████████████████ Deliv 57% ][░ Net 2%]
Year 3:  [███████ Base 33%][██████████████ Deliv 56%][███ Net 7%][██ Mkt 4%]
Year 5:  [█████ Base 22%][███████████ Deliv 45%][█████ Net 18%][███ Mkt 12%][░ 3%]
```

Deliverables are always the largest revenue source. But network and marketplace grow as percentages over time. By Year 5, 30% of revenue comes from platform effects (network + marketplace) that cost almost nothing to serve.

---

## 10. Customer Lifecycle & Expansion

### Typical Expansion Journey (Cosmetics Customer)

```
MONTH 1:    Signs up for Starter. 50 products. Runs substance screenings.
            Revenue: EUR 149 base + ~EUR 100 deliverables = EUR 249/mo

MONTH 3:    Connects 3 suppliers. Starts generating safety assessments.
            Revenue: EUR 149 + ~EUR 350 deliverables = EUR 499/mo

MONTH 6:    Hits 10-user limit. Upgrades to Growth. Adds CPNP notifications.
            Revenue: EUR 349 + ~EUR 800 deliverables = EUR 1,149/mo

MONTH 12:   Regulation changes. Buys "Swiss Cosmetics" Pack from marketplace.
            Revenue: EUR 349 + ~EUR 1,100 + EUR 29 Pack = EUR 1,478/mo

MONTH 18:   Retailer asks for DPPs. Enables network. Connects 15 suppliers.
            Revenue: EUR 349 + ~EUR 1,400 + EUR 29 + ~EUR 80 network = EUR 1,858/mo

MONTH 24:   Second product line (food contact packaging). Adds second product.
            Revenue: EUR 349 + EUR 175 + ~EUR 2,200 deliverables = EUR 2,724/mo
```

**Net Revenue Retention target: 140%+**

### Expansion Triggers

| Trigger | What Happens | Revenue Impact |
|---------|-------------|----------------|
| **More products cataloged** | More deliverables consumed | Deliverable revenue grows |
| **Team grows** | Tier upgrade | Base fee increases |
| **New regulation hits** | New deliverables needed | Deliverable revenue grows |
| **Supply chain pressure** | Suppliers connected, network usage | Network revenue starts |
| **New market entry** | Country-specific Packs purchased | Marketplace revenue |
| **Second vertical** | Adds another EuroComply product | Entire second revenue stream |

### Churn Defense

| Layer | How It Retains |
|-------|---------------|
| **Data** | No lock-in -- full export anytime. But reimporting elsewhere is painful. |
| **Deliverables** | They've automated workflows that used to cost 10x more manually. |
| **Network** | Their suppliers and customers are connected. Moving means rebuilding. |
| **Compliance history** | Audit trail, regulatory proof, 10-year records. Can't just leave. |
| **Packs** | Custom and third-party Packs they've configured and depend on. |

We don't trap customers with data lock-in. We retain them because the platform is genuinely more valuable the longer they use it.

---

## 11. Key Metrics & Business Invariants

### Metrics That Matter

| Metric | What It Measures | Target |
|--------|-----------------|--------|
| **Time to First Deliverable** | Minutes from signup to first compliance output | < 15 min |
| **Deliverables per Customer per Month** | Platform stickiness and value realization | 50+ (Growth) |
| **Net Revenue Retention** | Expansion revenue vs churn | > 140% |
| **Deliverable Gross Margin** | Unit economics on compliance outputs | > 80% |
| **Blended Gross Margin** | Overall (base + deliverables + network) | > 70% |
| **CAC Payback** | Months to recover acquisition cost | < 6 months |
| **Network Density** | Avg supplier connections per customer | > 10 |
| **Marketplace Attach Rate** | % of customers with third-party Packs | > 30% (Year 3+) |
| **Multi-Product Rate** | % of customers on 2+ verticals | > 15% (Year 3+) |
| **Logo Churn** | Monthly customer loss rate | < 2% |

### Business Invariants

```
1. DELIVERABLES ARE ALWAYS CHEAPER THAN CONSULTANTS
   If a deliverable costs more than 10% of the consultant equivalent,
   the pricing is wrong. The value gap must be obvious.

2. BASE FEE ALWAYS COVERS SPOKE COGS
   We never subsidize infrastructure. If a tier's base fee doesn't
   cover the Spoke cost with at least 30% margin, raise the price.

3. NO LOCK-IN, EVER
   Full data export available at all times, to all tiers, including
   compliance history and audit trails. Retention through value,
   not through trapping.

4. FREE TIER NEVER EXISTS
   Compliance is too expensive to serve for free. Free trials yes
   (30 days, Starter tier). Free tier no.

5. NETWORK BETWEEN EUROCOMPLY CUSTOMERS IS ALWAYS FREE
   Charging for intra-network data exchange kills the flywheel.
   Revenue comes from cross-network and premium services.

6. MARKETPLACE COMMISSION NEVER EXCEEDS 30%
   Publishers must earn enough to justify building Packs.
   Race to the bottom on commission kills the ecosystem.

7. DELIVERABLE PRICES ARE PER-VERTICAL, NOT GLOBAL
   A Safety Assessment in cosmetics has different value than a
   Fiber Composition Cert in textiles. Price to value, not to cost.

8. ANNUAL DISCOUNT NEVER EXCEEDS 20%
   Deeper discounts signal desperation and destroy cash flow
   predictability.

9. SECOND PRODUCT DISCOUNT IS EXACTLY 50% ON BASE
   Enough to make multi-product compelling. Not so much that
   single-product feels overpriced.

10. EVERY DELIVERABLE MUST BE AUTOMATABLE
    If it requires human intervention from EuroComply staff,
    it's a service, not a deliverable. Services are priced
    separately and never at scale pricing.
```

---

## 12. Data Sovereignty & Portability

### Customer Promise

| Need | Solution |
|------|----------|
| Simple SaaS | We host everything on a dedicated Spoke |
| No lock-in | Full export anytime, all tiers |
| Data ownership | Customer owns all data, compliance history, audit trails |
| Survival guarantee | Signed credentials work forever without us |

### Export Package (All Tiers)

```
export-{org-id}.zip
├── credentials/
│   ├── dpp-001.vc.json          # Signed VC with all data
│   └── ...
├── identity/
│   ├── did.json                 # DID document
│   └── private-key.jwk          # For future signing
├── compliance-history/
│   ├── assessments.json         # All deliverable outputs
│   ├── audit-trail.json         # Complete audit log
│   └── regulatory-snapshots/    # Point-in-time regulation state
├── products/
│   └── products.json            # All product data
├── graph/
│   └── compliance-graph.json    # Neo4j export (nodes + edges)
├── images/
│   └── ...                      # All media assets
├── viewer.html                  # Offline viewer
└── manifest.json                # Complete export manifest
```

### When Subscription Ends

```
DAY 0:    Subscription ends
          - Platform access suspended
          - Export tools remain accessible
          - Issued credentials continue working

DAYS 1-30: Grace period
          - Export all data
          - Download signing keys
          - Credentials continue working

DAY 30+:  Spoke decommissioned
          - Data destroyed (GDPR compliant)
          - Destruction certificate issued
          - Credentials remain valid (self-contained)
          - Legal hold exception if applicable
```

---

## Related Documents

| Document | Purpose |
|----------|---------|
| [Infrastructure Design](./2026-02-03-infrastructure-design.md) | Hub & Spoke deployment, provisioning pipeline |
| [Kernel VM](./2026-02-02-compliance-handler-vm.md) | kernel-vm design: handlers, AST, Simulator |
| [Platform Services](./2026-02-03-platform-services-layer.md) | Stateful kernel services, MCP tools |
| [Registry](./2026-02-03-registry-design.md) | Pack management, marketplace infrastructure |
| [Compliance Network](./2026-02-02-compliance-network-design.md) | A2A Protocol, cross-company interactions |

---

**Document Control**

| Version | Date | Changes |
|---------|------|---------|
| 3.0 | 2026-02-03 | Complete rewrite for Compliance OS architecture. Replaces monolithic SaaS model with vertical products, deliverable-based pricing, network revenue, and Pack marketplace. |
| 2.1 | 2026-01-23 | Updated Clerk references for auth provider migration |
| 2.0 | 2026-01-21 | Consolidated from business-model, onboarding, data-sovereignty designs |
