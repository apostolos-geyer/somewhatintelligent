# 06 — Testing Strategy: unit, browser, smoke

> **Scope.** How the single `workers/sprout` TanStack Start app (the per-brand
> **Portal** one-page shell + section layers, **Brand Admin**, and the **Hub**)
> is tested end to end — three clearly separated strategies (**unit**, **browser**,
> **smoke**) plus the test-data strategy, CI/CD integration, and how the three
> tiers divide the work (no coverage-% gates — the CI `test` job has no coverage
> tooling).
>
> Grounded in greenroom's real test setup: the RWX gate's per-package
> `test-<pkg>` task that runs the package's suite via `captain run greenroom-<pkg>`
> (`.rwx/ci.yml` — one task per package, so they cache independently and each gets
> its own machine); the **two coexisting test idioms** —
> _services_ run the real `@cloudflare/vitest-pool-workers` pool with miniflare
> D1/R2 bindings (`workers/roadie/vite.config.ts:23-41`), while _apps_ run
> `__tests__` as plain **node** with CF plugins dropped under `VITEST`
> (`workers/sprout/vite.config.ts:45-54`); the per-file vitest-globals phantom
> quirk (`scripts/staged-check.ts:17`); and `tsgo` as the authoritative typecheck
> (the gate's per-package `typecheck-<pkg>` task, `.rwx/ci.yml`). Every table/route/component name reuses
> docs 01-03 verbatim (`workers/sprout`, `_portal`, `SectionLayer`, `BrandStyle`,
> `GroupChatRoom`, `brand_theme`, `portal_config`, `reviews`, `deck_progress`,
> `user_brand_scores`, `physical_requests`, `analytics_events`, …).

---

## 0. The substrate has two test idioms — sprout uses both

This is the single most important grounding fact, and it dictates the whole
unit-test plan. The repo already runs vitest in **two distinct ways**:

| Idiom               | Where it's used today                                                                                        | Runner                                                                     | Bindings                                                                                                                                          | What it tests                                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **A. workers-pool** | `workers/roadie`, `workers/guestlist`, `workers/bouncer`                                                     | `@cloudflare/vitest-pool-workers` via `cloudflareTest(...)`                | **real** miniflare `env.DB` (D1), `env.BLOBS` (R2), `SELF`, `createExecutionContext()` (`workers/roadie/__tests__/helpers.ts:3,63-70`)            | real SQL against a real local D1, R2 round-trips, full RPC handlers            |
| **B. node-pure**    | `workers/sprout` — the pure-logic suites (`__tests__/policy.test.ts`, `grading.test.ts`, `score.test.ts`, …) | plain `vitest` (`environment: "node"`, CF plugins stripped under `VITEST`) | **none** — external deps (`cloudflare:workers` env, SDK clients) mocked directly with `vi.mock`/`vi.hoisted` (`__tests__/realtime.test.ts:26-40`) | pure predicates, scoring/grading math, theme-token derivation, SDK call shapes |

`workers/sprout` deliberately adopts **both**, partitioned by what a test needs:

- **Pure logic** (`policy.server.ts` predicates, scoring/leaderboard math,
  PDF page-count, CSV row shaping, review/authz decisions) → **idiom B** (node).
  Fast, zero bindings — sprout's own `__tests__/policy.test.ts` drives
  `decideBrandAdmin`/`isPlatformAdmin` this way today.
- **Binding-touching** (server fns hitting `env.DB`, roadie reference round-trips,
  the single `GroupChatRoom` DO — exercised against **both** `idFromName`
  keyspaces (group chat = `idFromName(brandId)`, feed comments =
  ``idFromName(`${brandId}:${postId}`)``), schema/migration round-trips, the
  brand-config resolver reading D1) → **idiom A** (workers pool), copying
  `workers/roadie/vite.config.ts`'s `cloudflareTest(...)` block + the
  `readD1Migrations` setup so the sprout D1 schema is materialised in miniflare.

The apps today _only_ use idiom B; sprout is the first **app** to also need
idiom A, because it owns a DO, an R2 contract, and a
host→brand resolver that all need real bindings to test honestly. The wiring is
fully precedented in the _services_; we lift it into the app's `vite.config.ts`.

> **vite.config split.** Both idioms live in one `workers/sprout/vite.config.ts`
> `test` block. The CF-plugin strip under `if (process.env.VITEST)`
> (`workers/sprout/vite.config.ts:45-54`) stays for the node SSR/HMR plugins; the
> `cloudflareTest(...)` plugin from the roadie config is added so binding tests
> get real D1/R2. The pool runs **serial within the package** (the RWX gate runs
> each package's tests as its own `test-<pkg>` task on its own machine — one
> workerd pool per box — sidestepping the dev-registry contention parallel pools
> on one machine would hit, `.rwx/ci.yml`); within the package, keep binding
> suites in one project so they don't contend either.

---

## 1. UNIT (vitest-pool-workers) — the bulk of correctness

### 1.1 What to unit-test (and which idiom)

| Subject                               | Doc 02/03 anchor                                                                   | Idiom  | What the test asserts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------- | ---------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Brand-config resolver**             | `lib/brand.server.ts` `resolveBrandForHost(host)` (03 §Host→brand)                 | A (D1) | `<slug>.sproutportal.ca` → `org_brand_directory` → `brand_theme` + `portal_config` rows; apex host → `brand=null` (Hub); unknown slug → not-found; theme draft vs live: public reads `live_theme_json`, admin preview reads the draft; portal content (`portal_config`) is live-edit (02 §1)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Theme-token derivation**            | `BrandStyle` token map (03 §Theming)                                               | B      | `live_theme_json` → `--color-primary`/`--color-background`/`--font-display` overrides; emits **both** light + dark blocks so `data-theme` switching still works                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **Server fns**                        | `*.functions.ts` (03 §Server-fn org)                                               | A (D1) | `brand_id` is taken from `context.principal.activeOrgId`, **never** from input (the forgery surface, `courses.functions.ts:115-118`); a forged `brand_id` in `data` is ignored; reads only return rows where `brand_id = activeOrgId OR brand_id IS NULL`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Review authz rules**                | `reviews.functions.ts`, `decideEditReview`                                         | B + A  | one review per `(brand_id, product_id, user_id)` (UNIQUE, 02 §2.3); author edits/deletes own; admin **DELETE** only — there is **no** edit/hide path (assert no such server fn exists); admin delete is a real SQL `DELETE` (no `deleted_at`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Scoring / leaderboard math**        | `user_brand_scores` recompute (02 §11)                                             | B      | `score = round(0.55·quizPoints + 0.30·deckPoints + 0.15·activityPoints)` (the single `SCORE_WEIGHTS` const in `jobs/cron.ts`); each sub-score's normalization + hard caps (quiz ≤100, deck base+≤20 bonus, activity ≤100); per (user, brand, period=`YYYY-MM`); per-brand ranking + platform-wide sum across the user's brands for the current period; "Last Month's Winner"/Education Award reads the **prior closed** period's row; user's own rank always returned; ties broken deterministically by earliest `computed_at` then `user_id`                                                                                                                                                                                                                                                                                                                   |
| **Quiz grading**                      | folded-in `grading.ts` (03 §Folding in quiz)                                       | B      | per-type scoring for `multiple_choice`/`select_all` (partial credit via `weight`)/`true_false`/`image`/`matching`; pass/fail vs `pass_threshold`; cert award on pass of a `cert_name` quiz                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **PDF page-count + thumbnail derive** | `deck.derive` job in `jobs/queue.ts` (02 §3, `decks.page_count`/`cover_thumb_ref`) | A (R2) | the async derive job reads the PDF blob from roadie, derives `page_count` + corpus text via **unpdf** and a page-1 PNG thumbnail via the **Browser Rendering** (`BROWSER`) binding, writes `page_count` + a **non-null** `cover_thumb_ref` back to the `decks` row (assert both are populated; **do not pixel-assert** the thumbnail — mask it in visual tests); replace-PDF keeps the same listing row                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **CSV export**                        | `analytics.functions.ts` `exportCsv` (03)                                          | B      | streams `analytics_events` rows to CSV; correct header order; quoting/escaping; `brand_id`-scoped (no cross-brand rows leak); per-budtender + per-deck/product/quiz shapes incl. **most-missed question**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Flip-depth recording**              | `deck_progress` upsert (02 §3)                                                     | A (D1) | `recordFlipDepth` upserts `last_page` (max), accumulates `time_spent_seconds`; UNIQUE `(deck_id, user_id)` → upsert not append; emits a `deck_flip` `analytics_events` row                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **Physical-request status flow**      | `physical_requests` (02 §4)                                                        | B + A  | legal transitions `Requested→Approved→Shipped`, `Requested→Declined(reason)`; illegal transitions rejected; `tracking` only on Shipped, `decline_reason` only on Declined                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **Banner window + counters**          | `banner_cards` (02 §1)                                                             | A (D1) | live/expiry windowing; `impressions`/`clicks` bump transactionally **and** emit `banner_impression`/`banner_click` events (02 §12)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **Schema / migration round-trips**    | `workers/sprout/migrations/*.sql`                                                  | A (D1) | every generated migration applies cleanly into miniflare D1; the two hand-appended CHECKs hold (`reviews.rating BETWEEN 1 AND 5`, `length(reviews.body) <= 300`, 02 §2.3); UNIQUE indexes enforce the product invariants (one review/user/product, one cert/user/quiz, one chat room/brand, one booking/slot)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **DO logic**                          | `room-server.ts` single `GroupChatRoom` class (03)                                 | A (DO) | drive the **one** class against **both** keyspaces — `idFromName(brandId)` (group chat) and ``idFromName(`${brandId}:${postId}`)`` (feed comments); `onStart` creates DO-local tables idempotently (`IF NOT EXISTS`); `onConnect` derives `expectedHost` from the WS-upgrade `Host` header, validates the `*.sproutportal.ca` single-label pattern, resolves label→org, and for authed connections asserts the envelope principal's `activeOrgId === resolved org_id` (rejects `1008` otherwise); **DO isolation assertion: a brand-A envelope cannot join a brand-B room**; broadcast fan-out; group-chat message persistence to `chat_messages` + feed-comment durable log to the D1 `comments` table; team marker; soft-delete; presence/`chat_rooms` written for group chat **only** (feed-comment fan-out is DO-local ephemeral, not mirrored to presence) |
| **Notification fan-out**              | `notifications` + `notification_prefs` (02 §10/11)                                 | A (D1) | a contact reply inserts a `contact_reply` notification for the thread author; per-brand/per-type pref gating (no global switch); unread badge query `(user_id, read_at)`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **Leaderboard read brand-scoping**    | `getLeaderboard({ brandId, period })` (05 §1.11)                                   | A (D1) | reads `user_brand_scores` via `user_brand_scores_leaderboard_idx (brand_id, period, score)` and returns **only** that brand's rows — a brand-B caller never sees brand-A scores (the per-brand Quizzes-layer leaderboard panel data path, 04 Surface 7)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Org-directory sync**                | `syncOrgDirectory({ orgId, slug, name, logoRef })` (05 §7.1)                       | A (D1) | the guestlist org-hook push upserts `org_brand_directory` and stamps `synced_at`; the hourly reconcile cron re-syncs stale/missing rows; `scripts/seed.ts` writes directory rows directly so tests don't depend on the live webhook                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Chart primitive render**            | `components/admin/charts/` `BarChart`/`Sparkline`/`TopNBars` (04, build-new)       | B      | renders **N** bars for **N** data points with correct `aria` labels (token-driven SVG, no chart library); no chart visual-regression baseline (data is volatile)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| **Reorder primitive**                 | `SortableList` move fn (04, build-new — hero/sections/banners)                     | B      | a move rewrites `order_idx` to a **contiguous `0..n-1`** sequence (the keyboard move-up/move-down baseline for `hero_slides.order_idx`, `live_sections_json` order, `banner_cards.order_idx`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

### 1.2 Testing D1 + R2 + DO bindings in-worker (idiom A)

Copy the _services'_ pool config verbatim into the app. The two load-bearing
pieces:

**(a) `cloudflareTest(...)` + `readD1Migrations`** — materialises the sprout D1
schema in miniflare from `workers/sprout/migrations/`, and declares the R2 bucket.
Lifted from `workers/roadie/vite.config.ts:23-41`:

```ts
// workers/sprout/vite.config.ts — test block (idiom A subset)
import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";

cloudflareTest(async () => {
  const migrations = await readD1Migrations(path.join(__dirname, "migrations"));
  return {
    wrangler: { configPath: "./wrangler.jsonc" }, // the wrangler config — DB + ROADIE + DO bindings
    miniflare: {
      bindings: { TEST_MIGRATIONS: migrations },
      r2Buckets: ["BLOBS"], // roadie's local R2 emulation
    },
  };
});
// test: { globals: true, include: ["__tests__/**/*.test.ts"],
//         setupFiles: ["__tests__/apply-migrations.ts"] }
```

**(b) the setup file** that applies `TEST_MIGRATIONS` before each suite — the
roadie pattern (`workers/roadie/__tests__/apply-migrations.ts`, referenced at
`workers/roadie/vite.config.ts:49`). It runs `applyD1Migrations(env.DB,
env.TEST_MIGRATIONS)` so every binding test starts on the real, fully-migrated
sprout schema.

**Bindings inside a test** come from `cloudflare:test`:

```ts
/// <reference types="@cloudflare/vitest-pool-workers/types" />
/// <reference types="vite-plus/test/globals" />
import { env, createExecutionContext, runInDurableObject } from "cloudflare:test";

// D1: real SQL against the migrated local DB
await env.DB.prepare("INSERT INTO brand_theme (id, org_id, ...) VALUES (?,?, ...)")
  .bind("cfg1", "org_mtl", "MTL Cannabis")
  .run();

// R2 (via roadie binding, caller_app="sprout"): register → PUT → finalize, then getReadUrl
// — mirror workers/roadie/__tests__/helpers.ts seedReady()

// DO: drive the single GroupChatRoom class against BOTH keyspaces with real stubs
// group chat = idFromName(brandId); feed comments = idFromName(`${brandId}:${postId}`)
const chatStub = env.GROUP_CHAT_ROOM.get(env.GROUP_CHAT_ROOM.idFromName("org_mtl"));
const feedStub = env.GROUP_CHAT_ROOM.get(env.GROUP_CHAT_ROOM.idFromName("org_mtl:post_42"));
await runInDurableObject(chatStub, async (instance) => {
  /* assert onStart/onConnect; brand-A envelope rejected (1008) on a brand-B room */
});
```

`createExecutionContext()` + `(ctx).props = { callerApp: "sprout" }` is exactly
how roadie seeds the caller (`workers/roadie/__tests__/helpers.ts:63-66`); use
the same `makeRoadie`-style helper so the sprout app's roadie calls carry
`caller_app: "sprout"` (so references stay private to the app, 02 §R2 split).

### 1.3 Fixtures / seed

A single `workers/sprout/__tests__/fixtures.ts` (mirrors roadie's `helpers.ts`):

- `seedBrand(env, { orgId, slug, name })` → inserts `org_brand_directory` +
  `brand_theme` (draft + live theme JSON) + `portal_config`, returns ids.
- `seedProduct`, `seedDeck` (with a real PDF blob in R2 so page-count derive can
  run), `seedQuiz` (+questions/options), `seedAsset`, `seedPost`.
- `makePrincipal({ userId, role, activeOrgId })` → a fake `context.principal`
  (`kind:"user"`, `actor{id,role}`, `activeOrgId`) so server-fn handlers can be
  invoked with a synthetic verified principal **without** a bouncer envelope —
  the unit boundary is _below_ envelope verification (envelope verify itself is
  covered in `packages/auth`/bouncer suites, not re-tested per app).
- Two demo brands + budtenders match the §7 test-data brands so unit fixtures and
  browser/smoke seeds share names.

### 1.4 What silently breaks — the risk-driven test set

There are **no coverage-% gates**: the CI `test` job (`vp test run`) carries no
coverage tooling, so a percentage threshold can never fail a build. Instead, pin
the unit suite to the handful of failures that would ship silently and the exact
test that catches each:

- **`brand_id` derived from the principal, never input** (the cross-tenant
  forgery surface) — **every** `*.functions.ts` fn has at least one test proving a
  forged `brand_id` in `data` is ignored on the **write** side **and** that a
  forged `brand_id` in a list read is ignored on the **read** side
  (`courses.functions.ts:115-118`). This is the load-bearing tenant-isolation
  assertion (08 INV-14).
- **Reviews are hard-delete with NO edit/hide path** — assert no edit/hide server
  fn exists and admin delete is a real SQL `DELETE` (no `deleted_at`), 02 §2.3.
- **Decision matrices stay exhaustive** — `lib/policy.server.ts` covers every
  `actorRole × orgRole × intent` branch, exhaustively exercised in
  `__tests__/policy.test.ts` (pure, cheap).
- **The math is right** — `grading.ts` per-type scoring, the single
  `SCORE_WEIGHTS` leaderboard formula + caps (§1.1), the CSV shaper, the
  `deck.derive` `page_count`/`cover_thumb_ref` populate.
- **The DO holds the line** — `onStart` idempotency, `onConnect` host +
  `activeOrgId` accept/reject across **both** `idFromName` keyspaces, broadcast,
  D1 write-through, and the brand-A-cannot-join-brand-B isolation assertion.
- **Every migration applies** — the schema/migration round-trip test is the gate;
  a migration that doesn't apply into miniflare D1 fails the suite.

### 1.5 Constraints to respect

- **Serial pool.** vitest-pool-workers suites must run serial within one machine
  (parallel workerd pools contend on the wrangler dev registry and hang) — the RWX
  gate header states this (`.rwx/ci.yml`). Each package runs as its own
  `test-<pkg>` task on its own machine; **do not** add a `--no-isolate`/parallel
  projects setup that fans out workerd pools inside the sprout package.
- **`__tests__` fmt-only partition.** The pre-commit hook
  (`scripts/staged-check.ts:17`) format-onlys anything matching
  `(__tests__|test|scripts)/` or `*.test.ts?` because vp's per-file checker
  phantoms vitest globals (`Cannot find name 'expect'`). So: keep test files under
  `workers/sprout/__tests__/`, expect `vp check --fix` to skip them, and treat
  workspace-wide `bun run check` + **`tsgo` (`bun run typecheck`) as
  authoritative** (the gate's `typecheck-<pkg>` tasks, `.rwx/ci.yml`). The documented `--no-verify`
  escape hatch is acceptable for test-file-only commits.
- **`/// <reference>` headers.** Binding tests need the two triple-slash refs at
  the top (pool types + vp globals), as every roadie/guestlist test has
  (`workers/roadie/__tests__/helpers.ts:1-2`) — otherwise `env`/`SELF` aren't
  typed.

---

## 2. BROWSER (Playwright)

> **Decision.** Playwright **is** the browser runner — settled, not a
> recommendation. The two-context + multi-host + visual-regression trifecta below
> is decisive (no other runner does all three), so this is a fixed contract.

### 2.1 Why Playwright

- **Real cross-context real-time.** The signature journeys — a feed comment
  appearing live in a _second_ context, group chat fan-out — need **two
  simultaneous browser contexts** hitting the single `GroupChatRoom` DO (group
  chat via `idFromName(brandId)`, feed comments via
  ``idFromName(`${brandId}:${postId}`)``). Playwright's `browser.newContext()`
  makes "alice posts, bob sees it without reload" a first-class assertion; this is
  the hardest thing to fake and the most important to prove.
- **Multi-tenant host simulation.** Brand resolution is by **subdomain**
  (`<slug>.sproutportal.localhost`, 03 §Host→brand). Playwright drives arbitrary
  hosts directly (`page.goto("https://mtlcannabis.sproutportal.localhost/")`),
  and vite's `allowedHosts: [".sproutportal.localhost"]`
  (`workers/sprout/vite.config.ts:67`) already admits the wildcard — so two brands
  are two URLs, no proxy gymnastics.
- **Per-brand visual regression.** Playwright's built-in
  `toHaveScreenshot()`/`expect(page).toHaveScreenshot()` is exactly what the
  runtime `<BrandStyle>` theming needs (§2.5) — pixel-diff two brands rendering
  the _same_ shell with different `--color-*` tokens.
- **Storage-state auth reuse.** Playwright `storageState` snapshots the
  bouncer/better-auth session cookie once and replays it across specs — critical
  because sign-in goes through guestlist and we don't want to re-auth per test.

**Alternatives weighed:** _Cypress_ — weak multi-origin/multi-tab story
(historically one browser tab), which breaks the two-context real-time tests that
are the whole point; _WebdriverIO_ — capable but heavier setup with no advantage
here; _vitest browser mode_ — good for component-level but not for full
two-context DO journeys against a running worker. Playwright wins on the
two-context + multi-host + visual-regression trifecta.

### 2.2 Critical end-to-end journeys to automate

Each maps to a route/section/component from doc 03 and exercises real bindings:

1. **Sign-in via guestlist → enter portal.** `goto(brand host)` → landing
   (`_portal/index.tsx`, rotating hero + ONE "Enter Portal") → sign-in (guestlist
   `/api/$` reverse-proxy, same-origin) → `_portal/home` section grid renders for
   the right brand.
2. **Open each section layer + close restores scroll.** Scroll the grid, open
   `?section=decks` (`SectionLayer` `fixed inset-0 z-50`), close
   (`section=undefined`) → assert `window.scrollY` is **unchanged** (the product
   rule, 03 §scroll restoration). Repeat for `assets`/`quizzes`/`feed`/`chat`/`contact`.
3. **Submit a review.** Open Drop Sheet product → submit 1-5 star + ≤300-char
   review (via `useAppForm`) → average updates; second submit by same user
   **replaces** (one per budtender/product); admin context can **delete** but the
   UI exposes **no edit/hide** control.
4. **Flip a PK deck + flip-depth recorded.** Open `?section=decks` → flip-viewer
   → advance pages → close → assert `deck_progress.last_page` advanced and a
   `deck_flip` `analytics_events` row exists (query via an admin/test endpoint or
   the analytics view).
5. **Take a quiz + cert + brand leaderboard.** Full-screen quiz overlay
   (re-hosted phase machine, 03 §Folding in quiz) → answer all five question types
   → submit → pass ≥ threshold → named **certification** badge appears on profile
   instantly. Then in the **Quizzes** layer (`?section=quizzes`), switch the
   `Quizzes | Leaderboard` sub-tab to **Brand Leaderboard** → the panel shows
   **this brand's** top-N + the budtender's own pinned rank, **brand-scoped** (a
   brand-B budtender never sees brand-A scores) — no route change (stays in the
   one-page shell, INV-7).
6. **Post a feed comment in real-time across two contexts.** Context A (budtender)
   opens an expanded feed post; Context B (brand team) posts a comment → it
   appears in A **without reload**; B's reply renders with the **Team marker**;
   closing the overlay returns A to the exact feed position.
7. **Request physical asset → admin fulfils → status flows.** Budtender opens
   Store Assets → Request Physical (qty + shipping street/city/province/postal +
   contact/phone) → appears in `/admin/fulfilment` queue → admin
   Approve → Shipped (tracking) → budtender's **My Requests** (`/requests`) shows
   `Requested→Approved→Shipped`.
8. **AI ask → booking.** AI bubble (`components/ai/`) → ask "strongest indica?"
   (answer grounded in brand content) → escalate → **slot picker** from published
   `availability_windows` → book a slot → it **vanishes** from the picker; assert
   **no "Start Call Now"** control exists anywhere (product law).
9. **Brand-admin portal-setup live-preview Draft→Live.** `/admin/setup` → change
   primary colour (LIVE PREVIEW retints the preview instantly via the same CSS
   vars) → save (writes `draft_theme_json`) → public portal still shows old skin →
   **Flip Draft→Live** → public portal now shows the new skin (reads
   `live_theme_json`).
10. **Hub leaderboard.** Sign in at the **apex** `sproutportal.localhost` → `/hub`
    (the one Sprout-branded surface) → `/hub/leaderboard` shows platform-wide
    top-5 by composite score (summed across the user's brands for the current
    period) + the user's own rank always visible; `/hub/award` shows the
    **Education Award** framing (never "prize/reward/cash") reading the prior
    closed period, with countdown + the user's gap to first.
11. **Admin analytics mounts.** As brand admin, open `/admin/analytics` → assert
    it **mounts without crashing** on the deployed bundle (the build-new
    `BarChart`/`Sparkline`/`TopNBars` token-driven SVG primitives + the
    per-budtender/most-missed/top-AI-question rollups as the identity-admin
    table). **No chart visual-regression baseline** — the data is volatile.
12. **Keyboard reorder (a11y baseline).** In `/admin/setup`, drive the
    `SortableList` **move-up/move-down buttons** (the mandatory keyboard baseline)
    to reorder hero slides → assert the new order persists via `reorderHeroSlides`.
    Pointer **drag** (`@dnd-kit`) is a progressive enhancement and stays **out** of
    the browser suite (its determinism lives in the unit reorder-fn test, §1.1).

### 2.3 Running against local dev and staging

- **Local (portless / wrangler dev).** Start the app the documented way —
  `cd workers/sprout && bun run dev` (portless) so brand subdomains resolve under
  `*.sproutportal.localhost` (CLAUDE.md "Local dev workflow"; vp recursive runner
  skips portless packages, so the explicit `cd … && bun run dev` is required).
  Playwright `baseURL` is the portless URL; brand hosts are derived by swapping
  the leftmost label. A Playwright `webServer` block can boot the app, or CI runs
  it as a separate started process (§6).
- **Staging.** Same specs, `baseURL = https://<brand>.sproutportal.ca` and the
  apex for the Hub. Bouncer is in front in staging (mints the real envelope), so
  the local **dev-envelope stamper is a hard no-op** there (it only fires under
  `ENVIRONMENT=development`) — the journeys exercise the _real_ bouncer→portal
  envelope path, which is the higher-fidelity run.

### 2.4 Auth / session, multi-tenant host, data setup/teardown

- **Auth/session.** A `global-setup` signs in each seeded budtender (and a brand
  admin, and a platform admin) once via guestlist and saves `storageState` per
  role; specs load the matching state. **Email-verification gotcha** (CLAUDE.md):
  in local dev without `RESEND_API_KEY`, verification blocks sign-in — pre-verify
  the test users in the seed (the README D1 bypass), or set `RESEND_API_KEY` for
  the browser run.
- **Multi-tenant host simulation.** Two seeded brands = two subdomains; the
  resolver picks the org from the host (03 §Host→brand). A cross-tenant negative
  test: a budtender authed for brand A cannot read brand B's content even by
  navigating to B's host (writes still gate on `activeOrgId`).
- **Data setup/teardown.** Reuse the §7 seed (`scripts/seed.ts`) to create
  the demo brands + budtenders before the run; teardown deletes those org ids'
  rows from the sprout D1 + the guestlist orgs. Each spec that mutates
  (reviews, requests, posts) namespaces its data by a unique suffix so reruns are
  idempotent.

### 2.5 Visual regression for per-brand theming

The runtime `<BrandStyle>` (03 §Theming) is the thing most likely to silently
break, and the hardest to unit-test. Playwright visual regression:

- Snapshot the **same** `_portal/home` shell for **two brands** with different
  `brand_theme` live JSON → assert the screenshots **differ** (proves the skin
  applied) and each **matches its own baseline** (proves it didn't regress).
- **Bounded override set.** Assert `--color-primary`/`--color-background` **differ**
  between the two demo brands but `--color-stigma` (the fixed `danger` semantic
  accent) is **identical** across both — proving a brand retints only the three
  identity roles (primary, one accent, background/surfaces), and the four semantic
  accents (`stigma`/`growth`/`pistil`/`haze`) stay non-overridable Sprout status
  tokens (04 runtime-theming, 02 §1).
- Snapshot **light and dark** (`data-theme` toggle) for one brand → both inherit
  the org override (03 §Theming point 3: the override emits both blocks).
- Snapshot `<BrandLogo>` (runtime, roadie logo) vs the Hub's build-time `Logo`
  (Sprout wordmark) → prove the Portal never shows the Sprout wordmark (only the
  "Powered by Sprout" footer credit; the invisibility product rule).
- Mask volatile regions (countdowns, "N online", relative timestamps) so diffs
  are deterministic.

---

## 3. SMOKE (post-deploy, read-only)

A **fast, read-only** suite that runs **after each staging/prod deploy** and
proves the deployed system is alive end to end — not a feature test, a
liveness/wiring test. It is **not** vitest-pool-workers (no miniflare); it's a
plain HTTP/Playwright probe against the **real deployed** origins.

### 3.1 What it checks (all read-only / idempotent)

1. **App health.** `GET https://sproutportal.ca/` (Hub apex) and
   `GET https://<seed-brand>.sproutportal.ca/` (a portal) return 200 and render
   the landing shell (hero + section grid markers).
2. **Each service binding reachable** (proven through the portal, since
   guestlist/roadie/promoter have no public HTTP):
   - **guestlist** — the `/api/$` reverse-proxy returns a session/health response
     (the portal proxies same-origin to the `GUESTLIST` binding, 03 §9).
   - **roadie** — a seeded asset/deck's `getReadUrl` resolves and the presigned
     GET returns the blob (proves the `ROADIE` binding + R2 + `caller_app:"sprout"`
     scoping).
   - **promoter** — **no public surface, so no runtime probe.** Promoter is
     RPC-only; instead a **build-time assertion** that the `PROMOTER` binding
     resolves in the `wrangler.jsonc` (never send a real email in smoke).
3. **Brand-config loads for a seeded org.** `<demo-brand>` host → resolver returns
   that org's `brand_theme`; the page carries the brand's `<BrandStyle>` token
   override (assert a known brand colour CSS var is present in the SSR'd `<head>`).
4. **A section renders.** Open one `SectionLayer` (e.g. `?section=decks`) and
   assert it mounts (the layer system is live; no JS crash on the deployed bundle).
5. **Login works.** Sign in the dedicated smoke user via guestlist → land in the
   portal (proves the bouncer→portal envelope path end to end in the real
   topology).
6. **DO connects.** Open the `/ws/*` channel to the single `GroupChatRoom`
   (`idFromName(brandId)`) → assert the socket upgrades (101 handled at the worker
   entry, before TSS) and the DO sends its **`session.init` frame** (05 §2.3) —
   proves the DO binding + the per-connection `expectedHost`/`activeOrgId` envelope
   gate at `onConnect`.

Each probe has a tight timeout; the whole suite targets **< 60s** so it gates a
deploy without slowing CD.

### 3.2 How it runs — AFTER deploy, via the RWX lanes

The wired post-deploy smoke is the shared **`scripts/smoke-test.sh <url>`**, run as
the final step of each RWX deploy lane (`.rwx/promote-staging.yml` for staging,
`.rwx/release-please.yml` + `.rwx/release.yml` for production) **after** the
ordered deploy finishes — bouncer is deployed **last**, so the smoke first runs
once the public router points at the freshly-deployed upstreams. It hits the
public apex router (bouncer) and requires a non-5xx answer: any status < 500 is
healthy (a 200/301/302/307 to the identity sign-in is a healthy router); a 5xx or
no connection (`000`) fails the deploy. That proves the whole router → `SPROUT`
binding → guestlist/roadie/promoter chain answers end-to-end. There is **no
`smoke:staging` package script** and **no separate CI job to add** — the lanes
already call the shared script, and because the deploy tasks are gated on the
`greenroom_deploy` vault + push-to-`main`, the smoke only runs when a real deploy
happened.

The richer read-only probes in §3.1 (brand-config token in the SSR'd `<head>`, a
`SectionLayer` mounting, sign-in, the DO `session.init` frame) are the **target
coverage**; today they live in the e2e Playwright suite (§2), not the lightweight
apex smoke. Keep the smoke fast (apex liveness) and let e2e own the authenticated
DO/envelope depth.

**Shared identity constants.** Both `__tests__/fixtures.ts` (unit, §1.3) and
`scripts/seed.ts` (browser/smoke, §4) import the two demo brands' + their
budtenders' slugs/handles/ids from one `workers/sprout/__tests__/demo-constants.ts`,
so names never drift across tiers. The `makePrincipal` seam stays a unit fixture:
export the **pure handler bodies** `(input, ctx)` for direct invocation; the
`createServerFn` wrapper + middleware is covered **once** by an integration test,
not re-mocked per fn.

### 3.3 Alerting on failure + standing uptime monitoring

- **On-failure alerting.** A failed smoke job fails the deploy workflow → GitHub's
  workflow-failure notifications fire; add a notify step (`if: failure()`) that
  posts to the team channel with the failing probe + origin. A red smoke is a
  **deploy-broke-staging** signal, distinct from a red CI (code-broke).
- **Standing uptime monitoring is an ops concern, not part of the test suite** —
  configure **Cloudflare Health Checks** against the apex + one brand portal as a
  **pre-GA prerequisite** (catches between-deploy drift: an expired secret, a
  roadie outage, the `*.sproutportal.ca` wildcard cert lapsing — note the cert is
  a single zone wildcard on one bouncer route per D-WILDCARD-DOMAIN, not per-brand
  provisioning). No invented cron cadence and no second copy of the smoke suite.

---

## 4. Test-data strategy

A single idempotent seed script, **`workers/sprout/scripts/seed.ts`**, shared by
browser specs (§2.4), smoke setup (§3), and unit fixtures (§1.3) so names never
drift across tiers. It seeds:

- **Two demo brands** (orgs in guestlist + `org_brand_directory` mirror +
  `brand_theme` + `portal_config` in the sprout D1), e.g. **`mtlcannabis`** (full skin: logo,
  forest theme JSON, all six sections enabled, hero slides, banners) and a second
  contrasting brand **`litelabel`** (different theme tokens → drives the
  visual-regression diff and the cross-tenant isolation test). Both have a
  **draft** and a **live** `brand_theme` so the theme Draft→Live journey (§2.2 #9) and
  the resolver draft/live unit test (§1.1) have data.
- **Budtenders** — per brand, a set with stable handles (e.g. **alice**, **bob**,
  **carol** — matching the demo handles preserved across the build queue, per
  project memory) so two-context real-time tests have known actors; plus a
  **brand admin** (org `owner`/`admin` role) and a **platform admin**
  (`isAdminRole`) for the admin/sprout-admin journeys.
- **Content** sufficient to exercise every section: a few `products`
  (incl. a `Limited` with `available_note`), a `deck` with a **real PDF blob in
  R2** (so page-count/thumbnail derive runs), assets (one `physical_available`),
  a `quiz` covering all five question types (one `cert_name`), a feed `post` with
  media, an open `chat_room`, published `availability_windows`, an
  `education_award` for the current period, and a few `analytics_events` so the
  Hub leaderboard + dashboards have numbers.
- **Pre-verified** test users (email-verification bypass, CLAUDE.md) so sign-in
  works without `RESEND_API_KEY` locally.

Seeding writes only to the two demo org ids; teardown deletes exactly those (no
risk to other tenants). The script is **idempotent** (upsert by stable ids /
slugs) so reruns and CI are safe.

---

## 5. CI integration (the RWX gate)

- **Unit tier is the gate's `test-sprout` task.** The RWX gate carries one
  `test-<pkg>` task per package (`captain run greenroom-<pkg>`, `.rwx/ci.yml`);
  Sprout's `test-sprout` (already present, filtered on `workers/sprout/**`) runs
  `workers/sprout`'s vitest suites on its **own machine**, which satisfies the
  workers-pool serial constraint (§1.5) by isolation rather than a shared serial
  loop. The paired `typecheck-sprout` task runs `bun run typecheck` (tsgo,
  authoritative). A genuinely new worker adds its own `typecheck-<pkg>` +
  `test-<pkg>` pair; Sprout's is already wired.
- **Browser + smoke are NOT in the gate** — they drive a _running_ worker, not
  the miniflare unit pool:
  - **Browser** → the **e2e Playwright suite** (`e2e/`, `bun run test:e2e`, §2).
    It is **manual only** today — not wired into the RWX gate
    (`docs/browser-automation.md`) — so it never slows the per-PR gate. Boot
    `workers/sprout` (portless/wrangler dev), `bun run seed`, then `playwright
test`.
  - **Smoke** → the shared **`scripts/smoke-test.sh`** run by the RWX deploy
    lanes (§3.2), strictly **after** deploy. Smoke is post-deploy by definition;
    it never runs in the gate (there's nothing deployed to smoke at gate time).

---

## 6. How the three tiers divide the work

No invented test-pyramid proportions and no coverage gates — the CI `test` job
carries no coverage tooling, so a percentage could never fail a build (§1.4).
Each tier owns the failures only it can catch:

- **UNIT** (the bulk; idiom B node + idiom A workers-pool per §0). The only tier
  that can exhaustively cover the decision matrices (policy/authz), the math
  (scoring/grading/CSV/`deck.derive` page-count), and the tenant-isolation
  invariant (`brand_id` from principal, never input — write **and** read side).
  The verification gate that must stay green.
- **BROWSER.** Reserved for what _only_ a real browser proves: the
  no-routing/scroll-restore layer system, **two-context real-time** against the
  single `GroupChatRoom` (both keyspaces), the Draft→Live skin flip, booking-only
  escalation (no "Start Call Now"), the brand-leaderboard panel in the Quizzes
  layer, the keyboard reorder baseline, the `/admin/analytics` mount, and
  per-brand visual regression with a bounded override set. Few but high-value; do
  not push unit-coverable logic up here.
- **SMOKE.** A thin post-deploy liveness band — enough to prove the deployed
  topology (app + guestlist/roadie bindings + the build-time `PROMOTER` binding
  assertion + brand-config + the `GroupChatRoom` `session.init` frame) is wired,
  no more.

This keeps the **serial vitest-pool-workers gate** fast and green (the union of
the per-package `typecheck-<pkg>` + `test-<pkg>` tasks is the authoritative gate,
`.rwx/ci.yml`), keeps the slow real-browser work manual/off-gate, and treats
post-deploy smoke as a deploy gate rather than a CI gate.

---

## 7. Settled decisions

These were the framed-as-open items; all are now decided.

- **Browser job placement.** The browser job is **gated on PRs touching
  `workers/sprout/**`** (keeps PR wall-clock down), with the **full set on `main`\*\*.
  Rationale: feedback speed on unrelated PRs without losing main-branch coverage.
- **DO test surface = one class, two keyspaces.** There is exactly **one**
  `GroupChatRoom` class (D-DO-TOPOLOGY); the DO unit tests drive **both**
  `idFromName` keyspaces against it — `idFromName(brandId)` (group chat) and
  ``idFromName(`${brandId}:${postId}`)`` (feed comments) — **not** two classes.
  `MediaFeedRoom` is only a documented future `tag:'v2'` escape hatch, never
  exercised in v1. Rationale: a brand room and a post-comment room are the same
  shape, so a second class would duplicate code for zero behavioural gain.
- **Smoke against prod.** The same shared `scripts/smoke-test.sh` runs against the
  prod apex from the production lanes (`.rwx/release-please.yml` /
  `.rwx/release.yml`), just parameterised with the prod URL. The
  `*.sproutportal.ca` wildcard is a **single zone wildcard cert on one bouncer
  route** (D-WILDCARD-DOMAIN), not per-brand provisioning, so no per-brand smoke
  setup. Rationale: the prod pipeline and wildcard cert are concrete provisioning
  tasks (see Implementation Prerequisites), not design unknowns.
- **Visual-regression baselines.** Commit PNG baselines **in-repo** for the **two
  fixed demo brands only** — never per-onboarded-brand (so baselines don't grow
  with tenancy). Rationale: only the two demo brands have deterministic seeded
  skins; onboarded brands are runtime data, not test fixtures.
- **Standing uptime monitoring** is an **ops concern**, not a test artifact:
  **Cloudflare Health Checks** against the apex + one brand portal as a pre-GA
  prerequisite (§3.3). Rationale: no second copy of the smoke suite and no invented
  cron cadence — health checks are the supported standing-uptime primitive.
- **Email in smoke/browser.** Rely on the **pre-verified-user seed bypass** (no
  `RESEND_API_KEY` gating the suite) and cover the in-platform
  contact→notification loop at the **D1 layer** instead of through promoter.
  Rationale: deterministic, no third-party email dependency in CI; the promoter
  send path is already idempotency-keyed and covered separately (05 §7.3).

## 8. Implementation Prerequisites

- **No new production CI file to author** — production ships on
  `.rwx/release-please.yml` (a Release-PR merge cuts `<worker>-v*` tags and ships
  the released subset, `db:migrate:production`→leaf→apps incl. `sprout`→`bouncer`,
  then smoke). Sprout only needs its release-please component registered
  (`release-please-config.json` + `.release-please-manifest.json`) and its place
  in the canonical deploy order (07 §6).
- Add **`sproutportal.ca` as a Cloudflare zone** and order/enable a
  `*.sproutportal.ca` wildcard TLS cert (Total TLS / ACM), then confirm the
  wildcard `custom_domain` route binds on the bouncer worker — required before the
  first staging brand subdomain and the staging smoke run (D-WILDCARD-DOMAIN).
- Add the brand/budtender identity constants (slugs, handles, ids for the two demo
  brands) to a single **`workers/sprout/__tests__/demo-constants.ts`** imported by
  both `__tests__/fixtures.ts` and `scripts/seed.ts` so names never drift
  (D-SMOKE-RECONCILE).
- Enable the **Browser Rendering** binding (`BROWSER`) on the account and add it to
  the sprout `wrangler.jsonc` alongside `AI`/`VECTORIZE` — required for the
  `deck.derive` thumbnail derive that the §1.1 PDF test asserts (D-PDF-RENDERER).
- Set the `vars.SPROUT_SMOKE_BRAND_HOST` / `secrets.SPROUT_SMOKE_USER` repo
  variables the smoke job reads, and seed the dedicated pre-verified smoke user.
