# Platform docs

Documentation for this fork of the platform monorepo (bouncer, guestlist,
roadie, promoter, identity, store, and supporting packages).

| Doc                                                                                                      | What's in it                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`ARCHITECTURE.md`](ARCHITECTURE.md)                                                                     | C4-style reference: context, containers, components, shared patterns (security, sessions, cross-worker comms, dev/prod parity, WebSockets, logging), adding a new app, config + secrets. Source of truth for the platform shape. |
| [`REQUEST-FLOW.md`](REQUEST-FLOW.md)                                                                     | How identity, attestation, and session state move through the platform — the trust architecture end to end.                                                                                                                      |
| [`MULTI-TENANCY.md`](MULTI-TENANCY.md)                                                                   | Organizations, brand-scoped data, per-org theme/asset overrides, and SCIM — the B2B2C white-label model over Better Auth's org plugin.                                                                                           |
| [`adding-an-app.md`](adding-an-app.md)                                                                   | Step-by-step for adding a TanStack Start app (the 90% case) or a non-Start app (the 10% case) — file edits, wrangler config, bouncer routing, portless, deploy.                                                                  |
| [`secrets.md`](secrets.md)                                                                               | Secrets matrix per service, `.dev.vars` vs deployed secrets, and how `bun run secrets` provisions them (see also [`runbooks/SECRETS.md`](runbooks/SECRETS.md)).                                                                  |
| [`onboarding.md`](onboarding.md)                                                                         | Local dev setup checklist — clone to signed-in local stack.                                                                                                                                                                      |
| [`definition-of-done.md`](definition-of-done.md)                                                         | What "shipped" means for a platform deliverable.                                                                                                                                                                                 |
| [`browser-automation.md`](browser-automation.md)                                                         | agent-browser + Playwright e2e setup over one shared Chromium; provisioning and the two consumers.                                                                                                                               |
| [`design/somewhatintelligent-brand-study/HANDOFF.md`](design/somewhatintelligent-brand-study/HANDOFF.md) | Current somewhatintelligent brand direction, accepted and rejected decisions, source imagery, UI mockups, implementation rules, and the scoped next-session checklist.                                                           |
| [`runbooks/PRODUCTION-DEPLOY.md`](runbooks/PRODUCTION-DEPLOY.md)                                         | How a production release works (RWX release lane) and how to re-ship or roll back a single worker.                                                                                                                               |
| [`runbooks/SECRETS.md`](runbooks/SECRETS.md)                                                             | Codified secret provisioning via `@si/secrets` (`bun run secrets <env>`) — the manifest, sources, and the attestation keypair flow.                                                                                              |
| [`runbooks/roadie-r2-provisioning.md`](runbooks/roadie-r2-provisioning.md)                               | Making roadie R2 blob images render: the `ROADIE` binding requirement plus the per-env S3 keypair + bucket CORS.                                                                                                                 |

The [`ops/`](ops) directory holds the CI/CD and environment references:
[PR previews + staging promotion](ops/04-pr-previews-and-promote-on-merge.md),
[bootstrap + agent harness](ops/05-bootstrap-and-agent-harness.md),
[commit scoping](ops/commit-scoping.md), [env vars](ops/env-vars.md),
[provisioning](ops/provisioning.md), and [RWX setup](ops/rwx-setup.md).

`ARCHITECTURE.md` is the durable reference; everything else points back to it.
