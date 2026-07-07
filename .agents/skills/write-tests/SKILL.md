---
name: write-tests
metadata:
  version: "1.0.0"
description: >-
  Where and how to write tests in this repo: the three tiers (unit / D1
  integration / e2e), file naming that keeps runners from colliding, and the
  commands that gate. TRIGGER when: asked to add or fix tests, cover a new
  feature, or decide which tier a check belongs in.
---

# Writing tests

Pick the LOWEST tier that can catch the bug. The pyramid, not e2e-everything.

| Tier | Files | Runner | Use for |
| ---- | ----- | ------ | ------- |
| Unit (pure) | `<pkg>/__tests__/*.test.ts` or `src/**/__tests__/*.test.ts` | `cd <pkg> && bun run test` (vp test, node) | logic, grading, theming, parsing — no bindings |
| Integration (D1) | `workers/sprout/__tests__/integration/*.itest.ts` | `cd workers/sprout && bun run test:pool` (vitest-pool-workers/miniflare) | real D1 constraints: CHECK/unique/FK/cascade |
| E2E (browser) | `e2e/**/*.spec.ts` | `bun run test:e2e` (root; stack must be up — see /interactive-test) | web→server→db round trips, auth journeys |

## Rules that keep the runners honest

- **Naming is load-bearing**: pool tests are `*.itest.ts` (never `*.test.ts`)
  so the node runner skips them; Playwright specs are `*.spec.ts` in `e2e/`
  so vitest never sees them.
- **Gate = per-package runs + `.rwx/ci.yml`**, exactly what CI executes. Root
  `bun run test` aggregates workspaces whose pool/alias files need their own
  context — use the per-package command for the signal.
- Pool tests self-apply migrations:
  `await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)` in setup. The pool
  config (`vitest.pool.config.ts`) declares miniflare bindings explicitly —
  it does NOT read wrangler.jsonc (remote-only AI/Vectorize/Browser bindings
  can't boot in miniflare). `TEST_MIGRATIONS` is optional in
  `__tests__/integration/env.d.ts` because sprout's tsconfig includes
  `__tests__` in the app program.
- Forms under test use `useAppForm` (`@greenroom/ui/hooks/use-app-form`) —
  repo-wide convention; TanStack Form validates onBlur, so e2e helpers
  (`e2e/sprout/helpers.ts`: `typeInto`, `signIn`, `enterPortal`) fill then
  blur before asserting submit-enabled.
- Kit/log tests live in `packages/kit/src/log/__tests__/` — spy on console,
  assert emitted canonical-line fields (see existing tests for the pattern).

## Adding coverage for a new feature

1. Pure logic → unit test beside the code (`__tests__/`).
2. New table/constraint → one `.itest.ts` asserting the constraint really
   holds in D1 (insert violating row, expect throw).
3. New user-facing journey step → extend an existing `e2e/sprout/*.spec.ts`
   before writing a new spec file.

Known quirk (unresolved upstream): `vp check` reports phantom vitest-global
errors inside `__tests__/` from its per-file checker; workspace `bun run
check` from root is the reference signal.
