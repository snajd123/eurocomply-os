# EuroComply OS

AI-programmable Compliance Operating System for European regulatory compliance. Federated hub-and-spoke architecture enabling companies to verify and communicate compliance claims across industries.

## Architecture

- **Hub**: Central SaaS control plane (provisioning, billing, fleet management, registry API)
- **Spoke**: Isolated customer instances with their own OS, databases, and AI infrastructure
- **Kernel VM**: Pure computation engine with ~53 immutable, audited compliance handlers
- **Platform Services**: Stateful operations (entity CRUD, files, search, permissions, tasks, audit)
- **Registry**: Versioned compliance logic (YAML/JSON/AST), stored in a separate repo (eurocomply-registry)

Layer order: Applications → System Services (Registry + A2A Protocol) → Kernel → Infrastructure

## Tech Stack

- TypeScript / Node.js
- PostgreSQL and Neo4j
- Cloudflare R2 (file storage)
- MCP (Model Context Protocol) for agent communication
- A2A Protocol for cross-company network communication

## Target Regulations

Cosmetics (CLP, REACH, EU Cosmetics Regulation), Textiles (ESPR, REACH, EU Ecolabel), Electronics (RoHS, WEEE, Batteries Regulation), Food Contact (FCM Regulation), and general ESPR/SCIP.

## Project Structure

```
design/docs/    # Architecture and design documents
```

## Design Docs

- `compliance-handler-vm.md` — Kernel VM and compliance handler specification
- `compliance-network-design.md` — Federated network and A2A protocol
- `business-model.md` — Product-driven business model
- `execution-plan.md` — Implementation roadmap
- `infrastructure-design.md` — Hub/spoke infrastructure
- `platform-services-layer.md` — Platform services specification
- `registry-design.md` — Compliance registry design
