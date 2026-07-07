# 06b — Browser-Test Scaffolding: making the deep-flow Playwright suite runnable

> **Scope.** A companion to [06 §2 (BROWSER)](./06-testing-strategy.md#2-browser-playwright).
> 06 §2 _designs_ the Playwright suite — it fixes the runner, lists the 12
> canonical deep-flow journeys (06 §2.2), and settles auth/host/visual strategy.
> This doc is the **gap analysis + scaffolding plan**: what must be built before
> those 12 journeys can actually run as **deep interaction flows** (not smoke), the
> state on disk **today** (on `main`), and the order to build it in. Every "exists
> today" claim is cited to `path:line` and was read off disk against `main`; every
> "intended" claim traces to docs 02–08.
>
> **Reconciled with the existing seed infra.** Unlike an earlier draft, this
> version is grounded in what `main` already provides: `workers/guestlist`'s
> `scripts/seed.ts` (+ `seed-users.ts`) **already seeds users, orgs, and
> memberships** (run via `bun run seed`), and
> `workers/sprout/scripts/seed.ts` **already links the two demo brands to the
> real guestlist orgs (by slug) + seeds hero slides**. The remaining gap is
> **domain content + the Playwright harness + three per-journey seams** — not a
> seed rewrite, and _not_ an org-id reconciliation problem (that is already solved
> by reading the real org id by slug).
>
> **Decisions locked for this suite:**
>
> - **Runner:** Playwright (06 §2.1, settled).
> - **Depth:** deep interaction flows end-to-end, not journey-smoke.
> - **Stack boot:** **pinned host + port** — run `dev:bare` on a fixed `PORT`;
>   brand portals are `https://<slug>.sprout.sproutportal.localhost`, the Hub apex
>   is `https://sprout.sproutportal.localhost`. We do **not** depend on portless's
>   branch-prefixed `PORTLESS_URL` (unknowable in CI; Determinism #8).

---

## 0. The headline finding

The suite design is done, and the **auth/data foundation already exists** — what's
missing is content + the harness. Mapping all 12 journeys against the code on
`main` found:

- **The org/user/membership foundation is already seeded.**
  `workers/guestlist/scripts/seed.ts` (via `seed-users.ts`) signs up `super@user.com`
  (platform admin), `alice@example.com`, `bob@example.com`, `dave@example.com`
  (all pre-verified — `seed-users.ts:116` sets `email_verified=1`), creates orgs
  `acme` + `beta` (`INSERT OR IGNORE`, real ids resolved by slug), and writes
  memberships: **alice = acme `admin`**, **bob = acme `member`**, **dave = beta
  `admin`**. `workers/sprout/scripts/seed.ts` then **re-keys the two demo brands
  onto those real org ids by slug** and seeds `brand_theme` + `portal_config` + 3 `hero_slides` each
  (self-contained gradient data-URIs, no R2). So sign-in, host→brand skinning, the
  brand-admin role, two same-brand distinct-role users (alice admin + bob member),
  and the rotating hero **already have data**.
- **The real remaining gap is domain content** — products, decks (with a real
  PDF), quizzes, assets, feed posts, chat rooms, availability windows, education
  awards, leaderboard scores, analytics events. The seed touches none of these
  yet. This is the dominant blocker for the content-dependent journeys (J3–J8, J10).
- **sprout has no sign-in form of its own.** The real form lives in `workers/identity`;
  sprout's auth middleware throws `redirect({ href: "/sign-in" })` to a route that
  doesn't exist in sprout's tree (`src/lib/middleware/auth.ts:26`). The Playwright
  `global-setup` must authenticate by driving the **guestlist API** (same-origin
  `/api` proxy) and **verify the cookie jar carries `sprout.session_token`** before
  trusting it.
- **Binding-usage note.** 06 §8 / 00 (prereq 6) list `AI`/`VECTORIZE`/`BROWSER` as
  bindings that "must be added." They are **already wired**
  (`wrangler.jsonc:74-106`) and are **remote-only ≠ inert**: with
  `remote: true` + `wrangler login` + `CF_ACCOUNT_ID`, `vite dev` runs the **real**
  Workers AI / Vectorize / Browser Rendering locally — the template comment says so
  (`:76-79`), and it's already the platform pattern (commit `31b8914`). So J8 runs
  against **real AI** in tests (§2.1); the `OFFLINE_ANSWER` guard (`ai.ts:33,60`) is
  the _unprovisioned / not-logged-in_ fallback, not the normal local state.

Net: build a **content-seed pass** + the **Playwright harness** + **three
per-journey seams**, and the suite covers all 12 journeys. The auth/org plumbing is
reuse, not new work.

---

## 1. Journey readiness matrix (today, on `main`)

The 12 journeys are 06 §2.2's numbering. "Needs harness" = the data exists; only the
Playwright scaffolding (Layer 1) is missing. "Needs content" = also needs a seed-row
pass (Layer 0). Demo actors: **alice** (acme admin), **bob** (acme member /
budtender), **dave** (beta admin), **super** (platform admin).

| #   | Journey (06 §2.2)                                 | PDF / INV           | Status           | What's actually missing                                                                                                                                                        |
| --- | ------------------------------------------------- | ------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| J1  | Sign-in via guestlist → enter portal              | Landing / —         | 🟡 needs harness | Users + orgs + memberships + pre-verify already seeded. Only the `global-setup` guestlist login + storageState is missing (sign-in is cross-origin via the `/api` proxy).      |
| J2  | Open each section layer + close restores scroll   | §03 / INV-7         | 🟡 needs content | `live_sections_json='[]'` hits the all-six fallback, so the grid shows; needs harness + enough seeded content for a non-zero `scrollY` to make the restore assertion real.     |
| J3  | Submit a review (admin DELETE-only, no edit/hide) | Drop Sheet / INV-3  | 🔴 needs content | Zero products → `DropSheet` renders null. Roles exist (alice admin can delete, bob authors). Needs a published product + ≥1 pre-existing review.                               |
| J4  | Flip a PK deck + flip-depth recorded              | PK Decks / INV-11   | 🔴 needs content | `getDeckReadUrl` returns `{url:null}` until a deck has a real PDF reachable via roadie/R2 (`decks.functions.ts:146-173`). Needs a seeded deck w/ real PDF (verify R2 path).    |
| J5  | Take a quiz (5 types) + cert + brand leaderboard  | Quizzes / —         | 🔴 needs content | No quiz/questions/options; no `user_brand_scores` so the Leaderboard tab has no contrasting data. Needs a 5-type cert quiz + scores for acme & beta.                           |
| J6  | Feed comment real-time across **two** contexts    | Media Feed / INV-13 | 🔴 needs content | Roles **solved**: Context A = bob (member), Context B = alice (admin → Team marker), both on acme. Needs a seeded feed post (both contexts share it) + a WS-ready seam (§2.3). |
| J7  | Request physical asset → admin fulfils → status   | Store Assets/INV-10 | 🔴 needs content | No asset with `physical_available=1` → the button never renders. Roles exist (bob requests, alice fulfils). Needs a published physical asset.                                  |
| J8  | AI ask → booking (RAG → escalate → slot picker)   | AI+Booking / INV-2  | 🔴 needs content | Needs `AI` as a remote binding (real Workers AI, §2.1) + seeded `availability_windows` (else `listSlots` empty) + a product to ground on. No `BOOK_A_CALL` offline.            |
| J9  | Brand-admin setup live-preview Draft→Live         | Brand Admin/INV-5   | 🟡 needs content | alice is acme `admin` so `assertBrandAdmin` passes. Seed writes `live_theme===draft_theme`, so "public still old after save" isn't observable until the test sets a new draft. |
| J10 | Hub leaderboard + Education Award                 | Hub / INV-1         | 🔴 needs content | Nothing the Hub reads is seeded — no `user_brand_scores`, no `education_award`. `callerBrands()` resolves (memberships exist) but renders empty. Needs scores + award rows.    |
| J11 | Admin analytics mounts without crashing           | Analytics / —       | 🟡 needs content | alice admin → mounts; but it "mounts" even when reads return empty, so the assertion is hollow. Real chart path needs `analytics_events`/attempts/reviews/decks content.       |
| J12 | Keyboard reorder hero slides (a11y baseline)      | Brand Admin / —     | 🟡 needs harness | alice admin + **hero_slides already seeded** (3 per brand, `scripts/seed.ts`). Only the harness is missing; reorder via `reorderHeroSlides` has real rows to move.             |

**Reading it:** the foundation lift the earlier draft assumed is **already done**.
J1 and J12 need only the harness; J9/J11 need only a small seed tweak / content;
J6's two-role requirement is satisfied by alice+bob on acme. The genuine remaining
work is a **content seed pass** (J2–J8, J10) and the **three hard seams** (J4 PDF,
J8 AI, J6 two-context WS).

---

## 2. The scaffolding inventory

Four layers. Each lists **purpose**, **build vs reuse**, and **which journeys it
unblocks**.

### Layer 0 — Content seed (the remaining data gap)

**0.1 — Add a content-seed pass** (now part of the ONE consolidated
`scripts/seed.ts`). The org/user/membership/brand-rows/hero
foundation already exists; this adds the missing **domain content** onto the
existing `acme`/`beta` orgs, idempotently and scoped to those org ids:

- `brand_theme` tweak: make `draft_theme_json.--color-primary` **≠**
  `live_theme_json.--color-primary` for J9's observable Draft→Live diff (currently
  identical, `scripts/seed.ts`); optionally write explicit `sections_json` (today
  `'[]'` → all-six fallback, fine for most journeys).
- content rows (§3): products (incl. a Limited), a deck with a **real PDF** in R2, a
  5-type cert quiz, a `physical_available` asset, feed posts + a `chat_room`, future
  `availability_windows`, current+prior `education_award`, `user_brand_scores` across
  both brands, `analytics_events` + `attempts`.
- _Reuse, not rewrite:_ the existing seed already resolves the real org id by slug
  (`scripts/seed.ts` `idByEmail`/`orgBySlug`) — keep that pattern for every new row's `brand_id`.

**0.2 — Extend `__tests__/demo-constants.ts`** (today: brands `acme`/`beta` +
hero slides, `demo-constants.ts:28-56`) with the seeded **content ids** + the
**user handles/passwords** (alice/bob/dave/super) so unit, browser, and smoke tiers
share one source of truth (06 §3.2). _Reuse the existing file._

### Layer 1 — Playwright harness (the contract every spec loads)

**1.1 — `playwright.config.ts` + `@playwright/test` dep + `browser` package
script.** `baseURL = https://acme.sprout.sproutportal.localhost`,
`ignoreHTTPSErrors:true` (portless self-signed CA), per-role projects loading
`storageState`, `snapshotPathTemplate` scoped to the two demo brands. No Playwright
exists in the repo today; `vite.config.ts:65` already admits `.sproutportal.localhost`.
_Build new. Unblocks: all 12._

**1.2 — `global-setup.ts` storageState login per role.** Sign each seeded role in
**once** via the same-origin guestlist proxy
(`POST https://<host>/api/auth/sign-in/email`, `rejectUnauthorized:false`) and save
`storageState`. The session cookie's `Domain=.sproutportal.localhost` means one state
replays across every brand subdomain **and** the apex Hub. Roles + real credentials
(from the existing seed):

- **acme admin / brand-admin + team:** `alice@example.com` / `alicepwd123`
- **acme budtender:** `bob@example.com` / `bobpwd1234`
- **beta admin (cross-tenant):** `dave@example.com` / `davepwd123`
- **platform admin:** `super@user.com` / `superuserdo`

Do **not** capture `x-platform-att` — the envelope is server-minted per-request from
the cookie by the dev stamper (`src/worker.ts`). **Verify the jar contains
`sprout.session_token`** before trusting the state (a silently-anonymous state
307-loops every gated journey). _Build new; sign-in pattern mirrors
`seed-users.ts:99-107`. Unblocks: every authed journey._

**1.3 — Multi-host baseURL helper.** Brand host = `${slug}.sprout.sproutportal.localhost`;
Hub apex = `sprout.sproutportal.localhost` (drop the slug label). Matches
`slugFromHost`'s single-label rule (`src/lib/brand.ts:93`). Used by J1 cross-tenant,
J5/J6 brand-scope, J9 two-brand, J10 apex. _Build new (trivial)._

**1.4 — Role fixtures.** A Playwright fixture per `storageState` (`acme-admin`,
`acme-budtender`, `beta-admin`, `platform-admin`) so specs declare their actor
declaratively; two-context journeys (J6) compose two fixtures in one spec via
`browser.newContext()`. _Build new. Unblocks: J3, J6, J7, J9, J11, J12._

**1.5 — DB-reset / teardown helper.** Each mutating spec (reviews J3, requests J7,
posts J6, theme J9) namespaces its data by a unique suffix so reruns are idempotent;
teardown removes the spec-created rows and resets `live_theme_json` to the seed
baseline (J9 mutates shared `brand_theme`). _Build new; reuse `d1Exec(cwd)` from
`scripts/dev-config.ts`. Do **not** delete the shared acme/beta orgs/users — they're
the persistent seed fixture._

### Layer 2 — Per-journey seams (the three hard cases)

**2.1 — AI via remote binding (J8), with an optional deterministic seam.**
_Primary:_ run the **real** Workers AI by configuring `AI` as a **remote binding**
(`remote: true` — confirm the exact key against the installed
`@cloudflare/vite-plugin`/wrangler version; some versions use
`experimental_remote: true`) plus `wrangler login` + `CF_ACCOUNT_ID`. Then `vite dev`
(and the browser test) hit real RAG + generation — already how the platform runs AI
locally (commit `31b8914`). With `AI` present, `env.AI` is non-null so the
`OFFLINE_ANSWER` guard (`ai.ts:33,60`) does **not** fire. Handle the remaining LLM
non-determinism in the assertions (Determinism #3): assert a non-empty grounded
answer renders (references a seeded product term), and drive escalation with an input
that unambiguously requests a human so the model reliably emits `BOOK_A_CALL` →
`SlotPicker` appears (tolerant wait; assert on `{escalate}` / final text + the picker
mounting, never stream frames). _Optional fallback:_ a test-flag override at the
`lib/ai.ts` `generate`/`generateStream` seam emitting fixed answers — used **only**
when CI has no Cloudflare auth or the escalation assertion proves flaky, **not** by
default. _Cost:_ the browser CI job then needs CF account auth + a provisioned
Vectorize index; gate the AI journey to skip-with-warning when auth is absent.

**2.2 — R2/PDF fixture for decks (J4).** `getDeckReadUrl` returns `{url:null}` until
a deck has a real PDF reachable via roadie/R2 (`decks.functions.ts:146-173`).
**Verify roadie's local R2 first** — whether the blob path needs a real PUT into the
local `BLOBS` bucket or roadie's R2 should itself be a `remote: true` binding (the
earlier mapping assumed "inert"; confirm before building). Either way, seed a `decks`
row with a real PDF (`pdf_ref` + `page_count>1`) and set `cover_thumb_ref`
**directly** to keep the test fast and off the Browser Rendering round-trip — note
`BROWSER` is remote-capable (same family as AI, §2.1) if you do want to exercise
`deck.derive`. Commit a small known-N-page PDF under `__tests__/fixtures/`. Mask the
thumbnail in visual tests; assert `deck_progress.last_page` + `deck_flip` existence,
never canvas pixels. _Build new; R2 pattern from `workers/roadie` helpers._

**2.3 — Two-context realtime helper + WS-ready seam (J6).** `browser.newContext()`
×2 with different `storageState` — Context A = bob (acme member), Context B = alice
(acme admin → Team marker), **same brand**. The DO (`src/room-server.ts`), `/ws/$`
route, and `usePartySocket` already exist; what's missing is a **WS-ready seam** the
test can `await` — today there's only a "Connecting…" string, so Context B can post
before A's subscription is live and the fan-out races. Add a `data-testid`/aria that
flips on `session.init`. Plus a raw-WS cross-brand helper asserting close code
`1008`. **Verify the dev-envelope stamper carries cookies on the `/ws` upgrade**, not
just HTTP — otherwise `onConnect`'s envelope verify fails and the socket `1008`s for
the wrong reason, masking real bugs. _Build new._

**2.4 — RealtimeKit mock: NONE NEEDED.** `realtime.ts` returns `{available:false}`
without `RTK_APP_ID`/`RTK_SECRET` (`realtime.ts:36,66,86`). This makes J8's
product-law assertion (no "Start Call Now" anywhere, INV-2) **easier** — assert the
`CallRoom` placeholder text, not a live call.

### Layer 3 — CI, visual regression, and the idiom-A prerequisite

**3.1 — Visual baselines (06 §2.5).** PNG snapshots of `_portal/home` for the two
demo brands; assert the screenshots **differ** and each matches its baseline; assert
`--color-primary`/`--color-background` differ but `--color-stigma` (fixed `danger`)
is identical (the bounded-override invariant, 00 / 02 §1). The two contrasting themes
already exist (`demo-constants.ts`: acme forest vs beta purple) and hero art is
already seeded. Requires a **mask list**: `Countdown`, `NotificationBell` poll badge,
"N online", relative timestamps, `RotatingHero` auto-advance (disable under test),
deck thumbnails. _Build new; baselines committed under `__tests__/e2e/__screenshots__`._

**3.2 — idiom-A vitest-pool-workers harness (prerequisite groundwork).**
`vite.config.ts`'s test block is **node-only** (`environment:"node"`, no
`cloudflareTest`, `vite.config.ts:78-82`). Add a second project:
`cloudflareTest({ wrangler:{ configPath:"./wrangler.jsonc" } })` + `readD1Migrations`

- `r2Buckets:["BLOBS"]` + an `apply-migrations.ts` setup file. This proves the
  migrations the **content seed depends on** actually apply into miniflare, and drives
  the `GroupChatRoom` `onConnect` 1008 gate across **both** `idFromName` keyspaces —
  currently the DO gate is **faked** as a static source scan
  (`__tests__/compliance/tenancy.test.ts`). \*Copy `workers/roadie/vite.config.ts:23-41`
- its `apply-migrations.ts`. Can proceed in parallel from step 1.\*

**3.3 — CI wiring.**

- **Browser (e2e Playwright)** is **manual only** today — `bun run test:e2e`, not
  wired into the RWX gate (`docs/browser-automation.md`, 06 §5). It installs
  Playwright browsers, runs `bun run bootstrap` + `bun run seed` + the content
  seed, boots `dev:bare` on the fixed port, then `playwright test`. If it were
  ever gated it would be its own RWX task **off** the serial workers-pool tasks
  (parallel to `typecheck-<pkg>`/`test-<pkg>`), path-filtered to
  `workers/sprout/**`.
- **Smoke** already runs post-deploy: the shared `scripts/smoke-test.sh` is the
  final step of each RWX deploy lane (`.rwx/promote-staging.yml` for staging),
  after the ordered fleet deploy (sprout included — the staging lane ships every
  changed worker, not just guestlist + roadie). Deeper read-only probes incl. the
  DO `session.init` frame live in the e2e suite (06 §3), not the apex smoke.
- **No `deploy-production.yml` to author** — production ships on
  `.rwx/release-please.yml` (06 §5, 07 §6).

---

## 3. Consolidated seed requirements

Split by **already seeded on `main`** vs **still needed**. Everything still-needed
binds to the real `acme`/`beta` org ids (resolved by slug, as the existing seed does),
is idempotent, and is removed by per-spec teardown — **never** delete the shared
orgs/users.

### Already seeded (reuse as-is)

- **guestlist orgs:** `acme`, `beta` (`seed.ts`, real ids resolved by slug).
- **guestlist users, pre-verified:** `super@user.com` (platform admin),
  `alice@example.com`, `bob@example.com`, `dave@example.com` (`email_verified=1`).
- **guestlist memberships, single each** (so `activeOrganizationId` auto-stamps —
  Determinism #2): alice→acme `admin`, bob→acme `member`, dave→beta `admin`.
- **sprout `brand_theme` + `portal_config`:** acme + beta, linked to the real org ids.
- **sprout `hero_slides`:** 3 per brand (gradient data-URIs) — J12 + visual already
  have rows.

### Still needed (the content-seed pass, Layer 0)

1. **`brand_theme` tweak:** `draft_theme` primary **≠** `live_theme` primary (J9);
   optionally explicit `live_sections_json`/`draft_sections_json` (today `'[]'`).
2. **products:** several published on `acme` (Flower/Pre-Roll/Infused/Hash + one
   **Limited** with `available_note`; one with `deck_id` → the seeded deck); one on
   `beta` for the cross-tenant negative. (J3, DropSheet, J8 grounding.)
3. **reviews:** 1–2 pre-existing on the J3 target product by **other** users
   (distinct `user_id`/`authorName`/`store`/`rating`) so average/count are non-trivial.
4. **decks:** one published on `acme` with a **real PDF blob** in local R2 +
   `pdf_ref` + `page_count>1` + non-null `cover_thumb_ref` set directly (§2.2);
   `deck_progress` empty. Commit a small known-N-page PDF fixture.
5. **quiz:** one published on `acme`, `on_leaderboard=1`, `cert_name` set,
   `pass_threshold` set, questions covering **all five** types (multiple_choice,
   select_all w/ weights, true_false, image, matching w/ `config_json`) + options.
   `shuffle_questions=0` (or drive answers by label — Determinism #6).
6. **assets:** ≥1 published non-archived on `acme` with `physical_available=1` +
   `physical_max_qty` (J7).
7. **feed:** ≥1 post on `acme` (deterministic id) shared by both J6 contexts; a
   pre-existing comment for non-empty `session.init` history; ideally ≥9 posts
   (> `PAGE_SIZE` 8) so the J6 scroll-restore offset is non-zero.
8. **chat_rooms:** one row per brand (UNIQUE `brand_id`) so `idFromName(brandId)` has
   a durable room.
9. **availability_windows:** ≥1 published `is_group=0` **future** window on `acme`
   spanning ≥2 `slot_minutes` chunks (J8 slot picker + vanish), relative to
   `Date.now()`; optionally an `is_group=1` window + `group_sessions`.
10. **education_award:** a **current**-period row for `acme` (fund language, `closes_at`
    future) **and** a **prior closed**-period row with `winner_user_id`/`winner_name`
    (J10).
11. **user_brand_scores:** **current**-period rows for a few users across **both**
    `acme` and `beta`, varied scores + distinct `computed_at` (J5 brand-scope + J10 +
    own-rank-outside-top-N); plus a prior-closed-period row. Period from the **same
    clock** (Determinism #5).
12. **analytics_events + attempts:** a handful (deck_open/flip/download, product_view,
    `ai_question` incl. one unanswered, banner/feed/quiz events) on `acme` so J11
    dashboards + CSV have data; `attempts` + `attempt_answers` with a
    consistently-wrong question for most-missed.

---

## 4. Determinism strategy

Each known flakiness source and its neutralizer (grounded to disk where load-bearing):

| #   | Risk                                                                                                                                                                                                                          | Neutralizer                                                                                                                                                                                                                                                                             |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Org binding — already correct, keep it.** Both the guestlist seed and the sprout seed resolve the real org id **by slug** (both `seed.ts` files use `orgBySlug`); host→brand and `getActiveMemberRole` key off the same id. | Reuse the read-by-slug pattern for **every** new content row's `brand_id`; do **not** hardcode a synthetic `org_demo_*` id. This is what makes gated reads resolve instead of silently 403'ing.                                                                                         |
| 2   | **Single-vs-multi membership** — BA auto-stamps `activeOrganizationId` only when a user has **exactly one** membership (`seed.ts` comment). The seed already gives each user one membership.                                  | Keep it. For cross-tenant negatives use the distinct single-membership users (bob/acme vs dave/beta). The Hub platform-sum (J10) is then per-single-brand — assert that, or switch org explicitly rather than seeding a dual-membership user.                                           |
| 3   | **AI non-determinism** — with `AI` as a remote binding the real LLM runs, but its free-text output isn't guaranteed to emit `BOOK_A_CALL`.                                                                                    | Assert tolerantly: a non-empty grounded answer renders; drive escalation with an unambiguous "talk to a human" input; assert on `{escalate}`/final text + the `SlotPicker` mounting, never stream frames. Optional deterministic seam override only as a CF-offline CI fallback (§2.1). |
| 4   | **Deck R2 availability** — `getDeckReadUrl` → `{url:null}` until a deck has a real PDF reachable via roadie/R2 (`decks.functions.ts:146-173`).                                                                                | **Verify roadie's local R2** (real PUT vs `remote:true`), then seed the deck **pre-derived** (real PDF, `page_count>1`, `cover_thumb_ref` direct — keeps the test off the Browser Rendering round-trip); mask the thumbnail; assert `deck_progress`/`deck_flip`, never pixels.          |
| 5   | **Time / period sensitivity** — period from `Date.now()`; `availability_windows` are future-only; `Countdown` ticks; timestamps relative.                                                                                     | Compute the seed period from the same clock; seed windows relative to seed-time `Date.now()`; mask Countdown/relative-time/"N online"/poll badge in snapshots.                                                                                                                          |
| 6   | **Quiz shuffle** — `shuffle_questions` + per-attempt `Math.random` seed randomises order.                                                                                                                                     | Seed `shuffle_questions=0` **or** drive answers by accessible **label text**, never index; seed answers clearly above `pass_threshold` to avoid rounding-boundary flake.                                                                                                                |
| 7   | **Debounced / fire-and-forget writes** — `recordFlipDepth` flushes ~1.2s after last flip or on close; comment fan-out is best-effort post-commit.                                                                             | Flip-then-close (or wait >1.2s) before asserting; for realtime use `expect.poll`/auto-wait; wait for A's `session.init` before B posts.                                                                                                                                                 |
| 8   | **`PORTLESS_URL` branch-prefixed** and surfaced only to `vite.config.ts:27-29`; unknowable in CI.                                                                                                                             | **Pin** host+port (`dev:bare` on a fixed `PORT`; brand host `<slug>.sprout.sproutportal.localhost`) — the locked decision.                                                                                                                                                              |
| 9   | **TLS** — brand subdomains serve over portless's local CA.                                                                                                                                                                    | `ignoreHTTPSErrors:true` and/or `NODE_EXTRA_CA_CERTS=~/.portless/ca.pem` on the runner (precedent `dev-config.ts`, `seed-users.ts:77-79`).                                                                                                                                              |
| 10  | **Rotating hero (6s) + banner IntersectionObserver** run continuously in the persistent shell and fire writes.                                                                                                                | Disable hero auto-advance under test (reduce-motion / test flag); treat impression writes as harmless noise; assert on stable text.                                                                                                                                                     |

---

## 5. Build order

The auth/org foundation already exists, so the path is shorter than a from-scratch
seed. The idiom-A harness (step 8) can run in parallel from step 1.

0. **Boot verification.** `bun run bootstrap` (`.dev.vars` only) → `bun run seed`
   (seeds guestlist users/orgs/memberships + the sprout demo brands/hero) →
   `cd workers/sprout && bun run dev`; hit
   `https://acme.sprout.sproutportal.localhost` signed-in and confirm the themed
   portal + carousel render (commit `b6e738a` claims this; verify).
1. **Content-seed pass** (Layer 0): extend the seed with the §3 still-needed rows on
   the existing `acme`/`beta` orgs + the `draft≠live` theme tweak; extend
   `demo-constants.ts` with content ids + user creds.
2. **Harness** (Layer 1): `playwright.config.ts` + dep + `global-setup` storageState
   (guestlist login, verify `sprout.session_token`) + multi-host helper + role
   fixtures + `ignoreHTTPSErrors`.
3. **J1 + J12 + J11 + J2** — least-blocked: J1/J12 need only the harness (data + hero
   already seeded); J11/J2 add light content.
4. **J9 + J10 + J7** — small seed tweaks (draft≠live theme; scores+award; physical
   asset); roles already exist.
5. **J3 + J5** — richer content seed + a label-driven quiz-answer helper.
6. **AI remote binding → J8** (config + `availability_windows`/qa seed).
7. **R2/PDF fixture → J4** (the hardest single binding blocker).
8. **idiom-A vitest-pool-workers harness** (DO 1008 gate + migration round-trip) —
   parallelisable from step 1.
9. **Two-context realtime helper + WS-ready seam → J6** (signature, hardest
   determinism case; roles already solved).
10. **Visual baselines** (acme + beta) + mask list, once `_portal/home` is content-stable.
11. **CI:** none required for deploy — the RWX staging lane
    (`.rwx/promote-staging.yml`) already ships + migrates sprout, and
    `scripts/smoke-test.sh` already smokes the apex; the browser e2e suite stays
    manual (`bun run test:e2e`), and production is `.rwx/release-please.yml`.

---

## 6. Decisions

**Locked:** Playwright runner (06 §2.1) · deep-flow depth · pinned host+port boot
(brand `<slug>.sprout.sproutportal.localhost`, Hub `sprout.sproutportal.localhost`) ·
**AI run against the real Workers AI via `remote: true`** (deterministic `lib/ai.ts`
seam override only as a CF-offline CI fallback) · deck PDF seeded pre-derived
(thumbnail set directly) · RealtimeKit left inert (no mock) · **reuse the existing
guestlist+sprout-seed foundation** (acme/beta orgs, alice/bob/dave/super users,
single-membership, org id resolved by slug) — extend with content, don't rewrite.

**Open (worth a call before/while building):**

- **Browser CI auth:** the AI/Vectorize/Browser journeys run against real remote
  bindings, so the `main` browser job needs Cloudflare auth (`wrangler login` token +
  `CF_ACCOUNT_ID`) + a provisioned Vectorize index. Recommend: real bindings on
  `main`; the deterministic `lib/ai.ts` seam fallback on fork PRs without secrets, so
  the AI journey skips-with-warning rather than hard-failing.
- **Sign-in transport for `global-setup`:** drive the guestlist `/api` proxy directly
  (faster, deterministic) **vs** drive the identity UI (higher fidelity to the real
  cross-app hop). Recommend the API; keep one UI-driven login spec as a fidelity check.
- **Where the content seed runs:** fold into `bun run seed` vs a
  dedicated `seed:e2e` script. Recommend a dedicated script so browser content never
  bloats the base demo seed.

---

## 7. Biggest risks

1. **The content seed is the dominant remaining blocker** (J2–J8, J10). The
   auth/org/user/membership foundation is done, but until the §3 content rows land,
   those journeys have nothing to drive. This work can't be parallelised away.
2. **Cross-app sign-in:** sprout has no sign-in form (`middleware/auth.ts:26`
   redirects to a non-existent `/sign-in`). `global-setup` must auth via guestlist and
   **verify the captured jar contains `sprout.session_token`** — a silently-anonymous
   state 307-loops every gated journey.
3. **J4 (deck) and J8 (AI)** depend on remote-capable substrates. J8 runs **real**
   Workers AI via a `remote: true` binding (CF auth required in CI; non-deterministic
   output handled in the assertions, §2.1). J4 needs a real PDF reachable via
   roadie/R2 — **verify roadie's local R2 behavior before assuming a seam is needed**.
   If under-scoped, both can ship "green" while never actually exercised.
4. **J6 WS path:** depends on the dev-envelope stamper carrying cookies on the `/ws`
   **upgrade** (not just HTTP) **and** a WS-ready seam that doesn't exist yet (only a
   "Connecting…" string). If the stamper drops cookies on upgrade, `onConnect` 1008s
   for the wrong reason.
5. **No idiom-A infra exists** (`vite.config.ts` is node-only) and the DO 1008 gate +
   migration round-trip are currently **faked** as static scans
   (`compliance/tenancy.test.ts`). The content seed/teardown and DO journeys build on
   a miniflare-binding substrate this app has never actually exercised.
6. **Spec drift + binding usage:** 06 §8 / 00 say AI/VECTORIZE/BROWSER "must be added"
   but they are already wired (`wrangler.jsonc:74-106`) and are
   **remote-capable, not inert** — usable locally via `remote: true` + `wrangler login`
   (commit `31b8914`). The real work is provisioning + the `remote: true` config, and
   giving the browser e2e runner CF auth (for the remote `AI`/`VECTORIZE`/`BROWSER` bindings).
7. **Browser e2e is off the gate.** The RWX staging lane already deploys +
   migrates sprout (`.rwx/promote-staging.yml`) and `scripts/smoke-test.sh` smokes
   the apex, but the browser e2e suite is **manual only** (`bun run test:e2e`, 06
   §5) — so a green local browser run isn't enforced in CI; it's a developer-run
   check, not a gate.

---

## 8. Verified on-disk facts (grounding)

Read off disk against `main`; these anchor the claims above.

- `workers/guestlist/scripts/seed.ts` (+ `seed-users.ts`) — seeds users
  `super`/`alice`/`bob`/`dave` via BA sign-up, orgs `acme`/`beta`
  (`INSERT OR IGNORE`, ids resolved by slug via `orgBySlug`), and **org**
  memberships alice→acme `admin`, dave→beta `admin` only. **bob is intentionally
  not an org member** — he's a budtender (sprout `portal_members`), and the seed
  even `DELETE`s any stray bob org membership (`seed.ts:115-118`). The comment
  confirms BA auto-sets `activeOrganizationId` for single-membership users.
- `workers/guestlist/scripts/seed-users.ts:99-107,116` — sign-up POST pattern +
  `UPDATE user SET role=…, email_verified=1` (pre-verify; the auth-seed precedent).
- `workers/sprout/scripts/seed.ts` — re-keys the two demo brands onto the real
  guestlist org ids **by slug** (`orgBySlug`), seeds `brand_theme` + `portal_config`
  (`live_theme===draft_theme`, `live_sections_json='[]'`) + 3 `hero_slides` per brand
  (gradient data-URIs); deletes prior `org_demo_*` rows.
- `workers/sprout/__tests__/demo-constants.ts:28-56` — brands `acme` (Acme Cannabis,
  forest) + `beta` (Beta Greens, purple), each with `orgId = slug` and `heroSlides`.
- `workers/sprout/src/lib/brand.ts:71-100` — `APEX_DOMAINS`
  (`sprout.sproutportal.{ca,localhost}`, `sproutportal.{ca,localhost}`) + `slugFromHost`
  single-label extraction → brand host is `<slug>.sprout.sproutportal.localhost`, Hub
  apex is `sprout.sproutportal.localhost`.
- `workers/sprout/wrangler.jsonc:39-106` — `GROUP_CHAT_ROOM` DO, `AI`,
  `VECTORIZE`, `BROWSER`, `GUESTLIST`, `ROADIE`, `PROMOTER` **all present**; comment
  at `:74-81` states AI/Vectorize/Browser are remote-only bindings that `vite dev`
  **runs over a Cloudflare remote-proxy session** (needs `wrangler login` + a selected
  `CF_ACCOUNT_ID`) — usable locally, **not inert**.
- git log `31b8914` — "local dev runs the remote bindings — set account_id": the
  platform already relies on remote bindings in local dev.
- `workers/sprout/src/lib/decks.functions.ts:146-173` — `getDeckReadUrl` returns
  `{url:null}` when the deck has no reachable PDF / roadie call fails.
- `workers/sprout/src/lib/ai.ts:33,43-44,60` — `OFFLINE_ANSWER` returned **only** when
  `getAi()` finds no `AI` binding (unprovisioned / not logged in); with `AI` present
  the real model runs.
- `workers/sprout/src/lib/realtime.ts:36,66,86` — returns `{available:false}` without
  `RTK_APP_ID`/`RTK_SECRET`.
- `workers/sprout/src/lib/middleware/auth.ts:26` — `throw redirect({ href: "/sign-in" })`
  to a route absent from sprout's tree.
- `workers/sprout/vite.config.ts:65,78-82` — `allowedHosts:[".sproutportal.localhost"]`;
  test block is `environment:"node"`, no `cloudflareTest` (idiom-A absent).
- `workers/roadie/vite.config.ts:23-41` — the `cloudflareTest` + `readD1Migrations`
  block to copy for idiom-A.
