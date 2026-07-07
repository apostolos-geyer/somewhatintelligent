/**
 * Sprout portal D1 schema — the walking skeleton's first slice.
 *
 * Owns ONLY the two tables needed to resolve a host → brand and render that
 * brand's runtime skin: `org_brand_directory` (slug → org mirror) and
 * `brand_config` (the per-org runtime theme/sections). The rest of the authored
 * model in docs/sprout/02-data-model.md lands one migration per epic via
 * `db:generate` (migrations-before-code).
 *
 * Conventions (02 §Conventions): text ULID PKs, nullable+indexed `brand_id`
 * where a public variant exists, snake_case columns, integer epoch-ms
 * timestamps. NO foreign key to guestlist's org/user/member — those live in a
 * different database and are referenced by value. `brand_id`/`org_id` is ALWAYS
 * derived from the verified envelope or host→org resolution, never from input.
 */
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { DEFAULT_FEED_LABEL } from "./lib/feed-label";

/**
 * Read-only mirror of guestlist's org plugin so the public/unauth portal render
 * can resolve host→org WITHOUT a cross-service hop on every cold request. Source
 * of truth is ALWAYS guestlist; never written by Brand Admin directly. Refreshed
 * by a guestlist org-hook push (authoritative for onboarding latency) + an hourly
 * reconcile cron (drop-recovery). `scripts/seed.ts` writes rows directly so tests
 * don't depend on the live webhook. Isolation holds because the public render
 * derives `brand_id` from the RESOLVED org, never from input — a stale mirror
 * only shows an old name/logo, never another brand's data.
 */
export const orgBrandDirectory = sqliteTable(
  "org_brand_directory",
  {
    orgId: text("org_id").primaryKey(), // = guestlist organization.id (by value)
    slug: text("slug").notNull(), // = organization.slug (UNIQUE host label)
    name: text("name").notNull(),
    logoRef: text("logo_ref"), // roadie referenceId, or null
    syncedAt: integer("synced_at").notNull(),
  },
  (t) => [uniqueIndex("org_brand_dir_slug_idx").on(t.slug)],
);

/**
 * The runtime brand SKIN for ONE org's portal — theme tokens ONLY (colours,
 * radius/spacing, fonts, mode policy). This is one of the two halves the old
 * `brand_config` split into: the THEME path (this table) blocks first paint via
 * the root route, while portal CONTENT config (`portal_config`) is fetched by
 * the portal page in parallel. Loaded per request from host→org; the tokens are
 * injected as a scoped <style> that redefines --color-* / --font-* in
 * __root.tsx.
 *
 * Draft-vs-live: Brand Admin edits the DRAFT column; "Publish" copies draft →
 * live and stamps live_published_at. The public portal reads only live; the
 * admin preview reads draft. The theme is the only surface that keeps the
 * draft/live lifecycle — content config went live-edit (like hero slides).
 */
export const brandTheme = sqliteTable(
  "brand_theme",
  {
    id: text("id").primaryKey(), // ULID
    orgId: text("org_id").notNull(), // = organization.id (by value, indexed unique)

    // Theme — v2 BrandTheme JSON: { modePolicy, fixedMode, light, dark, radius,
    // spacing, fonts } (see lib/brand.ts parseBrandTheme).
    liveThemeJson: text("live_theme_json").notNull().default("{}"),
    draftThemeJson: text("draft_theme_json").notNull().default("{}"),

    // Draft/live lifecycle
    state: text("state").notNull().default("draft"), // draft | live
    livePublishedAt: integer("live_published_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [uniqueIndex("brand_theme_org_idx").on(t.orgId)],
);

/**
 * Portal CONTENT config for ONE org — the non-theme half of the old
 * `brand_config`: display identity overrides (name, tagline, logo) and the
 * portal-shape knobs (section toggles, feed label). LIVE-EDIT: every save is
 * immediately public (no draft/live flip), matching hero slides' per-item
 * `enabled` model. Read by the portal page loader in parallel with hero slides
 * — never by the root route, so editing content can't invalidate the skin path.
 */
export const portalConfig = sqliteTable(
  "portal_config",
  {
    id: text("id").primaryKey(), // ULID
    orgId: text("org_id").notNull(), // = organization.id (by value, indexed unique)

    // Display identity. `name`/`logo_ref` override the org_brand_directory
    // mirror when set; tagline is hero copy.
    name: text("name").notNull(),
    tagline: text("tagline").notNull().default(""),
    logoRef: text("logo_ref"), // roadie referenceId (R2); D1 holds the handle only

    // Section toggles + order. JSON array of { key, enabled, order } where key ∈
    // assets | decks | quizzes | feed | chat | contact. The ONE canonical six-key
    // enum used 1:1 for both sections_json AND the ?section= URL param.
    sectionsJson: text("sections_json").notNull().default("[]"),

    // The brand-renameable media feed label ("Enter the Grow" by default).
    feedLabel: text("feed_label").notNull().default(DEFAULT_FEED_LABEL),

    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [uniqueIndex("portal_config_org_idx").on(t.orgId)],
);

// ─── P1 — Landing (hero + banners) ──────────────────────────────────────────

/** Rotating HERO carousel slides behind logo+tagline on the landing. */
export const heroSlides = sqliteTable(
  "hero_slides",
  {
    id: text("id").primaryKey(),
    brandId: text("brand_id").notNull(), // = org_id
    imageRef: text("image_ref").notNull(), // roadie referenceId (R2)
    category: text("category"),
    headline: text("headline"),
    orderIdx: integer("order_idx").notNull(),
    enabled: integer("enabled").notNull().default(1),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("hero_slides_brand_order_idx").on(t.brandId, t.orderIdx)],
);

/** Brand banner cards flanking the hero. Live/expiry windowed, dismissible. */
export const bannerCards = sqliteTable(
  "banner_cards",
  {
    id: text("id").primaryKey(),
    brandId: text("brand_id").notNull(),
    categoryTag: text("category_tag"),
    headline: text("headline").notNull(),
    line: text("line").notNull().default(""),
    // { section, item } JSON — in-platform link only, NEVER an external URL.
    linkJson: text("link_json").notNull().default("{}"),
    dismissible: integer("dismissible").notNull().default(1),
    liveFrom: integer("live_from"), // epoch-ms; null = live now
    expiresAt: integer("expires_at"), // epoch-ms; null = no expiry
    impressions: integer("impressions").notNull().default(0),
    clicks: integer("clicks").notNull().default(0),
    orderIdx: integer("order_idx").notNull().default(0),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("banner_cards_brand_idx").on(t.brandId),
    index("banner_cards_window_idx").on(t.brandId, t.liveFrom, t.expiresAt),
  ],
);

/** Per-user dismissal of a dismissible banner (sticky across sessions). */
export const bannerDismissals = sqliteTable(
  "banner_dismissals",
  {
    bannerId: text("banner_id")
      .notNull()
      .references(() => bannerCards.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    dismissedAt: integer("dismissed_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.bannerId, t.userId] })],
);

// ─── P1.D — Store assets (+ P4.A physical requests) ─────────────────────────

/**
 * A library asset. The file is an R2 blob (roadie); D1 holds metadata + the
 * reference handle. `type` (pdf|image|video|zip) drives the in-platform opener.
 * Physical-availability flags exist now but are inert until P4.A.
 */
export const assets = sqliteTable(
  "assets",
  {
    id: text("id").primaryKey(),
    brandId: text("brand_id").notNull(),
    name: text("name").notNull(),
    category: text("category"),
    type: text("type").notNull(), // pdf | image | video | zip
    fileRef: text("file_ref").notNull(), // roadie referenceId (R2)
    thumbRef: text("thumb_ref"),
    sizeBytes: integer("size_bytes").notNull().default(0),
    physicalAvailable: integer("physical_available").notNull().default(0),
    physicalMaxQty: integer("physical_max_qty"),
    downloadCount: integer("download_count").notNull().default(0),
    status: text("status").notNull().default("published"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    archivedAt: integer("archived_at"),
  },
  (t) => [
    index("assets_brand_cat_idx").on(t.brandId, t.category),
    index("assets_brand_physical_idx").on(t.brandId, t.physicalAvailable),
  ],
);

/**
 * A physical-print request → the brand fulfilment queue (P4.A). Shipping address
 * is an inline one-shot snapshot. status: Requested → Approved → Shipped / Declined.
 */
export const physicalRequests = sqliteTable(
  "physical_requests",
  {
    id: text("id").primaryKey(),
    brandId: text("brand_id").notNull(),
    assetId: text("asset_id")
      .notNull()
      .references(() => assets.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    quantity: integer("quantity").notNull().default(1),
    store: text("store").notNull(),
    shipStreet: text("ship_street").notNull(),
    shipCity: text("ship_city").notNull(),
    shipProvince: text("ship_province").notNull(),
    shipPostal: text("ship_postal").notNull(),
    contactName: text("contact_name").notNull(),
    contactPhone: text("contact_phone").notNull(),
    note: text("note"),
    status: text("status").notNull().default("Requested"),
    tracking: text("tracking"),
    declineReason: text("decline_reason"),
    // Proof-of-display: the budtender confirms the display went up in-store, with
    // an optional photo (roadie blob) the LP sees on the fulfilment queue.
    proofPhotoRef: text("proof_photo_ref"),
    deployedAt: integer("deployed_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("physical_requests_brand_status_idx").on(t.brandId, t.status),
    index("physical_requests_user_idx").on(t.userId),
    index("physical_requests_asset_idx").on(t.assetId),
  ],
);

// ─── P1.E — Analytics + audit (both append-only) ────────────────────────────

/**
 * Append-only engagement event stream — the source of truth dashboards + CSV
 * read. metadata_json carries type-specific detail. NEVER updated/deleted.
 */
export const analyticsEvents = sqliteTable(
  "analytics_events",
  {
    id: text("id").primaryKey(),
    brandId: text("brand_id").notNull(),
    actorId: text("actor_id").notNull(),
    type: text("type").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    metadataJson: text("metadata_json").notNull().default("{}"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("analytics_events_brand_actor_idx").on(t.brandId, t.actorId, t.createdAt),
    index("analytics_events_brand_type_idx").on(t.brandId, t.type, t.createdAt),
    index("analytics_events_target_idx").on(t.targetType, t.targetId),
  ],
);

/**
 * Append-only audit log — the accountability sink. EVERY mutation server fn calls
 * `writeAudit(...)`. `action` is a dotted verb ("review.delete"); meta_json carries
 * the decision/before-after. NEVER updated/deleted. brandId nullable (platform acts).
 */
export const auditLog = sqliteTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    brandId: text("brand_id"),
    actorId: text("actor_id").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    metaJson: text("meta_json").notNull().default("{}"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("audit_log_brand_created_idx").on(t.brandId, t.createdAt),
    index("audit_log_actor_idx").on(t.actorId, t.createdAt),
  ],
);

// ─── P2.A — Products / Drop Sheet ───────────────────────────────────────────

/** A SKU on the Drop Sheet. category ∈ Flower|Pre-Roll|Infused|Hash|Limited. */
export const products = sqliteTable(
  "products",
  {
    id: text("id").primaryKey(),
    brandId: text("brand_id").notNull(),
    category: text("category").notNull(),
    name: text("name").notNull(),
    thcPct: real("thc_pct"),
    cbdPct: real("cbd_pct"),
    terpenesJson: text("terpenes_json").notNull().default("[]"),
    effectsJson: text("effects_json").notNull().default("[]"),
    talkingPointsJson: text("talking_points_json").notNull().default("[]"),
    format: text("format"),
    batch: text("batch"),
    heroImageRef: text("hero_image_ref"),
    availability: text("availability").notNull().default("available"), // available|limited|sold_out|upcoming
    availableNote: text("available_note"),
    // Cross-cutting descriptor tags (rotational|flow-through|wholesale) — distinct
    // from the grouping `category`. JSON array; the lineup card chips + the
    // rotational scroll-callout read this.
    tagsJson: text("tags_json").notNull().default("[]"),
    // Provincial wholesale listing link (OCS/SQDC/etc.) + the province it's for.
    wholesaleUrl: text("wholesale_url"),
    province: text("province"), // 2-letter province code (ON|QC|BC|…), optional
    deckId: text("deck_id"), // optional "Full PK →" jump
    status: text("status").notNull().default("draft"), // draft|published|archived
    orderIdx: integer("order_idx").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    archivedAt: integer("archived_at"),
  },
  (t) => [
    index("products_brand_cat_idx").on(t.brandId, t.category),
    index("products_brand_status_idx").on(t.brandId, t.status),
  ],
);

/** A timed drop / limited release surfacing a product first (re-releasable). */
export const drops = sqliteTable(
  "drops",
  {
    id: text("id").primaryKey(),
    brandId: text("brand_id").notNull(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    headline: text("headline"),
    dropsAt: integer("drops_at").notNull(),
    endsAt: integer("ends_at"),
    isLimited: integer("is_limited").notNull().default(1),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("drops_brand_window_idx").on(t.brandId, t.dropsAt),
    index("drops_product_idx").on(t.productId),
  ],
);

// ─── P2.B — Reviews (HARD delete by compliance; NO deleted_at) ───────────────

/**
 * Product review. UNIQUE (brand_id, product_id, user_id) = one per budtender per
 * product. NO soft-delete by design — removal is a real DELETE (author or admin);
 * admins may delete but NEVER edit/hide. The `rating BETWEEN 1 AND 5` +
 * `length(body) <= 300` CHECKs are added in a hand-written SIBLING migration
 * (drizzle would drop an in-place edit); the arktype edge validator is primary.
 */
export const reviews = sqliteTable(
  "reviews",
  {
    id: text("id").primaryKey(),
    brandId: text("brand_id").notNull(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    authorName: text("author_name").notNull(),
    store: text("store"),
    rating: integer("rating").notNull(),
    body: text("body").notNull().default(""),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("reviews_one_per_user_idx").on(t.brandId, t.productId, t.userId),
    index("reviews_product_idx").on(t.productId),
  ],
);

// ─── P2.C — PK Decks (flip-viewer) ──────────────────────────────────────────

/**
 * A PK deck = one uploaded PDF (roadie R2). cover_thumb_ref + page_count are
 * derived ASYNC by the deck.derive queue job (enqueued by finalizeDeckUpload, not
 * register). pdf_ref is null until finalize; library card shows a "processing"
 * placeholder until page_count > 0. download_allowed gates the viewer download.
 */
export const decks = sqliteTable(
  "decks",
  {
    id: text("id").primaryKey(),
    brandId: text("brand_id").notNull(),
    title: text("title").notNull(),
    productLine: text("product_line"),
    pdfRef: text("pdf_ref"), // null until finalizeDeckUpload
    coverThumbRef: text("cover_thumb_ref"), // async page-1 render
    pageCount: integer("page_count").notNull().default(0), // 0 = processing
    downloadAllowed: integer("download_allowed").notNull().default(0),
    status: text("status").notNull().default("draft"),
    publishedAt: integer("published_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    archivedAt: integer("archived_at"),
  },
  (t) => [index("decks_brand_status_idx").on(t.brandId, t.status)],
);

/** Per-user flip-depth state (the analytics signal). UNIQUE (deck_id, user_id). */
export const deckProgress = sqliteTable(
  "deck_progress",
  {
    id: text("id").primaryKey(),
    brandId: text("brand_id").notNull(), // denormalized from deck
    deckId: text("deck_id")
      .notNull()
      .references(() => decks.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    lastPage: integer("last_page").notNull().default(1),
    timeSpentSeconds: integer("time_spent_seconds").notNull().default(0),
    openedAt: integer("opened_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("deck_progress_user_idx").on(t.deckId, t.userId),
    index("deck_progress_brand_idx").on(t.brandId),
  ],
);

// ─── P2.D — Quizzes + certifications (folds in apps/quiz, re-namespaced) ─────

/** A quiz. brand_id NULLABLE (NULL = public/platform quiz). */
export const quizzes = sqliteTable(
  "quizzes",
  {
    id: text("id").primaryKey(),
    brandId: text("brand_id"), // nullable: NULL = public
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    passThreshold: integer("pass_threshold").notNull().default(80),
    retakesAllowed: integer("retakes_allowed").notNull().default(1),
    maxAttempts: integer("max_attempts"),
    timeLimitSeconds: integer("time_limit_seconds"),
    certName: text("cert_name"), // non-null ⇒ certification quiz
    onLeaderboard: integer("on_leaderboard").notNull().default(1),
    shuffleQuestions: integer("shuffle_questions").notNull().default(1),
    status: text("status").notNull().default("draft"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    createdBy: text("created_by").notNull(),
  },
  (t) => [index("quizzes_brand_status_idx").on(t.brandId, t.status)],
);

/** A question. type ∈ multiple_choice|select_all|true_false|image|matching. */
export const questions = sqliteTable(
  "questions",
  {
    id: text("id").primaryKey(),
    quizId: text("quiz_id")
      .notNull()
      .references(() => quizzes.id, { onDelete: "cascade" }),
    orderIdx: integer("order_idx").notNull(),
    type: text("type").notNull(),
    prompt: text("prompt").notNull(),
    imageRef: text("image_ref"),
    points: real("points").notNull().default(1),
    explanation: text("explanation"),
    configJson: text("config_json").notNull().default("{}"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("questions_quiz_order_idx").on(t.quizId, t.orderIdx)],
);

/** An option for a question (matching right-side value in config_json). */
export const questionOptions = sqliteTable(
  "question_options",
  {
    id: text("id").primaryKey(),
    questionId: text("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    orderIdx: integer("order_idx").notNull(),
    text: text("text").notNull(),
    imageRef: text("image_ref"),
    isCorrect: integer("is_correct").notNull().default(0),
    weight: real("weight").notNull().default(1),
    configJson: text("config_json").notNull().default("{}"),
  },
  (t) => [index("question_options_question_idx").on(t.questionId, t.orderIdx)],
);

/**
 * One quiz-taking session. Autosave/resume via answers_json + current_question;
 * shuffle_seed set at start for deterministic resumable order. brand_id
 * denormalized from quiz (nullable = public attempt). status open→submitted.
 */
export const attempts = sqliteTable(
  "attempts",
  {
    id: text("id").primaryKey(),
    brandId: text("brand_id"), // denormalized; nullable
    quizId: text("quiz_id")
      .notNull()
      .references(() => quizzes.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    shuffleSeed: integer("shuffle_seed").notNull(),
    answersJson: text("answers_json").notNull().default("{}"),
    currentQuestion: integer("current_question").notNull().default(0),
    score: real("score"),
    maxScore: real("max_score").notNull(),
    passed: integer("passed"),
    status: text("status").notNull().default("open"),
    startedAt: integer("started_at").notNull(),
    deadlineAt: integer("deadline_at"),
    submittedAt: integer("submitted_at"),
    timeSpentSeconds: integer("time_spent_seconds"),
  },
  (t) => [
    index("attempts_user_quiz_idx").on(t.userId, t.quizId, t.status),
    index("attempts_brand_submitted_idx").on(t.brandId, t.submittedAt),
  ],
);

/** Per-question graded answer (immutable post-submit; frozen awarded points). */
export const attemptAnswers = sqliteTable(
  "attempt_answers",
  {
    id: text("id").primaryKey(),
    attemptId: text("attempt_id")
      .notNull()
      .references(() => attempts.id, { onDelete: "cascade" }),
    questionId: text("question_id").notNull(),
    payloadJson: text("payload_json").notNull(),
    isCorrect: integer("is_correct").notNull(),
    pointsAwarded: real("points_awarded").notNull(),
  },
  (t) => [index("attempt_answers_attempt_idx").on(t.attemptId)],
);

/** A named certification badge. UNIQUE (brand_id, user_id, quiz_id). */
export const certifications = sqliteTable(
  "certifications",
  {
    id: text("id").primaryKey(),
    brandId: text("brand_id").notNull(),
    quizId: text("quiz_id")
      .notNull()
      .references(() => quizzes.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    name: text("name").notNull(), // snapshot of cert_name
    attemptId: text("attempt_id")
      .notNull()
      .references(() => attempts.id, { onDelete: "cascade" }),
    awardedAt: integer("awarded_at").notNull(),
  },
  (t) => [
    uniqueIndex("certifications_unique_idx").on(t.brandId, t.userId, t.quizId),
    index("certifications_user_idx").on(t.userId),
  ],
);

// ─── P2.E — Leaderboard (materialized composite score) ──────────────────────

/**
 * Materialized composite learning score per (user, brand, period="YYYY-MM"). The
 * cron (jobs/cron.ts) is the ONE place the leaderboard math runs (SCORE_WEIGHTS),
 * writing quiz/deck/activity points + the weighted score. Leaderboards read this
 * snapshot — never a live scan.
 */
export const userBrandScores = sqliteTable(
  "user_brand_scores",
  {
    id: text("id").primaryKey(),
    brandId: text("brand_id").notNull(),
    userId: text("user_id").notNull(),
    period: text("period").notNull(), // "YYYY-MM"
    score: real("score").notNull().default(0),
    quizPoints: real("quiz_points").notNull().default(0),
    deckPoints: real("deck_points").notNull().default(0),
    activityPoints: real("activity_points").notNull().default(0),
    computedAt: integer("computed_at").notNull(),
  },
  (t) => [
    uniqueIndex("user_brand_scores_unique_idx").on(t.brandId, t.userId, t.period),
    index("user_brand_scores_leaderboard_idx").on(t.brandId, t.period, t.score),
    index("user_brand_scores_period_score_idx").on(t.period, t.score),
  ],
);

// ─── P3.B — Media feed ("Enter the Grow") ───────────────────────────────────

/**
 * A feed post. like/comment counters + first_comment_json snapshot are
 * denormalized (maintained transactionally) so a cell renders joinless. brand_team
 * is derived SERVER-SIDE from the caller's org role, NEVER from input.
 */
export const posts = sqliteTable(
  "posts",
  {
    id: text("id").primaryKey(),
    brandId: text("brand_id").notNull(),
    authorId: text("author_id").notNull(),
    caption: text("caption").notNull().default(""),
    productId: text("product_id"),
    likeCount: integer("like_count").notNull().default(0),
    commentCount: integer("comment_count").notNull().default(0),
    firstCommentJson: text("first_comment_json"), // { authorName, body } | null
    brandTeam: integer("brand_team").notNull().default(1),
    createdAt: integer("created_at").notNull(),
    deletedAt: integer("deleted_at"),
  },
  (t) => [index("posts_brand_created_idx").on(t.brandId, t.createdAt)],
);

/** Ordered media items on a post (image|video R2 blobs). */
export const postMedia = sqliteTable(
  "post_media",
  {
    id: text("id").primaryKey(),
    postId: text("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    mediaRef: text("media_ref").notNull(),
    kind: text("kind").notNull(), // image | video
    orderIdx: integer("order_idx").notNull(),
  },
  (t) => [index("post_media_post_idx").on(t.postId, t.orderIdx)],
);

/** Idempotent like (composite PK); post.like_count bumped transactionally. */
export const postLikes = sqliteTable(
  "post_likes",
  {
    postId: text("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.postId, t.userId] })],
);

/**
 * A comment (≤500 chars). Real-time via the GroupChatRoom DO keyed
 * `${brandId}:${postId}`; this table is the durable log. brand_team derived
 * SERVER-SIDE. Soft-delete via deleted_at.
 */
export const comments = sqliteTable(
  "comments",
  {
    id: text("id").primaryKey(),
    brandId: text("brand_id").notNull(),
    postId: text("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    authorName: text("author_name").notNull(),
    store: text("store"),
    body: text("body").notNull(),
    brandTeam: integer("brand_team").notNull().default(0),
    heartCount: integer("heart_count").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    deletedAt: integer("deleted_at"),
  },
  (t) => [index("comments_post_created_idx").on(t.postId, t.createdAt)],
);

/** Idempotent heart on a comment (composite PK); heart_count denormalized. */
export const commentLikes = sqliteTable(
  "comment_likes",
  {
    commentId: text("comment_id")
      .notNull()
      .references(() => comments.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.commentId, t.userId] })],
);

// ─── P3.C — Group chat (DO live fan-out; D1 durable log) ─────────────────────

/** One chat room per brand (UNIQUE). DO instance = idFromName(brandId). */
export const chatRooms = sqliteTable(
  "chat_rooms",
  {
    id: text("id").primaryKey(),
    brandId: text("brand_id").notNull(),
    title: text("title").notNull().default("Group Chat"),
    createdAt: integer("created_at").notNull(),
    archivedAt: integer("archived_at"),
  },
  (t) => [uniqueIndex("chat_rooms_brand_idx").on(t.brandId)],
);

/** Durable chat message log (the DO streams live; this persists history). */
export const chatMessages = sqliteTable(
  "chat_messages",
  {
    id: text("id").primaryKey(),
    roomId: text("room_id")
      .notNull()
      .references(() => chatRooms.id, { onDelete: "cascade" }),
    brandId: text("brand_id").notNull(), // denormalized
    userId: text("user_id").notNull(),
    authorName: text("author_name").notNull(),
    store: text("store"),
    body: text("body").notNull(),
    team: integer("team").notNull().default(0), // brand-team marker
    createdAt: integer("created_at").notNull(),
    deletedAt: integer("deleted_at"),
  },
  (t) => [index("chat_messages_room_created_idx").on(t.roomId, t.createdAt)],
);

/** "Last seen" mirror the DO flushes coarsely (live presence is DO-held). */
export const presence = sqliteTable(
  "presence",
  {
    roomId: text("room_id")
      .notNull()
      .references(() => chatRooms.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    lastSeenAt: integer("last_seen_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.roomId, t.userId] })],
);

// ─── P4.B — Contact (in-platform; reply → notification) ─────────────────────

/** A contact thread → Brand Admin inbox. topic ∈ Restocking|Events|Assets|Feedback|General. */
export const contactThreads = sqliteTable(
  "contact_threads",
  {
    id: text("id").primaryKey(),
    brandId: text("brand_id").notNull(),
    userId: text("user_id").notNull(),
    authorName: text("author_name").notNull(),
    store: text("store"),
    areaOfStore: text("area_of_store"), // which part of the store the request is about
    email: text("email").notNull(),
    topic: text("topic").notNull(), // the request TYPE (Restocking|Events|Assets|…)
    message: text("message").notNull(),
    status: text("status").notNull().default("open"), // open | replied | closed
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("contact_threads_brand_status_idx").on(t.brandId, t.status),
    index("contact_threads_user_idx").on(t.userId),
  ],
);

/** A reply on a contact thread; a brand reply ALSO emits a contact_reply notification. */
export const contactReplies = sqliteTable(
  "contact_replies",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id")
      .notNull()
      .references(() => contactThreads.id, { onDelete: "cascade" }),
    authorId: text("author_id").notNull(),
    fromBrand: integer("from_brand").notNull().default(1),
    body: text("body").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("contact_replies_thread_idx").on(t.threadId, t.createdAt)],
);

// ─── P4.C — Booking + group sessions (BOOKING ONLY; no instant calls) ────────

/** A published availability window 1:1 slots are derived from (isGroup=1 ⇒ group). */
export const availabilityWindows = sqliteTable(
  "availability_windows",
  {
    id: text("id").primaryKey(),
    brandId: text("brand_id").notNull(),
    hostId: text("host_id").notNull(),
    startsAt: integer("starts_at").notNull(),
    endsAt: integer("ends_at").notNull(),
    slotMinutes: integer("slot_minutes").notNull().default(30),
    isGroup: integer("is_group").notNull().default(0),
    capacity: integer("capacity").notNull().default(1),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("availability_windows_brand_time_idx").on(t.brandId, t.startsAt)],
);

/** A 1:1 booking. UNIQUE (window_id, slot_starts_at) = single-use slot (isGroup=0 only). */
export const bookings = sqliteTable(
  "bookings",
  {
    id: text("id").primaryKey(),
    brandId: text("brand_id").notNull(),
    windowId: text("window_id")
      .notNull()
      .references(() => availabilityWindows.id, { onDelete: "cascade" }),
    hostId: text("host_id").notNull(), // denormalized at bookCall
    userId: text("user_id").notNull(),
    slotStartsAt: integer("slot_starts_at").notNull(),
    slotEndsAt: integer("slot_ends_at").notNull(),
    status: text("status").notNull().default("booked"), // booked | cancelled | completed
    note: text("note"),
    realtimeSessionId: text("realtime_session_id"), // created lazily on first join (now >= slot_starts_at)
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("bookings_slot_idx").on(t.windowId, t.slotStartsAt),
    index("bookings_user_idx").on(t.userId),
    index("bookings_brand_time_idx").on(t.brandId, t.slotStartsAt),
    index("bookings_host_idx").on(t.hostId, t.slotStartsAt),
  ],
);

/** A scheduled group session in an in-platform Realtime room; recording → roadie R2. */
export const groupSessions = sqliteTable(
  "group_sessions",
  {
    id: text("id").primaryKey(),
    brandId: text("brand_id").notNull(),
    hostId: text("host_id").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    startsAt: integer("starts_at").notNull(),
    endsAt: integer("ends_at").notNull(),
    capacity: integer("capacity"),
    recordingRef: text("recording_ref"), // roadie referenceId, set after the session
    realtimeSessionId: text("realtime_session_id"), // set when the room goes live
    status: text("status").notNull().default("scheduled"), // scheduled | live | ended | cancelled
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("group_sessions_brand_time_idx").on(t.brandId, t.startsAt)],
);

/** Registration + attendance for a group session. UNIQUE (session_id, user_id). */
export const sessionAttendance = sqliteTable(
  "session_attendance",
  {
    id: text("id").primaryKey(),
    brandId: text("brand_id").notNull(),
    sessionId: text("session_id")
      .notNull()
      .references(() => groupSessions.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    registeredAt: integer("registered_at").notNull(),
    joinedAt: integer("joined_at"),
    leftAt: integer("left_at"),
  },
  (t) => [
    uniqueIndex("session_attendance_unique_idx").on(t.sessionId, t.userId),
    index("session_attendance_user_idx").on(t.userId),
  ],
);

// ─── P4.D — AI assistant (RAG over the brand's own content) ──────────────────

/** Append-only AI question/answer log (the analytics gold mine). */
export const aiQaLog = sqliteTable(
  "ai_qa_log",
  {
    id: text("id").primaryKey(),
    brandId: text("brand_id").notNull(),
    userId: text("user_id").notNull(),
    question: text("question").notNull(),
    answer: text("answer").notNull(),
    source: text("source"), // product | deck | custom_qa | navigation | none
    sourceId: text("source_id"),
    kind: text("kind").notNull().default("customer"), // customer | navigation
    escalatedBookingId: text("escalated_booking_id"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("ai_qa_log_brand_created_idx").on(t.brandId, t.createdAt),
    index("ai_qa_log_brand_kind_idx").on(t.brandId, t.kind),
  ],
);

/** Admin-added custom Q&A augmenting the AI's brand grounding. */
export const aiCustomQa = sqliteTable(
  "ai_custom_qa",
  {
    id: text("id").primaryKey(),
    brandId: text("brand_id").notNull(),
    question: text("question").notNull(),
    answer: text("answer").notNull(),
    enabled: integer("enabled").notNull().default(1),
    createdBy: text("created_by").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [index("ai_custom_qa_brand_idx").on(t.brandId, t.enabled)],
);

/**
 * Brand-scoped RAG grounding metadata: one row per indexed chunk. Vectors live in
 * Cloudflare Vectorize (brand_id metadata filter — retrieval cannot cross brands);
 * this row holds chunk text + provenance + vectorize_id. Embeddings via env.AI
 * (@cf/baai/bge-base-en-v1.5, 768-dim).
 */
export const aiEmbeddings = sqliteTable(
  "ai_embeddings",
  {
    id: text("id").primaryKey(),
    brandId: text("brand_id").notNull(),
    sourceType: text("source_type").notNull(), // product | deck | asset | custom_qa
    sourceId: text("source_id").notNull(),
    chunkIdx: integer("chunk_idx").notNull().default(0),
    content: text("content").notNull(),
    vectorizeId: text("vectorize_id").notNull(),
    model: text("model"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("ai_embeddings_brand_idx").on(t.brandId),
    index("ai_embeddings_source_idx").on(t.brandId, t.sourceType, t.sourceId),
  ],
);

// ─── Notifications (emitted P4.A/B; the system + prefs UI land in P5.C) ──────

/** Per-user, per-brand, per-type notification. CLOSED type enum (D-NOTIF-ENUM). */
export const notifications = sqliteTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    brandId: text("brand_id").notNull(),
    userId: text("user_id").notNull(),
    type: text("type").notNull(), // new_post|new_comment|chat|contact_reply|session_reminder|award|access_approved|fulfilment_status
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    refType: text("ref_type"),
    refId: text("ref_id"),
    readAt: integer("read_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("notifications_user_unread_idx").on(t.userId, t.readAt),
    index("notifications_brand_user_idx").on(t.brandId, t.userId),
  ],
);

/** Granular per-user/per-brand/per-type pref (default-on; no global switch). */
export const notificationPrefs = sqliteTable(
  "notification_prefs",
  {
    userId: text("user_id").notNull(),
    brandId: text("brand_id").notNull(),
    type: text("type").notNull(),
    enabled: integer("enabled").notNull().default(1),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.brandId, t.type] })],
);

// ─── P5 — Hub & gamification ────────────────────────────────────────────────

/**
 * The Education Award per brand per period. fund_description is the education-fund
 * framing (NEVER prize/reward/cash — product law). winner set when the period closes.
 */
export const educationAward = sqliteTable(
  "education_award",
  {
    id: text("id").primaryKey(),
    brandId: text("brand_id").notNull(),
    period: text("period").notNull(), // "YYYY-MM"
    fundDescription: text("fund_description").notNull(),
    coversText: text("covers_text"),
    closesAt: integer("closes_at").notNull(),
    winnerUserId: text("winner_user_id"),
    winnerName: text("winner_name"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("education_award_period_idx").on(t.brandId, t.period)],
);

/**
 * The "Request Access" join queue (Portals You Can Join). UNIQUE (brand_id,
 * user_id) so a user can't double-queue. On approval the app creates a PORTAL
 * membership (`portal_members` below — a budtender, NOT an org member) and emits
 * an access_approved notification. Cross-org joins are fine: an org member of one
 * brand can request, and be approved into, another brand's portal.
 */
export const portalAccessRequests = sqliteTable(
  "portal_access_requests",
  {
    id: text("id").primaryKey(),
    brandId: text("brand_id").notNull(),
    userId: text("user_id").notNull(),
    message: text("message"),
    status: text("status").notNull().default("pending"), // pending | approved | declined
    decidedBy: text("decided_by"),
    decidedAt: integer("decided_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("portal_access_requests_unique_idx").on(t.brandId, t.userId),
    index("portal_access_requests_brand_status_idx").on(t.brandId, t.status),
  ],
);

/**
 * Portal membership — a brand's portal AUDIENCE, separate from org membership. A
 * budtender joins via the request→approval queue with no org membership and can
 * belong to many brands; org staff are lazily synced in (`source = "org"`), so
 * this is the single source of truth for the audience. `role` is the PORTAL
 * standing, never org authority. `brand_id` is the owning org id, always
 * caller-derived; UNIQUE (brand_id, user_id).
 */
export const portalMembers = sqliteTable(
  "portal_members",
  {
    id: text("id").primaryKey(),
    brandId: text("brand_id").notNull(),
    userId: text("user_id").notNull(),
    role: text("role").notNull().default("budtender"), // portal standing, NOT org authority
    source: text("source").notNull().default("request"), // request | org (lazy-synced)
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("portal_members_unique_idx").on(t.brandId, t.userId),
    index("portal_members_user_idx").on(t.userId),
  ],
);

// ─── Login — CanSell credential (budtender certification) ───────────────────

/**
 * A budtender's retail-certification record (CanSell / SellSafe / provincial
 * equivalent). PLATFORM-WIDE per user (a person's cert, not a per-brand thing) —
 * keyed on `user_id`, never an org. The budtender UPLOADS their certificate
 * (PDF/photo) as a roadie blob (`proof_ref`) — the upload IS the proof — plus an
 * (optional) cert number and a (required) expiry. A PLATFORM admin then REVIEWS
 * the submission: `status` is `pending` (submitted, awaiting review), `verified`
 * (an admin confirmed it, stamping `verified_by` + an optional `review_note`), or
 * `rejected` (an admin rejected it, with the reason in `review_note`). A
 * credential is usable when it's `verified` AND `expires_at` is in the future
 * (see `credentialState` in `lib/credentials.ts`). UNIQUE (user_id, kind) — one
 * cert per type per person.
 */
export const budtenderCredentials = sqliteTable(
  "budtender_credentials",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    kind: text("kind").notNull().default("cansell"), // cansell | sellsafe | other
    issuer: text("issuer").notNull().default("CanSell"),
    credentialNumber: text("credential_number"), // optional — the upload is the proof
    proofRef: text("proof_ref"), // roadie referenceId (R2) for the uploaded certificate
    expiresAt: integer("expires_at").notNull(),
    status: text("status").notNull().default("pending"), // pending | verified | rejected
    reviewNote: text("review_note"), // admin's optional note (esp. the reject reason)
    verifiedBy: text("verified_by"), // platform admin actor id who decided
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [uniqueIndex("budtender_credentials_user_kind_idx").on(t.userId, t.kind)],
);
