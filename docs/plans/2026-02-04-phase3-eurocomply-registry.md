# Phase 3: First Vertical Slice — eurocomply-registry Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create the first Logic Pack (`packs/logic/clp-basic/`) — a CLP Annex VI substance restriction check with rule AST, validation suite, and pack manifest. This pack is the regulatory content that runs on the EuroComply OS spoke-runtime.

**Architecture:** The pack is a directory containing `pack.json` (manifest), `rules/main.ast.json` (the Rule Logic AST composed from kernel-vm handlers), and `tests/validation_suite.json` (test cases for the Simulator). The rule uses `core:and` to compose multiple `core:threshold_check` handlers for heavy metal limits. The validation suite contains synthetic product data covering compliant and non-compliant cases. The workspace config `eurocomply.yaml` defines the registry endpoint for future publishing.

**Tech Stack:** JSON (rule ASTs, manifests, validation suites), YAML (workspace config)

**Prerequisites:** The eurocomply-os repo must have completed Tasks 1-4 (pack manifest types, pack loader, CLI lint, CLI test) from the companion plan before Task 5 (verification) can run.

---

## Dependency Order

```
Task 1: Workspace config (eurocomply.yaml)
Task 2: Pack manifest (pack.json)
Task 3: Rule AST (rules/main.ast.json)
Task 4: Validation suite (tests/validation_suite.json)
  ↓
Task 5: Verification with eurocomply CLI (requires eurocomply-os Tasks 1-4)
```

Tasks 1-4 are independent JSON/YAML authoring. Task 5 requires the CLI from eurocomply-os.

---

### Task 1: Workspace Config

**Files:**
- Create: `eurocomply.yaml`

**Context:** The workspace config is the top-level file that identifies this as a eurocomply-registry repository. For Phase 3, it only needs the registry endpoint and signing key placeholder. Full spec is in `design/docs/2026-02-03-infrastructure-design.md` §2.

**Step 1: Create the workspace config**

Create `eurocomply.yaml` at the repository root:

```yaml
# EuroComply Registry Workspace Configuration
# This file identifies this repository as a eurocomply-registry.

registry:
  # Hub registry endpoint (used by `eurocomply publish`)
  endpoint: "https://registry.eurocomply.com"

  # Signing key reference (used by `eurocomply publish`)
  # In production, this resolves to a DID key in the keystore.
  # For Phase 3, packs are unsigned.
  sign_with: null

# Default scope for packs authored in this repository
defaults:
  author:
    name: "EuroComply"
    did: "did:web:eurocomply.com"
  trust_tier: "verified"
```

**Step 2: Commit**

```
chore: add eurocomply.yaml workspace config
```

---

### Task 2: Pack Manifest

**Files:**
- Create: `packs/logic/clp-basic/pack.json`

**Context:** This is the first Logic Pack. It defines a CLP Annex VI basic restriction check for heavy metals in cosmetic products. The manifest follows the schema from `design/docs/2026-02-03-registry-design.md` §2. Fields match the `PackManifestSchema` Zod type in `@eurocomply/types`.

**Step 1: Create directory structure**

```
packs/logic/clp-basic/
├── pack.json
├── rules/
│   └── main.ast.json
├── tests/
│   └── validation_suite.json
└── docs/
    └── README.md
```

**Step 2: Create the manifest**

Create `packs/logic/clp-basic/pack.json`:

```json
{
  "name": "@eu/clp-basic",
  "version": "1.0.0",
  "type": "logic",

  "handler_vm_version": "^1.0.0",

  "scope": {
    "verticals": ["cosmetics"],
    "markets": ["EU"],
    "entity_types": ["cosmetic_product"]
  },

  "regulation_ref": "gsr:reg:EU_CLP_1272_2008",

  "logic_root": "rules/main.ast.json",
  "validation_suite": "tests/validation_suite.json"
}
```

**Step 3: Create the README**

Create `packs/logic/clp-basic/docs/README.md`:

```markdown
# CLP Basic — Annex VI Heavy Metal Restrictions

Logic Pack implementing basic substance restriction checks from Regulation (EC) No 1272/2008 (CLP), Annex VI.

## What it checks

For cosmetic products in the EU market:

- **Lead** < 10 ppm
- **Cadmium** < 10 ppm
- **Mercury** < 1 ppm
- **Nickel** < 10 ppm
- **Chromium VI** < 1 ppm

## Entity requirements

Products must have entity type `cosmetic_product` with numeric fields:
`lead_ppm`, `cadmium_ppm`, `mercury_ppm`, `nickel_ppm`, `chromium_vi_ppm`

## Rule composition

Uses `core:and` to compose five `core:threshold_check` handlers. All must pass for the product to be compliant.

## Regulation reference

- EU CLP Regulation (EC) No 1272/2008, Annex VI
- Cosmetics Regulation (EC) No 1223/2009, Annex II (prohibited substances)
```

**Step 4: Commit**

```
feat(clp-basic): add pack manifest and docs for CLP Annex VI basic checks
```

---

### Task 3: Rule AST

**Files:**
- Create: `packs/logic/clp-basic/rules/main.ast.json`

**Context:** The Rule Logic AST is a JSON tree composed from kernel-vm handler primitives. This rule uses `core:and` to compose five `core:threshold_check` handlers — one per heavy metal. Each threshold_check reads a field from the entity data (via `{ field: "lead_ppm" }` reference) and compares it to the CLP Annex VI limit.

The handler reference format:
- `{ field: "name" }` — resolves to `context.entity_data.name` (the product being evaluated)
- `{ data_key: "key" }` — resolves to `context.data.key` (pre-loaded graph data)

For Phase 3, all thresholds are hardcoded in the AST (not looked up from the graph). Future phases will use `data_key` references to look up limits dynamically from substance entities.

**Step 1: Create the rule AST**

Create `packs/logic/clp-basic/rules/main.ast.json`:

```json
{
  "handler": "core:and",
  "config": {
    "conditions": [
      {
        "handler": "core:threshold_check",
        "config": {
          "value": { "field": "lead_ppm" },
          "operator": "lt",
          "threshold": 10
        },
        "label": "Lead below 10 ppm (CLP Annex VI, Index No 082-001-00-6)"
      },
      {
        "handler": "core:threshold_check",
        "config": {
          "value": { "field": "cadmium_ppm" },
          "operator": "lt",
          "threshold": 10
        },
        "label": "Cadmium below 10 ppm (CLP Annex VI, Index No 048-001-00-5)"
      },
      {
        "handler": "core:threshold_check",
        "config": {
          "value": { "field": "mercury_ppm" },
          "operator": "lt",
          "threshold": 1
        },
        "label": "Mercury below 1 ppm (CLP Annex VI, Index No 080-001-00-0)"
      },
      {
        "handler": "core:threshold_check",
        "config": {
          "value": { "field": "nickel_ppm" },
          "operator": "lt",
          "threshold": 10
        },
        "label": "Nickel below 10 ppm (CLP Annex VI, Index No 028-002-00-7)"
      },
      {
        "handler": "core:threshold_check",
        "config": {
          "value": { "field": "chromium_vi_ppm" },
          "operator": "lt",
          "threshold": 1
        },
        "label": "Chromium VI below 1 ppm (CLP Annex VI, Index No 024-017-00-8)"
      }
    ]
  },
  "label": "CLP Annex VI: Heavy metal restriction compliance"
}
```

**Step 2: Commit**

```
feat(clp-basic): add Rule Logic AST for CLP heavy metal restriction checks
```

---

### Task 4: Validation Suite

**Files:**
- Create: `packs/logic/clp-basic/tests/validation_suite.json`

**Context:** The validation suite contains test cases for the Simulator. Each test case provides synthetic `entity_data` (a product) and declares the `expected_status` (`compliant` or `non_compliant`). The Simulator evaluates the rule AST against each test case and verifies the result matches. This is the mandatory test suite — you cannot publish a Logic Pack without it (enforced in future phases).

Test case design:
- Cover each substance individually (one at boundary, one well over)
- Cover the all-compliant case
- Cover the all-non-compliant case
- Cover edge cases (exact boundary value, zero values)

**Step 1: Create the validation suite**

Create `packs/logic/clp-basic/tests/validation_suite.json`:

```json
{
  "vertical_id": "cosmetics",
  "test_cases": [
    {
      "id": "all-compliant",
      "description": "Product with all heavy metals well below limits passes",
      "entity_data": {
        "name": "Clean Face Cream",
        "lead_ppm": 0.5,
        "cadmium_ppm": 0.2,
        "mercury_ppm": 0.01,
        "nickel_ppm": 0.1,
        "chromium_vi_ppm": 0.001
      },
      "expected_status": "compliant"
    },
    {
      "id": "lead-over-limit",
      "description": "Product with lead above 10 ppm fails",
      "entity_data": {
        "name": "Lead Contaminated Lipstick",
        "lead_ppm": 15,
        "cadmium_ppm": 0.1,
        "mercury_ppm": 0.01,
        "nickel_ppm": 0.05,
        "chromium_vi_ppm": 0.001
      },
      "expected_status": "non_compliant"
    },
    {
      "id": "mercury-over-limit",
      "description": "Product with mercury above 1 ppm fails",
      "entity_data": {
        "name": "Mercury Contaminated Powder",
        "lead_ppm": 0.3,
        "cadmium_ppm": 0.1,
        "mercury_ppm": 2.5,
        "nickel_ppm": 0.05,
        "chromium_vi_ppm": 0.001
      },
      "expected_status": "non_compliant"
    },
    {
      "id": "chromium-vi-over-limit",
      "description": "Product with chromium VI above 1 ppm fails",
      "entity_data": {
        "name": "Chromium Eye Shadow",
        "lead_ppm": 0.1,
        "cadmium_ppm": 0.1,
        "mercury_ppm": 0.01,
        "nickel_ppm": 0.05,
        "chromium_vi_ppm": 3.0
      },
      "expected_status": "non_compliant"
    },
    {
      "id": "all-zero",
      "description": "Product with zero heavy metal content passes",
      "entity_data": {
        "name": "Ultra Pure Serum",
        "lead_ppm": 0,
        "cadmium_ppm": 0,
        "mercury_ppm": 0,
        "nickel_ppm": 0,
        "chromium_vi_ppm": 0
      },
      "expected_status": "compliant"
    },
    {
      "id": "at-boundary-lead",
      "description": "Product with lead at exactly 10 ppm fails (must be strictly less than)",
      "entity_data": {
        "name": "Boundary Lead Product",
        "lead_ppm": 10,
        "cadmium_ppm": 0.1,
        "mercury_ppm": 0.01,
        "nickel_ppm": 0.05,
        "chromium_vi_ppm": 0.001
      },
      "expected_status": "non_compliant"
    },
    {
      "id": "just-below-boundary",
      "description": "Product with lead at 9.99 ppm passes",
      "entity_data": {
        "name": "Near Boundary Product",
        "lead_ppm": 9.99,
        "cadmium_ppm": 9.99,
        "mercury_ppm": 0.99,
        "nickel_ppm": 9.99,
        "chromium_vi_ppm": 0.99
      },
      "expected_status": "compliant"
    },
    {
      "id": "multiple-violations",
      "description": "Product with multiple heavy metals over limits fails",
      "entity_data": {
        "name": "Heavily Contaminated",
        "lead_ppm": 50,
        "cadmium_ppm": 25,
        "mercury_ppm": 10,
        "nickel_ppm": 100,
        "chromium_vi_ppm": 5
      },
      "expected_status": "non_compliant"
    }
  ]
}
```

**Step 2: Commit**

```
feat(clp-basic): add validation suite with 8 test cases for CLP heavy metal checks
```

---

### Task 5: Verification with eurocomply CLI

**Prerequisites:** The eurocomply-os repo must have completed the CLI (Tasks 1-4 of the companion plan). You need the built CLI available.

**Step 1: Run lint**

From the eurocomply-registry root:

```bash
npx @eurocomply/cli lint packs/logic/clp-basic
```

Or if working locally with the monorepo:

```bash
cd /path/to/eurocomply-os
node packages/cli/dist/index.js lint /path/to/eurocomply-registry/packs/logic/clp-basic
```

Expected output:

```
✓ @eu/clp-basic — valid
  Handlers: core:and, core:threshold_check
  Complexity: 6
```

**Step 2: Run test**

```bash
node packages/cli/dist/index.js test /path/to/eurocomply-registry/packs/logic/clp-basic
```

Expected output:

```
✓ @eu/clp-basic — 8/8 tests passed
```

**Step 3: Commit (if any fixes were needed)**

```
fix(clp-basic): address lint/test issues
```

---

## Final Pack Structure

```
packs/logic/clp-basic/
├── pack.json                          # Manifest: @eu/clp-basic@1.0.0
├── rules/
│   └── main.ast.json                  # Rule AST: core:and composing 5 threshold_checks
├── tests/
│   └── validation_suite.json          # 8 test cases (compliant, non-compliant, boundary)
└── docs/
    └── README.md                      # Human-readable description
```

## Verification Checklist

- [ ] `pack.json` validates against `PackManifestSchema` from `@eurocomply/types`
- [ ] `rules/main.ast.json` passes `validateAST` (all handlers exist, no circular refs)
- [ ] `tests/validation_suite.json` — all 8 test cases pass in the Simulator
- [ ] `eurocomply lint` exits 0
- [ ] `eurocomply test` exits 0 with 8/8 passed
- [ ] Rule covers: lead, cadmium, mercury, nickel, chromium VI
- [ ] Tests cover: all-compliant, individual violations, boundary values, multiple violations
