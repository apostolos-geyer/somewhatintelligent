# Sprout — Implementation Plan

The buildable plan for **Sprout**, a white-label B2B budtender-portal platform,
implemented as **one TanStack Start app** (`workers/sprout`) inside the greenroom
monorepo. Start with the overview, then follow the docs in order.

| Doc                                 | Title                              | One-line summary                                                                                                                                                           |
| ----------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [00](./00-overview.md)              | Executive Overview                 | The product, the one-app decision, the 14-surfaces map, the phase plan, and the resolved-decisions & risk register — read this first.                                      |
| [01](./01-architecture.md)          | Architecture & C4 View             | The one-app decision, the build-time-vs-runtime brand-model tension, C4 diagrams, request lifecycle, real-time + AI architecture, and multi-tenant isolation.              |
| [02](./02-data-model.md)            | D1 Data Model                      | The complete authored Drizzle schema (every table), migrations strategy, the R2-vs-D1 split, and indexing/tenancy rules.                                                   |
| [03](./03-app-structure.md)         | App Structure                      | The single `workers/sprout` tree, the one-page shell + no-routing section-layer system, the route map, server-fn organisation, runtime theming, and the quiz/chat fold-in.    |
| [04](./04-ui.md)                    | UI: Surfaces, Screen by Screen     | Every surface's desktop/mobile layout, exact components (exists/variant/build-new), motion, accessibility, the component inventory, and the runtime theming model.         |
| [05](./05-api-and-integrations.md)  | API Surface & Integrations         | Every `createServerFn` by domain, the Durable-Object wire protocol, analytics ingest + CSV, the AI/RAG pipeline, PDF handling, booking, and the service-binding contracts. |
| [06](./06-testing-strategy.md)      | Testing Strategy                   | Unit (vitest-pool-workers) + browser (Playwright) + post-deploy smoke; the two test idioms, the risk-driven tests that catch silent breakage, the seed strategy, and CI.   |
| [07](./07-deployment.md)            | Deployment, Environments & Cadence | Registering `sprout` as a worker, D1 migrations-before-code, deploy ordering, the three environments, secrets, and the deploy cadence + feature-gating.                    |
| [08](./08-compliance-invariants.md) | Compliance & Product Invariants    | INV-1…INV-14 — every product law pinned to its one load-bearing enforcement point (schema constraint / authz gate), with grep backstops for the legal-line rules.          |
| [09](./09-roadmap-and-cadence.md)   | Delivery Roadmap & Cadence         | The walking-skeleton first slice, the phase-by-phase epic plan, the dependency graph + critical path, parallelisable workstreams, and the fold-in plan.                    |

## Supplementary

| Doc                                                  | Title                         | One-line summary                                                                                                                                                                                                                                              |
| ---------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [user-journey-report.pdf](./user-journey-report.pdf) | User Journey Report (v4.0)    | Visual companion to [04](./04-ui.md): the 14 surfaces walked end-to-end as user journeys, each paired with a mockup, corrected against the live MTL build. "One engine, infinite skins"; nothing leaves the platform; the Education Award compliance framing. |
| [06b](./06b-browser-test-scaffolding.md)             | Browser Test Scaffolding      | Playwright browser-test scaffolding detail, supplementing [06](./06-testing-strategy.md).                                                                                                                                                                     |
| [10](./10-local-stack-and-testing-runbook.md)        | Local Stack & Testing Runbook | Friction-first: the working local-boot sequence (portless `--wildcard`, remote bindings via `CLOUDFLARE_API_TOKEN`, inspector ports, the dev PKCS8 key), the browser-automation recipe, and the test pyramid (unit · D1 integration · e2e).                   |
| [P7-mobile.md](./P7-mobile.md)                       | P7 — Mobile                   | Mobile-surface notes.                                                                                                                                                                                                                                         |
