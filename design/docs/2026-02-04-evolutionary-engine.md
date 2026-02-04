# Design Document: The Evolutionary Engine (Phase 6)

**Status:** Draft
**Date:** 2026-02-04
**Target:** "Post-SaaS" Autonomy
**Prerequisite:** Phase 5.7 (Platform Completion)

---

## 1. The Vision: "Software That Writes Itself"

Traditional software is static. You buy it, you use it, it decays.
**Evolutionary Software** is dynamic. You buy it, you use it, it learns, it improves.

The goal of the **Evolutionary Engine** (aka "The Optimizer") is to transform EuroComply from a passive "System of Record" into an active "System of Improvement." It continuously monitors business performance, hypothesizes improvements to its own logic, proves them via simulation, and proposes them to the user.

---

## 2. The Core Loop: O.H.S.E.

The Engine runs a continuous, 4-step loop.

### Step 1: OBSERVE (The Monitor)
*   **Goal:** Find the pain points.
*   **Mechanism:** Statistical analysis of the Audit Log and Graph Structure.
*   **Input:** Live operational data (Audit Logs, Entity States).
*   **Process:**
    *   Calculate running averages for key metrics (e.g., "Time to Approval", "Defect Rate").
    *   Use **Postgres Window Functions** to detect statistical outliers (Z-Score > 3).
    *   Use **Neo4j Centrality Algorithms** to detect structural bottlenecks.
*   **Output:** A **"Failure Cluster"**.
    *   *Example:* "Metric `LeadTime` is failing (Avg: 14 days). Correlation found: `Supplier: Acme`."

### Step 2: HYPOTHESIZE (The Architect)
*   **Goal:** Invent a solution.
*   **Mechanism:** Generative AI (Tier B) + Logic AST Mutation.
*   **Input:** The "Failure Cluster" + The current Logic Pack AST.
*   **Process:**
    *   The Engine sends the problem context to the LLM.
    *   *Prompt:* "Supplier Acme is slow. The current rule requires 100% inspection. Propose a safe optimization."
    *   The LLM generates a **Candidate AST**.
    *   *Proposal:* "Switch Acme to 10% random sampling."
*   **Output:** A **Candidate Logic Pack** (a JSON file).

### Step 3: SIMULATE (The Proof)
*   **Goal:** Verify safety and value.
*   **Mechanism:** The Deterministic Kernel VM + Historical Data Replay.
*   **Input:** The Candidate AST + The last 12 months of real entity data.
*   **Process:**
    *   The Engine spins up a "Shadow Spoke" (in-memory).
    *   It replays 10,000 past transactions through the *new* logic.
    *   It measures two things:
        1.  **Safety:** Did any known "Bad" items pass? (Must be 0).
        2.  **Impact:** How much time/money would we have saved?
*   **Output:** A **Verification Report** (Pass/Fail + ROI).

### Step 4: EVOLVE (The Proposal)
*   **Goal:** Human authorization.
*   **Mechanism:** Universal Shell Notification.
*   **Input:** The Verification Report.
*   **Process:**
    *   The user receives a "Business Case."
    *   *"I found a way to save $50k/year by optimizing the inspection rule for Supplier Acme. Safety risk is 0% (Simulated)."*
    *   User clicks [Approve].
*   **Output:** The Logic Pack is updated via `registry:install`. The system evolves.

---

## 3. The Architecture (Under the Hood)

The Evolutionary Engine is built from 4 new components layered on top of the existing OS.

### 1. `MetricService` (The Eyes)
*   **Role:** Defines what "Good" looks like.
*   **Data Structure:** `metrics` table (name, logic_expression, threshold).
*   **Function:** Runs periodic SQL aggregation queries to update the `metric_snapshots` table.

### 2. `OptimizerService` (The Brain)
*   **Role:** Orchestrates the OHSE loop.
*   **Function:** It is a background daemon. It wakes up nightly, checks Metrics, triggers the AI for hypotheses, runs the Simulator, and creates User Notifications.

### 3. `GraphAnalyst` (The Map Reader)
*   **Role:** Finds structural problems.
*   **Function:** A wrapper around Neo4j GDS (Graph Data Science) library. It runs algorithms like `PageRank` (influence) and `Louvain` (clustering) to find hidden patterns in the supply chain.

### 4. `CandidateRegistry` (The Lab)
*   **Role:** Stores "Potential" Futures.
*   **Function:** A database table that holds the "Candidate Packs" that the AI has generated but the user hasn't approved yet.

---

## 4. Concrete Examples

### Example A: The "Lazy Approver" (Efficiency)
*   **Observation:** 98% of "Formatting Change" documents are approved in <2 mins.
*   **Hypothesis:** "We don't need 3 signatures for formatting fixes."
*   **New Rule:** `IF change_type == 'formatting' THEN signatures = 1`.
*   **Simulation:** Replayed 500 past documents. 0 errors found. 400 executive hours saved.
*   **Result:** System auto-streamlines its own bureaucracy.

### Example B: The "Golden Batch" (Quality)
*   **Observation:** Production batches yield 99% when `Temperature < 40C`. (Standard rule allows 50C).
*   **Hypothesis:** "Tighten the temperature limit to match best practice."
*   **New Rule:** `validate_range(temp, 20, 40)`.
*   **Simulation:** Checks past data. Confirms that no "Good" batches would have been rejected.
*   **Result:** System tightens quality standards automatically based on empirical success.

### Example C: The "Inventory Balancer" (Financial)
*   **Observation:** Inventory of "Acetone" sits unused for 4 months every Winter.
*   **Hypothesis:** "Reduce safety stock in Q4."
*   **New Rule:** `safety_stock = base * (month == 'Winter' ? 0.5 : 1.0)`.
*   **Simulation:** Replays last Winter's usage. Confirms 0 stockouts would have occurred.
*   **Result:** System releases $20k cash flow back to the business.

---

## 5. Why This Is Safe (The "Hallucination" Defense)

The biggest fear with AI is "It will do something crazy."
The **Evolutionary Engine** has a Triple Safety Lock:

1.  **The Syntax Lock:** The Kernel VM rejects any AST that isn't valid JSON syntax. (AI can't write broken code).
2.  **The Simulation Lock:** The Simulator replays history. If the AI suggests "Delete all data," the Simulator will show "100% Data Loss" and reject the proposal immediately. The user never sees it.
3.  **The Compliance Lock:** The system respects `ComplianceLock` constraints. If a Rule is "Legally Mandated" (locked by a Regulatory Pack), the Optimizer is *forbidden* from mutating it. It can only optimize "Discretionary" rules.

---

## 6. The Business Value

This feature changes the sales pitch entirely.

*   **Old Pitch:** "Buy EuroComply to manage your compliance." (Cost Center).
*   **New Pitch:** "Buy EuroComply to optimize your business." (Profit Center).

The software pays for itself. If the Optimizer finds one $50k saving per year, the license is free.

---

## 7. The Strategic Moat

Why can't Salesforce or SAP just copy this? It is not just about writing code; it is about the **Fundamental Architecture**.

### The "Code vs. Data" Barrier
*   **Competitors (SAP/Salesforce):** Their logic is **Code** (Java, Apex).
    *   To optimize, an AI must write and compile code. This is dangerous and prone to crashing the server. No enterprise CIO will allow an AI to rewrite backend Java.
*   **EuroComply:** Our logic is **Data** (JSON AST).
    *   To optimize, we just mutate a JSON field. The Kernel stays untouched. It is safe, verifiable, and requires no compilation.

### The "Simulation" Barrier
*   **Competitors:** Their systems have **Side Effects** (Emails, API calls).
    *   Replaying 10,000 historical events is impossible because it would re-send 10,000 emails. "Sandboxes" are slow and expensive to maintain.
*   **EuroComply:** Our Kernel is **Zero-I/O**.
    *   We can spin up a "Shadow Kernel" in milliseconds and process millions of records in seconds on a single CPU. We can "brute force" the future.

### The "Unified Graph" Barrier
*   **Competitors:** Data is siloed across 10 tables and 3 systems.
    *   Finding a correlation between "Supplier X" (ERP) and "Late Approval" (PLM) requires a massive Data Warehouse project.
*   **EuroComply:** We have a **Native Graph (Neo4j)**.
    *   The OS "sees" the entire supply chain as a connected web by default. Bottleneck detection is a native operation.

**Conclusion:** The Evolutionary Engine is not a "feature" you add. It is a capability you **unlock** only if you built your OS as a Deterministic, Graph-based, AST-driven engine from Day 1.

---

**Summary:** The Evolutionary Engine turns the EuroComply OS into a "Living Organism" that fights entropy, optimizes efficiency, and evolves to fit its environment perfectly. It is the ultimate expression of the "Generative OS."