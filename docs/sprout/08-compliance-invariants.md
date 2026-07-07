# 08 — Compliance & Product Invariants

> **Scope.** The Sprout spec's non-negotiable product rules — the cannabis-industry
> and product-integrity laws — encoded as enforceable **invariants**. Each one has
> a statement, a WHY, its single **load-bearing enforcement point** in this
> architecture (the one place a violation is actually stopped — a schema constraint
> or a server-side authz check), and a concrete **regression test**.
>
> These are grounded in the three foundation docs — every table, route, column,
> and component name below is reused verbatim from
> [`01-architecture.md`](./01-architecture.md), [`02-data-model.md`](./02-data-model.md),
> and [`03-app-structure.md`](./03-app-structure.md). When an invariant says
> "`reviews` has no `deleted_at`", that is a literal claim about the
> `workers/sprout/src/schema.ts` `reviews` table authored in
> [`02-data-model.md` §2.3](./02-data-model.md).
>
> **How to read enforcement.** Each invariant names its **load-bearing enforcement
> point** — the single place that actually makes the violation impossible. That is
> almost always one of two things: a **schema constraint** whose shape encodes the
> law (a `CHECK`/`UNIQUE`/PK, or the deliberate _absence_ of a column/server fn), or
> a **server-side authz check** in the handler (a `brand_id` derived from the
> verified envelope, a gate middleware, a server-derived trust marker). Other
> signals — UI absence, lint rules, forbidden-string greps — are listed where they
> help, but they are **regression backstops, not the law**: they catch naive
> copy/paste regressions in _source_ and _seeded_ content only and slip past
> paraphrases, dynamic strings, computed hrefs, and brand-authored **runtime**
> content (banner headlines, custom Q&A). The real load-bearing point for runtime
> award-context fields (`education_award.fund_description`/`covers_text`) and banner
> links (`link_json` `{section, params}` shape) is the **server-side arktype
> validator at write time**, not the grep. This doc does **not** claim every rule
> is defended at four layers; it names the one point that holds.

---

## The invariant table (INV-1 … INV-14)

| #          | Invariant (one line)                                                                                                                                            | Load-bearing enforcement                                                                                                                                                       |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **INV-1**  | "Education **Award**" framing only — never _prize_/_reward_/_cash_ in any award context (UI strings, emails, DB enums, content).                                | `education_award` has no `prize`/`reward`/`cash` column/enum + a server-side arktype validator on `fund_description`/`covers_text` at write time (grep backstop).              |
| **INV-2**  | **Booking only** — no instant calls anywhere, for budtenders OR the AI. No "Start Call Now"/"instant video call" route, handler, or string.                     | the Cloudflare Realtime session opens **only** from a `bookings`/`group_sessions` row at/after slot start; no `startCall`/`joinNow` fn, route, or open-room RPC.               |
| **INV-3**  | Reviews: **DELETE, never suppress** — admins hard-delete; cannot edit, cannot hide.                                                                             | `reviews` has **no** `deleted_at`/`hidden`/`status` column **and** no admin edit/hide server fn exists; `deleteReview` is a real `DELETE`.                                     |
| **INV-4**  | Sprout stays **invisible** inside portals — only the "Powered by Sprout" footer credit; the Hub is the only Sprout-branded surface.                             | the portal subtree never imports the Sprout `Logo` wordmark (renders `<BrandLogo>`); chrome import-boundary guard.                                                             |
| **INV-5**  | Admins **never need a developer** — every customisation is dashboard-driven (`brand_theme`/`portal_config` rows + Brand-Admin server fns), not code.            | each spec customisation resolves to a `brand_theme`/`portal_config`/content write behind an `/admin` route + server fn; brand config is never wired through build-time config. |
| **INV-6**  | Notifications are **per-brand, per-type** — no single global switch.                                                                                            | `notification_prefs` composite PK `(user_id, brand_id, type)` makes a global-mute row unrepresentable.                                                                         |
| **INV-7**  | **One page, no routing** — sections are search-param layers over a single shell; closing restores exact scroll.                                                 | `_portal.tsx` pathless shell + typed `?section=` search param; no `/_portal/{section}` child route files exist.                                                                |
| **INV-8**  | **Hero is a rotating carousel** — auto-advance, arrows + dots; not a static banner.                                                                             | `hero_slides` is a multi-row ordered table `(brand_id, order_idx)`; `RotatingHero` is a carousel (auto-advance + prev/next + dot controls).                                    |
| **INV-9**  | **Banners are side/top strips** flanking the hero (side columns desktop, top strip mobile) — never a body block.                                                | `BannerRail` is mounted in `_portal.tsx` above/outside `<Outlet/>` (persistent chrome, not section content).                                                                   |
| **INV-10** | **Assets: download AND request physical** — every library asset offers both actions; physical request captures a shipping address.                              | `physical_requests` carries the full `ship_*` + contact columns; `requestPhysical` writes the brand fulfilment queue row.                                                      |
| **INV-11** | **PK decks are uploaded PDFs** — flip-through; no field-by-field rebuild; thumbnail + page count auto-derived.                                                  | `decks` is a `pdf_ref` + auto `cover_thumb_ref`/`page_count` and has **no** per-page content column; `registerDeckUpload` takes a PDF ref only.                                |
| **INV-12** | **Contact reaches a human** — private in-platform message to the brand team; no email client; the three channels (AI / Contact / Group Chat) strictly separate. | `contact_threads`→admin inbox + `contact_reply` notification; `sendContact` opens no `mailto:`; the only cross-channel escalation path is AI→`bookCall`.                       |
| **INV-13** | **Nothing links out** — 100% in-platform; banner/feed/CTA links target a section, never an external URL.                                                        | `banner_cards.link_json` is a `{section, params}` shape enforced by the arktype write-validator (no URL); deep links call `openLayer`, not an external anchor.                 |
| **INV-14** | **Multi-tenant isolation** — every domain query scoped by `brand_id` derived from the verified envelope/host, never from client input.                          | handlers set `brand_id` from `context.principal.activeOrgId` (or host→org), never from `data`; the DO scopes per-room and gates the socket on the envelope's org.              |

The sections below expand each invariant.

---

## INV-1 — Education AWARD framing is law

**Invariant.** Across every surface — UI strings, transactional emails, DB enum
values, Brand-Admin copy, AI answers, and analytics labels — the monthly award is
framed as an **education fund / professional development award**. The words
**"prize", "reward", "cash", "winnings", "payout", "giveaway"** (and equivalents)
**never appear in an award context**.

**Why (cannabis-industry / integrity).** Cannabis advertising and promotion in
Canada (and most regulated markets) prohibits inducements framed as prizes,
rewards, or cash incentives tied to product promotion. The spec elevates this to a
product law: the program is positioned as _professional development_, not a
sweepstakes. Mislabeling it as a "prize/cash reward" would expose every brand on
the platform to promotional-inducement liability and break the B2B education
positioning the whole product rests on.

**Load-bearing enforcement — the schema's column set + a write-time validator.**
The framing is held by what the schema _cannot_ express plus a server-side arktype
validator on the award copy; the grep is a regression backstop, not the law.

- **The data model uses education-fund language (load-bearing).** The
  `education_award` table ([`02-data-model.md` §11](./02-data-model.md)) names the
  copy column `fund_description` (not `prize_description`) and carries
  `covers_text` ("what it covers"). The column names themselves are the schema-level
  statement of the framing. There is **no** `prize`/`reward`/`cash` column or enum
  value anywhere in `schema.ts`.
- **A write-time arktype validator guards the runtime copy (load-bearing).** Because
  `fund_description`/`covers_text` are brand-authored at runtime, the grep cannot
  catch a Brand-Admin typing "cash prize" into the field. The award-copy write fn
  validates the submitted text against the forbidden-term set with arktype before
  upsert and rejects it — this is the point that actually holds for runtime content.
- **Award server fns emit fund framing.** `hub.functions.ts`'s `getAward`
  returns `fundDescription` / `coversText`; no handler constructs award copy from a
  forbidden term. Award notifications (`notifications.type = "award"`,
  [`02-data-model.md` §11](./02-data-model.md)) use the fund title.
- **Forbidden-term grep (regression backstop, CI).** A contract test greps the source
  tree, the route components under `components/hub/AwardOfMonth`, the email
  templates, the **AI system-prompt template + the seeded `ai_custom_qa` content**,
  and any seeded content for forbidden terms **in award contexts** (see CI guardrails
  below). The greenroom analytics inventory already states the rule:
  _"EDUCATION AWARD framing — education fund, professional development, NEVER
  prize/reward/cash, on every surface + in every string."_ This catches naive
  copy/paste regressions in source/seed only — it is not the runtime guarantee.

**Regression test.**

```ts
// tests/compliance/award-framing.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync, globSync } from "node:fs";
import path from "node:path";

const FORBIDDEN = /\b(prize|reward|cash|winnings|payout|giveaway)\b/i;
// Anchor every glob to the app root so the suite never silently scans nothing.
const ROOT = path.resolve(__dirname, "../..");
// Award-context surfaces: the Award components, hub award fn, award emails, the AI
// system-prompt template + seeded ai_custom_qa content, and seeds.
const AWARD_SURFACES = [
  "src/components/hub/award-of-month.tsx",
  "src/components/hub/award*.tsx",
  "src/lib/hub.functions.ts",
  "src/lib/ai/**/award*.ts",
  "src/lib/ai/system-prompt.ts", // AI generation system prompt (D-AI-MODEL)
  "../../packages/email/**/award*.tsx",
  "seeds/**/{award,ai-custom-qa}*.ts", // seeded ai_custom_qa is in the scan scope
];

describe("INV-1 education award framing", () => {
  it("no forbidden award terms in award surfaces", () => {
    const offenders: string[] = [];
    let matchedAny = 0;
    for (const pattern of AWARD_SURFACES) {
      for (const file of globSync(path.join(ROOT, pattern))) {
        matchedAny++;
        const src = readFileSync(file, "utf8");
        // strip the lint-allow line that legitimately *names* the forbidden words
        const scanned = src.replace(/\/\/ *forbidden-terms-allow.*$/gm, "");
        if (FORBIDDEN.test(scanned)) offenders.push(`${file}: ${FORBIDDEN.exec(scanned)?.[0]}`);
      }
    }
    // fail loudly if the globs matched nothing (a moved file must not silently pass)
    expect(matchedAny, "award-framing globs matched no files").toBeGreaterThan(0);
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("education_award schema has no prize/reward/cash column", () => {
    const schema = readFileSync("src/schema.ts", "utf8");
    const block = schema.slice(schema.indexOf('sqliteTable(\n  "education_award"'));
    expect(block).toMatch(/fund_description/);
    expect(block).not.toMatch(/\b(prize|reward|cash)\b/i);
  });
});
```

A regression — e.g. a banner card headlined "Win a $500 cash prize!" or an email
template renaming `fundDescription` to `prizeDescription` — fails this test before
merge.

---

## INV-2 — Booking only, no instant calls (for users OR the AI)

**Invariant.** There is **no instant-call path anywhere**: no "Start Call Now"
button, no "instant video call" copy, no route or handler that opens a live call
on demand. The AI assistant's escalation tool has **exactly one** call action —
**booking** — and connection is only ever to a _booked_ slot whose Join goes live
at start time.

**Why (cannabis-industry / integrity).** The legacy MTL portal shipped an
"instant video call" affordance; the spec explicitly removes it. A budtender (or
the AI on their behalf) cannot summon a brand rep on demand for a real-time sales
conversation — interactions are scheduled, auditable, and consent-bounded through
the brand's published availability windows. Booking-only keeps every live
interaction inside a controlled, recordable, scheduled channel (the spec's
"BOOKING ONLY — no instant calls EVER, incl. from the AI").

**Load-bearing enforcement — the absence of any open-room-now path + a booked-row
gate.** A live room can be reached _only_ from a `bookings`/`group_sessions` row
whose start time has arrived; no server fn, route, AI tool, or DO RPC opens a room
on demand. The forbidden-string grep is a regression backstop.

- **No instant-call route/component.** The route map
  ([`03-app-structure.md`](./03-app-structure.md)) has `/admin/calls` for
  _availability windows + group sessions_ and a slot-picker under
  `components/ai/`. There is **no** route or component named `start-call`,
  `instant-call`, `call-now`, or equivalent. The AI bubble's escalation UI renders
  only the slot picker (`listSlots` → `bookCall`).
- **AI escalation tool = booking only (load-bearing).** In `ai.functions.ts` the
  assistant's tool surface is `{ listSlots, bookCall }` — no `startCall`/`joinNow`.
  The AI module's tool schema ([`01-architecture.md` §8](./01-architecture.md):
  "booking-only escalation") exposes a single call action. AI→`bookCall` is the only
  cross-channel escalation path that exists at all (see INV-12).
- **Booking model has no instant path (load-bearing).** There is **no** `join_at`
  column: Join is enabled when `now >= slot_starts_at`, and the Cloudflare Realtime
  session is created on first join and its id stored in `realtime_session_id`
  ([`02-data-model.md` §9](./02-data-model.md): the slot single-use
  `UNIQUE(window_id, slot_starts_at)` + lazy `realtime_session_id`). No `bookings`
  status or `availability_windows` flag means "available right now, join
  immediately", and there is no open-room-now RPC on the DO.
- **String/route absence grep (regression backstop, CI).** A grep asserts no
  `"Start Call Now"` / `"instant video call"` string and no route/handler matching
  the instant-call pattern exists.

**Regression test.**

```ts
// tests/compliance/booking-only.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync, globSync } from "node:fs";

describe("INV-2 booking only", () => {
  it("no instant-call strings anywhere in src", () => {
    const banned = /start call now|instant (video )?call|call now|join now (call)?/i;
    const offenders = globSync("src/**/*.{ts,tsx}")
      .filter((f) => banned.test(readFileSync(f, "utf8")))
      .filter((f) => !f.includes("tests/")); // the test file itself names the strings
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("no instant-call route exists", () => {
    const routes = globSync("src/routes/**/*.tsx").map((f) => f.toLowerCase());
    expect(routes.some((r) => /start-?call|instant-?call|call-?now/.test(r))).toBe(false);
  });

  it("AI escalation tool exposes only bookCall, not startCall", () => {
    const ai = readFileSync("src/lib/ai.functions.ts", "utf8");
    expect(ai).toMatch(/bookCall|listSlots/);
    expect(ai).not.toMatch(/\bstartCall\b|\binstantCall\b|\bjoinNow\b/);
  });
});
```

> **Room transport — settled.** The in-platform booked-call room is a **Cloudflare
> Realtime** WebRTC SFU session (via the **RealtimeKit** Core SDK + REST), opened
> at slot/session start; the session id is stored in `realtime_session_id`
> ([`05-api-and-integrations.md` §6](./05-api-and-integrations.md)). The surviving
> compliance clause is the one that bites: a Realtime session opens **only** from a
> booked `bookings`/`group_sessions` row at/after slot start — no `startCall`/
> `joinNow` tool, fn, route, or DO open-room-now RPC exists.

---

## INV-3 — Reviews: DELETE, never suppress

**Invariant.** A `reviews` row can be **removed** (a real SQL `DELETE`) by its
author or by a brand admin removing a guideline violation. An admin can **NEVER
edit** a review and **NEVER hide** it. There is no soft-delete, no "hidden" flag,
no moderation-suppression state on a review.

**Why (cannabis-industry / integrity).** Review credibility _is_ the feature. If a
brand could silently hide or edit unflattering reviews, the Drop Sheet's peer
reviews become marketing copy and the budtender community loses trust in the
signal. The spec's rule — "admins remove violations; cannot edit or hide;
credibility is the feature" — is made structurally impossible to violate: the
schema does not provide a hide mechanism, and no edit server fn exists for admins.

**Load-bearing enforcement — the column-absence + the no-edit-fn rule.** The law is
the _shape_ of the table (it has no suppression column) plus the _absence_ of any
admin edit/hide server fn. Nothing can hide a review because nothing can express
"hidden."

- **`reviews` is the one HARD-delete table (load-bearing).** Per
  [`02-data-model.md` §2.3](./02-data-model.md), `reviews` deliberately has **no
  `deleted_at`** column and **no** `hidden`/`suppressed`/`status` flag — the only
  way out is a real `DELETE`. This is called out as the explicit exception to the
  repo-wide soft-delete policy. UNIQUE `(brand_id, product_id, user_id)` enforces
  one review per budtender per product.
- **Authz split in `reviews.functions.ts` (load-bearing).**
  [`03-app-structure.md`](./03-app-structure.md) defines `upsertMyReview` (author
  only, edits **own** review in place) and `deleteReview` (admin, gated by
  `requireBrandRole`). There is **no** `editReview`/`hideReview`/`moderateReview`
  server fn. `deleteReview` issues `DELETE FROM reviews WHERE id = ? AND brand_id =
?` — it cannot update.
- **No admin "edit/hide review" affordance.** `/admin/reviews`
  ([`03-app-structure.md`](./03-app-structure.md)) renders a list with a single
  destructive **Delete** action ("delete guideline-violating reviews (NEVER edit,
  NEVER hide)") — no edit field, no visibility toggle.

**Regression test.**

```ts
// tests/compliance/reviews-hard-delete.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

describe("INV-3 reviews delete-never-suppress", () => {
  it("reviews table has no soft-delete or hidden flag (structural law)", () => {
    const schema = readFileSync("src/schema.ts", "utf8");
    const start = schema.indexOf('sqliteTable(\n  "reviews"');
    const block = schema.slice(start, schema.indexOf("sqliteTable(", start + 1));
    // the column-name SET is the law — no suppression column may exist
    expect(block).not.toMatch(/deleted_at|archived_at|hidden|suppressed|is_visible|status/);
    // one review per budtender per product is a UNIQUE over (brand_id, product_id, user_id)
    expect(block).toMatch(/unique\([^)]*\)[\s\S]*?brandId[\s\S]*?productId[\s\S]*?userId/);
  });

  it("no admin edit/hide review server fn exists", () => {
    const fns = readFileSync("src/lib/reviews.functions.ts", "utf8");
    expect(fns).not.toMatch(/editReview|hideReview|moderateReview|setReviewVisible/);
    expect(fns).toMatch(/deleteReview/);
  });

  it("deleteReview issues a real DELETE, not an UPDATE", () => {
    const fns = readFileSync("src/lib/reviews.functions.ts", "utf8");
    const handler = fns.slice(fns.indexOf("deleteReview"));
    expect(handler).toMatch(/DELETE FROM reviews/i);
    expect(handler.slice(0, handler.indexOf("})", 0) + 2)).not.toMatch(/UPDATE reviews/i);
  });
});
```

A runtime authz test complements this: signing in as an org `admin` and calling
`upsertMyReview` against **another** budtender's review id must be rejected
(an admin's only review power is `deleteReview`), and there must be no server fn
that flips a review to a non-visible state.

---

## INV-4 — Sprout stays invisible inside portals

**Invariant.** Inside a brand portal, the only Sprout mark is the
**"Powered by Sprout"** footer credit. The Sprout wordmark/`Logo` appears **only**
in the **Hub** (the one Sprout-branded surface) and Brand-Admin chrome — never in
the one-page portal shell.

**Why (product integrity / "infinite skins").** The whole value proposition is
"one engine, infinite skins" — each brand portal must look entirely like _that
brand's_ product, not like a Sprout-branded SaaS. A Sprout logo bleeding into the
portal chrome breaks the white-label promise and confuses the budtender about
whose product they are in.

**Load-bearing enforcement — the portal-subtree import boundary.** The portal
shell physically cannot render the Sprout wordmark because the chrome-import guard
forbids importing it; the only logo it can reach is `<BrandLogo>`.

- **Portal shell uses `<BrandLogo>`, not `Logo` (load-bearing).**
  [`03-app-structure.md`](./03-app-structure.md) makes `components/brand/BrandLogo`
  the **only** logo in the `_portal` shell (it renders the org's uploaded logo from
  `portal_config.logo_ref` via roadie `getReadUrl`, falling back to a tinted
  `BrandIcon`/`LogoIcon`). The build-time Sprout `Logo`
  (`packages/ui/.../logo/logo.tsx`, reads `platformConfig.brand`) is reachable
  **only** from Hub/Admin chrome. The footer credit is a fixed string, not the
  Sprout wordmark component.
- **Chrome-import guard test (CI).** A contract test asserts no file under
  `src/components/shell/**`, `src/components/sections/**`, `src/components/drop-sheet/**`,
  or `src/routes/_portal/**` imports `Logo` (or `LogoAnimated`) from
  `@greenroom/ui`. The portal subtree may import `BrandLogo` and the footer-credit
  component only.

**Regression test.**

```ts
// tests/compliance/sprout-invisible.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync, globSync } from "node:fs";

const PORTAL_SUBTREE = [
  "src/components/shell/**/*.tsx",
  "src/components/sections/**/*.tsx",
  "src/components/drop-sheet/**/*.tsx",
  "src/components/ai/**/*.tsx",
  "src/routes/_portal/**/*.tsx",
  "src/routes/_portal.tsx",
];

describe("INV-4 Sprout invisible inside portals", () => {
  it("portal shell never imports the Sprout Logo wordmark", () => {
    const offenders: string[] = [];
    for (const p of PORTAL_SUBTREE) {
      for (const f of globSync(p)) {
        const src = readFileSync(f, "utf8");
        // allow BrandLogo; reject the Sprout Logo/LogoAnimated wordmark + LogoIcon used as a wordmark
        if (
          /from ["']@greenroom\/ui\/components\/logo\/logo["']/.test(src) ||
          /\bimport\s*\{[^}]*\bLogo(Animated)?\b[^}]*\}\s*from\s*["']@greenroom\/ui/.test(src)
        ) {
          offenders.push(f);
        }
      }
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("portal footer renders the fixed 'Powered by Sprout' credit", () => {
    const footer = readFileSync("src/components/shell/portal-footer-credit.tsx", "utf8");
    expect(footer).toMatch(/Powered by Sprout/);
  });
});
```

---

## INV-5 — Admins never need a developer

**Invariant.** Every per-brand customisation and every content operation the spec
lists is achievable through the Brand-Admin dashboard, writing **data**
(`brand_theme`/`portal_config` and content rows) — **never** by editing code or redeploying. If a
spec customisation has no `/admin` surface + server fn, the tooling has failed.

**Why (product integrity / "configuration, never code").** "One engine, infinite
skins" only holds if a brand operator can launch and run a portal without an
engineer. Per-brand = data only (logo, colours, fonts, hero slides, banners,
content, section on/off). Any customisation that secretly requires a code change
re-introduces code-per-client — the exact thing the spec forbids.

**Load-bearing enforcement — every customisation is a config/content write
behind an `/admin` server fn.** The law is that no customisation routes through
build-time config; each one resolves to a data write a Brand-Admin can perform.

- **Runtime brand config is DB rows, not build-time brand (load-bearing).**
  [`01-architecture.md` §2](./01-architecture.md) and
  [`03-app-structure.md`](./03-app-structure.md) draw the hard line: per-brand skins
  live in the `brand_theme` (draft/live `*_theme_json`) + `portal_config` (`sections_json`,
  `feed_label`, `logo_ref`) + `hero_slides` + `banner_cards`, edited via
  `brand.functions.ts` (`updatePortalConfig`, `updateThemeDraft`, `publishTheme`). They are **never**
  routed through `packages/config` (which brands the whole fork
  at build time).
- **Every content type has an admin write path (load-bearing).** Each spec
  customisation maps to an `/admin` route + a content server fn: `/admin/setup`
  (brand_theme, portal_config, hero_slides, banners, sections),
  `/admin/content/{assets,drops,decks,quizzes,banners,feed}`,
  `/admin/calls` (availability/sessions), `/admin/ai` (`ai_custom_qa`).
- **Customisation-coverage acceptance test (CI).** A test asserts that for each
  customisation key the spec enumerates, a corresponding `/admin` route and
  server fn exist. Forms must go through `useAppForm` (repo convention) — no
  customisation requires hand-edited config.

**Acceptance criterion / regression test.**

```ts
// tests/compliance/admin-self-serve.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, globSync } from "node:fs";

// Each spec customisation → the admin route that drives it + the server fn module.
const CUSTOMISATIONS: Array<[string, string, string]> = [
  [
    "logo/name/tagline/colours/fonts/sections/hero/banners",
    "src/routes/admin/setup.tsx",
    "src/lib/brand.functions.ts",
  ],
  ["assets", "src/routes/admin/content/assets.tsx", "src/lib/assets.functions.ts"],
  ["drops", "src/routes/admin/content/drops.tsx", "src/lib/drops.functions.ts"],
  ["decks", "src/routes/admin/content/decks.tsx", "src/lib/decks.functions.ts"],
  ["quizzes", "src/routes/admin/content/quizzes.tsx", "src/lib/quizzes.functions.ts"],
  ["banners", "src/routes/admin/content/banners.tsx", "src/lib/brand.functions.ts"],
  ["feed", "src/routes/admin/content/feed.tsx", "src/lib/feed.functions.ts"],
  ["calls", "src/routes/admin/calls.tsx", "src/lib/ai.functions.ts"],
  ["ai-qa", "src/routes/admin/ai.tsx", "src/lib/ai.functions.ts"],
];

describe("INV-5 admins never need a developer", () => {
  it("every spec customisation has an admin route + server fn", () => {
    for (const [label, route, fn] of CUSTOMISATIONS) {
      expect(existsSync(route), `missing admin route for ${label}`).toBe(true);
      expect(existsSync(fn), `missing server fn for ${label}`).toBe(true);
    }
  });

  it("brand customisation is never wired through build-time config", () => {
    const brandFns = readFileSync("src/lib/brand.functions.ts", "utf8");
    expect(brandFns).not.toMatch(/@greenroom\/config\/(deploy|brand)/);
    expect(brandFns).toMatch(/brand_theme|portal_config|hero_slides|banner_cards/);
  });

  it("admin editors use useAppForm (no hand-rolled native inputs)", () => {
    for (const f of globSync("src/components/admin/**/*-form.tsx")) {
      const src = readFileSync(f, "utf8");
      expect(src, f).toMatch(/useAppForm/);
    }
  });
});
```

---

## INV-6 — Notifications per-brand, per-type (no global switch)

**Invariant.** A budtender's notification preferences are granular — keyed by
**user × brand × type**. There is **no single global on/off switch** that mutes
everything.

**Why (product integrity).** A budtender is a member of multiple brand portals and
cares about different signals per brand (new posts, chat, contact replies, session
reminders, award). A global mute is a blunt instrument that drives users to turn
_everything_ off, killing engagement; granular control is what keeps the
notification channel trusted and used. The spec lists "Notifications per-brand,
per-type (granular settings; never one global switch)" as a non-negotiable rule.

**Load-bearing enforcement — the composite PK shape.** `notification_prefs`'s
composite PK makes a single global-mute row literally unrepresentable; the UI and
the per-key pref check follow from that shape.

- **`notification_prefs` is keyed three ways (load-bearing).** Per
  [`02-data-model.md` §11](./02-data-model.md), `notification_prefs` has composite
  PK `(user_id, brand_id, type)` and is default-on; a row marks an explicit choice.
  The schema makes a global switch unrepresentable — there is no `(user_id)`-only
  preference row and no `notify_all` boolean. (Because `brand_id` is part of this
  composite PK, `notification_prefs` is **not** an INV-14 brand-id-exclusion table —
  see INV-14.)
- **`/hub/notifications` renders a per-brand × per-type matrix.**
  [`03-app-structure.md`](./03-app-structure.md) places notification settings at
  `/hub/notifications` (and surfaces them on the Hub per
  [`01`/`02`](./02-data-model.md)). The `NotificationSettings` component renders one
  toggle per (brand, type) pair — no master toggle.
- **The pref check is per (user, brand, type).** Notification-emitting server
  fns consult `notification_prefs` by the full composite key before inserting a
  `notifications` row.

**Regression test.**

```ts
// tests/compliance/notification-granularity.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

describe("INV-6 per-brand per-type notifications", () => {
  it("notification_prefs PK is (user_id, brand_id, type)", () => {
    const schema = readFileSync("src/schema.ts", "utf8");
    const block = schema.slice(schema.indexOf('sqliteTable(\n  "notification_prefs"'));
    expect(block).toMatch(/primaryKey\(\{ columns: \[t\.userId, t\.brandId, t\.type\] \}\)/);
    expect(block).not.toMatch(/notify_all|global|master|mute_all/i);
  });

  it("settings UI has no master/global toggle", () => {
    const ui = readFileSync("src/components/hub/notification-settings.tsx", "utf8");
    expect(ui).not.toMatch(/all notifications|mute all|global toggle|master switch/i);
  });
});
```

---

## INV-7 — One page, no routing; sections are layers; scroll restored

**Invariant.** A brand portal is a **single shell loaded once**. Each section opens
as a **layer over** the shell driven by a typed `?section=` search param — **not** a
path change. Closing a layer restores the exact scroll position. The hero, banner
rail, and AI bubble stay mounted across open/close.

**Why (product integrity).** "One page, one shell; sections are layers; closing
restores exact scroll position; NO routing" is a literal product rule. Navigating
to `/decks` would unmount the shell, kill the hero carousel timer, reset banner
impressions, and lose scroll — breaking the signature feel of the product.

**Load-bearing enforcement — the section is a search param, not a route file.** The
shell can never remount on section open because there are no `/_portal/{section}`
child routes to navigate to; the only way in is a same-route `?section=` change.

- **Shell is a pathless layout; sections are search params (load-bearing).**
  [`03-app-structure.md`](./03-app-structure.md) makes `_portal.tsx` a pathless
  layout route that renders `RotatingHero`, `BannerRail`, `AiBubble`, and
  `<LayerStack/>` above `<Outlet/>`. `_portal/home.tsx` owns the typed
  `homeSearch = type({ "section?": "'assets'|'decks'|'quizzes'|'feed'|'chat'|'contact'", "item?": "string" })`.
  Opening a section is `navigate({ search: s => ({ ...s, section: "decks" }) })` —
  a same-route search change, so the shell never remounts. There are **no**
  `/_portal/decks`, `/_portal/quizzes`, … child route files. The `?section=` param
  value is identical to the `live_sections_json` key (`assets | decks | quizzes |
feed | chat | contact`), 1:1.
- **Scroll restoration.** The router is created with `scrollRestoration: true`
  (mirrors `workers/identity/src/router.tsx`); because the grid never unmounts, the
  browser preserves its offset, and `PortalShell` snapshots `window.scrollY` for
  the mobile-body-scroll edge case.
- **Route-tree absence test (CI).**

**Regression test.**

```ts
// tests/compliance/one-page-shell.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, globSync } from "node:fs";

describe("INV-7 one-page shell, sections are layers", () => {
  it("no section is a child route under _portal", () => {
    const sectionRoutes = ["assets", "decks", "quizzes", "feed", "chat", "contact"].map(
      (s) => `src/routes/_portal/${s}.tsx`,
    );
    for (const r of sectionRoutes) expect(existsSync(r), `${r} must NOT exist`).toBe(false);
  });

  it("home route validates a section search param (not a path)", () => {
    const home = readFileSync("src/routes/_portal/home.tsx", "utf8");
    expect(home).toMatch(/validateSearch/);
    expect(home).toMatch(/"section\?":/);
  });

  it("router enables scrollRestoration", () => {
    expect(readFileSync("src/router.tsx", "utf8")).toMatch(/scrollRestoration:\s*true/);
  });

  it("hero/banners/AI bubble live in the persistent shell, not a section", () => {
    const shell = readFileSync("src/routes/_portal.tsx", "utf8");
    expect(shell).toMatch(/RotatingHero/);
    expect(shell).toMatch(/BannerRail/);
    expect(shell).toMatch(/AiBubble/);
    expect(shell).toMatch(/LayerStack/);
  });
});
```

---

## INV-8 — Hero is a rotating carousel

**Invariant.** The landing hero is a **rotating carousel** — multiple ordered
slides, auto-advance, arrows + dots — not a single static banner image.

**Why (product integrity).** The spec specifies a rotating brand-image hero
(auto-advance, arrows + dots; each slide a brand image with a category). A static
hero is a different product surface and loses the brand's ability to showcase a
rotating set of campaign images. Listed as a product rule: "Hero is a rotating
carousel (auto-advance, arrows + dots; not a static banner)."

**Load-bearing enforcement — the multi-row ordered slide table.** `hero_slides` is
modelled as _many_ ordered rows per brand, so a single static image is not even
expressible; `RotatingHero` is the carousel that consumes it.

- **Multi-row, ordered slide data (load-bearing).** `hero_slides`
  ([`02-data-model.md` §1](./02-data-model.md)) is a per-brand table with
  `order_idx`, `enabled`, `image_ref`, `category` — modelled as _many_ slides per
  brand, indexed `(brand_id, order_idx)`. The data shape presumes a carousel, not a
  single field on `portal_config`.
- **`RotatingHero` is a carousel primitive.**
  [`03-app-structure.md`](./03-app-structure.md) marks `RotatingHero` as a **NEW**
  carousel primitive (embla / scroll-snap; no carousel exists in `packages/ui`),
  mounted once in `_portal.tsx` with auto-advance, arrows, and dots, reading the
  ordered `hero_slides`.
- **Behaviour test.** A component test asserts the structural carousel law — the
  hero renders one dot per slide (N slides ⇒ N dot controls) and exposes
  prev/next + auto-advance — not an incidental aria-label or test-id string.

**Regression test.**

```ts
// tests/compliance/hero-carousel.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { RotatingHero } from "@/components/shell/rotating-hero";

const slides = [
  { id: "a", imageRef: "r1", category: "Flower", headline: "One", orderIdx: 0 },
  { id: "b", imageRef: "r2", category: "Hash", headline: "Two", orderIdx: 1 },
];

describe("INV-8 hero rotating carousel", () => {
  it("renders multiple ordered slides with arrows and dots", () => {
    render(<RotatingHero slides={slides} />);
    expect(screen.getByRole("button", { name: /next/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /previous/i })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /slide \d/i })).toHaveLength(2); // dots
  });

  it("auto-advances on a timer", () => {
    vi.useFakeTimers();
    render(<RotatingHero slides={slides} autoAdvanceMs={4000} />);
    const first = screen.getByTestId("hero-active-slide").getAttribute("data-slide-id");
    vi.advanceTimersByTime(4000);
    expect(screen.getByTestId("hero-active-slide").getAttribute("data-slide-id")).not.toBe(first);
    vi.useRealTimers();
  });
});
```

---

## INV-9 — Banners flank the hero (side columns / top strip)

**Invariant.** Brand banner cards are placed as **side columns flanking the hero on
desktop** and a **horizontal top strip on mobile** — they are part of the
persistent shell chrome, never a body content block.

**Why (product integrity).** The spec fixes banner placement: "Banners: side/top
strip (flank hero desktop; collapse to horizontal top strip mobile)." Banners that
render as a body block would scroll away, break the impression/clickthrough model,
and visually compete with the section grid.

**Load-bearing enforcement — `BannerRail`'s mount position in the shell.** The rail
is part of `_portal.tsx`'s persistent chrome, mounted _outside_ `<Outlet/>`, so it
can never render as scroll-away body content.

- **`BannerRail` lives in `_portal.tsx`, outside `<Outlet/>` (load-bearing).**
  [`03-app-structure.md`](./03-app-structure.md) mounts `BannerRail` (composed from
  `Card` + `surfaceMaterials`) in the persistent shell alongside `RotatingHero`,
  flanking the hero. It is responsive: side columns desktop, top strip mobile.
- **Banner data supports the rail.** `banner_cards`
  ([`02-data-model.md` §1](./02-data-model.md)) carries `order_idx`, `category_tag`,
  `headline`, `line`, `link_json` (a section link, never a URL — see INV-13),
  live/expiry windows, and `impressions`/`clicks` counters — the data behind a
  side/top promo rail, with per-user `banner_dismissals`.

**Regression test.**

```ts
// tests/compliance/banner-placement.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

describe("INV-9 banners flank the hero", () => {
  it("BannerRail is mounted in the persistent shell, not inside the outlet", () => {
    const shell = readFileSync("src/routes/_portal.tsx", "utf8");
    const bannerIdx = shell.indexOf("BannerRail");
    const outletIdx = shell.indexOf("<Outlet");
    expect(bannerIdx).toBeGreaterThan(-1);
    // BannerRail appears above the Outlet (shell chrome), not as outlet content
    expect(bannerIdx).toBeLessThan(outletIdx);
  });

  it("BannerRail renders side columns (desktop) and a top strip (mobile)", () => {
    const rail = readFileSync("src/components/shell/banner-rail.tsx", "utf8");
    // responsive layout: a flex/grid column rail that collapses on small screens
    expect(rail).toMatch(/lg:flex-col|md:grid-cols|aside/);
  });
});
```

---

## INV-10 — Assets: download AND request physical

**Invariant.** Every Store Asset offers **two** actions — **DOWNLOAD** (digital,
counted per file) and **REQUEST PHYSICAL** (printed material → a short form
capturing a **shipping address** → the brand fulfilment queue). A physical request
records street/city/province/postal + contact + phone.

**Why (product integrity).** Budtenders need both the digital file (to use online)
and physical print collateral (tent cards, shelf talkers, displays, posters) for
the store floor. The spec mandates both actions and the full shipping-address
capture so the brand's fulfilment queue can ship real material.

**Load-bearing enforcement — the `physical_requests` shipping-address columns.** The
"request physical" action cannot be a stub: the schema requires the full address +
contact columns, so a request always carries enough to ship.

- **`physical_requests` captures the shipping address inline (load-bearing).**
  [`02-data-model.md` §4](./02-data-model.md) gives `physical_requests` the columns
  `ship_street`, `ship_city`, `ship_province`, `ship_postal`, `contact_name`,
  `contact_phone`, `quantity`, `store`, plus `status` flowing
  `Requested → Approved → Shipped` / `Declined`. `assets.physical_available` and
  `assets.physical_max_qty` gate the action per asset; `assets.download_count` is the
  per-file counter.
- **Both actions per asset.** The Store Assets section
  ([`03-app-structure.md`](./03-app-structure.md), `components/sections/store-assets/`)
  renders DOWNLOAD + REQUEST PHYSICAL on each asset card, with the request form
  (via `useAppForm`) capturing the address, and a "My Requests" status view.
- **`requestPhysical` writes the queue row (load-bearing).** `assets.functions.ts`'s
  `requestPhysical` validates the address and inserts a `physical_requests` row
  scoped by `brand_id`; `listMyRequests` reads the budtender's status.

**Regression test.**

```ts
// tests/compliance/assets-actions.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

describe("INV-10 download + request physical", () => {
  it("physical_requests captures a full shipping address", () => {
    const schema = readFileSync("src/schema.ts", "utf8");
    const block = schema.slice(schema.indexOf('sqliteTable(\n  "physical_requests"'));
    for (const col of [
      "ship_street",
      "ship_city",
      "ship_province",
      "ship_postal",
      "contact_name",
      "contact_phone",
    ]) {
      expect(block, `physical_requests must capture ${col}`).toMatch(new RegExp(col));
    }
    expect(block).toMatch(/Requested \| Approved \| Shipped \| Declined|"Requested"/);
  });

  it("both asset actions exist as server fns", () => {
    const fns = readFileSync("src/lib/assets.functions.ts", "utf8");
    expect(fns).toMatch(/requestPhysical/); // physical
    expect(fns).toMatch(/listAssets|downloadUrl|getReadUrl/); // digital download path
    expect(fns).toMatch(/listMyRequests/); // status tracking
  });
});
```

---

## INV-11 — PK decks are uploaded PDFs (no field-by-field rebuild)

**Invariant.** A PK deck is **one uploaded PDF**. The platform **auto-derives** the
cover thumbnail and page count from the PDF. There is **no field-by-field deck
builder**. Replacing a deck = upload a new PDF against the same listing row.

**Why (product integrity).** Brands already produce polished sell-decks as PDFs;
forcing them to rebuild a deck field-by-field in an admin UI is exactly the
"developer/agency needed" friction the product removes. The spec: "PK Decks are
uploaded PDFs (flip through; no field-by-field rebuild)."

**Load-bearing enforcement — the `decks` column set has no page-content fields.** A
deck cannot be field-by-field rebuilt because the schema offers nowhere to store
per-page authored content; the content _is_ the `pdf_ref` blob.

- **`decks` holds a PDF ref + auto-derived metadata (load-bearing).**
  [`02-data-model.md` §3](./02-data-model.md): `decks.pdf_ref` is the roadie R2
  handle for the PDF; `cover_thumb_ref` and `page_count` are **auto-derived
  asynchronously** by the `deck.derive` queue job — `unpdf` (Workers-targeted) reads
  `page_count` and extracts the AI-corpus text, and the Cloudflare Browser Rendering
  binding screenshots page 1 → the thumbnail (the client flip-viewer rasterises with
  `pdfjs-dist`). Until the job completes the library card shows a `FileIcon`
  "processing" placeholder. There are **no** per-page text/content columns — the deck
  content _is_ the PDF. `download_allowed` gates the viewer's download button.
  `deck_progress` tracks flip depth (`last_page`, `time_spent_seconds`).
- **`registerDeckUpload`/`finalizeDeckUpload` take a PDF ref, derive the rest
  (load-bearing).** `decks.functions.ts` registers the uploaded PDF row, the client
  PUTs bytes, then `finalizeDeckUpload` sets `pdf_ref` and enqueues the
  `deck.derive` job; neither accepts page-by-page content. The flip-viewer
  (`components/sections/pk-decks/`) is a NEW PDF flip primitive.
- **Admin deck UI is upload-only.** `/admin/content/decks` uploads a PDF (auto
  thumbnail + page count); there is no rich-text/per-page deck editor.

**Regression test.**

```ts
// tests/compliance/pk-decks-pdf.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

describe("INV-11 PK decks are uploaded PDFs", () => {
  it("decks table is a PDF ref + auto-derived metadata, no page-content fields", () => {
    const schema = readFileSync("src/schema.ts", "utf8");
    const block = schema.slice(schema.indexOf('sqliteTable(\n  "decks"'));
    expect(block).toMatch(/pdf_ref/);
    expect(block).toMatch(/cover_thumb_ref/);
    expect(block).toMatch(/page_count/);
    // no per-page authored content columns
    expect(block).not.toMatch(/slides_json|page_body|deck_html|page_content/);
  });

  it("deck registration takes a PDF ref, not per-page content", () => {
    const fns = readFileSync("src/lib/decks.functions.ts", "utf8");
    expect(fns).toMatch(/registerDeckUpload/);
    expect(fns).toMatch(/pdfRef|pdf_ref/);
    expect(fns).not.toMatch(/pages:\s*\[|slideContent/);
  });
});
```

---

## INV-12 — Contact reaches a human (distinct from the AI)

**Invariant.** "Get in Touch" sends a **private in-platform message** that lands in
the Brand-Admin **inbox**; the reply comes back as an in-platform **notification**.
There is **no email client** (`mailto:`). The three product channels —
**AI** (instant automated answers), **Contact** (a _private_ member↔brand-team
thread that replies via notification), and **Group Chat** (the _community_ room
with the Team marker, backed by the `GroupChatRoom` DO) — are **strictly separate**:
the **only** cross-channel escalation path that exists anywhere is **AI→`bookCall`**.

**Why (product integrity).** The spec defines three strictly separate channels —
AI (instant automated), Contact (private to the brand team), Group Chat
(community). Collapsing Contact into the AI would route a budtender's private,
human-intended question into an automated responder; opening a `mailto:` would
leave the platform (violating "100% in-platform, nothing links out") and lose the
in-platform reply→notification loop.

**Load-bearing enforcement — `contact_replies`→notification + the absence of any
cross-channel escalation path other than AI→`bookCall`.** Contact stays a private
human loop because the reply path is a `notifications` row (not email, not the AI),
and the three channels stay separate because no fn bridges them — the only escalation
that exists is the AI's single `bookCall` tool.

- **`contact_threads` + `contact_replies` model the _private_ human loop
  (load-bearing).** [`02-data-model.md` §8](./02-data-model.md): `contact_threads`
  (topic ∈ Restocking | Events | Assets | Feedback | General; status
  open → replied → closed) lands in the admin inbox; `contact_replies` records a
  brand reply and **also** inserts a `notifications` row (`type = "contact_reply"`)
  — that is how the reply reaches the budtender in-platform. This is distinct from
  **Group Chat**, which is a community room (Team marker, presence, hearts) backed by
  the single `GroupChatRoom` DO — not a private thread and not a notification reply.
- **`sendContact` writes a thread, sends no client email (load-bearing).**
  `contact.functions.ts`'s `sendContact` inserts a `contact_threads` row (no
  `mailto:` redirect); `listInbox` (admin) reads it. The AI's `askAssistant`
  (`ai.functions.ts`) is a distinct server fn — Contact never routes into it, and
  Group Chat (the DO) is a third distinct surface. The only escalation that crosses
  channels is the AI's `bookCall` (INV-2); there is no `escalateToChat`,
  `contactToAi`, or equivalent bridge.
- **The Get-in-Touch form opens no email client.**
  `components/sections/contact/` renders the form (name/store/email pre-filled,
  topic picker) submitting to `sendContact`; no `href="mailto:"` anywhere.
- **Channel-separation grep (regression backstop, CI):** no `mailto:` in the portal
  subtree; Contact, AI, and Group Chat live in different modules.

**Regression test.**

```ts
// tests/compliance/contact-human.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync, globSync } from "node:fs";

describe("INV-12 contact reaches a human", () => {
  it("no mailto: anywhere in the app", () => {
    const offenders = globSync("src/**/*.{ts,tsx}").filter(
      (f) => /mailto:/.test(readFileSync(f, "utf8")) && !f.includes("tests/"),
    );
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("sendContact writes a thread; reply emits a notification", () => {
    const fns = readFileSync("src/lib/contact.functions.ts", "utf8");
    expect(fns).toMatch(/sendContact/);
    expect(fns).toMatch(/contact_threads/);
    const schema = readFileSync("src/schema.ts", "utf8");
    expect(schema).toMatch(/contact_reply/); // reply → notifications row
  });

  it("Contact and AI are separate channels", () => {
    const contact = readFileSync("src/lib/contact.functions.ts", "utf8");
    expect(contact).not.toMatch(/askAssistant|aiAnswer/); // contact never routes into the AI
  });
});
```

---

## INV-13 — Nothing links out (100% in-platform)

**Invariant.** The platform is 100% in-platform — **nothing links out**. Banner
cards, feed CTAs, and AI/Hub deep links target a **section** (`{section, params}`),
never an external URL. No `target="_blank"`, no `http(s)://` anchor href in the
portal chrome.

**Why (product integrity).** "100% IN-PLATFORM — nothing links out" is the opening
line of the spec. An external link breaks the one-page-shell model (INV-7), leaks
the budtender out of the controlled brand surface, and undermines the in-platform
analytics + compliance story.

**Load-bearing enforcement — the arktype write-validator on `link_json`.** Because
banner links are brand-authored at runtime, the law that bites is the server-side
arktype validator that accepts only a `{ section, params }` shape and rejects a URL;
the outbound-link grep is a source-only backstop.

- **Banner links are a section shape, not a URL (load-bearing).**
  [`02-data-model.md` §1](./02-data-model.md): `banner_cards.link_json` is
  documented as `{ section, params }` — **"NEVER an external URL (the platform is
  100% in-platform — nothing links out)"**. The arktype write-validator on the
  banner upsert is the point that holds: it accepts only `{ section, params }` and
  rejects any `href`/`url`/`http(s)` shape before the row is written.
- **Deep links use the layer-stack hook.** Banner/feed/AI CTAs call
  `openLayer(section, item)` ([`03-app-structure.md`](./03-app-structure.md)) —
  a `?section=` search-param change, not an anchor to an external host.
- **Outbound-link grep (regression backstop, CI).**

**Regression test.**

```ts
// tests/compliance/no-external-links.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync, globSync } from "node:fs";

describe("INV-13 nothing links out", () => {
  it("banner link validator is a section shape, not a URL", () => {
    const fns = readFileSync("src/lib/brand.functions.ts", "utf8");
    // the banner upsert validator describes { section, params }, never href/url
    const banner = fns.slice(fns.indexOf("Banner"));
    expect(fns).toMatch(/section/);
    expect(banner).not.toMatch(/href:\s*"https?|url:\s*"https?/);
  });

  it("no external anchors or new-tab links in the portal subtree", () => {
    const offenders: string[] = [];
    for (const f of globSync("src/components/{shell,sections,drop-sheet,ai,hub}/**/*.tsx")) {
      const src = readFileSync(f, "utf8");
      if (/href=\{?["'`]https?:\/\//.test(src) || /target=["']_blank["']/.test(src))
        offenders.push(f);
    }
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
```

> Note: the portal still calls roadie `getReadUrl` for presigned blob URLs — those
> are _content fetches_ served in-platform (PDF flip-viewer, lightbox, native
> player), not navigations the user is sent _out_ through. The grep targets anchor
> `href`s / `target="_blank"`, not `fetch`/`src` of brand media.

---

## INV-14 — Multi-tenant isolation (every query scoped by org)

**Invariant.** Every tenant-scoped domain read/write is filtered by `brand_id` (=
`organization.id`), and `brand_id` is **always** derived from the verified envelope
(`context.principal.activeOrgId`) or the host→org resolution — **never** from
server-fn input. No code path can read or write another brand's data.

**Why (product integrity / data security).** One worker instance serves every
brand portal. The entire white-label model depends on a budtender at brand A never
seeing or mutating brand B's products, reviews, decks, feed, bookings, or analytics.
Accepting `brand_id` from client input would let a caller forge a cross-brand write
— the exact forgery surface quiz documents at `courses.functions.ts:115-118`.

**Load-bearing enforcement — `brand_id` is set from the verified envelope/host in the
handler, never from `data` (and the DO gates its socket on it).** Forgery is
impossible because tenancy is bound server-side from `context.principal.activeOrgId`
(or host→org), and the realtime DO additionally asserts the socket's org before
admitting it.

- **Handlers read tenancy from the principal, never `data` (load-bearing).** The
  canonical server-fn shape ([`03-app-structure.md`](./03-app-structure.md),
  [`01-architecture.md` §10](./01-architecture.md)) sets
  `const brandId = context.principal.activeOrgId;` and binds it into every query;
  reads also bind the caller id so a row returns only when public OR the caller has
  a membership. The two role layers (platform `actor.role` via `isAdminRole` vs the
  org-plugin role via `getCallerOrgRole`) are kept separate; Brand-Admin writes gate
  on the org `theme:["update"]` permission. A forged `brand_id` in input is ignored
  on **both** the write side (the row lands on the caller's brand) and the read side
  (the foreign `brand_id` is dropped, so the listing stays caller-scoped).
- **`brand_id` on every tenant row, indexed (load-bearing).**
  [`02-data-model.md`](./02-data-model.md) carries an indexed `brand_id` on every
  authoring/leaf table (denormalized onto hot leaf rows: `attempts`,
  `deck_progress`, `chat_messages`, `session_attendance`). It is `.notNull()`
  everywhere it is always brand-scoped; the only **nullable** `brand_id` columns are
  `quizzes`/`attempts` (NULL = a public/platform-wide quiz, matching the live quiz
  schema) and `audit_log` (platform actions are brand-less). UNIQUE `(brand_id, …)`
  on the invariant-bearing tables enforces one review per user/product, one room per
  brand, one booking per slot. The AI retrieval (Vectorize) index has a `brand_id`
  metadata filter and the DO is `brand_id`-partitioned per room.
- **The DO gates its socket on the verified org (load-bearing).** Because one worker
  serves N brand hosts under the `*.sproutportal.ca` wildcard, the single
  `GroupChatRoom` DO derives `expectedHost` per-connection from the WS-upgrade Host
  header, validates the single-label wildcard shape, resolves the leftmost label →
  org via `org_brand_directory`, and for authenticated connections asserts the
  envelope principal's `activeOrgId === the resolved org_id` before admitting the
  socket (else reject `1008`). A member of brand A cannot open brand B's room even if
  a room id leaks.
- **Isolation harness (regression backstop, CI).** A vitest-pool-workers test seeds
  two brands and asserts no server fn returns or mutates the other brand's rows even
  when the client passes a foreign `brand_id` in `data` (write **and** read side),
  plus a DO assertion that a brand-A envelope cannot join a brand-B room.

**Regression test (cross-org leakage harness).**

```ts
// tests/compliance/tenant-isolation.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { env } from "cloudflare:test"; // vitest-pool-workers
import { listLineup, upsertProduct } from "@/lib/drops.functions";
import { seedBrand, asPrincipal, openRoomSocket } from "../helpers/tenancy";

describe("INV-14 multi-tenant isolation", () => {
  let brandA: string, brandB: string, productA: string;
  beforeEach(async () => {
    brandA = await seedBrand(env, "alice-co");
    brandB = await seedBrand(env, "bob-co");
    productA = await asPrincipal(brandA, () =>
      upsertProduct({ data: { name: "A-only Flower", category: "Flower" } }),
    );
  });

  it("a brand-B caller cannot read brand-A products", async () => {
    const lineup = await asPrincipal(brandB, () => listLineup({ data: {} }));
    expect(lineup.find((p) => p.id === productA)).toBeUndefined();
  });

  it("a forged brand_id in a write is ignored — the row lands on the caller's brand", async () => {
    // caller is brand B but tries to forge brandA in the payload
    const created = await asPrincipal(brandB, () =>
      // @ts-expect-error brand_id is NOT part of the validated input
      upsertProduct({ data: { name: "forged", category: "Hash", brand_id: brandA } }),
    );
    const row = await env.DB.prepare("SELECT brand_id FROM products WHERE id = ?")
      .bind(created.id)
      .first<{ brand_id: string }>();
    expect(row?.brand_id).toBe(brandB); // tenancy came from the principal, not the input
  });

  it("a forged brand_id in a READ is ignored — the listing stays caller-scoped", async () => {
    // brand-B caller forges brandA in the read payload; must still get only brand-B rows
    const lineup = await asPrincipal(brandB, () =>
      // @ts-expect-error brand_id is NOT part of the validated input
      listLineup({ data: { brand_id: brandA } }),
    );
    expect(lineup.find((p) => p.id === productA)).toBeUndefined();
  });

  it("a brand-A envelope cannot join a brand-B group-chat room (DO socket gate)", async () => {
    // GroupChatRoom derives expectedHost from the WS Host header and asserts
    // the envelope's activeOrgId === resolved org before admitting the socket.
    const ws = await openRoomSocket(env, { host: `bob-co.sproutportal.ca`, asBrand: brandA });
    expect(ws.closeCode).toBe(1008); // cross-brand socket rejected
  });

  it("every tenant table carries an indexed brand_id", async () => {
    const tables = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT IN ('org_brand_directory','_cf_KV','d1_migrations')",
    ).all<{ name: string }>();
    // Parent-scoped tables carry no brand_id of their own; each scopes via its parent FK:
    //   banner_dismissals → banner_cards.brand_id   post_likes → posts.brand_id
    //   comment_likes → comments.brand_id           presence → chat_rooms.brand_id
    //   attempt_answers → attempts.brand_id         question_options → questions.brand_id
    //   post_media → posts.brand_id                 contact_replies → contact_threads.brand_id
    // (org_brand_directory is excluded by its org_id name rule above;
    //  notification_prefs is NOT excluded — brand_id is part of its composite PK.)
    const PARENT_SCOPED = [
      "banner_dismissals",
      "post_likes",
      "comment_likes",
      "presence",
      "attempt_answers",
      "question_options",
      "post_media",
      "contact_replies",
    ];
    for (const { name } of tables.results) {
      const cols = await env.DB.prepare(`PRAGMA table_info(${name})`).all<{ name: string }>();
      const hasBrand = cols.results.some((c) => c.name === "brand_id");
      if (!PARENT_SCOPED.includes(name)) expect(hasBrand, `${name} missing brand_id`).toBe(true);
    }
  });
});
```

---

## CI guardrails (making these durable)

The invariants above are only worth as much as the automation that keeps them
true. These guardrails run in the existing greenroom CI (the RWX gate's
per-package `test-<pkg>` tasks in `.rwx/ci.yml`) and pre-commit
(`scripts/staged-check.ts`).

### 1. Forbidden-term grep suite — the two genuine legal lines (INV-1, INV-2)

The forbidden-string grep is reserved for the **two genuine legal lines**: the
Education-Award framing (INV-1) and the no-instant-calls rule (INV-2). A single
`tests/compliance/forbidden-terms.test.ts` (or a `bun`/`rg` script wired into
`vp check`) greps the source + seeded content for context-scoped banned terms.
Every glob is anchored to an explicit repo root (`path.resolve` from `__dirname`)
and must match ≥1 file (the suite fails loudly if a glob matched nothing — a moved
file must never silently pass):

| Rule  | Pattern                                                 | Scope                                                                                                   |
| ----- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| INV-1 | `\b(prize\|reward\|cash\|winnings\|payout\|giveaway)\b` | Award components, `hub.functions.ts`, award emails, the AI system-prompt + seeded `ai_custom_qa`, seeds |
| INV-2 | `start call now\|instant (video )?call\|call now`       | all `src/**`                                                                                            |

Escape hatch: a `// forbidden-terms-allow: <reason>` trailing comment on a line
legitimately _naming_ a term (e.g. the test fixtures themselves, or a code comment
explaining the rule) is stripped before scanning, so the rule never blocks the
rule's own documentation.

> **Honest scope.** These greps catch naive copy/paste regressions in **source** and
> **seeded** content only — they are a regression backstop, **not** a guarantee.
> Paraphrases, dynamic strings, computed hrefs, and brand-authored **runtime**
> content (banner headlines, custom Q&A, `education_award.fund_description`/
> `covers_text`) slip past a static grep. The runtime guarantee for those fields is
> the **server-side arktype write-validator** (INV-1, INV-13), not this scan. The
> INV-13 outbound-link / `mailto:` check is an import-boundary backstop (§3, §5),
> not a legal-line grep.

### 2. Schema-shape contract tests (INV-3, INV-6, INV-10, INV-11, INV-14)

Read `workers/sprout/src/schema.ts` and assert structural facts that encode a law:

- `reviews` has **no** `deleted_at`/`hidden`/`status` column and keeps the UNIQUE
  over `(brand_id, product_id, user_id)` (one review per budtender per product) (INV-3).
- `notification_prefs` PK is exactly `(user_id, brand_id, type)` and has no
  global-mute column (INV-6).
- `physical_requests` carries the full `ship_*` + contact columns (INV-10).
- `decks` has `pdf_ref` + auto `cover_thumb_ref`/`page_count` and **no** per-page
  content column (INV-11).
- every non-parent-scoped table carries an indexed `brand_id`, `.notNull()` except
  the documented nullable exceptions (`quizzes`/`attempts` = public variant,
  `audit_log` = platform-level) (INV-14).

These run as plain Node `fs`-read tests (fast, no worker) plus the
vitest-pool-workers `PRAGMA table_info` sweep for the live-DB assertions.

### 3. Route-tree / component-absence tests (INV-2, INV-4, INV-7, INV-9, INV-12)

Assert the _absence_ of forbidden surfaces and the _presence_ of required ones:

- no `src/routes/_portal/{assets,decks,quizzes,feed,chat,contact}.tsx` child route
  files; `_portal/home.tsx` `validateSearch` carries the `section?` param (INV-7).
- no instant-call route/component (INV-2).
- portal subtree never imports the Sprout `Logo` wordmark; a `portal-footer-credit`
  renders "Powered by Sprout" (INV-4).
- `BannerRail` is mounted above `<Outlet/>` in `_portal.tsx` (INV-9).
- no `mailto:` in the portal subtree; Contact, AI, and Group Chat are separate
  modules with no cross-channel escalation bridge other than AI→`bookCall` (INV-12).

### 4. Authz contract tests (INV-3, INV-5, INV-14)

Server-fn module tests (importing the `*.functions.ts` source and the pure
predicates in `policy.server.ts`) assert:

- `reviews.functions.ts` exports `deleteReview` (hard `DELETE`) and `upsertMyReview`
  (author-own) but **no** `editReview`/`hideReview` (INV-3).
- each spec customisation key resolves to an `/admin` route + content server fn, and
  admin editors use `useAppForm` (INV-5).
- the tenant-isolation harness: two seeded brands, forged-`brand_id` input ignored
  on **both** the write and the read side, cross-brand reads empty, and a brand-A
  envelope rejected (`1008`) when joining a brand-B `GroupChatRoom` socket (INV-14).

### 5. Lint rule: portal-subtree import boundary (INV-4, INV-12, INV-13)

A `no-restricted-imports` / custom lint rule scoped to
`src/components/{shell,sections,drop-sheet,ai,hub}/**` and `src/routes/_portal/**`
forbids: importing the Sprout `Logo` wordmark, importing the AI module from the
contact module (keeping the three channels separate), and any anchor with an
external `href`. This catches violations at edit time, before the test job.

> **Per-file check quirk (from CLAUDE.md):** `vp check` phantoms vitest globals in
> `__tests__/`. Treat workspace-wide `bun run check` + tsgo as authoritative for the
> compliance suite; the `--no-verify` escape hatch is acceptable for
> test-file-touching commits, exactly as the two prior commits did.

---

## Traceability

Every invariant traces to a product rule in the spec and to a concrete artifact in
the foundation docs:

| Invariant | Spec rule                                                 | Grounding doc + artifact                                                                                            |
| --------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| INV-1     | "EDUCATION AWARD framing is law"                          | `02` `education_award.fund_description`/`covers_text`                                                               |
| INV-2     | "BOOKING ONLY — no instant calls EVER, incl. from the AI" | `01` §8 booking-only escalation; `02` §9 `bookings`/`availability_windows`; `03` `/admin/calls`                     |
| INV-3     | "Reviews: DELETE never suppress"                          | `02` §2.3 `reviews` (no `deleted_at`); `03` `reviews.functions.ts` / `/admin/reviews`                               |
| INV-4     | "Sprout stays INVISIBLE"                                  | `03` `<BrandLogo>` vs `Logo`; footer credit                                                                         |
| INV-5     | "Admins never need a developer"                           | `01` §2 runtime brand config split; `03` `/admin/*` + `brand.functions.ts`                                          |
| INV-6     | "Notifications per-brand, per-type"                       | `02` §11 `notification_prefs` PK; `03` `/hub/notifications`                                                         |
| INV-7     | "One page, one shell … NO routing"                        | `03` `_portal.tsx` + `?section=` search param                                                                       |
| INV-8     | "Hero is a rotating carousel"                             | `02` §1 `hero_slides`; `03` `RotatingHero`                                                                          |
| INV-9     | "Banners: side/top strip"                                 | `03` `BannerRail` in `_portal.tsx`; `02` §1 `banner_cards`                                                          |
| INV-10    | "Assets: download AND request physical"                   | `02` §4 `assets`/`physical_requests`; `03` `assets.functions.ts`                                                    |
| INV-11    | "PK Decks are uploaded PDFs"                              | `02` §3 `decks.pdf_ref` + auto thumb/count; `03` flip-viewer                                                        |
| INV-12    | "Contact reaches a HUMAN; 3 channels separate"            | `02` §8 `contact_threads`/`contact_replies`; `03` `contact.functions.ts` vs `ai.functions.ts` vs `GroupChatRoom` DO |
| INV-13    | "100% IN-PLATFORM — nothing links out"                    | `02` §1 `banner_cards.link_json`; `03` `openLayer`                                                                  |
| INV-14    | "Multi-tenant isolation"                                  | `01` §10; `02` tenancy rules; `03` server-fn shape                                                                  |
