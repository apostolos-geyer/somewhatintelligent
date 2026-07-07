# Definition of Done

## Purpose

This document is the contract under which work on the platform is considered complete. It exists to prevent indefinite iteration — a failure mode the author has identified as the primary risk to finishing — by defining, specifically and ahead of time, what "done" means for each deliverable and what changes are permissible after.

The contract applies to each service and application individually. When every service and every application is done per this contract, v1 of the platform is done.

## Component-level done

A service or application is done when all of the following are true.

**Every functional requirement in its specification is implemented and deployed.** Scope reductions documented in the specification as acceptable are permitted; those listed as not acceptable are blocking. A requirement cannot be moved from required to deferred after the specification was last reviewed; moving it requires a specification amendment.

**Every test scenario in its specification passes.** Unit tests, integration tests, and end-to-end tests per the component's testing requirements are present and green. Flaky tests are fixed, not tolerated.

**The component is deployed at its production URL and reachable.** DNS resolves, TLS terminates, the component responds. Sign-in works where applicable.

**Platform patterns are observed without deviation on the non-negotiable axes.**

- Authentication flows through Guestlist exclusively.
- Authorization is expressed in the component's grant table, using the documented principal types and resolution order.
- Storage is mediated by Roadie; no direct integration with the object storage backend.
- Transactional email flows through Promoter exclusively; no direct integration with the upstream email provider.
- Notifications and activity tracking follow the activity pattern.

Deviation on any non-negotiable axis is not a scope reduction; it is a failed delivery. Deviations on negotiable axes (visual design specifics, optional feature variants, secondary integrations) are permissible if documented.

**Observability is wired.** Dashboards are configured, alerts are enabled, unhandled errors are routed to the error tracking service. The component's runbook exists and is specific enough to be followed by the author six months later.

**A brief onboarding walkthrough exists.** Fresh sign-up, first use of the primary flow, and first share (if applicable) are performed by someone not involved in development, and any friction encountered is either fixed or documented as a known issue with a tracked resolution.

## Platform-level done

The platform as a whole is done when:

- Every component listed in the service and application inventory has met its component-level done criteria.
- A unified demonstration has been performed: a single user journey that exercises the identity provider, the blob service, the notification pattern, and at least two applications, with a third-party observer able to complete it unassisted.
- The cross-cutting patterns described in `docs/ARCHITECTURE.md` §4 have been validated as consistent across every component — the same principal type is resolved the same way in every application, the same notification fan-out happens for analogous verbs, the same session cookie works across every subdomain.
- A written tour of the platform — intended for a technical reviewer with no prior context — exists and faithfully describes what the platform does, how it is composed, and the design decisions made.

## What done does not mean

**Done is not final.** Applications and services will continue to be maintained, bugs will be fixed, and incremental improvements will ship. Done is the point at which the component can be demonstrated and presented without embarrassment, not the point at which further work is forbidden.

**Done is not feature-complete against the category.** The platform's applications are narrower than their commercial counterparts. Being done against this specification does not mean the Sprout brand portals are as feature-rich as commercial white-label CMS platforms, or that the marketing site and identity app are as polished as their commercial equivalents. It means the scoped product works, coherently, under the platform patterns.

**Done is not perfect.** Rough edges, suboptimal performance in uncommon cases, and known follow-up work are all compatible with done. The explicit reductions permitted by each specification exist for this reason.

## Change policy after done

After a component reaches done, changes are classified:

**Bug fixes** — functionality that is specified but does not work as specified — proceed without specification amendment.

**Security fixes** — issues that could lead to unauthorized access, data loss, or compromise — proceed immediately.

**Scope additions** — features not in the specification — require a specification amendment with a written rationale and a corresponding scope reduction elsewhere (unless the overall scope is legitimately growing, which is itself a deliberate decision requiring acknowledgment).

**Pattern changes** — modifications to the cross-cutting patterns in `docs/ARCHITECTURE.md` §4 — require updating the pattern document and confirming every component remains compliant.

**Performance and polish work** — improvements that do not change the specification's claims — proceed without amendment. These are the most common post-done changes and are welcomed; they are also the most common time-sinks, and discipline is required to ensure they remain improvements and not infinite refactoring.

## Anti-patterns to recognize

The following are warning signs that the done criteria are being circumvented:

**Iteration on architectural purity.** Replacing a working abstraction with a purer one. Inverting dependencies that are fine where they are. Introducing a new pattern because it is more elegant. If a reviewer could not tell the difference in the product or the tests, the effort is not creating value.

**Feature scope expansion.** Adding a capability not in the specification because it came up in conversation or seemed useful while building. The solution is not to discuss whether the feature should be added; the solution is to note the idea in a future-work file and move on.

**Test suite expansion.** Adding tests beyond the specification's testing requirements to pursue a coverage goal that is not declared. Test suites should grow with the code they verify, not with an aspiration.

**Tooling optimization.** Improving the development environment, the build, the CI, the monorepo structure. Legitimate in small amounts and easily the largest time-sink in practice. If the tooling works, leaving it alone until the product is done is almost always correct.

**Premature operational hardening.** Installing monitoring for scenarios that have never occurred, adding retry logic for failures that have not been observed, architecting for scale that has not been approached. The discipline is to let the architecture be minimally sufficient for v1 and add hardening in response to evidence.

## Schedule

v1 is expected to reach done within a defined window from the specification's finalization. The window is documented in the project's planning artifact; it is not reproduced here because schedules drift and this specification is intended to outlast individual plans.

When the window is at risk, the appropriate response is scope reduction per the specifications' enumerated permissible reductions, not extension. When the window is met, the appropriate response is to stop — not to use remaining time to pursue follow-on work. Further work begins after v1 is declared done.

## Declaration

When the component-level done criteria are met for a component, the author writes the declaration in the component's specification document. When the platform-level done criteria are met, the author writes the declaration in the platform overview. The declarations are dated and describe what was delivered against what was specified.

Declaring done is a deliberate act. It has no practical technical consequence — the software continues to run — but it marks the transition in mindset from building v1 to maintaining v1 and planning v2.
