# 09 — Delivery Roadmap & Cadence

> **Scope.** This document sequences the spec's seven build phases (P1…P7) into
> concrete engineering work for the **one-app** architecture defined in
> [`01-architecture.md`](./01-architecture.md), [`02-data-model.md`](./02-data-model.md),
> and [`03-app-structure.md`](./03-app-structure.md). Every deliverable ties to a
> real table, route, server-fn module, or component named in those docs. Sizing is
> **relative, not date-bound**; "ships dark" vs "ships live" is governed by the
> per-org `brand_config` section toggles + continuous-deploy-to-staging.
>
> The target app is `workers/sprout` (package `@greenroom/sprout-app`, worker
> `sprout-sprout` → `sprout-sprout`, service binding `SPROUT`, D1
> token `D1_SPROUT`, URL var `SPROUT_URL`, in-worker D1 binding `DB`, caller
> `"sprout"`). Quizzes and group chat ship as sprout-native sections (§7 covers
> how each was consolidated into sprout's own schema and worker).
> These wire identifiers are pinned canonically in [`07-deployment.md` §1.1](./07-deployment.md);
> 09/03/05's generic `*_JOBS_QUEUE` resolves to `SPROUT_JOBS_QUEUE`, the DO
> class is `GroupChatRoom` (binding `GROUP_CHAT_ROOM`).

---

## 0. How to read this roadmap

- **Epics → tasks.** Each phase is a small set of epics; each epic lists tasks
  bound to the foundation docs' artifacts (tables from §02, routes/components
  from §03, server-fn modules from §03's table, contracts from §01).
- **Exit criteria** are observable, not "feels done": a smoke path through the
  real stack (host → brand-config → shell → server fn → D1 → roadie/promoter/DO).
- **Deployment mode per phase.** Everything lands on **staging continuously**
  (CD in `.rwx/promote-staging.yml`); whether a surface is _visible to a budtender_ is
  controlled by the `brand_config.live_sections_json` toggle (six section keys:
  `assets | decks | quizzes | feed | chat | contact` — the same enum is used 1:1
  for both `live_sections_json` and the `?section=` param, no mapping table) plus
  the Draft→Live `brand_config.state` flip. So a half-built section can ship to
  staging dark, behind its toggle, without gating the whole deploy.
- **Tenancy invariant** holds in every phase: `brand_id` is **always** derived
  from `context.principal.activeOrgId` or the host→org resolution, **never** from
  server-fn input (§01 §10, §02 conventions).

---

## 1. The walking skeleton (FIRST SLICE — do this before P1 epics)

The thinnest vertical that proves the one-app architecture end-to-end. It is **not
a phase**; it is the spike that de-risks every later phase and unblocks parallel
work. One brand, one host, one section, one server fn, one D1 table, deployed and
smoke-tested.

### Slice deliverables

| Step                  | Artifact                                                                                                                                                                  | Source of truth            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| Register the app      | `workers/sprout/` scaffold with the own-D1 + DO shape (own D1 database + Durable Object binding)                                                                             | §03 directory tree         |
| Registration surfaces | `workers/sprout/wrangler.jsonc` `DB` d1 binding, `workers/sprout/vite.config.ts` `db:migrate:local` vp task, `portless.json` + per-app `portless` key                              | §03 registration checklist |
| Bouncer route         | `SPROUT` service binding + wildcard `*.sproutportal.ca` (+ apex) in the top-level (staging) and `env.production` blocks of `workers/bouncer/wrangler.jsonc`              | §01 §6, §03 host→brand     |
| Secrets               | `sprout` added to `ServiceName`/`SERVICE_DIR`; `BNC_ATT_PRIV.perEnv.local += sprout`                                                                                      | §03 checklist              |
| Flat worker entry     | `src/worker.ts` — `devEnvelopeStamper` → `/ws/` intercept → `startEntry.fetch` → re-append setCookies; exports DO + queue/scheduled                                       | §01 §5, §03 worker.ts      |
| Platform wiring       | `src/lib/platform.ts` (`createPlatformStartApp({ name:"sprout" })`), `src/start.ts` (`envelopeMiddleware` global), `src/lib/middleware/auth.ts` (`requireUserMiddleware`) | §03 lib map                |
| ONE D1 table          | `brand_config` + `org_brand_directory` only (the minimum to resolve a host)                                                                                               | §02 §1                     |
| Brand resolver        | `lib/brand.server.ts` `resolveBrandForHost(host)` + `__root.tsx beforeLoad` → `RouterContext.brand`                                                                       | §01 §2.3, §03 host→brand   |
| ONE server fn         | `brand.functions.ts` `getBrandConfig` (GET, gated, raw `env.DB.prepare`)                                                                                                  | §03 server-fn table        |
| ONE rendered section  | `_portal.tsx` shell + `_portal/index.tsx` landing rendering brand name/tagline/logo from D1; `<BrandStyle>` injects `--color-*` overrides in `__root` head                | §03 shell + theming        |
| Deploy + smoke        | CD step lands the `sprout` worker on staging; one seeded org's `<slug>.sproutportal.ca` renders its skin                                                                  | §03 checklist item 7       |

### Slice exit criteria

1. `bun run dev` applies the local `brand_config`/`org_brand_directory`
   migration and serves a seeded brand at `<slug>.sproutportal.localhost`.
2. Two seeded orgs render **visibly different skins** (different `--color-primary`,
   different `<BrandLogo>`) from the **same worker** — proving "one engine, infinite
   skins" with **no rebuild**.
3. A signed-in request carries a verified envelope; `getBrandConfig` reads
   `brand_id = context.principal.activeOrgId` (zero-hop) and never trusts input.
4. The slice is green on staging via the existing CD pipeline (deploys after
   guestlist+leaf services, before bouncer).

**Why this slice:** it exercises the single highest-risk seam in the whole plan —
the **runtime per-org brand mechanism** (the #1 trap, §01 §2) — plus the
registration/CD/envelope plumbing that every later phase assumes. If the skin
resolves and the envelope verifies, the rest is feature volume on a proven spine.

---

## 2. Phase-by-phase plan

Phases map 1:1 to the spec's own delivery plan. Each builds on the skeleton.

### P1 — Foundation

> Spec: auth, template engine, portal customisation, landing (rotating hero +
> banner cards), section grid, store assets (download), basic analytics.

**Epic P1.A — One-page shell + section-layer system** (the architectural core)

- Build `_portal.tsx` pathless shell mounting `RotatingHero`, `BannerRail`,
  `AiBubble` placeholder, and `<LayerStack/>` above `<Outlet/>`
  (`components/shell/`).
- Implement `_portal/home.tsx` with the typed `homeSearch` schema
  (`section?`, `item?`) and `useLayerStack()` (`openLayer`/`closeLayer`) reading
  `Route.useSearch()`; `scrollRestoration:true` in `router.tsx`.
- Build the **six-card section grid** + the `SectionLayer` (`fixed inset-0 z-50`)
  overlay shell with scroll-snapshot/restore on open/close.
- `RotatingHero` is a **NEW carousel primitive** (no carousel in `packages/ui`).
- Tables: none new (uses `brand_config`, `hero_slides`).
- Server fns: `brand.functions.ts getBrandConfig` (already in skeleton).
- Tests: layer open/close preserves scroll; hero timer survives a layer open;
  `validateSearch` rejects bad section keys.

**Epic P1.B — Portal customisation (Brand Admin setup) + Draft→Live**

- Tables: `hero_slides`, `banner_cards`, `banner_dismissals` (full §02 §1).
- Routes: `/admin` guard layout (`admin.tsx`, `requireBrandRole`), `/admin/setup`.
- Components: `components/admin/` setup editors — **all via `useAppForm`** (logo,
  name, tagline, colours with LIVE PREVIEW, fonts, hero slide upload+order, banner
  set, section checklist toggle+reorder, Flip Draft→Live button). The brand retints
  THREE roles only — `--color-primary` (= `--color-sprout`), one secondary
  `--color-accent`, and `--color-background`/surfaces — plus optional fonts/radius; the
  four other named accents (stigma/growth/pistil/haze) stay FIXED Sprout status tokens
  and are intentionally non-overridable.
- Reorder primitive: build ONE keyboard-first `SortableList` (build-new, P1.B) —
  move-up/move-down buttons are the mandatory a11y baseline (rewriting `order_idx` /
  array order to a contiguous `0..n-1`), with pointer drag handles as a progressive
  enhancement via `@dnd-kit/core` + `@dnd-kit/sortable`. Reuse it for all three ordered
  controls: `hero_slides.order_idx`, `live_sections_json` order, `banner_cards.order_idx`.
- Server fns: `brand.functions.ts updatePortalSetup`, `reorderHeroSlides`, `flipDraftToLive`
  (copies `draft_*_json` → `live_*_json`, stamps `live_published_at`).
- Roadie: brand logo + hero images via `registerUpload`/`finalize`
  (`resourceType: "brand-logo"|"hero"`); store only `referenceId`.
- `BrandStyle` light+dark blocks; `BrandLogo` runtime component (`components/brand/`).
- Tests: Draft edits never affect the public live render until flip; `requireBrandRole`
  rejects a non-member; LIVE PREVIEW mutates CSS vars client-side pre-save.

**Epic P1.C — Landing (rotating hero + banner cards)**

- `_portal/index.tsx` renders `RotatingHero` from `hero_slides` + ONE "Enter Portal"
  button; `BannerRail` from `banner_cards` (windowed by `live_from`/`expires_at`,
  dismissible via `banner_dismissals`).
- Server fns: read in the `_portal` loader; banner `impressions`/`clicks` bumped via
  `analytics_events` (`banner_impression`/`banner_click`) **in the same transaction**
  as the counter on `banner_cards`.
- Tests: expired banners hidden; dismissed banner stays dismissed across sessions;
  impression counter + event row both written.

**Epic P1.D — Store Assets (download only) + Section grid wiring**

- Tables: `assets` (download path only; physical-request fields exist but unused
  this phase).
- Section: `components/sections/store-assets/` — library grid (Card + `surfaceMaterials`),
  in-platform viewers (PDF full-screen, image lightbox, native video player, ZIP
  direct download), DOWNLOAD action.
- Server fns: `assets.functions.ts listAssets`; roadie `getReadUrl` for serve;
  `download_count` bump + `asset_download` analytics event.
- Admin: `/admin/content/assets` upload + metadata (physical flags set but inert).
- Tests: each `type` (pdf/image/video/zip) opens the correct in-platform viewer;
  download increments counter + emits event.

**Epic P1.E — Basic analytics + jobs scaffold**

- Tables: `analytics_events` (append-only); `audit_log` (append-only, authored in
  [02 §12](./02-data-model.md#12-analytics-events); every mutation calls `writeAudit`).
- `jobs/queue.ts handleQueueBatch` + `jobs/cron.ts handleCron` scaffolds (AE binding,
  no heavy rollups yet — banner expiry sweep + a no-op rollup).
- Server fns: `analytics.functions.ts` minimal `getBudtenderReport` over events.
- Tests: events are append-only (no UPDATE/DELETE path); `writeAudit` appends.

**P1 exit criteria:** a Brand Admin configures a portal end-to-end (skin + hero +
banners + section toggles + Draft→Live), a budtender lands on the rotating hero,
enters the portal, sees the six-card grid, opens **Store Assets** as a layer,
downloads a file in-platform, the layer closes restoring scroll, and the download +
banner impressions land in `analytics_events`. Sections other than Store Assets are
toggled **off** (dark) in `live_sections_json`.

**Deployment mode:** Brand Admin + landing + grid + Store Assets ship **live**
(behind the `assets` toggle); the other five section keys ship **dark**.

---

### P2 — Product & Learning

> Spec: Drop Sheet (products + rotations), reviews, PK deck PDF flip-viewer,
> quizzes, certifications, leaderboard.

**Epic P2.A — Drop Sheet (products + rotations)**

- Tables: `products`, `drops`.
- Component: `components/drop-sheet/` — category cards row (Flower/Pre-Roll/Infused/
  Hash/Limited), per-product detail (THC/CBD, terpenes, effects, talking points,
  format, batch), "when available" note for Limited; `Drawer` bottom-sheet on mobile.
- Routes: drop sheet renders below the grid in `_portal/home.tsx`; product deep-link
  via `?item=`.
- Server fns: `drops.functions.ts listLineup`, `getProduct`, `upsertProduct`.
- Admin: `/admin/content/drops` lineup per category.
- Analytics: `product_view` event.

**Epic P2.B — Reviews (HARD-delete by compliance)** — _depends on P2.A products_

- Tables: `reviews` (UNIQUE `(brand_id, product_id, user_id)`, **no `deleted_at`**;
  hand-add `rating BETWEEN 1 AND 5` + `length(body) <= 300` CHECKs to the migration).
- Component: reviews live in the product detail (`components/drop-sheet/`): 1-5 stars,
  ≤300 chars, name/store/date + average; optimistic upsert replaces own prior review.
- Server fns: `reviews.functions.ts listReviews`, `upsertMyReview`, `deleteReview`
  (admin hard-delete, gated `requireBrandRole`); `review_left` event.
- Admin: `/admin/reviews` — delete-only (NEVER edit, NEVER hide).
- Tests: second review by same user UPSERTs in place; admin `deleteReview` issues a
  real SQL `DELETE`; there is no hide/suppress path anywhere.

**Epic P2.C — PK Decks (flip-viewer)** — _depends on roadie upload + queue thumbnailer_

- Tables: `decks`, `deck_progress`.
- Component: `components/sections/pk-decks/` — deck library (cover thumb, title,
  product line, page count, date) + **NEW full-screen flip-VIEWER** built on
  **`pdfjs-dist`** (pdf.js) in the browser, fetching the inline
  `getReadUrl({ referenceId, disposition:'inline' })` PDF and rasterising page N to
  canvas on demand (pinch/double-tap zoom, thumbnail filmstrip, download if
  `download_allowed`; keeps Worker CPU free).
- Server fns: `decks.functions.ts listDecks`, `registerDeckUpload`, `finalizeDeckUpload`,
  `recordFlipDepth`. Two-step handoff: `registerDeckUpload` INSERTs a `decks` row
  (`status='draft'`, `pdf_ref=null`) and returns `{ deckId, referenceId, uploadUrl }`;
  client PUTs bytes; `finalizeDeckUpload({ deckId, referenceId })` calls `roadie.finalize`,
  sets `decks.pdf_ref=referenceId`, and enqueues the `deck.derive` job.
- Queue: the **async** `deck.derive` job (`jobs/queue.ts`) populates `page_count` +
  `cover_thumb_ref` — `unpdf` (Workers-targeted) reads `page_count` AND extracts text for
  the AI corpus; **Cloudflare Browser Rendering** binding (`BROWSER`, NEW) screenshots
  page 1 → page-1 PNG thumbnail → roadie `put`. The library card shows a `FileIcon`
  "processing" placeholder until the job completes (replace = new PDF, same listing row).
- Roadie: PDF `resourceType:"deck"`.
- Analytics: `deck_open`, `deck_flip` (`{ page, dwellMs }` = flip depth), `deck_download`.
- Wire products → decks via `products.deck_id` ("Full PK →" jump).
- Tests: `page_count` + a non-null `cover_thumb_ref` asserted after the derive job (do
  NOT pixel-assert the thumbnail — mask it); flip depth (`last_page`) upserts per
  `(deck_id, user_id)`; download gated by `download_allowed`.

**Epic P2.D — Quizzes + certifications**

- Tables: `quizzes`, `questions`, `question_options`, `attempts`, `attempt_answers`,
  `certifications` (§02 §5, re-namespaced to `brand_id`).
- Routes: `?section=quizzes` opens the **full-screen overlay** re-hosting quiz's
  phase state machine (intro/active/result) inside `SectionLayer`; admin question
  builder at `/admin/content/quizzes`.
- Server fns: `quizzes.functions.ts` (folded `listCourses`/`startAttempt`/`gradeAttempt`
  → portal naming); 5 question types (multiple_choice, select_all, true_false, image,
  matching); autosave/resume via `attempts.answers_json` + `current_question`.
- Certifications unlock instantly; `cert_awarded` event.
- Roadie blob caveat (resolved, §01 §9): existing quiz blobs under `caller_app:"quiz"`
  are invisible to `"sprout"` (roadie scopes by `caller_app` first, **not** by
  `resourceType` alone). **Greenfield default = NO-OP** — every sprout blob is minted
  under `caller_app:"sprout"` from the skeleton onward. **For a data-carrying fork**,
  run a one-time migration script in `workers/sprout` that re-registers each legacy quiz
  blob under `caller_app:"sprout"` with the appropriate sprout `resourceType` and
  rewrites the D1 `*_ref` handles (roadie dedup is global on content hash, so this is a
  metadata-only re-reference, **not** a byte copy). Gated on the §8 prerequisite "does
  any target fork carry existing quiz rows?".
- Tests: autosave/resume mid-quiz (deterministic via stored `shuffle_seed`);
  pass-threshold + retake limits enforced; cert UNIQUE `(brand_id, user_id, quiz_id)`
  prevents duplicate badge.

**Epic P2.E — Leaderboard (brand-scoped) + score materialisation**

- Tables: `user_brand_scores` (materialised composite score + the three component
  columns `quiz_points`/`deck_points`/`activity_points` per `(user, brand, period)`,
  `period` = calendar month `'YYYY-MM'`).
- Cron: `jobs/cron.ts` recomputes per `(user, brand, period)`. **The leaderboard math
  lives in ONE place — the cron** (the `attempt.completed` queue job only re-indexes a
  row's inputs, never materialises). The single canonical formula:
  - `quizPoints = min(100, 100 * Σ(best passing-attempt grade% per quiz) / published quizzes this period)`
  - `deckPoints = 100 * (decks with last_page ≥ page_count) / published decks + min(20, total deck time_spent_seconds / 3600 * 5)`
  - `activityPoints = min(100, 4*comments + 2*post_likes + 10*session_join + 5*session_register + 1*chat_message)` over the period
  - `score = round(0.55*quizPoints + 0.30*deckPoints + 0.15*activityPoints)`,
    ties broken deterministically by earliest `computed_at` then `user_id`.
    The three weights + activity coefficients live in a single `SCORE_WEIGHTS` const in
    `jobs/cron.ts` so retuning is one line (weights front-load learning at 85% per the
    education-funded framing; hard caps stop activity farming).
- Server fns: `hub.functions.ts getLeaderboard({ brandId, period })` (brand-scoped this
  phase via `user_brand_scores_leaderboard_idx (brand_id, period, score)`; platform-wide
  sum in P5).
- **UI deliverable — brand leaderboard panel:** render a brand-scoped leaderboard panel
  **inside the Quizzes section layer** (`?section=quizzes`) as a tab/segment alongside
  the quiz list (`Quizzes | Leaderboard`) — **NO new route** (stays within the one-page
  shell, INV-7). It reuses the existing `getLeaderboard({ brandId: activeOrgId, period })`
  (no new server fn, no schema change): the same bordered top-N table the Hub uses, with
  the budtender's own rank pinned + a period selector.
- Tests: leaderboard reads the snapshot (no live scan); score recompute is idempotent
  per period; the Quizzes-layer panel shows this brand's top-N + own rank, brand-scoped
  (a brand-B budtender never sees brand-A scores); `getLeaderboard({ brandId })` returns
  only that brand's rows.

**P2 exit criteria:** a budtender opens the Drop Sheet, views a product, leaves one
review (and edits it in place), an admin deletes a violating review (hard delete),
the "Full PK →" jump opens a deck in the flip-viewer (flip depth recorded), the
budtender passes a certification quiz (badge unlocked), and the brand leaderboard
ranks them from the materialised `user_brand_scores`.

**Deployment mode:** `decks` + `quizzes` toggles go **live**; Drop Sheet (always
below the grid) + reviews live. Hub leaderboard route exists but Hub is dark until P5.

---

### P3 — Engagement

> Spec: media feed (posts, media, likes, real-time comments), group chat,
> banner-card management.

**Epic P3.A — Durable Object real-time substrate** (critical-path dependency)

- `src/room-server.ts` — **ONE** DO class `GroupChatRoom` (binding `GROUP_CHAT_ROOM`,
  lifted verbatim from chat's single `RoomServer` class) serves **both** keyspaces via
  `idFromName`: group chat = `idFromName(brandId)` (one instance per brand); media-feed
  live comments = `idFromName(`${brandId}:${postId}`)` (one instance per post). A brand
  room and a post-comment room are the same shape (durable message log + presence +
  hearts), so a second class would duplicate code for zero behavioural gain and enlarge
  the irreversible v1 migration set. `v1` is **frozen** at
  `migrations: [{ tag: 'v1', new_sqlite_classes: ['GroupChatRoom'] }]`. (`MediaFeedRoom`
  is a documented future `tag: 'v2'` additive escape hatch only — if a single post's
  comment fan-out ever needs independent hibernation/sharding — never shipped in v1.)
- Worker: `/ws/*` intercept via `routePartykitRequest` **before** `startEntry.fetch`;
  DO verifies the envelope in `onConnect` with a **per-connection** `expectedHost`
  derived from the WS-upgrade `Host` header (real change vs chat's static `*_URL`,
  §01 §7); it must match the `*.sproutportal.ca` single-label wildcard, resolve the
  leftmost label → org, then assert `principal.activeOrgId === resolved org_id` before
  admitting an authenticated socket (reject `1008` otherwise).
- Wrangler: `durable_objects.bindings` + `migrations[{ new_sqlite_classes }]` repeated
  in **every** env block.
- Tests: envelope-verify rejects a forged/wrong-host connection; a brand-A envelope
  cannot join a brand-B room (cross-brand DO isolation); both `idFromName` keyspaces
  are exercised against the single class; DO survives hibernate (`onStart` idempotent
  `IF NOT EXISTS`).

**Epic P3.B — Media feed ("Enter the Grow")** — _depends on P3.A_

- Tables: `posts`, `post_media`, `post_likes`, `comments`, `comment_likes`.
- Component: `components/sections/media-feed/` — Instagram-style cells (NEW feed
  primitive; reuse `VideoPlayer` + `file-preview/*`), expand → full-screen overlay
  (carousel, live like count, full caption, "View Product Details →" → Drop Sheet +
  stacked PK deck), live comments (≤500 chars, hearts, author/admin delete, brand
  Team marker).
- Server fns: `feed.functions.ts listFeed`, `createPost`, `likePost`, `addComment`;
  comments stream over the DO; D1 is the durable log.
- Admin: `/admin/content/feed` composer; feed label from `brand_config.feed_label`
  (brand-renameable).
- Analytics: `post_view`, `post_like`, `comment_create`.
- Tests: closing the expanded post restores exact feed position; comment broadcast is
  real-time for a second client; soft-delete hides comment but preserves analytics.

**Epic P3.C — Group Chat** — _depends on P3.A_

- Tables: `chat_rooms` (UNIQUE per brand), `chat_messages`, `presence`.
- Component: `components/sections/group-chat/` (message list incl. `message-row.tsx`,
  presence, Team marker); `?section=chat` layer; mobile = full screen.
- Server fns: `chat.functions.ts getRoomHistory`; live via DO; Team marker on
  `chat_messages.team`.
- Analytics: `chat_message` event.
- Tests: history persists across reconnect; Team marker renders distinctly; presence
  flush populates `presence` for the Hub "N online".

**Epic P3.D — Banner-card management**

- Routes: `/admin/content/banners` (CRUD, live/expiry windows, impression/clickthrough
  reporting). Tables already exist (`banner_cards`); this is the admin surface +
  analytics read.
- Tests: live/expiry windows respected on the public render; clickthrough → section
  deep-link via `link_json` (in-platform only, never external).

**P3 exit criteria:** budtenders see the brand's feed, like posts, post real-time
comments (visible instantly to others), brand replies render with the Team marker,
the persistent group chat room carries history + live messages, and Brand Admin
manages banners with live impression/click counts.

**Deployment mode:** `feed` + `chat` toggles go **live**. The DO ships
to staging in P3.A (dark — no UI) before the feed/chat UI lands.

---

### P4 — Assistance & Connection

> Spec: AI assistant, video booking + group sessions, in-platform contact +
> messaging, physical-asset requests + fulfilment.

**Epic P4.A — Physical-asset requests + fulfilment**

- Tables: `physical_requests` (the `assets` physical fields from P1.D activate now).
- Component: request-physical form (`useAppForm`: quantity, store pre-filled, shipping
  street/city/province/postal, contact+phone, optional note) in
  `components/sections/store-assets/`; "My Requests" status view (`/requests`).
- Server fns: `assets.functions.ts requestPhysical`, `listMyRequests`; admin fulfilment
  in `components/admin/` fulfilment queue.
- Admin: `/admin/fulfilment` — Requested→Approved→Shipped (optional tracking) /
  Declined (reason); status flows to My Requests via a `notifications` row
  (`type:"fulfilment_status"`, the named arm of the closed notification enum).
- Promoter: fulfilment-status email, keyed `idempotencyKey = fulfilment:${requestId}:${status}`
  (cron/queue handlers retry, so the send needs an idempotency key).
- Analytics: `physical_request` event.

**Epic P4.B — Contact (in-platform, reaches a human)**

- Tables: `contact_threads`, `contact_replies`.
- Component: `components/sections/contact/` Get-in-Touch form (`useAppForm`:
  name/store/email pre-filled, topic ∈ Restocking|Events|Assets|Feedback|General,
  message). **No email client.**
- Server fns: `contact.functions.ts sendContact`, `listInbox` (admin); a brand reply
  inserts a `contact_replies` row **and** emits a `notifications` row
  (`type:"contact_reply"`) — that is how the reply reaches the budtender in-platform.
- Tests: reply creates no new channel; notification lands for the thread author.

**Epic P4.C — Booking + group sessions (BOOKING ONLY — no instant calls)**

- Tables: `availability_windows`, `bookings` (UNIQUE `(window_id, slot_starts_at)` —
  booked slot vanishes; 1:1 model applies ONLY to `isGroup=0` windows), `group_sessions`,
  `session_attendance` (UNIQUE `(session_id, user_id)`). Group windows (`isGroup=1`)
  surface as `group_sessions` rows via `registerSession`, **not** a `bookings` row;
  `listSlots` derives 1:1 slots from `isGroup=0` windows only.
- Component: slot picker (booked slots vanish), Register→reminders→Join for group.
  **Join is enabled when `now >= slot_starts_at`** (a computed gate — there is no
  `join_at` column); the in-platform call room is **RealtimeKit** (Core SDK client +
  RealtimeKit REST server to mint the meeting/session + auth tokens, **not** the raw
  SFU push/pull-tracks API). The `realtime_session_id` is created lazily on first join
  and stored then. Managed recording writes S3-compatible output to the project R2
  bucket; on the recording-complete webhook the object is registered with roadie via
  `put({ application:{ resourceType:'session-recording', resourceId: sessionId } })`
  → `recording_ref` on `bookings`/`group_sessions`.
- Server fns (`sessions.functions.ts`, or extend `ai.functions.ts`):
  `ai.functions.ts bookCall`/`listSlots` (shared with AI escalation); `listGroupSessions`
  (GET); `registerSession` (INSERT `session_attendance.registered_at`, emits
  `session_register`, honours capacity); `joinSession` (stamp `joined_at` / open
  `realtime_session_id`, emits `session_join`); `leaveSession` (stamp `left_at`, compute
  `durationSeconds`); `cancelBooking` (status=`cancelled`, frees the slot); admin
  `upsertAvailabilityWindow`/`upsertGroupSession` (`requireBrandRole`). A session
  lifecycle cron flips `group_sessions` scheduled→live→ended and `bookings`
  booked→completed around slot times, tying `ended`/`completed` to the recording-archive
  step (`recording_ref` set on ended).
- RealtimeKit app id + secret are **new** `provided` wrangler secrets scoped to
  `['sprout']` (§8 prerequisite); recordings are blocked without them.
- Admin: `/admin/calls` — availability windows + group sessions.
- Analytics: `booking_created`, `session_register`, `session_join`
  (`{ durationSeconds }`). Session-reminder send keyed
  `idempotencyKey = reminder:${sessionId|bookingId}:${reminderOffset}`.
- **Product law:** there is NO "Start Call Now" anywhere — verify no instant-call
  path exists for budtenders OR the AI (no `startCall`/`joinNow` tool, fn, route, or
  DO open-room-now RPC).

**Epic P4.D — AI assistant (RAG over brand's own content)** — _depends on P2.A/C
products+decks corpus, P4.C booking_

- Tables/bindings: `ai_qa_log` (append-only), `ai_custom_qa`, `ai_embeddings`
  (chunk text + `vectorize_id` + provenance,
  [02 §10](./02-data-model.md#10-ai-assistant)). Vectors live in **Cloudflare
  Vectorize** (768-dim index, `brand_id` metadata filter — retrieval cannot cross
  brands). Generation + embeddings both run on **Workers AI** via the `AI` binding
  behind the AI module's single `generate()` seam: generation model
  `@cf/meta/llama-3.1-8b-instruct` (or the current CF-recommended instruct model at
  build time), embeddings `@cf/baai/bge-base-en-v1.5` (768-dim → set the Vectorize
  index dimension to 768 to match). No AI secret is provisioned for v1 (binding path);
  an external LLM is a documented opt-in `SecretSpec` scoped to `['sprout']` and a
  one-file change at the `generate()` seam, **not** provisioned now.
- Component: `components/ai/` — persistent `AiBubble` (now functional), assistant chat,
  booked-call slot picker (NO instant call). Streaming client = **Vercel AI SDK**
  (`ai` + `@ai-sdk/react` `useChat`) with `askAssistant` returning a streamed `Response`.
  Net-new build (`ai-sdk` skill available).
- Server fns: `ai.functions.ts askAssistant`, `addCustomQA`; corpus = Drop Sheet
  products, PK deck text, asset metadata, custom Q&A — all scoped to the resolved brand.
- Admin: `/admin/ai` custom Q&A + question log review.
- Analytics: `ai_question` (`{ kind, source }`); `escalated_booking_id` set on booking.
- Tests: retrieval never returns another brand's content; escalation reaches the slot
  picker, never an instant call.

**P4 exit criteria:** a budtender requests a physical asset (tracked through the
fulfilment queue with status notifications), sends a Contact message that lands in the
Brand Admin inbox and gets a reply as an in-platform notification, books a 1:1 call
(slot vanishes) and registers for a group session, and asks the AI a product question
answered from the brand's own content with a booking escalation (never an instant call).

**Deployment mode:** `contact` toggle goes **live**; AI bubble + booking + fulfilment
live. The three channels (AI / Contact / Group Chat) are now all present and **strictly
separate**.

---

### P5 — Community (the Hub)

> Spec: full Hub (leaderboard, Award of the Month, Last Month's Winner, Portals You
> Can Join), notification system.

**Epic P5.A — Hub shell + Your Portals + Portals You Can Join**

- Routes: `/hub` (the ONE Sprout-branded surface; uses `Logo`/Sprout wordmark, not
  `BrandLogo`); host dispatcher renders Hub for the apex `sproutportal.ca`.
- Tables: `portal_access_requests` (the join queue; membership itself stays in
  guestlist's `member` table). `org_brand_directory` mirror drives the "brands you can
  join" list. **Directory refresh** = guestlist org-hook push (primary, authoritative
  for onboarding latency) + an hourly reconciliation cron in `jobs/cron.ts` (self-healing
  drop-recovery): on org create/update/slug-change/membership-change guestlist fires a
  better-auth org `databaseHook` that RPC-calls sprout's `syncOrgDirectory({ orgId, slug,
name, logoRef })`, which upserts `org_brand_directory` + stamps `synced_at`; the cron
  re-syncs stale/missing rows. (`seed-demo.ts` writes directory rows directly so tests
  don't depend on the live webhook.)
- Server fns: `hub.functions.ts listMyPortals` (guestlist member rows + unread badges),
  `requestAccess`; approval calls guestlist to insert the org `member` row + emits an
  `access_approved` notification.
- **Hub unread badge = poll v1** (`getUnreadCounts` GET on Hub mount + on window-focus +
  a 30s interval, `sessionStorage`-seeded to avoid a flash; "pulse on increment" when a
  poll returns a higher count). The standing push preference is consciously deferred here:
  the Hub is the cross-brand apex surface with no per-brand DO connection open, so a
  dedicated push channel is net-new infra. **Push deferred to P7 mobile** (rides
  `notification_prefs`). The DO push channel stays reserved for in-section real-time
  (chat/feed) where it already exists.
- Tests: a user can't double-queue (UNIQUE `(brand_id, user_id)`); approval creates the
  guestlist membership.

**Epic P5.B — Platform-wide leaderboard + Education Award**

- Tables: `education_award` (fund framing — NEVER prize/reward/cash); `user_brand_scores`
  platform-wide index (`(period, score)`).
- Routes: `/hub/leaderboard` (top-5 platform-wide + own rank), `/hub/award` (countdown,
  semi-anonymous leader, your gap to first), Last Month's Winner.
- Server fns: `hub.functions.ts getLeaderboard` (now sums `score` across the user's
  brands for the CURRENT period), `getAward`. "Last Month's Winner" / Education Award read
  the **prior closed period's** `user_brand_scores` row.
- Cron: award countdown + winner snapshot at period close.
- **Education Award framing is law** on every surface + string.

**Epic P5.C — Notification system (per-brand, per-type)**

- Tables: `notifications`, `notification_prefs` (UNIQUE `(user_id, brand_id, type)`;
  default-on; **no global switch**).
- Routes: `/hub/notifications` (per-brand, per-type settings).
- Server fns: notification read/mark + prefs; emitters retrofitted across P3/P4 over the
  **closed** type enum: `new_post | new_comment | chat | contact_reply | session_reminder
| award | access_approved | fulfilment_status` (a finite set so the per-type
  `notification_prefs` settings grid is implementable; distinct from the
  `analytics_events.type` vocabulary). `setNotificationPref` is the documented
  envelope-only exception: it takes `brandId` from input (the Hub tunes prefs across ALL
  a user's portals, so `activeOrgId` is insufficient) BUT binds `user_id` from the
  envelope and asserts the caller has a guestlist member row for that `brandId` before
  upsert — a server-side membership check, not a forgery surface.
- Tests: a per-type opt-out suppresses only that type for that brand; unread badge
  reflects `notifications_user_unread_idx`.

**P5 exit criteria:** post-login a budtender lands on the Hub, sees Your Portals with
unread badges, requests access to a new brand (queued for that Brand Admin, approved →
membership), views the platform-wide top-5 leaderboard with their own rank, sees the
Education Award countdown + their gap to first + last month's winner, and tunes
per-brand/per-type notifications.

**Deployment mode:** Hub goes **live** (host dispatcher routes apex → `/hub`). This is
the first phase where the Sprout-branded surface is user-visible.

---

### P6 — Intelligence (full analytics)

> Spec: full Brand Admin analytics (AI question log, deck flip-depth, physical-request
> tracking), CSV export, Sprout Admin monitoring.

**Epic P6.A — Brand Admin analytics dashboards**

- Routes: `/admin/analytics` — per-budtender (deck time + pages reached, quiz
  grades/attempts, products viewed, reviews, feed activity, sessions + join duration,
  downloads, physical requests, AI questions, chat, rank, certs); per-deck (opens/avg
  flip time/last page/downloads); per-product (views/review count/avg stars); per-quiz
  (completion rate/avg grade/**most-missed question**); AI question-log top questions.
- Server fns: `analytics.functions.ts getBudtenderReport`, `getDeckStats`, plus
  per-product/per-quiz aggregates reading `analytics_events` + denormalised counters.
  D1 `analytics_events` is the source of truth dashboards + `exportCsv` read (one event
  = one D1 row); Analytics Engine (`AE` binding) is an OPTIONAL write-mostly firehose for
  the two high-rate types only (`deck_flip` dwell, session join duration), never read by
  any product surface — a MAY, default `deck_flip` to D1-only unless AE is explicitly on.
- Charts: build a tiny token-driven SVG primitive set — `BarChart` + `Sparkline` +
  `TopNBars` — in `workers/sprout/components/admin/charts/`, composed from existing
  `--color-*` tokens; **NO chart library** (no recharts/visx/plot). The per-budtender
  matrix + most-missed/top-AI rollups render as the existing identity admin TABLE.
- Cron/queue: heavy rollups (most-missed question, top AI questions) off the request path.

**Epic P6.B — CSV export**

- Server fns: `analytics.functions.ts exportCsv` streams from D1/`analytics_events`.
- Tests: every dashboard view exports to CSV; export is brand-scoped.

**Epic P6.C — Sprout Admin monitoring**

- Routes: `/sprout-admin` (platform-admin only, `requireAdminMiddleware`) —
  cross-brand monitoring, org provisioning, system health.
- Server fns: `sprout-admin.functions.ts` — `listBrands` / `provisionOrg` /
  `getSystemHealth` / `getCrossBrandStats`, all `.middleware([requireAdminMiddleware])`;
  cross-brand reads bypass `brand_id` scoping via `isAdminRole` (god-mode). `provisionOrg`
  calls guestlist over the `GUESTLIST` binding to create the org, then seeds a
  `brand_config` row + an `org_brand_directory` row.

**P6 exit criteria:** a Brand Admin answers "how engaged are my budtenders?" with
evidence across all per-budtender/per-deck/per-product/per-quiz views, sees the
most-missed quiz question and top AI questions, exports any view to CSV, and a Sprout
Admin monitors across brands.

**Deployment mode:** all admin analytics live behind `requireBrandRole`/
`requireAdminMiddleware`. No new budtender-facing surfaces.

---

### P7 — Reach

> Spec: mobile app wrapper with push notifications, past-session recordings.

**Epic P7.A — Past-session recordings**

- Tables: `group_sessions.recording_ref` (roadie R2 handle), archived after a session
  ends; in-platform playback via `VideoPlayer`.
- Server fns: recording archive + serve via `getReadUrl`.

**Epic P7.B — Mobile wrapper + push**

- Mobile shell wrapping the one-page portal; push provider integration (the §01 system
  context's push external system).
- Push rides the **per-brand/per-type** `notification_prefs` (never a global switch);
  the DO broadcast + notification channel already exist from P3/P5.

**P7 exit criteria:** a session recording is archived and replayable in-platform; the
mobile wrapper delivers per-brand/per-type push notifications honouring
`notification_prefs`.

**Deployment mode:** recordings live; mobile wrapper is a separate distribution
artifact (not a worker deploy).

---

## 3. Dependency graph & critical path

```
SKELETON (brand-config + one-page shell + envelope/auth + bouncer wildcard + deploy)
  └── unblocks EVERYTHING
       │
       ├── P1.A shell + layer system ──┬── every section (P1.D, P2.*, P3.B/C, P4.*)
       │                               │
       ├── P1.B brand_config Draft→Live ── all per-brand content authoring
       │
       ├── P1.D Store Assets (download) ── P4.A physical requests (same `assets` table)
       │
       ├── P2.A products ──┬── P2.B reviews (FK product)
       │                   ├── P2.C decks (`products.deck_id` "Full PK →")
       │                   └── P4.D AI corpus (products + deck text)
       │
       ├── P2.C decks ──── P4.D AI corpus + P6 flip-depth analytics
       │
       ├── P2.D quizzes + P2.C decks ── P2.E score ── P5.B platform leaderboard + Award
       │
       ├── P3.A Durable Object ──┬── P3.B media feed live comments
       │                         └── P3.C group chat
       │
       ├── P4.C booking ──── P4.D AI booking-only escalation
       │
       ├── P4.B contact replies ─┐
       ├── P3/P4 emitters ───────┴── P5.C notification system
       │
       ├── analytics_events (P1.E, written by every section) ── P6 dashboards + CSV
       │
       └── guestlist org plugin (member table) ── P5.A multi-tenant Your Portals/access
```

**The critical path** (longest must-be-serial chain):

```
SKELETON → P1.A shell → P1.B brand_config/Draft→Live → P2.A products
        → P2.C decks → P4.D AI assistant
```

and in parallel the real-time chain:

```
SKELETON → P1.A shell → P3.A Durable Object → P3.B feed + P3.C chat → P5.C notifications
```

**Hard ordering rules (from the foundation docs):**

- **Brand-config + one-page shell + auth unblock everything** — they are the skeleton.
- **Drop Sheet (products, P2.A) before reviews (P2.B)** — reviews FK `products.id`.
- **Decks before flip analytics** — `deck_flip` events + `deck_progress` need the deck +
  viewer first (P2.C → P6 flip-depth).
- **DO before chat + live comments** — P3.A is a hard prerequisite for P3.B and P3.C.
- **Org plugin (guestlist `member`) before multi-tenant Hub** — P5.A "Your Portals" +
  access approval need real org membership, not the local `portal_access_requests` queue
  alone.
- **Booking before AI escalation** — P4.D escalates only to a P4.C booked slot.
- **`analytics_events` before P6** — events must be flowing (written from P1.E onward)
  before the dashboards aggregate them.

---

## 4. Parallelisable workstreams

Once the **skeleton + P1.A shell** land (the serial gate), work fans out. Treat
**file-system subtree overlap as a real dependency** (commit between waves; use
`addBlockedBy` when two streams touch the same `components/` or `schema.ts` region —
per project memory on agent fanout).

| Stream                 | Owns (subtree)                                                                                                     | Phases                 | Independent after                 |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------- | --------------------------------- |
| **Brand/Admin**        | `components/admin/`, `brand.functions.ts`, `/admin/setup`                                                          | P1.B, banner mgmt P3.D | skeleton                          |
| **Drop/Reviews/Decks** | `components/drop-sheet/`, `components/sections/pk-decks/`, `drops/reviews/decks.functions.ts`                      | P2.A–C                 | P1.A shell                        |
| **Quizzes**            | `components/sections/quizzes/`, `quizzes.functions.ts`                                                             | P2.D–E                 | P1.A shell                        |
| **Real-time**          | `room-server.ts`, `components/sections/{media-feed,group-chat}/`, `feed/chat.functions.ts`                         | P3.A–C                 | P1.A shell                        |
| **Assistance**         | `components/ai/`, `components/sections/{store-assets,contact}/` physical+contact, `ai/assets/contact.functions.ts` | P4.A–D                 | P1.D (assets), P2.A/C (AI corpus) |
| **Hub**                | `components/hub/`, `hub.functions.ts`, `/hub/*`                                                                    | P5.A–C                 | P2.E score, guestlist member      |
| **Analytics/Jobs**     | `analytics.functions.ts`, `jobs/queue.ts`, `jobs/cron.ts`                                                          | P1.E, P2.E, P6         | events flowing                    |

`schema.ts` is a **shared hot file** — every stream adds tables. Sequence schema
additions by phase (one migration per epic, generated by `db:generate`, never
hand-edited except the `reviews` CHECKs) and land them ahead of the code that reads
them (migrations-before-code, §02 migrations strategy).

---

## 5. Relative sizing & sequencing

Relative T-shirt sizes (effort, not calendar). The skeleton is the only thing that
**must** precede everything; within a phase, epics parallelise per §4.

| Phase        | Epics | Relative size | Net-new builds (highest risk)                              |
| ------------ | ----- | ------------- | ---------------------------------------------------------- |
| **Skeleton** | —     | M             | runtime brand resolution + `<BrandStyle>` (the #1 trap)    |
| **P1**       | A–E   | **L**         | NEW carousel (`RotatingHero`), layer/scroll system         |
| **P2**       | A–E   | **XL**        | NEW PDF flip-viewer, quiz fold-in + full-screen overlay    |
| **P3**       | A–D   | **L**         | DO per-request `expectedHost`, NEW feed primitive          |
| **P4**       | A–D   | **L**         | NEW AI assistant + RAG (per-brand isolation), booking room |
| **P5**       | A–C   | **M**         | platform-wide leaderboard, notification fan-out            |
| **P6**       | A–C   | **M**         | most-missed-question / top-AI-question rollups             |
| **P7**       | A–B   | **M**         | mobile wrapper + push (distribution, not a worker)         |

**Front-loaded risk:** P1 (shell mechanics) and P2 (flip-viewer + quiz overlay) carry
the most net-new UI primitives; P3 (DO multi-tenant host pinning) and P4 (RAG brand
isolation) carry the most net-new infrastructure. Sequencing P1→P2 serially on the
critical path is deliberate — they share the layer/overlay substrate.

---

## 6. Deployment cadence & feature-gating

**Continuous deploy to staging** is the default: every push to `main` runs CD
(`.rwx/promote-staging.yml`, embedded from `.rwx/ci.yml` after the gate), which
migrates the portal's D1 (`db:migrate:staging`) **before** its deploy via
`scripts/deploy-worker.sh ship`, and deploys the `sprout` worker **after**
guestlist + leaf services but **before** bouncer (bouncer last). This is unchanged
from the existing pipeline; the portal just slots into it.

**Two independent gates decide visibility — neither blocks the deploy:**

1. **Section toggles** (`brand_config.live_sections_json`, six keys
   `assets | decks | quizzes | feed | chat | contact`, each key === its `?section=`
   param value 1:1). A half-built section ships to staging **dark** by being
   absent/disabled in a brand's toggle list.
   When the section's exit criteria pass, the Brand Admin (or a seed) enables the key
   and it goes **live** — per brand, no redeploy. This is how "ships dark behind section
   toggles vs live" works: code ships continuously; the toggle is the release switch.
2. **Draft→Live** (`brand_config.state` + `flipDraftToLive`). The whole portal's skin +
   layout is Draft until the Brand Admin flips it; the public render reads only `live_*`.

**Interaction with per-phase work:** a phase's epics can land on staging incrementally
(behind their toggle or Draft) without a "phase complete" gate. P1.B ships the toggle
machinery itself, so from P1 onward every later section is gated by the same mechanism.
Admin-only surfaces (`/admin/*`, `/sprout-admin/*`) are gated by middleware
(`requireBrandRole`/`requireAdminMiddleware`), not toggles — they ship live but are
reachable only by the right principal.

**Per-phase cadence summary:**

| Phase    | Ships live (gated)                                     | Ships dark on staging              |
| -------- | ------------------------------------------------------ | ---------------------------------- |
| Skeleton | brand resolution (internal)                            | —                                  |
| P1       | Brand Admin, landing, grid, `assets`                   | other 5 section keys               |
| P2       | `decks`, `quizzes`, Drop Sheet, reviews                | Hub routes (no dispatcher yet)     |
| P3       | `feed`, `chat`                                         | DO lands ahead of UI               |
| P4       | `contact`, AI bubble, booking, fulfilment              | —                                  |
| P5       | **Hub** (apex dispatcher), notifications               | —                                  |
| P6       | admin analytics + CSV, Sprout Admin (middleware-gated) | —                                  |
| P7       | recordings                                             | mobile wrapper (separate artifact) |

---

## 7. Consolidation: folding quiz and chat into sprout

The fold-in is a **schema move + re-namespacing + UI re-host**, not a rewrite (§01 §1,
§03 "Folding in quiz and chat"). It happens **inside the phases that need each surface**,
not as a separate migration project.

### Migration order

1. **Skeleton (own caller + own D1).** `workers/sprout` stands up with `caller_app:"sprout"`
   and its own `DB`. From this point, _new_ blobs and rows are sprout-native.
2. **P2.D — Quiz fold-in.** The quiz tables move into `workers/sprout/src/schema.ts`
   (they already carry nullable indexed `brand_id` + denormalised `attempts.brand_id`,
   so `brand_id` already means the org — **no remap**). `courses.functions.ts` becomes
   `quizzes.functions.ts` (gate/handler shape already matches). The "take" flow re-hosts
   into the full-screen `SectionLayer` overlay (phase state machine reused).
   `course_collaborators` (seed-derived today) is **driven by the guestlist org `member`
   table** in sprout, not a parallel hand-seeded table.
3. **P3.A/C — Chat fold-in.** `workers/sprout/src/room-server.ts` hosts the single DO class,
   exported as `GroupChatRoom` (binding `GROUP_CHAT_ROOM`), from the sprout worker; the
   room UI (message list, presence, Team marker) lives in `components/sections/group-chat/`.
   The DO's `expectedHost` is **per-connection**, derived from the WS-upgrade `Host`
   header (§01 §7).

### Data move

- Quiz/chat domain rows live in **separate D1 databases** today; moving them is a D1
  export/import per table into the sprout `DB`, preserving `brand_id`. (Greenfield brands
  need no move; this matters only if a fork carries existing quiz/chat data.)
- **Roadie blob backfill (resolved, §01 §9 / §03):** references are scoped by
  `caller_app` **first** (not by `resourceType` alone). Blobs minted under
  `"quiz"`/`"chat"` are **invisible** to `"sprout"` (treated as not-found). **Greenfield =
  NO-OP** (no legacy blobs; all sprout blobs minted under `caller_app:"sprout"` from the
  skeleton). **Data-carrying fork =** a one-time migration script in `workers/sprout`
  re-registers each legacy blob under `caller_app:"sprout"` with the appropriate sprout
  `resourceType` and rewrites the D1 `*_ref` handles — roadie dedup is global on content
  hash, so this is a metadata-only re-reference, **not** a byte copy. Do NOT rely on
  `resourceType` namespacing alone. Scheduled as a P2.D (quiz) / P3 (chat) task only if
  the §8 prerequisite confirms a fork carries existing rows.

### Route cutover

- Quiz/chat **hostnames** (exact-host bouncer routes) outrank the `*.sproutportal.ca`
  wildcard, so during transition the old apps can keep serving their exact hosts while
  the portal serves brand subdomains. Cut over by **removing the exact-host routes** for
  quiz/chat once their surfaces are live as portal sections — verify no brand slug
  collides with `quiz.`/`chat.`/`identity.` hostnames (§01 §10 edge isolation).

### Deprecation

- Once each surface was **live as a section** (P3 for chat, P2.D for quiz) and its data
  was moved + blobs re-referenced, the standalone `apps/quiz` and `apps/chat` workers were
  torn down in one fold-in teardown PR per app: their CD deploy steps,
  bouncer exact-host routes + bindings, local-migration registration,
  `portless.json` + secrets-manifest entries, and their `wrangler.jsonc` `d1`
  blocks were removed, and the directories deleted. (This teardown predates the
  move to RWX — those deploy steps then lived in a `deploy-staging.yml` GitHub
  Action and local migrations in `apply-migrations.ts` `D1_PACKAGES`; both
  mechanisms have since been replaced by `.rwx/promote-staging.yml` +
  per-worker `db:migrate:local` vp tasks.)
  [`07-deployment.md` §3 "Fold-in deploy teardown"](./07-deployment.md) is the single home
  for **which deploy surfaces changed**; this §7 owns the data-move / blob-backfill side.
  Because quiz/chat had already folded in before their standalone deploy surfaces were
  torn down, no `db:migrate:staging` backfill was needed for their deprecated remote D1
  (the latent unmigrated-staging-D1 bug resolved via fold-in, not via backfilling workers
  slated for removal). `workers/identity` (account/admin) and `workers/marketing` (Astro, no
  remote D1) **stay separate apps** and were excluded from the teardown.

---

## 8. Sequencing decisions (settled)

Every cutover/sequencing question this roadmap once surfaced is now **decided**. Each
line states the decision + the phase it binds; `(default — change if X)` marks a chosen
default. The provisioning facts that must be true before a phase can run are listed under
**Implementation prerequisites** below.

- **DO topology — ONE class.** `GroupChatRoom` (binding `GROUP_CHAT_ROOM`) serves both
  group chat (`idFromName(brandId)`) and media-feed live comments
  (`idFromName(`${brandId}:${postId}`)`); `v1` is frozen at
  `new_sqlite_classes: ['GroupChatRoom']`. A brand room and a post-comment room are the
  same shape, so a second class would duplicate code for zero gain and enlarge the
  irreversible v1 set. `MediaFeedRoom` is a documented future `tag:'v2'` additive escape
  hatch only. (default — add `MediaFeedRoom` later as its own tag if a single post's
  comment fan-out needs independent hibernation/sharding.) Binds at **P3.A**.
- **DO `expectedHost` — per-connection + activeOrgId gate.** Derived from the WS-upgrade
  `Host` header, validated against the `*.sproutportal.ca` single-label wildcard, leftmost
  label resolved → org; authenticated sockets additionally assert
  `principal.activeOrgId === resolved org_id` (reject `1008`). Accepting any
  `*.sproutportal.ca` alone would permit cross-brand room access, so host + activeOrgId
  both gate — tenant isolation, non-negotiable. Binds at **P3.A**.
- **Roadie blob backfill — greenfield no-op / data-carrying re-reference.** Greenfield
  forks: NO-OP (all blobs minted under `caller_app:"sprout"`). Data-carrying fork: a
  one-time metadata-only re-register-under-`"sprout"` script (roadie dedup is global on
  content hash). Gated on the prerequisite confirming a fork carries existing rows. Binds
  at **P2.D** (quiz) / **P3** (chat).
- **Quiz/chat data move — conditional on greenfield.** If all target brands are
  greenfield the §7 data-move + the chat/quiz staging-migrate backfill are no-ops; a
  data-carrying fork schedules the D1 export/import as a P2.D / P3 task. Determined by the
  prerequisite below.
- **Public-org lookup — synced `org_brand_directory` mirror (push + cron).** Guestlist
  org-hook push is the primary path (authoritative for onboarding latency); an hourly
  reconciliation cron in `jobs/cron.ts` is the self-healing drop-recovery backstop. The
  public render derives `brand_id` from the resolved org (never from input), so a stale
  mirror only shows an old name/logo, never another brand's data. (default — if guestlist
  exposes no usable org `databaseHook` yet, run cron-only at **5-minute** cadence and
  accept up to ~5 min onboarding latency; switch to the webhook the moment the emitter
  ships.) Affects **skeleton + P5.A**.
- **Wildcard `*.sproutportal.ca` — single wildcard route + zone wildcard cert.** A single
  wildcard custom-domain route `*.sproutportal.ca` on the bouncer worker backed by a zone
  wildcard TLS cert (Advanced Certificate Manager / Total TLS), **not** Cloudflare for
  SaaS custom hostnames — every brand is a subdomain of the operator's own apex, so one
  cert + one route covers all brands with zero per-brand provisioning ("a new brand is a
  row of data"). (default — add Cloudflare for SaaS for a single brand only if it later
  brings its own apex/vanity domain.) Binds at the **skeleton** staging deploy.
- **Hub unread badge — poll v1, push deferred to P7.** Lightweight `getUnreadCounts` GET
  on Hub mount + window-focus + 30s interval, `sessionStorage`-seeded; the DO push channel
  stays reserved for in-section real-time. The Hub is the cross-brand apex with no
  per-brand DO connection open, so a dedicated push channel is net-new infra; poll-on-focus
  matches the existing chat-bell poll concession. (default — change to a net-new per-user
  notification DO/SSE channel in P5.C only if the operator wants instant cross-brand badge
  updates pre-mobile.) Push lands in **P7** with the mobile wrapper + push provider, riding
  `notification_prefs`. Decided at **P5.C**.
- **Booking/video room transport — Cloudflare Realtime via RealtimeKit.** RealtimeKit Core
  SDK (client) + RealtimeKit REST (server) rather than the raw SFU push/pull-tracks API;
  managed recording writes S3-compatible output to the project R2 bucket and, on the
  recording-complete webhook, registers with roadie (`resourceType:'session-recording'`) →
  `recording_ref`. RealtimeKit gives managed participant/recording lifecycle out of the
  box; raw SFU would be net-new track negotiation/presence/recording work. Binds at
  **P4.C** (recordings are blocked without the RealtimeKit secrets — see prerequisites).

### Implementation prerequisites

Provisioning/account facts that must be true before the named phase can deploy non-locally
(these are concrete tasks, not design unknowns):

- **Cloudflare account + `cloudflareAccountId`.** Provision the real CF account and set
  `cloudflareAccountId` in `packages/config/src/deploy.ts` (currently
  `'TODO-replace-with-your-cf-account-id'`). Blocks any non-local deploy.
- **Sprout D1.** Run `wrangler d1 create sprout` for staging/production, paste the
  UUIDs into the `database_id` fields of the sprout `wrangler.jsonc` (top level =
  staging, `env.production` = prod). Blocks the **skeleton** staging deploy.
- **Roadie D1.** roadie's staging/production `database_id`s live directly in
  `workers/roadie/wrangler.jsonc` (top level = staging, `env.production` = prod)
  — there is no `deploy.ts` `d1` field — and are already populated with the
  provisioned UUIDs.
- **`sproutportal.ca` zone + wildcard cert.** Add the zone and order/enable a
  `*.sproutportal.ca` Advanced/wildcard TLS cert (Total TLS or ACM), then confirm the
  wildcard `custom_domain` route binds on the bouncer worker before the first staging brand
  subdomain. Blocks the **skeleton** staging deploy.
- **Roadie R2 + S3 credentials.** Provision roadie's R2 bucket + S3/SigV4 (`S3_*`) secrets
  before any non-local roadie upload/serve (blocks **P1.B** logo upload onward in
  staging/prod).
- **Browser Rendering binding.** Enable Cloudflare Browser Rendering on the account and add
  it (binding `BROWSER`) to the sprout `wrangler.jsonc` alongside `AI` and
  `VECTORIZE`. Blocks **P2.C** thumbnails.
- **Vectorize index.** Create the index with dimension **768** (matching
  `@cf/baai/bge-base-en-v1.5`) and a `brand_id` metadata filter. Blocks **P4.D**.
- **RealtimeKit.** Create the app, capture app id + secret, add them as `provided` wrangler
  secrets scoped to `['sprout']` for local/staging/production, and configure managed
  recording's S3-compatible output to target the project R2 bucket. Blocks **P4.C**.
- **`sproutcannabis` workers.dev subdomain confirmation.** The staging URL vars in each
  `wrangler.jsonc` embed `sproutcannabis` (e.g. `sprout-marketing-staging.sproutcannabis.workers.dev`);
  confirm via `wrangler whoami` / the CF dashboard
  that this is the fork account's actual workers.dev subdomain before relying on the
  direct-smoke URL; update only if the account differs.
- **Guestlist org-hook emitter.** If guestlist's org plugin exposes a usable better-auth
  `databaseHook`, wire `syncOrgDirectory` there (primary path). If it has **no** usable
  hook surface yet, building that emitter (or a thin Reflect-resolved sprout RPC guestlist
  can call) is the concrete net-new task; until it lands, run the directory sync cron-only
  at 5-min cadence (default — switch to the webhook the moment the emitter ships). Affects
  **skeleton + P5.A**.
- **Production lane enrolment.** No new CI file to author — production ships on
  `.rwx/release-please.yml` (a Release-PR merge cuts `<worker>-v*` tags and ships the
  released subset in canonical order, `db:migrate:production`→leaf→apps incl.
  `sprout`→bouncer, then apex smoke; see [`07-deployment.md` §6](./07-deployment.md)).
  Sprout only needs its release-please component (`release-please-config.json` +
  `.release-please-manifest.json`) and its place in the canonical deploy order.
- **Fork data-carry check.** Confirm whether any target fork carries existing quiz/chat
  **production** rows; if all greenfield, the roadie re-reference backfill and the chat/quiz
  staging-migrate backfill are no-ops; if a data-carrying fork exists, schedule the backfill
  as a **P2.D** (quiz) / **P3** (chat) task.
- **Shared demo constants.** Add the two demo brands' identity constants (slugs, handles,
  ids) to a single `workers/sprout/__tests__/demo-constants.ts` imported by both
  `__tests__/fixtures.ts` and `scripts/seed-demo.ts` so names never drift.
