# 05 — API Surface & Integrations

> **Scope.** The complete server-side API surface of the single `workers/sprout`
> TanStack Start app — every `createServerFn` per domain, the Durable-Object
> real-time API, the three platform service bindings (guestlist, roadie,
> promoter), and the external integrations (AI provider, booking/video). It is
> grounded in greenroom's real contracts: sprout's own `src/lib/*.functions.ts`
> modules and Durable Object, `workers/roadie/src/methods/*`,
> `workers/promoter/src/index.ts`, and
> `packages/kit/src/react-start/envelope-middleware.ts`. (Sprout's quiz and
> group-chat features carry forward design patterns from earlier prior-art apps
> no longer in this repo.) Table names match
> [02-data-model](./02-data-model.md); routes/components match
> [03-app-structure](./03-app-structure.md); the architecture is
> [01-architecture](./01-architecture.md).

---

## 0. The server-fn contract (every fn obeys this)

Every domain mutation/read is a `createServerFn` in `src/lib/*.functions.ts`
(TSS's compiler requires top-level `createServerFn`). Every domain server fn
follows this canonical shape:

```ts
export const fnName = createServerFn({ method: "GET" | "POST" })
  .middleware([gate]) // identity verified once / request
  .inputValidator(
    type({
      /* arktype */
    }),
  ) // shape-validates client input
  .handler(async ({ data, context }) => {
    const userId = context.principal.actor.id; // NEVER from input
    const brandId = context.principal.activeOrgId; // NEVER from input
    // … decide(policy) → raw env.DB.prepare(SQL).bind(...).run() → writeAudit
    return mapRow(row); // snake_case → camelCase
  });
```

**Invariants applied to every fn below (stated once, not repeated):**

- **Identity is envelope-only.** `userId`/`brandId` come from
  `context.principal` (`packages/kit/src/react-start/envelope-middleware.ts:26-33`),
  never from `data`. Passing `brand_id` via input is a forgery surface, so no
  handler accepts it from the client.
- **Tenancy.** Reads/writes filter on the envelope-derived `brand_id`
  (host-resolved org for the public landing render). See
  [02 §Indexing & org-scoping](./02-data-model.md).
- **DB access is raw D1.** `env.DB.prepare(SQL).bind(...).all<Row>()/.first()/.run()`,
  snake_case→camelCase mapped by hand at the edge (`mapRow`). The Drizzle
  schema only generates migrations.
- **Audit.** Every mutation calls `writeAudit({ brandId, action, actorId, … })`.
- **Forms.** Client callers of every POST fn use `useAppForm`
  (`@greenroom/ui/hooks/use-app-form`) — never hand-rolled inputs.

### Authz gates (`src/lib/middleware/auth.ts`)

Built with `createPrincipalGate({ envelope, predicate, onReject })`
(`packages/kit/src/react-start/envelope-middleware.ts:123`). `envelopeMiddleware`
is installed globally in `start.ts` so TSS dedupes the one verify.

| Gate                         | Predicate                                                                                                                         | Used by                 |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `requireUserMiddleware`      | `p.kind === "user"`; `onReject` → `redirect({ href: "/sign-in" })`                                                                | all budtender + Hub fns |
| `requireAdminMiddleware`     | `&& isAdminRole(p.actor.role)` (platform god-mode, **comma-separated** role string — never `=== "admin"`)                         | `/sprout-admin` fns     |
| `requireBrandRole` (**NEW**) | `p.kind === "user"`, then handler resolves host→org and checks `getCallerOrgRole(orgId)` (guestlist hop) against a pure predicate | all Brand-Admin fns     |

`requireBrandRole` defers to a pure decision in `policy.server.ts`
(`decideBrandAdmin({ actorRole, orgRole })` → `{ ok:true } | { ok:false, reason }`).
**Platform admin bypasses the org-role check** (`isPlatformAdmin`). Brand-config /
theme writes gate on the org `theme:["update"]` permission
(`packages/auth/src/server.ts:48-68`), which is a different layer from the
platform role. The org role requires a guestlist round-trip (`getCallerOrgRole`)
and is skipped when the decision wouldn't use it.

---

## 1. Server-fn surface by domain

One `*.functions.ts` module per surface (route map in
[03 §Server-fn organization](./03-app-structure.md)). Each fn's `brand_id`,
where tenant-scoped, is `context.principal.activeOrgId` unless noted.

### 1.1 `brand.functions.ts` — brand config / portal setup

| Fn                                           | Method | Input                                                                | Reads/writes                                                                                                              | Authz                      |
| -------------------------------------------- | ------ | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `getBrandForHost`                            | GET    | `{}`                                                                 | slim skin: `brand_theme` (live theme) + `portal_config`/`org_brand_directory` identity cols                               | public (host-resolved org) |
| `getPortalContent`                           | GET    | `{}`                                                                 | `portal_config` content: tagline, feed label, section toggles                                                             | public (host-resolved org) |
| `probeBrandAdmin`                            | GET    | `{}`                                                                 | no-op authz probe awaited by the `/admin` guard layout                                                                    | `requireBrandAdmin`        |
| `getAdminTheme`                              | GET    | `{}`                                                                 | `brand_theme` draft + live + lifecycle (`state`, `live_published_at`)                                                     | `requireBrandAdmin`        |
| `updateThemeDraft`                           | POST   | `{ theme }`                                                          | UPSERT `brand_theme.draft_theme_json`                                                                                     | `requireBrandAdmin`        |
| `publishTheme`                               | POST   | `{}`                                                                 | copy `draft_theme_json` → `live_theme_json`, stamp `live_published_at`, `state='live'`                                    | `requireBrandAdmin`        |
| `getAdminPortalConfig`                       | GET    | `{}`                                                                 | `portal_config` row (name, tagline, feed label, logo ref, sections)                                                       | `requireBrandAdmin`        |
| `updatePortalConfig`                         | POST   | `{ name, tagline?, feedLabel?, sections }`                           | UPSERT `portal_config` — LIVE-EDIT, immediately public (incl. section toggles)                                            | `requireBrandAdmin`        |
| `upsertHeroSlide` / `reorderHeroSlides`      | POST   | `{ imageRef, category?, headline?, orderIdx, enabled? }`             | INSERT/UPDATE `hero_slides`                                                                                               | `requireBrandRole`         |
| `upsertBannerCard`                           | POST   | `{ headline, line?, linkJson, liveFrom?, expiresAt?, dismissible? }` | INSERT/UPDATE `banner_cards`; `linkJson` is an **in-platform** `{ section, params }` (never an external URL)              | `requireBrandRole`         |
| `dismissBanner`                              | POST   | `{ bannerId }`                                                       | INSERT `banner_dismissals` (PK `(banner_id, user_id)`)                                                                    | `requireUser`              |
| `trackBannerImpression` / `trackBannerClick` | POST   | `{ bannerId, section? }`                                             | bump `banner_cards.impressions`/`.clicks` **+** append `analytics_events` (`banner_impression`/`banner_click`) in one txn | `requireUser`              |

`getBrandForHost`/`publishTheme` postconditions: the public portal reads only
`live_theme_json`; admin LIVE PREVIEW mutates the same CSS vars client-side then
persists to `draft_theme_json`. The draft→publish lifecycle applies to the THEME
only — `updatePortalConfig` (name/tagline/feed label/sections) is live-edit.
The CSS-var override mechanism is the runtime `<BrandStyle>` —
**not** the build-time `packages/config` brand system (architecture [01 §2](./01-architecture.md)).

**Public landing has no principal gate.** `getBrandForHost`/`getPortalContent`
for the landing render run **without** `requireUser` and resolve `brand_id` from
the host (`org_brand_directory` slug → org_id), **never** from
`context.principal`. `envelopeMiddleware` projecting an anonymous principal in
prod is fine because these fns never read `context.principal`, and the prod
403-on-missing-envelope applies only to **gated** fns, not this unauthenticated
loader. `trackBannerImpression` stays `requireUser` **by design**: pre-login
brand-landing impressions are intentionally **not** counted — the portal is a B2B
members area; the truly-public apex is the Hub.

### 1.2 `drops.functions.ts` — Drop Sheet (products + rotations)

| Fn               | Method | Input                                                                                                                                                                        | Authz              |
| ---------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `listLineup`     | GET    | `{ category? }` → `products` grouped by category (Flower/Pre-Roll/Infused/Hash/Limited) with `availability`, average stars                                                   | `requireUser`      |
| `getProduct`     | GET    | `{ productId }` → product detail (THC/CBD, terpenes, effects, talking points, format, batch, `deckId` for `Full PK →`) + reviews + avg; emits `product_view` analytics event | `requireUser`      |
| `upsertProduct`  | POST   | `{ productId?, category, name, thcPct?, cbdPct?, terpenes[], effects[], talkingPoints[], format?, batch?, heroImageRef?, availability, availableNote?, deckId? }`            | `requireBrandRole` |
| `archiveProduct` | POST   | `{ productId }` → soft-delete (`archived_at`)                                                                                                                                | `requireBrandRole` |
| `createDrop`     | POST   | `{ productId, headline?, dropsAt, endsAt?, isLimited? }` → `drops` row (surfaces product first on Drop Sheet)                                                                | `requireBrandRole` |

`upsertProduct` postcondition: `brand_id = context.principal.activeOrgId` —
the create handler reads it off the principal, never the body.

### 1.3 `reviews.functions.ts` — reviews (DELETE never suppress)

This domain encodes the product law: **one per budtender per product; budtenders
edit/delete OWN; admins DELETE violations but NEVER edit, NEVER hide.**

| Fn                     | Method | Input                                                        | Pre/post                                                                                                                                                                                                     | Authz                                                                                                 |
| ---------------------- | ------ | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `listReviews`          | GET    | `{ productId }` → reviews (name/store/date) + average        | —                                                                                                                                                                                                            | `requireUser`                                                                                         |
| `upsertMyReview`       | POST   | `{ productId, rating: "1<=number<=5", body: "string<=300" }` | **pre:** rating ∈ 1..5, body ≤ 300 (arktype + D1 CHECK defence-in-depth). **post:** UPSERT on `UNIQUE(brand_id, product_id, user_id)` — replaces the caller's own prior review in place; emits `review_left` | **owner-only**: `user_id = actor.id`; the unique index makes a second review an UPDATE, not a new row |
| `deleteMyReview`       | POST   | `{ reviewId }`                                               | hard `DELETE WHERE id=? AND user_id=?`                                                                                                                                                                       | **owner-only**                                                                                        |
| `deleteReview` (admin) | POST   | `{ reviewId }`                                               | hard `DELETE WHERE id=? AND brand_id=?` — **no `deleted_at`, no hide path by design** (`reviews` is the only hard-delete table, [02 §2.3](./02-data-model.md))                                               | `requireBrandRole`                                                                                    |

There is deliberately **no** `editReview`/`hideReview` admin fn — credibility is
the feature. `deleteReview` writes an audit row so removals are accountable
without being reversible-into-suppression.

### 1.4 `decks.functions.ts` — PK decks + flip tracking

PK decks are uploaded PDFs; the platform auto-derives cover thumbnail + page
count server-side (`unpdf` + Browser Rendering), and the flip-viewer renders
client-side with `pdfjs-dist` (no field rebuild — see
[§5](#5-pdf-handling-server-side-thumbnail--page-count)).

| Fn                   | Method | Input                                                                                                                              | Behaviour                                                                                                                                                                                                                                                         | Authz              |
| -------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `listDecks`          | GET    | `{}` → published `decks` (cover thumb ref, title, product line, page count, date)                                                  | —                                                                                                                                                                                                                                                                 | `requireUser`      |
| `getDeck`            | GET    | `{ deckId }` → deck + a roadie `getReadUrl({ referenceId: pdf_ref, disposition:"inline" })` for the flip-viewer; emits `deck_open` | resolves the R2 read URL on demand (cached)                                                                                                                                                                                                                       | `requireUser`      |
| `registerDeckUpload` | POST   | `{ title, productLine?, hash, size, contentType:"application/pdf", downloadAllowed? }`                                             | INSERTs a `decks` row (`status='draft'`, `pdf_ref=null`); roadie `registerUpload(application:{ app:"sprout", resourceType:"deck", resourceId })` → returns `{ deckId, referenceId, uploadUrl }` (presigned PUT). Listing row is **stable across PDF replacement** | `requireBrandRole` |
| `finalizeDeckUpload` | POST   | `{ deckId, referenceId }`                                                                                                          | roadie `finalize({ referenceId })`; sets `decks.pdf_ref=referenceId`; **enqueues** the `deck.derive` job (page count + cover thumb, **async** — the library card shows a `FileIcon` "processing" placeholder until done)                                          | `requireBrandRole` |
| `recordFlipDepth`    | POST   | `{ deckId, page, dwellMs }`                                                                                                        | UPSERT `deck_progress` on `UNIQUE(deck_id, user_id)`: `last_page = max(last_page, page)`, `time_spent_seconds += dwell`; emits `deck_flip` (the **flip-depth** analytics signal)                                                                                  | `requireUser`      |
| `getDeckDownloadUrl` | GET    | `{ deckId }`                                                                                                                       | only when `download_allowed=1`: roadie `getReadUrl({ disposition:"attachment", filename })`; emits `deck_download`                                                                                                                                                | `requireUser`      |

### 1.5 `assets.functions.ts` — store assets + physical requests

| Fn                              | Method | Input                                                                                                     | Behaviour                                                                                                                                                                                                                             | Authz                                   |
| ------------------------------- | ------ | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `listAssets`                    | GET    | `{ category?, q? }` → searchable `assets` (thumb, name, category, type, size)                             | everything opens **in-platform** (the `type` drives the viewer)                                                                                                                                                                       | `requireUser`                           |
| `getAssetUrl`                   | GET    | `{ assetId }`                                                                                             | roadie `getReadUrl` (`inline` for pdf/image/video, `attachment` for zip); bumps `assets.download_count` **+** emits `asset_download` in one txn                                                                                       | `requireUser`                           |
| `requestPhysical`               | POST   | `{ assetId, quantity, shipStreet, shipCity, shipProvince, shipPostal, contactName, contactPhone, note? }` | **pre:** asset.`physical_available=1`, `quantity ≤ physical_max_qty`. **post:** INSERT `physical_requests` (status `"Requested"`, `store` pre-filled from roster snapshot); emits `physical_request`; optional invite/notify to admin | `requireUser`                           |
| `listMyRequests`                | GET    | `{}` → caller's `physical_requests` with status (Requested→Approved→Shipped)                              | "My Requests"                                                                                                                                                                                                                         | `requireUser` (owner-scoped)            |
| `decidePhysicalRequest` (admin) | POST   | `{ requestId, decision:"approve"                                                                          | "ship"                                                                                                                                                                                                                                | "decline", tracking?, declineReason? }` | UPDATE `physical_requests.status`; on Ship sets `tracking`; on Decline sets `decline_reason`; emits a `notifications` row (fulfilment status) to the budtender | `requireBrandRole` (the **FULFILMENT QUEUE**) |

### 1.6 `quizzes.functions.ts` — quizzes + attempts + autosave

Quiz, attempt, and session logic is namespaced to the portal's `brand_id`
tenancy. Grading always happens server-side and results are redacted before
they reach the client — the client never receives (or computes) a trustworthy
score on its own.

| Fn                                                               | Method | Input                                                                                                                                                                                                                                               | Pre/post                                                                                                                                                                                                                                                                                                                                     | Authz                                     |
| ---------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `listQuizzes`                                                    | GET    | `{}` → brand-scoped + public quizzes (visibility: `brand_id IS NULL OR caller is a member`)                                                                                                                                                         | —                                                                                                                                                                                                                                                                                                                                            | `requireUser`                             |
| `startAttempt`                                                   | POST   | `{ quizId }`                                                                                                                                                                                                                                        | **pre:** reject if an `open` attempt exists. **post:** INSERT `attempts` (status `open`, `shuffle_seed`, `deadline_at`); returns **redacted** questions (`is_correct`/`weight` stripped server-side); emits `quiz_attempt_start`                                                                                                             | `requireUser`                             |
| `autosaveAttempt`                                                | POST   | `{ attemptId, answersJson, currentQuestion }`                                                                                                                                                                                                       | **owner-only** (`attempt.user_id === actor.id`); UPDATE `attempts.answers_json` + `current_question` **only while `status='open'`** — the resume buffer ([02 §5](./02-data-model.md) `attempts.answers_json`/`current_question`). Idempotent; debounced client-side                                                                          | owner-only                                |
| `resumeAttempt`                                                  | GET    | `{ attemptId }` → the open attempt's `answers_json` + `current_question` + redacted questions (stable shuffle via `shuffle_seed`)                                                                                                                   | rehydrates mid-quiz                                                                                                                                                                                                                                                                                                                          | owner-only                                |
| `submitAttempt`                                                  | POST   | `{ attemptId, answers[] }`                                                                                                                                                                                                                          | **pre:** `status='open'`, not past `deadline_at` (else transition `expired`, audit, reject). **post:** server-grades, writes immutable `attempt_answers`, sets `score`/`passed`/`status='submitted'`; first-pass-wins `certifications` insert if cert quiz; emits `quiz_attempt_submit` (+ `cert_awarded`); enqueues `attempt.completed` job | owner-only                                |
| `viewAttemptResult`                                              | GET    | `{ attemptId }` → score, pass/fail vs threshold, per-question breakdown (the result screen **always** reveals correct answers + the Brand-Admin explanation for wrong answers — [04 Surface 7](./04-ui.md) is canonical; no `feedbackVisible` gate) | —                                                                                                                                                                                                                                                                                                                                            | owner-only (admin path adds course-admin) |
| `upsertQuiz` / `upsertQuestion` / `upsertOption` (admin builder) | POST   | builder payloads (type ∈ multiple_choice/select_all/true_false/image/matching; threshold, retakes, cert name, leaderboard, time limit toggles)                                                                                                      | INSERT/UPDATE `quizzes`/`questions`/`question_options`; image questions carry `image_ref` (roadie)                                                                                                                                                                                                                                           | `requireBrandRole`                        |

Autosave note: `answers_json` is the in-flight buffer; `attempt_answers` rows are
written **only** at submit (immutable graded record) — the two are deliberately
separate ([02 §5](./02-data-model.md)).

`attempt.completed` job: (a) re-indexes the affected `user_brand_scores` inputs
for that `(user, brand, period)` but **defers the materialisation to the cron**
(leaderboard math lives in **one** place — the cron,
[§3.1](#31-leaderboard-materialisation-the-single-canonical-formula)); and
(b) renders/persists the certification badge artifact **if** a cert was awarded. This is the concrete render trigger reconciled with the
`jobs/queue.ts` "cert render" comment in [03](./03-app-structure.md).

### 1.7 `feed.functions.ts` — media feed (posts / comments / likes)

The feed ("Enter the Grow", brand-renameable via `portal_config.feed_label`) is
HTTP for posts and **real-time via the DO** for comments (see [§2](#2-real-time-api-the-durable-object)).

| Fn                   | Method | Input                                                                                                                                                     | Behaviour                                                                                                                                                                                                                                 | Authz                             |
| -------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| `listFeed`           | GET    | `{ cursor? }` → `posts` (newest-first, `posts_brand_created_idx`) with `media_count`/`like_count`/`comment_count` + `first_comment_json` preview snapshot | denormalized counters + `first_comment_json` (02 §6) → no joins on the cell                                                                                                                                                               | `requireUser`                     |
| `getPost`            | GET    | `{ postId }` → post + ordered `post_media` (carousel) + `productId` for `View Product Details →`; emits `post_view`                                       | —                                                                                                                                                                                                                                         | `requireUser`                     |
| `createPost` (admin) | POST   | `{ caption, mediaRefs[]:{ ref, kind, order }, productId? }`                                                                                               | INSERT `posts` + `post_media` (roadie refs); brand-team flagged; broadcasts to the feed DO                                                                                                                                                | `requireBrandRole`                |
| `deletePost` (admin) | POST   | `{ postId }`                                                                                                                                              | soft-delete `deleted_at` so the post leaves `listFeed`/`getPost` (its likes/comments/media survive but become unreachable); audited `post.delete`; DO broadcasts a `post.deleted` frame so an open overlay drops to "no longer available" | `requireBrandRole`                |
| `likePost`           | POST   | `{ postId }`                                                                                                                                              | idempotent on `post_likes` PK `(post_id, user_id)`; bumps `posts.like_count` txn; emits `post_like`; live count via DO                                                                                                                    | `requireUser` (optimistic client) |
| `addComment`         | POST   | `{ postId, body: "string<=500" }`                                                                                                                         | INSERT `comments` (≤500, text-only); bumps `comment_count`; refreshes `posts.first_comment_json` snapshot; emits `comment_create`; **fan-out via DO** so it appears real-time for everyone                                                | `requireUser`                     |
| `heartComment`       | POST   | `{ commentId }`                                                                                                                                           | idempotent on `comment_likes` PK; bumps `heart_count`                                                                                                                                                                                     | `requireUser`                     |
| `deleteComment`      | POST   | `{ commentId }`                                                                                                                                           | soft-delete `deleted_at`; refreshes `posts.first_comment_json` if it was the previewed comment; **authors delete own / admins delete any** (`from_brand`/role check); DO broadcasts a `comment.deleted` frame                             | owner-or-`requireBrandRole`       |

Brand replies are `comments.brand_team=1` → rendered with the Team marker
(visually distinct). The `brand_team`/`team` marker is derived **server-side** in
`createPost`/`addComment` from the caller's resolved org role
(`getCallerOrgRole == owner|admin ⇒ team=1`), **never** from client input — the
same forgery-surface rule as `brand_id`. The Team marker is a load-bearing trust
signal, so deriving it from the verified role closes the spoofing surface.
Closing the expanded post restores exact feed position (shell layer mechanism,
[03](./03-app-structure.md)).

### 1.8 `chat.functions.ts` — group chat

One persistent room per brand. Live traffic is the DO ([§2](#2-real-time-api-the-durable-object)); these fns are the durable/admin edges — the D1-backed history read and the admin moderation path.

| Fn                         | Method | Input                                                                         | Behaviour                                                                                                                 | Authz                  |
| -------------------------- | ------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| `ensureRoom`               | POST   | `{}` → the brand's `chat_rooms` row (UNIQUE per brand), creating on first use | —                                                                                                                         | `requireUser`          |
| `getRoomHistory`           | GET    | `{ beforeId?, limit? }`                                                       | RPC to the DO's `getHistory({ requestingUserId, beforeId, limit })` for scroll-up; durable log mirrors to `chat_messages` | `requireUser` (member) |
| `deleteAnyMessage` (admin) | POST   | `{ messageId }`                                                               | DO RPC `deleteAnyMessage(messageId)` after the org-role gate runs server-side; audit written here, not in the DO          | `requireBrandRole`     |

### 1.9 `contact.functions.ts` — contact (human channel, in-platform)

CONTACT reaches a HUMAN — **no email client**; a reply returns as an in-platform
**notification**, not a new channel.

| Fn                      | Method | Input                                           | Behaviour                                                                                                                                                                                                                        | Authz              |
| ----------------------- | ------ | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ | ---------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- | ------------- |
| `sendContact`           | POST   | `{ topic:"Restocking"                           | "Events"                                                                                                                                                                                                                         | "Assets"           | "Feedback" | "General", message }` (name/store/email pre-filled from roster snapshot) | INSERT `contact_threads` (status `open`) → Brand Admin inbox; optionally notify admins via promoter | `requireUser` |
| `listInbox` (admin)     | GET    | `{ status? }` → `contact_threads` for the brand | —                                                                                                                                                                                                                                | `requireBrandRole` |
| `replyToThread` (admin) | POST   | `{ threadId, body }`                            | INSERT `contact_replies` (`from_brand=1`) **AND** INSERT a `notifications` row (`type="contact_reply"`) for the thread author — that is how the reply reaches the budtender in-platform; sets `contact_threads.status='replied'` | `requireBrandRole` |

### 1.10 `ai.functions.ts` — AI assistant + booked calls

Trained on the brand's OWN content; escalates to **booking only**. See
[§4](#4-ai-assistant-integration) for the pipeline and [§6](#6-booking--video).

| Fn                        | Method | Input                                                                                                 | Behaviour                                                                                                                                                                                                                                                                                                                            | Authz              |
| ------------------------- | ------ | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------ |
| `askAssistant`            | POST   | `{ question }`                                                                                        | RAG over the brand's content ([§4](#4-ai-assistant-integration)); append `ai_qa_log` (question, answer, source, kind); emits `ai_question`. May return a `bookCall` escalation tool result — **never** an instant-call action                                                                                                        | `requireUser`      |
| `listSlots`               | GET    | `{}` → derived 1:1 slots from `availability_windows` minus taken `bookings`                           | booked slots vanish                                                                                                                                                                                                                                                                                                                  | `requireUser`      |
| `bookCall`                | POST   | `{ windowId, slotStartsAt, note? }`                                                                   | INSERT `bookings` on `UNIQUE(window_id, slot_starts_at)` (slot single-use), denormalizing `host_id` from the window; Join is enabled when `now >= slot_starts_at` and the Cloudflare Realtime session is created on first join (its id stored in `realtime_session_id`); emits `booking_created`. **1:1 only** (`isGroup=0` windows) | `requireUser`      |
| `addCustomQA` (admin)     | POST   | `{ question, answer, enabled? }`                                                                      | INSERT/UPDATE `ai_custom_qa` (augments grounding)                                                                                                                                                                                                                                                                                    | `requireBrandRole` |
| `listQuestionLog` (admin) | GET    | `{ kind? }` → `ai_qa_log` aggregated (top questions: what budtenders don't know / what customers ask) | —                                                                                                                                                                                                                                                                                                                                    | `requireBrandRole` |

**Guard — NO instant-call path.** There is no `startCallNow` server fn, no DO
"open room immediately" RPC, and no AI tool that opens a live room. The AI's only
escalation tool is `bookCall` (slot picker). This is enforced by _absence_:
`listSlots`/`bookCall` are the only call-related fns, and `bookings` has no
"now" branch ([02 §9](./02-data-model.md): "NO instant-call path").

### 1.11 `hub.functions.ts` — Hub / leaderboard / notifications

The one Sprout-branded surface (platform-wide, not brand-scoped).

| Fn                                             | Method   | Input                                                                                                                                     | Behaviour                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Authz                                                                                                                                                            |
| ---------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| `listMyPortals`                                | GET      | `{}` → the caller's brand memberships (guestlist org `member` rows + `org_brand_directory` for name/logo) with unread-notification badges | memberships are guestlist-owned, NOT in portal D1 ([02 §11](./02-data-model.md))                                                                                                                                                                                                                                                                                                                                                                                                                    | `requireUser`                                                                                                                                                    |
| `listJoinable`                                 | GET      | `{}` → brands the user can join (with a Request Access button)                                                                            | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `requireUser`                                                                                                                                                    |
| `requestAccess`                                | POST     | `{ brandId, message? }`                                                                                                                   | INSERT `portal_access_requests` on `UNIQUE(brand_id, user_id)` (no double-queue); queues for that Brand Admin                                                                                                                                                                                                                                                                                                                                                                                       | `requireUser`                                                                                                                                                    |
| `decideAccessRequest` (admin)                  | POST     | `{ requestId, decision:"approve"                                                                                                          | "decline" }`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | on approve: guestlist `addMember` (org plugin `member` insert — the **authoritative** membership) + emit `access_approved` notification; on decline: status only | `requireBrandRole` |
| `getLeaderboard`                               | GET      | `{ brandId?, period? }`                                                                                                                   | reads materialized `user_brand_scores` (platform-wide top-5 + own rank when unscoped; **brand-scoped top-N + own rank** when `brandId` given, via `user_brand_scores_leaderboard_idx (brand_id, period, score)`); **never** a live scan. The brand-scoped read powers **both** the Hub board and the in-portal **Brand Leaderboard** sub-tab in the Quizzes section ([04 Surface 7](./04-ui.md)) — same fn, no new data path. `brandId` here is membership-validated (see the exception note below) | `requireUser`                                                                                                                                                    |
| `getAward`                                     | GET      | `{ brandId, period? }` → `education_award` (covers text, countdown `closes_at`, semi-anonymous leader, user's gap to first)               | **Education Award framing** (fund / professional development — never prize/reward/cash)                                                                                                                                                                                                                                                                                                                                                                                                             | `requireUser`                                                                                                                                                    |
| `listNotifications` / `markRead`               | GET/POST | `{}` / `{ ids[] }` → `notifications` (`notifications_user_unread_idx`); `markRead` sets `read_at`                                         | unread badge                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `requireUser`                                                                                                                                                    |
| `getNotificationPrefs` / `setNotificationPref` | GET/POST | `{}` / `{ brandId, type, enabled }`                                                                                                       | per-user, **per-brand, per-type** prefs (`notification_prefs` PK `(user_id, brand_id, type)`); **NO global switch**. `type` ∈ the closed notification enum (02 §11): `new_post \| new_comment \| chat \| contact_reply \| session_reminder \| award \| access_approved \| fulfilment_status`                                                                                                                                                                                                        | `requireUser`                                                                                                                                                    |

**`brandId`-in-input exception (documented).** `notification_prefs` is
legitimately **cross-brand** — the Hub tunes prefs across **all** a user's
portals, so `activeOrgId` alone is insufficient. `setNotificationPref` (and
likewise `getLeaderboard`, `getAward`, `requestAccess`) therefore accept
`brandId` in the input as the **explicit, documented exception** to the
envelope-only rule: the handler binds `user_id = actor.id` from the envelope and
**asserts the caller has a guestlist `member` row for the supplied `brandId`**
before the upsert/read, else rejects. This is **not** a forgery surface because
the write/read is gated by the server-side membership check — the same guarantee
the forgery rule exists to provide.

### 1.12 `analytics.functions.ts` — analytics dashboards + CSV export

Reads aggregate from D1 `analytics_events` (and rollup tables); writes go through
the [analytics ingest path](#3-analytics-ingest--csv-export).

| Fn                   | Method | Input                 | Behaviour                                                                                                                                                                                                                                        | Authz              |
| -------------------- | ------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------ | ------ | -------------------- | ---------------------------------------------------------------------------------------------------- | ------------------ |
| `getBudtenderReport` | GET    | `{ userId, period? }` | per-budtender: deck time + pages reached, quiz grades/attempts, products viewed, reviews left, feed activity, sessions attended + join duration, assets downloaded, physical requests, AI questions, chat activity, monthly rank, certifications | `requireBrandRole` |
| `getDeckStats`       | GET    | `{ deckId }`          | opens / avg flip time / last page / downloads                                                                                                                                                                                                    | `requireBrandRole` |
| `getProductStats`    | GET    | `{ productId }`       | views / review count / avg stars                                                                                                                                                                                                                 | `requireBrandRole` |
| `getQuizStats`       | GET    | `{ quizId }`          | completion rate / avg grade / **most-missed question** (the single most actionable metric)                                                                                                                                                       | `requireBrandRole` |
| `exportCsv`          | POST   | `{ report:"budtender" | "deck"                                                                                                                                                                                                                                           | "product"          | "quiz" | "events", filters }` | streams CSV from D1 (Content-Disposition `attachment`); append-only `analytics_events` is the source | `requireBrandRole` |

The heavy rollups (leaderboard recompute, most-missed-question, award countdown,
banner expiry) run in `jobs/queue.ts`/`jobs/cron.ts` off the request path
(`handleQueueBatch`/`handleCron`, wired at the flat worker entry).

### 1.13 `sprout-admin.functions.ts` — cross-brand god-mode (platform admin)

The data layer behind the `/sprout-admin` routes ([03](./03-app-structure.md)).
All fns `.middleware([requireAdminMiddleware])`; cross-brand reads **bypass**
`brand_id` scoping via `isAdminRole` (god-mode) — the one place the
envelope-`brand_id` filter is intentionally lifted.

| Fn                   | Method | Input                           | Behaviour                                                                                                                                                                 | Authz                    |
| -------------------- | ------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `listBrands`         | GET    | `{}` → all brands (cross-brand) | reads `org_brand_directory` + `brand_theme`/`portal_config` across every org                                                                                              | `requireAdminMiddleware` |
| `provisionOrg`       | POST   | `{ name, slug, ownerEmail? }`   | calls guestlist over the `GUESTLIST` binding to **create the org**, then seeds `brand_theme` + `portal_config` rows + an `org_brand_directory` row (stamping `synced_at`) | `requireAdminMiddleware` |
| `getSystemHealth`    | GET    | `{}`                            | service-binding/queue/DO health rollup for the monitoring view                                                                                                            | `requireAdminMiddleware` |
| `getCrossBrandStats` | GET    | `{ period? }`                   | cross-brand aggregate counts (brands, members, attempts, sessions) — god-mode read                                                                                        | `requireAdminMiddleware` |

### 1.14 `sessions.functions.ts` — group sessions + 1:1 booking lifecycle

The lifecycle fns behind [§6](#6-booking--video). 1:1 booking
(`bookCall`/`listSlots`) lives in [§1.10](#110-aifunctionsts--ai-assistant--booked-calls)
since the AI escalates into it; the **group-session** register/join/leave path
and the shared cancel/admin edges live here.

| Fn                                 | Method | Input                                                                      | Behaviour                                                                                                                               | Authz                 |
| ---------------------------------- | ------ | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `listGroupSessions`                | GET    | `{}` → upcoming `group_sessions` (capacity, registered count, `starts_at`) | derived from `availability_windows` with `isGroup=1`                                                                                    | `requireUser`         |
| `registerSession`                  | POST   | `{ sessionId }`                                                            | INSERT `session_attendance.registered_at` on `UNIQUE(session_id, user_id)` honoring capacity; emits `session_register`                  | `requireUser`         |
| `joinSession`                      | POST   | `{ sessionId? , bookingId? }`                                              | stamps `joined_at`; opens/attaches the Cloudflare Realtime session (creating `realtime_session_id` on first join); emits `session_join` | `requireUser`         |
| `leaveSession`                     | POST   | `{ sessionId?, bookingId? }`                                               | stamps `left_at`, computes `durationSeconds` (feeds join-duration analytics)                                                            | `requireUser`         |
| `cancelBooking`                    | POST   | `{ bookingId }`                                                            | UPDATE `bookings.status='cancelled'`, freeing the slot back into the picker                                                             | `requireUser` (owner) |
| `upsertAvailabilityWindow` (admin) | POST   | `{ windowId?, isGroup, startsAt, endsAt, capacity?, hostId?, … }`          | INSERT/UPDATE `availability_windows` (1:1 vs group windows)                                                                             | `requireBrandRole`    |
| `upsertGroupSession` (admin)       | POST   | session payload                                                            | INSERT/UPDATE `group_sessions`                                                                                                          | `requireBrandRole`    |

**Booking model split.** `bookCall` + `bookings.UNIQUE(window_id,
slot_starts_at)` apply **only** to `isGroup=0` windows; group windows
(`isGroup=1`) surface as `group_sessions` rows that callers join via
`registerSession` against `session_attendance.UNIQUE(session_id, user_id)`
honoring capacity — **never** a `bookings` row. `listSlots` derives 1:1 slots
from `isGroup=0` windows only. A **session lifecycle cron** flips
`group_sessions` `scheduled → live → ended` and `bookings` `booked → completed`
around slot times; `ended`/`completed` ties to the recording-archive step
(`recording_ref` set on `ended`). The **session-reminder cron** fires against
`group_sessions.starts_at` (and booked-slot start) via promoter
([§7.3](#73-promoter--transactional-email-rpc-only)).

---

## 2. Real-time API: the Durable Object

Sprout's real-time layer is **one** Durable Object class, `GroupChatRoom`
(binding `GROUP_CHAT_ROOM`), bound to the portal worker. It backs **both group
chat and live feed comments** — a brand chat room and a post-comment room are
the same shape (durable message log in DO SQLite + presence + hearts), so a
second class would duplicate code for zero behavioural gain and enlarge the
irreversible `v1` migration set. The `v1` migration is **frozen** at
`migrations:[{ tag:"v1", new_sqlite_classes:["GroupChatRoom"] }]`. A future
`tag:"v2" new_sqlite_classes:["MediaFeedRoom"]` is a documented, additive
escape hatch — only if a single post's comment fan-out ever needs independent
hibernation/sharding — never shipped in `v1`.

### 2.1 DO class + lifecycle

```ts
export class GroupChatRoom extends Server<Env> {
  static options = { hibernate: true }; // zero-traffic room ≈ free
  async onStart() {
    /* IF NOT EXISTS DDL — re-fires on every wake */
  }
}
```

One DO **instance per room**, addressed per-room via `idFromName`:

- **group chat** = `idFromName(brandId)` — one instance per brand;
- **feed live-comments** = `idFromName(`${brandId}:${postId}`)` — one instance
  per post.

The `chat_rooms` + `presence` tables stay **group-chat-only** (no per-post room
rows). Feed-comment real-time is **not** mirrored to those tables: it is
DO-local ephemeral fan-out keyed by post id, while the durable comment log is
the D1 `comments` table. DO-local SQLite holds the hot message log for fast
`session.init` snapshots; the durable mirror + membership live in the portal's
**own D1** (`binding DB`), read via `getDb()`.

### 2.2 Transport + auth (zero-hop at the socket)

- **WS upgrade is intercepted at the worker entry** via
  `routePartykitRequest(stamped, env, { prefix: "ws" })` **before**
  `startEntry.fetch`, because TSS crashes on 101 responses. The dev-envelope
  stamper runs _before_ the WS branch so upgrades carry an envelope locally.
- **The DO verifies the envelope itself** in `onConnect` via
  `createBouncerEnvelopeVerifier`. Because one worker serves N brand hosts, the
  verifier derives `expectedHost` **per-connection** from the incoming
  WS-upgrade `Host` header, validates it matches the `*.sproutportal.ca`
  single-label wildcard pattern (mirroring bouncer `routes.ts`'s single-label
  rule), then resolves the leftmost label → org via `org_brand_directory`. For
  **authenticated** connections the DO then asserts the envelope principal's
  `activeOrgId === the resolved org_id` before admitting the socket — host +
  `activeOrgId` must **both** gate, so a member of brand A cannot open brand
  B's room even if a room id leaks. The **public-read** path requires only the
  label-shape match. Invalid/missing envelope or org mismatch →
  `conn.close(1008, "unauthenticated")`.
- **Membership gate.** On connect, if the user isn't in `memberCache` the DO
  either self-joins (`canSelfJoin`) or rejects `not_member`. Brand isolation:
  the room is per-brand, D1 reads inside the DO are `brand_id`-scoped, and the
  per-room `brand_id` scope is tied to the verified envelope `activeOrgId`
  (above).

### 2.3 Wire protocol (camelCase on the wire, snake_case in SQLite)

Client→server ops: `send`, `react`/heart, `edit`, `delete`, `read`, `pin`,
`typing`. Server→client frames: `session.init` (history + presence + `you`),
`message.created`, `message.deleted`, `presence.joined`/`presence.left`,
reaction summaries, `room.archived`.

For the **media feed** the same substrate carries comment frames:
`comment.created`, `comment.deleted`, `comment.hearted` (chronological,
real-time for everyone), plus live like-count updates. An admin `deletePost`
also fans out a `post.deleted` frame on the post's room so an open overlay
drops to "no longer available".

### 2.4 Fan-out, persistence, presence

- **Fan-out.** The DO holds open connections and `broadcast()`s frames to all
  clients in the room.
- **D1 reconciliation.** Server fns that mutate room/feed state in D1 then call a
  DO RPC (`refreshRoomState()`) so the live DO reflects the D1 change.
  `addComment`/`createPost`/`deleteComment` server fns write D1 then broadcast.
- **Persistence.** Two layers: DO-local SQLite (hot log) + portal D1
  (`chat_messages`, `comments` — the durable history that survives a DO reset),
  both `brand_id`-scoped.
- **Presence.** Authoritative live presence is DO-held (`presence.joined`/`left`
  on the 1→0 / 0→1 transitions); a coarse `presence` mirror table is flushed
  for "N online" without a socket ([02 §7](./02-data-model.md)).

---

## 3. Analytics ingest + CSV export

Two ingest paths feed the dashboards in [§1.12](#112-analyticsfunctionsts--analytics-dashboards--csv-export):

1. **D1 `analytics_events` (append-only) — the SOURCE OF TRUTH.** Every
   engagement server fn appends an event in the same txn as its mutation, and
   (where a read-cheap counter exists) bumps the denormalized column
   (`assets.download_count`, `banner_cards.clicks`, `posts.like_count`). An event
   is **always** one D1 row; `exportCsv` and every product surface read D1.
   Event-type vocabulary is the table in [02 §12](./02-data-model.md)
   (`deck_flip`, `product_view`, `review_left`, `quiz_attempt_submit`,
   `asset_download`, `physical_request`, `ai_question`, `comment_create`,
   `chat_message`, `session_join`, `booking_created`,
   `banner_impression`/`banner_click`, …). Never UPDATE/DELETE'd.
2. **Analytics Engine (`AE` binding) — OPTIONAL write-mostly firehose.** For the
   two high-rate types **only** — `deck_flip` dwell + session join duration — a
   fn **MAY** also `env.AE.writeDataPoint({ blobs, doubles, indexes })` to feed
   sampled trend charts. This is a **MAY, not a MUST**: AE is **never** read by
   `exportCsv` or any product surface, and `deck_flip` defaults to **D1-only**
   unless AE telemetry is explicitly enabled. Pinning D1 as authoritative and AE
   as an optional sampled mirror removes double-count/gap ambiguity. The `AE`
   binding / dataset `sprout_sprout_events` is pinned in
   [07 §1.1](./07-deployment.md) and declared in sprout's own wrangler config
   per env.

**CSV export** (`exportCsv`, `requireBrandRole`) streams from D1 — the
append-only `analytics_events` plus the rollup tables — with a
`Content-Disposition: attachment` response. Every report in the spec's analytics
inventory (per-budtender, per-deck, per-product, per-quiz incl. most-missed
question, AI question log) is a query over these two surfaces. Heavy aggregation
(most-missed question, leaderboard recompute) is materialized by the
`queue`/`cron` jobs so `exportCsv` and the dashboard loaders read pre-aggregated
rows.

### 3.1 Leaderboard materialisation (the single canonical formula)

The leaderboard cron (`jobs/cron.ts`) is the **only** place scoring math lives
(`getLeaderboard` only **reads** `user_brand_scores`, never computes). Per
`(user, brand, period)` with `period` = calendar-month `"YYYY-MM"`:

- `quizPoints` = `100 * (Σ best passing-attempt grade% per quiz) / (# published
quizzes that period)`, capped at 100.
- `deckPoints` = `100 * (decks with deck_progress.last_page >= page_count) /
(published decks)` + a `0..20` engagement bonus
  `= min(20, total deck time_spent_seconds / 3600 * 5)`.
- `activityPoints` = `min(100, 4*comments + 2*post_likes + 10*session_join +
5*session_register + 1*chat_message)` over the period.
- `score = round(0.55*quizPoints + 0.30*deckPoints + 0.15*activityPoints)`,
  written with the three components into
  `user_brand_scores.{quiz_points, deck_points, activity_points, score}`.

Weights front-load learning (quizzes + decks = 85%) over social activity per the
education-funded framing; normalisation makes a 3-quiz brand comparable to a
30-quiz brand; hard caps stop activity farming. Ties break deterministically by
earliest `computed_at` then `user_id`. The platform-wide Hub board **sums**
`score` across the user's brands for the **current** period; "Last Month's
Winner" / the Education Award reads the **prior closed** period's row. The three
weights + activity coefficients live in a single `SCORE_WEIGHTS` const in
`jobs/cron.ts` so retuning is one line. Columns/semantics are authored in
[02 §11](./02-data-model.md).

---

## 4. AI assistant integration

The persistent bottom-right bubble, trained on the **brand's OWN content** (Drop
Sheet products, PK deck text, asset metadata) + Brand-Admin custom Q&A. No
AI/streaming primitive exists in the repo today (grep-confirmed), so this is
built from scratch on **Workers AI + Vectorize** (settled, [§4.2](#42-embeddings--generation)),
with the **Vercel AI SDK** as the streaming client — the `ai-sdk` skill is
available.

### 4.1 Where it runs

Server-side in the portal worker, behind `requireUserMiddleware`, as
`askAssistant` in `src/lib/ai/*`. `env` is never read at module top level
(`createServerOnlyFn` for any binding access).

### 4.2 Embeddings + generation

Embeddings are produced by the **Workers AI** binding (`env.AI`) with
`@cf/baai/bge-base-en-v1.5` (768-dim — the Vectorize index dimension is set to
**768** to match); vectors live in **Cloudflare Vectorize**. **Generation runs on
Workers AI via `env.AI`** behind the AI module's single `generate()` seam, using
`@cf/meta/llama-3.1-8b-instruct` (or the current CF-recommended instruct model at
build time). This keeps generation in-grain with the all-Workers / zero-extra-secret
architecture; the brand-scoped RAG corpus is small, so an 8B instruct model is
adequate, and the `generate()` seam makes swapping to an external LLM a one-file
change if eval quality demands it. **No AI secret is provisioned for v1** (binding
path); the external-LLM `SecretSpec` is a documented opt-in (provided secret
scoped to `['sprout']`), **not provisioned**. The streaming client is the
**Vercel AI SDK** (`ai` + `@ai-sdk/react` `useChat`) with `askAssistant`
returning a streamed `Response` (the `ai-sdk` skill is the intended client).
**Only the final generation call may leave the platform** — embedding + retrieval
are on-platform — and for INV-1 coverage the system-prompt template +
`ai_custom_qa` seed content are in the forbidden-term grep scope.

### 4.3 Retrieval pipeline (grounded, brand-scoped)

```
Brand-Admin content  →  index  →  retrieve  →  ground  →  generate
─────────────────────────────────────────────────────────────────
Drop Sheet products (THC/CBD, terpenes, effects, talking points)
PK deck text (extracted from the R2 PDF via roadie getReadUrl)
asset metadata + ai_custom_qa rows
        │
        ▼  (queue job on content change)
Workers AI embed → Cloudflare Vectorize upsert (vector + { brand_id } metadata);
  chunk text + vectorize_id mirrored to ai_embeddings (02 §10) for citation
        │
        ▼  askAssistant({ question })
Workers AI embed question → Vectorize query topK, filter brand_id = activeOrgId
  → fetch chunk text from ai_embeddings              ← cannot cross brands
        │
        ▼
prompt = system grounding + retrieved brand chunks + custom Q&A
        │
        ▼
LLM generate  →  answer  →  append ai_qa_log (source, kind, sourceId)
```

- **Brand isolation.** Every vector in the **Vectorize** index carries a
  `brand_id` metadata field; queries filter
  `brand_id = context.principal.activeOrgId` so RAG **cannot** cross brands
  ([01 §8,§10](./01-architecture.md)). `ai_embeddings` (02 §10) mirrors each
  chunk's text + `vectorize_id` + provenance in the portal D1 for citation and
  re-indexing. Deck/asset source blobs are roadie references scoped to
  `caller_app:"sprout"`; the AI module reads their text via
  `roadie.getReadUrl(...)`.
- **Grounding only on owned content.** The system prompt instructs the model to
  answer product/strain questions ("strongest indica?", "what for a customer who
  wants sleep?") and navigation ("where are display templates?") **from the
  retrieved brand chunks**, and to escalate to booking when it can't help.

### 4.4 Escalation tool — booking only (the guard)

The AI's only tool is a **`bookCall` escalation** that surfaces the brand's
published slot picker ([§1.10](#110-aifunctionsts--ai-assistant--booked-calls),
[§6](#6-booking--video)). There is **NO instant-call path**: no `startCallNow`
server fn, no DO "open room now" RPC, no AI tool that opens a live room. The AI
escalates by returning a `bookCall` action (slot picker) — booked slots vanish,
Join goes live at start time. The legacy MTL "instant video call" / "Start Call
Now" copy is removed (product law).

### 4.5 Question log + custom Q&A

Every question appends `ai_qa_log` (append-only, `brand_id`-scoped:
question/answer/source/kind/`escalated_booking_id`) → the Brand-Admin "top
questions" analytics (`listQuestionLog`). Brand Admins add `ai_custom_qa` rows
(`addCustomQA`) that augment grounding and review the question log.

---

## 5. PDF handling: server-side thumbnail + page count

**No field-by-field rebuild** — the platform auto-generates the cover thumbnail
and page count from the uploaded PDF; replace = new PDF, same listing row
([02 §3](./02-data-model.md), [03](./03-app-structure.md)).

The renderer is **split by environment** (a pure-WASM rasteriser in a plain
Worker is fragile/heavy):

- **Client flip-viewer** — **`pdfjs-dist`** (pdf.js) in the browser, fetching the
  inline `getReadUrl({ referenceId, disposition:"inline" })` PDF and rasterising
  page N to canvas on demand (pinch/zoom, no Worker PDF runtime).
- **Server-side derive job** — **`unpdf`** (Workers-targeted) reads `page_count`
  **and** extracts text for the AI corpus, and the Cloudflare **Browser
  Rendering** binding (binding `BROWSER`) takes a headless screenshot of page 1
  for the page-1 PNG thumbnail. Browser Rendering is the supported CF path for
  PDF→image in a Worker; `unpdf` gives count + corpus text without native deps.

Flow:

1. `registerDeckUpload` → roadie `registerUpload({ hash, size, contentType:
"application/pdf", application:{ app:"sprout", resourceType:"deck",
resourceId } })` → presigned PUT; client uploads the PDF bytes; `finalizeDeckUpload`
   calls roadie `finalize({ referenceId })`. D1 stores **only** `decks.pdf_ref`.
2. `finalizeDeckUpload` enqueues a `deck.derive` job
   (`env.SPROUT_JOBS_QUEUE.send` — the generic `*_JOBS_QUEUE` resolves to the
   canonical `SPROUT_JOBS_QUEUE` binding pinned in
   [07 §1.1](./07-deployment.md); fire-and-forget, not awaited by the caller).
3. The **queue handler** (`jobs/queue.ts`, `handleQueueBatch`, **async**):
   fetches the PDF bytes via roadie `getReadUrl`; runs `unpdf` to count pages +
   extract text (the latter feeds the AI corpus); takes a page-1 screenshot via
   the Browser Rendering (`BROWSER`) binding → PNG; then `put`s the thumbnail
   through roadie
   (`put({ application:{ resourceType:"deck-thumb", resourceId:deckId }, body })`
   — server-side streaming, bytes never buffer in the Worker,
   `workers/roadie/src/methods/upload.ts:820-828`). It writes
   `decks.cover_thumb_ref` + `decks.page_count` back to D1. Until this job
   completes the library card shows a `FileIcon` "processing" placeholder.

The listing row (`decks.id`) is stable across PDF replacement: replacing the PDF
mints a new `pdf_ref` and re-runs the derive job, but the same `decks` row and
its `title`/`product_line` persist.

---

## 6. Booking / video

**Booking only — no instant calls, ever** (including from the AI;
[§4.4](#44-escalation-tool--booking-only-the-guard)).

- **Booked-slot model (1:1 only).** `availability_windows` with `isGroup=0`
  (brand-published) → `listSlots` derives 1:1 slots from those windows only →
  `bookCall` INSERTs a `bookings` row on `UNIQUE(window_id, slot_starts_at)`,
  making a slot **single-use** (it vanishes from the picker) and denormalizing
  `host_id` from the window. There is **no `join_at` column**: Join is enabled
  when `now >= slot_starts_at`, and the Cloudflare Realtime session is created
  on first join with its id stored in `bookings.realtime_session_id`. Status
  `booked | cancelled | completed`. `cancelBooking` sets `status='cancelled'`,
  freeing the slot.
- **Group sessions.** `availability_windows` with `isGroup=1` surface as
  `group_sessions` rows (Register → reminders → Join), **not** `bookings` rows;
  `registerSession` honors capacity on `session_attendance.UNIQUE(session_id,
user_id)`. `session_attendance` tracks `registered_at`/`joined_at`/`left_at`
  (join duration feeds analytics). A session lifecycle cron flips
  `group_sessions` `scheduled → live → ended` (and 1:1 `bookings`
  `booked → completed`) around slot times; on `ended`, the recording is archived
  to roadie R2 and the handle stored in `group_sessions.recording_ref`
  ([02 §9](./02-data-model.md)). Status `scheduled | live | ended | cancelled`.
- **Room transport — Cloudflare Realtime via RealtimeKit (specified contract).**
  The in-platform room uses the **RealtimeKit Core SDK** (client) +
  **RealtimeKit REST** (server, to mint the meeting/session + auth tokens) —
  **not** the raw SFU push/pull-tracks API, which would require hand-building
  track negotiation / presence / recording. The session is created on first
  join and its id stored in `bookings.realtime_session_id` /
  `group_sessions.realtime_session_id`. The RealtimeKit app id + secret are new
  wrangler secrets (provided `SecretSpec` scoped to `['sprout']`).
- **Recording egress (specified contract — recordings are blocked without it).**
  Enable **RealtimeKit managed recording** with an S3-compatible output
  configured to write to the project's R2 bucket (the same R2 credentials roadie
  uses). On the recording-complete webhook, register the object with roadie via
  `put({ application:{ resourceType:"session-recording", resourceId: sessionId } })`
  to mint `recording_ref`, stored on `bookings` / `group_sessions`. Routing
  recordings through roadie keeps every blob under `caller_app:"sprout"`. The
  substrate also fixes the booked-slot model (D1), the **absence** of any
  instant-call path, and reminders via promoter ([§7.3](#73-promoter--transactional-email-rpc-only)).

---

## 7. Service bindings (the surveyed contracts)

All three are reached **only over service bindings** (never cross-origin); every
call carries `caller_app: "sprout"` + the request envelope/actor. roadie/promoter
have **no public HTTP** (default `fetch` 404s — `workers/promoter/src/index.ts:169-173`).

### 7.1 guestlist — auth / org / session / membership / access-request

Reached via `createGuestlistFactory({ callerApp:"sprout", … })`
(`lib/guestlist.ts`); also a `/api/$` catch-all reverse-proxies to guestlist over
the binding so the browser stays same-origin (cookies auto-attach, no CORS).

- **Session/identity.** Zero-hop on the envelope (`context.principal`); explicit
  `getSession`/org calls only where plugin-extended BA fields are needed.
- **Org role.** `getCallerOrgRole(orgId)` →
  `getGuestlist().auth.organization.getActiveMemberRole({ query:{ organizationId }})`
  — the per-org owner/admin/member role, distinct from the platform role.
- **Membership / roster / invitations (Brand Admin).** Via the org-admin Eden
  routes (`workers/identity/src/lib/org-admin.functions.ts:143-225`):
  `addOrgMember`, `updateOrgMemberRole`, `removeOrgMember`, `createOrgInvitation`,
  `cancelOrgInvitation`. `decideAccessRequest`'s **approve** path calls
  `addOrgMember` — the guestlist `member` insert is the **authoritative**
  membership (the portal's `portal_access_requests` is only the queue,
  [02 §11](./02-data-model.md)).
- **Public org lookup.** Host→org for the unauth landing render uses the
  `org_brand_directory` mirror (or a guestlist hop); `organization.slug` is
  UNIQUE.
- **Directory refresh = guestlist org-hook push (primary) + hourly cron
  reconcile (backstop).** On org create/update/slug-change/membership-change,
  guestlist fires a better-auth org `databaseHook` (`afterCreate`/`afterUpdate`)
  that RPC-calls a sprout server fn `syncOrgDirectory({ orgId, slug, name,
logoRef })`, which upserts `org_brand_directory` and stamps `synced_at`. This
  push is **authoritative for onboarding latency** — a new brand's
  `<slug>.sproutportal.ca` must resolve immediately after provisioning. An
  **hourly reconciliation cron** in `jobs/cron.ts` re-syncs rows whose
  `synced_at` is stale/missing (drop-recovery). `scripts/seed.ts` writes
  directory rows **directly** (it owns the demo orgs) so tests don't depend on
  the live webhook. Isolation: the public render derives `brand_id` from the
  resolved org, never from input, so a stale mirror only shows an old name/logo —
  never another brand's data.
  **Emitter prerequisite:** if guestlist's org plugin exposes a usable
  `databaseHook`, wire `syncOrgDirectory` there; if it has **no** usable hook
  surface yet, building that emitter (or a thin Reflect-resolved sprout RPC
  guestlist can call) is a concrete provisioning prerequisite (§8) — until it
  lands, fall back to **cron-only at 5-minute cadence** and accept up to ~5 min
  onboarding latency (**default — change to the webhook the moment the emitter
  ships**).

### 7.2 roadie — R2 upload/serve (asset files, deck PDFs, feed media, recordings)

Wrap the binding with `createRoadieClient(env.ROADIE, { callerApp:"sprout",
getRequestId, getActor })` (`workers/roadie/src/client/index.ts:47`) or
`createRoadieFactory`. Every RPC takes a required `meta` `{ actor, requestId,
callerApp }` as the **last** argument; the client builds it (anonymous folds to a
service actor, `client/index.ts:96-101`).

- **Upload.** `registerUpload({ hash, size, contentType, application:{ app:"sprout",
resourceType, resourceId } })` → `{ status:"ready"|"single-part"|"multipart",
referenceId, blobId, upload? }` (`upload.ts:42-75`). Content-addressable global
  **dedup** on hash. Client PUTs bytes to the presigned URL →
  `finalize({ referenceId })` (`upload.ts:599`). Large files use
  `signPart`/`recordPart`/`finalize`. Store **only** the returned `referenceId`
  (text) on the domain row.
- **Server-side put.** `put({ hash, size, contentType, application, body:
ReadableStream|ArrayBuffer })` (`upload.ts:803-828`) streams consumer-held bytes
  through the R2 binding without Worker buffering — used by the deck-thumbnail
  job ([§5](#5-pdf-handling-server-side-thumbnail--page-count)).
- **Serve.** `getReadUrl({ referenceId, disposition:"inline"|"attachment",
filename, permissionScope, lifetimeSeconds })` → `{ url, expiresAt, cached }`
  (presigned GET, cached in `signed_url_cache`, `read.ts:34`). PK decks open in
  the flip-viewer (`inline`); assets open in-platform; downloads use `attachment`.
- **Caller scoping.** A `referenceId` minted under a different `caller_app` is
  treated as `reference_not_found` (`read.ts:65`); roadie scopes by `caller_app`
  **first**, so do **not** rely on `resourceType` namespacing alone.
  **Migration note (backfill).** For **greenfield forks** this is a **no-op** —
  no legacy blobs exist; all sprout blobs are minted under `caller_app:"sprout"`
  from the skeleton onward ([09 §7](./09-roadmap-and-cadence.md) "greenfield
  brands need no move"). For a fork **carrying existing quiz/chat data**, run a
  one-time migration script in `workers/sprout` that re-registers each legacy blob
  under `caller_app:"sprout"` with the appropriate sprout `resourceType` and
  rewrites the D1 `*_ref` handles. roadie dedup is global on content hash, so
  this is a **metadata-only re-reference, not a byte copy**. Gate on the
  [09 §8](./09-roadmap-and-cadence.md) "does any fork carry existing quiz/chat
  rows?" prerequisite; greenfield = no-op, data-carrying fork = one-time
  re-register-under-sprout backfill (P2.D quiz / P3 chat). See
  [01 §9](./01-architecture.md), [03](./03-app-structure.md).

resourceType namespaces used by the portal: `deck`, `deck-thumb`, `asset`,
`asset-thumb`, `feed-media`, `product-hero`, `brand-logo`, `hero-slide`,
`quiz-image`, `session-recording`.

### 7.3 promoter — transactional email (RPC-only)

Bind `{ binding:"PROMOTER", service:"sprout-promoter",
entrypoint:"Promoter" }`; call `env.PROMOTER.send(input, meta)`
(`workers/promoter/src/index.ts:76-166`). `send` is discriminated by `kind`;
the provider auto-switches CF Email binding vs Resend per env (`index.ts:90-93`).
**Adding a template = a new `kind` union arm in promoter + redeploy**
(`index.ts:22-47`).

Portal email uses (new union arms vs the existing
verification/reset/magic-link/org-invitation set):

| Use                     | Template `kind` (new)                                                                                                   | Triggered by                                             |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Roster invites          | `organization-invitation` (existing)                                                                                    | `createOrgInvitation`                                    |
| Contact replies         | surfaced in-platform as a `notifications` row, **not** email — but an optional `contact-reply` digest arm can mirror it | `replyToThread`                                          |
| Session reminders       | `session-reminder` (new)                                                                                                | `cron` before `group_sessions.starts_at` / a booked slot |
| Access-request decision | `access-decision` (new)                                                                                                 | `decideAccessRequest`                                    |
| Fulfilment status       | `fulfilment-status` (new)                                                                                               | `decidePhysicalRequest`                                  |

Contact replies land **primarily** as an in-platform notification
([§1.9](#19-contactfunctionsts--contact-human-channel-in-platform)) — promoter is
the optional out-of-band mirror, never the primary contact channel (the platform
is 100% in-platform).

**Idempotency for cron/queue-triggered sends.** Because cron/queue handlers
retry, every send fired off a job passes an `idempotencyKey`:
`session-reminder` keyed `reminder:${sessionId|bookingId}:${reminderOffset}`;
`fulfilment-status` keyed `fulfilment:${requestId}:${status}`
(`workers/promoter/src/index.ts:30-32`). **User-triggered** sends (contact
notify) need no key.

**Roster invites have a single sender.** Invites go through guestlist's
org-plugin invitation flow, which **already** sends the `organization-invitation`
email; the portal must **not** also call `promoter.send` for invites — it only
calls the guestlist `createOrgInvitation` Eden route. This removes the
double-send risk.

---

## 8. Settled decisions (formerly open) + implementation prerequisites

The items that were open are now decided; each is specified in-body above. Recap:

- **AI generation + embeddings store — SETTLED.** Generation runs on **Workers
  AI** (`env.AI`, `@cf/meta/llama-3.1-8b-instruct` or the current CF-recommended
  instruct model) behind the AI module's single `generate()` seam; **no AI
  secret in v1** (binding path), the external-LLM `SecretSpec` is a documented
  opt-in (scoped to `['sprout']`), not provisioned. Embeddings use
  `@cf/baai/bge-base-en-v1.5` (768-dim); vectors live in **Cloudflare Vectorize**
  (index dimension 768) — there is **no** D1-blob vs external-vector-store choice
  left; Vectorize is settled, only generation was ever open ([§4.2](#42-embeddings--generation)).
  Streaming client = Vercel AI SDK (`ai` + `@ai-sdk/react`).
- **In-platform room transport — SETTLED.** **Cloudflare Realtime via RealtimeKit
  Core SDK (client) + RealtimeKit REST (server)**, with managed recording
  egressing to the project R2 bucket and registered through roadie under
  `caller_app:"sprout"` ([§6](#6-booking--video)). RealtimeKit app id + secret
  are provided wrangler secrets scoped to `['sprout']`.
- **One DO class — SETTLED.** **One** class `GroupChatRoom` (binding
  `GROUP_CHAT_ROOM`); group chat = `idFromName(brandId)`, feed comments =
  `idFromName(`${brandId}:${postId}`)`. `v1` is frozen at
  `new_sqlite_classes:["GroupChatRoom"]`; `MediaFeedRoom` is a documented future
  `tag:"v2"` escape hatch only ([§2](#2-real-time-api-the-durable-object)).
- **Per-request `expectedHost` for the DO verifier — SETTLED.** Derived
  per-connection from the WS-upgrade `Host` header, validated against the
  `*.sproutportal.ca` single-label wildcard, then resolved to an org; for
  authenticated connections the envelope `activeOrgId === resolved org_id` is
  also asserted ([§2.2](#22-transport--auth-zero-hop-at-the-socket)).
- **roadie blob backfill — SETTLED.** Greenfield forks = **no-op**; a
  data-carrying fork runs a one-time metadata-only re-reference under
  `caller_app:"sprout"` ([§7.2](#72-roadie--r2-uploadserve-asset-files-deck-pdfs-feed-media-recordings)).
- **promoter idempotency — SETTLED.** Cron/queue-triggered sends pass an
  `idempotencyKey` (`reminder:…`, `fulfilment:…`); invites have a single sender
  in guestlist ([§7.3](#73-promoter--transactional-email-rpc-only)).

### Implementation prerequisites (provisioning facts, not design unknowns)

These are external/provisioning steps this surface depends on:

1. **Vectorize index** created with **dimension 768** (matching
   `@cf/baai/bge-base-en-v1.5`) and a `brand_id` metadata filter.
2. **Browser Rendering** binding enabled on the account and added as `BROWSER`
   to the sprout `wrangler.jsonc` (alongside `AI` and `VECTORIZE`) — required by
   the `deck.derive` thumbnail step.
3. **RealtimeKit** app created; app id + secret added as **provided** wrangler
   secrets scoped to `['sprout']` for local/staging/production, with managed
   recording's S3-compatible output targeting the project R2 bucket.
4. **roadie R2 bucket + S3/SigV4 credentials** (the `S3_*` roadie secrets)
   provisioned before any non-local roadie upload/serve or recording egress.
5. **guestlist org-hook emitter** built (better-auth org `databaseHook` →
   RPC to sprout's `syncOrgDirectory`) if guestlist exposes no usable hook
   surface yet; until it lands, run `org_brand_directory` sync **cron-only at
   5-min cadence** ([§7.1](#71-guestlist--auth--org--session--membership--access-request)).
6. **Fork data check:** confirm whether any target fork carries existing
   quiz/chat production rows; if all greenfield, the roadie re-reference backfill
   is a no-op, else schedule it P2.D (quiz) / P3 (chat).
