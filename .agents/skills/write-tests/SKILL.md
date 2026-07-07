---
name: write-tests
metadata:
  version: "1.1.0"
description: >-
  Where and how to write tests in this repo: the two tiers (per-package unit +
  D1/pool vs. e2e), file naming that keeps runners from colliding, and the
  commands that gate. TRIGGER when: asked to add or fix tests, cover a new
  feature, or decide which tier a check belongs in.
---

# Writing tests

Pick the LOWEST tier that can catch the bug. The pyramid, not e2e-everything.

| Tier | Files | Runner | Use for |
| ---- | ----- | ------ | ------- |
| Per-package (unit + pool) | `<pkg>/__tests__/*.test.ts` | `cd <pkg> && bun run test` (vp test) | Everything below the browser: pure logic, and for D1-backed workers (guestlist, roadie) real D1 constraints too — those workers wire `@cloudflare/vitest-pool-workers` against their actual `wrangler.jsonc` in the SAME `*.test.ts` suite (no separate integration-only file suffix or `test:pool` script). |
| E2E (browser) | `e2e/**/*.spec.ts` | `bun run test:e2e` (root; stack must be up — see `/interactive-test`) | web→server→db round trips, auth journeys |

## Rules that keep the runners honest

- **Naming is load-bearing**: Playwright specs are `*.spec.ts` in `e2e/` so
  vitest never sees them; everything else in `__tests__/` is `*.test.ts`.
- **Gate = per-package runs + `.rwx/ci.yml`**, exactly what CI executes. Root
  `bun run test` aggregates workspaces whose pool/alias files need their own
  context — use the per-package command for the signal.
- D1-backed workers (guestlist, roadie) self-apply migrations inside their
  vitest-pool-workers setup — see their `vite.config.ts` (`cloudflareTest`)
  and existing `__tests__/*.test.ts` for the pattern (insert a row that
  violates a CHECK/unique/FK constraint, expect the D1 call to throw).
- Forms under test use `useAppForm` (`@si/ui/hooks/use-app-form`) —
  repo-wide convention; TanStack Form validates onBlur, so e2e helpers fill
  then blur before asserting submit-enabled.
- Kit/log tests live in `packages/kit/src/log/__tests__/` — spy on console,
  assert emitted canonical-line fields (see existing tests for the pattern).
- Bouncer's route/dispatch tests (`workers/bouncer/__tests__/`) are the
  reference for testing `routes.ts`'s `compileRoutes`/`matchRoute` at the
  unit level and full dispatch (`SELF.fetch` via `cloudflare:test`) at the
  integration level — see `routing.test.ts`, `mixed-modes.test.ts`,
  `redirect.test.ts` for schema/mode-coexistence/specificity coverage
  patterns.

## Adding coverage for a new feature

1. Pure logic → unit test beside the code (`__tests__/`).
2. New D1 table/constraint (guestlist, roadie) → a `__tests__/*.test.ts`
   asserting the constraint really holds (insert violating row, expect
   throw) — see the rule above, not a separate integration tier.
3. New user-facing journey step → extend an existing `e2e/*.spec.ts` before
   writing a new spec file.

Known quirk (unresolved upstream): `vp check` reports phantom vitest-global
errors inside `__tests__/` from its per-file checker; workspace `bun run
check` from root is the reference signal.
