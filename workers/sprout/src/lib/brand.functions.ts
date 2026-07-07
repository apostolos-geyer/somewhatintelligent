/**
 * Brand server functions, split along the two storage paths:
 *
 *  - THEME path (`brand_theme`): the skin. Public read rides `getBrandForHost`
 *    (root/blocking, no gate — the public/unauth landing must render the
 *    brand); admin writes keep the draft→publish lifecycle
 *    (`updateThemeDraft` / `publishTheme`).
 *  - PORTAL-CONTENT path (`portal_config`): name/tagline/logo + section
 *    toggles + feed label. Public read is `getPortalContent` (fetched by the
 *    portal page in parallel — never on the root path); the admin write
 *    (`updatePortalConfig`) is LIVE-EDIT, like hero slides.
 *
 * Every gated fn derives `brand_id` from the verified envelope, NEVER from
 * input (the tenancy invariant — §01 §10 / §02 conventions). Mutations run the
 * in-handler Brand-Admin gate (`assertBrandAdmin`) and `writeAudit` in the same
 * op, and upsert their per-org row so a fresh org doesn't need a create step.
 */
import { createServerFn } from "@tanstack/react-start";
import { setCookie } from "@tanstack/react-start/server";
import { getRequestBrandSlug } from "@/lib/request-host";
import { BRAND_COOKIE } from "@/lib/brand-resolution";
import { env } from "cloudflare:workers";
import { type } from "arktype";
import { and, asc, count, eq, sql } from "drizzle-orm";
import { ulid } from "@greenroom/kit/ids";
import {
  DEFAULT_FEED_LABEL,
  parseBrandTheme,
  parseSections,
  type BrandRuntime,
  type BrandTheme,
  type PortalContent,
  type SectionToggle,
} from "@/lib/brand";
import { createDb } from "@/lib/db";
import { bannerCards, brandTheme, heroSlides, orgBrandDirectory, portalConfig } from "@/schema";
import { resolveBrandBySlug, resolvePortalContentBySlug } from "@/lib/brand.server";
import { SECTION_KEYS, isSectionKey } from "@/lib/sections";
import { requireBrandAdmin } from "@/lib/middleware/auth";
import { assertBrandAdmin } from "@/lib/runtime.server";
import { getRoadie } from "@/lib/roadie";
import { writeAudit } from "@/lib/audit";

/** Public: resolve the runtime brand skin for the current request, under the
 * build-time addressing strategy (host label in subdomain mode, `sprout_brand`
 * cookie in path mode — `brand-resolution.ts`). */
export const getBrandForHost = createServerFn({ method: "GET" }).handler(
  async (): Promise<BrandRuntime | null> => {
    return resolveBrandBySlug(getRequestBrandSlug());
  },
);

/** Public: the viewed brand's portal CONTENT config (tagline, feed label,
 * section toggles). Same addressing as `getBrandForHost`; fetched by the portal
 * shell loader in parallel with banners/roles — never on the root path. */
export const getPortalContent = createServerFn({ method: "GET" }).handler(
  async (): Promise<PortalContent | null> => {
    return resolvePortalContentBySlug(getRequestBrandSlug());
  },
);

const selectBrandInput = type({ slug: "string >= 1" });

/**
 * Persist the `path`-mode brand selection: confirm the slug resolves to a real
 * brand, then set the host-scoped `sprout_brand` cookie. The `/b/$slug` entry
 * route calls this so the single staging host can switch brand skins with no
 * per-brand DNS/wildcard. `ok:false` (unknown slug) lets the route 404 instead
 * of persisting a dead cookie. Public/pre-auth — it only picks the SKIN; every
 * content read stays scoped to the verified envelope's `activeOrgId`.
 */
export const selectBrand = createServerFn({ method: "POST" })
  .inputValidator(selectBrandInput)
  .handler(async ({ data }): Promise<{ ok: boolean }> => {
    const brand = await resolveBrandBySlug(data.slug);
    if (!brand) return { ok: false };
    setCookie(BRAND_COOKIE, data.slug, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      maxAge: 60 * 60 * 24 * 30,
    });
    return { ok: true };
  });

// ─── Brand-Admin gate probe ──────────────────────────────────────────────────

/**
 * The cheapest possible Brand-Admin authorization probe — the `/admin` layout
 * guard awaits this before rendering any admin chrome. All the work is in the
 * `requireBrandAdmin` middleware; the handler is a no-op. It throws (notFound)
 * for a signed-in non-admin of the viewed brand and resolves for an
 * owner / admin / platform-admin.
 */
export const probeBrandAdmin = createServerFn({ method: "GET" })
  .middleware([requireBrandAdmin])
  .handler(async (): Promise<{ ok: true }> => ({ ok: true }));

// ─── THEME path (draft → publish) ────────────────────────────────────────────

/**
 * The theme editor's view: DRAFT + LIVE so the workbench can preview the draft
 * and diff it against what's live. Non-null even for a fresh org (empty
 * themes, "draft" state) so the editor renders sensible defaults.
 */
export interface AdminThemeView {
  draftTheme: BrandTheme;
  liveTheme: BrandTheme;
  state: "draft" | "live";
  livePublishedAt: number | null;
}

/** Gated admin read of the caller's brand theme (draft + live + lifecycle). */
export const getAdminTheme = createServerFn({ method: "GET" })
  .middleware([requireBrandAdmin])
  .handler(async ({ context }): Promise<AdminThemeView> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null

    const db = createDb(env.DB);
    const row = (
      await db
        .select({
          draftThemeJson: brandTheme.draftThemeJson,
          liveThemeJson: brandTheme.liveThemeJson,
          state: brandTheme.state,
          livePublishedAt: brandTheme.livePublishedAt,
        })
        .from(brandTheme)
        .where(eq(brandTheme.orgId, brandId))
        .limit(1)
    ).at(0);

    return {
      draftTheme: parseBrandTheme(row?.draftThemeJson),
      liveTheme: parseBrandTheme(row?.liveThemeJson),
      state: row?.state === "live" ? "live" : "draft",
      livePublishedAt: row?.livePublishedAt ?? null,
    };
  });

// Theme values are CSS strings; the public render sanitizes them again
// (`brandThemeToCss`) and `parseBrandTheme` filters keys against the token
// allow-list, so a permissive index-signature shape here is safe. Each map is
// keyed by a registry token key; an empty value clears that override. The client
// sends only the buckets it actually set (`compactTheme`), so these bare optional
// keys never see an explicit `undefined`. arktype is confined to this server-only
// module — it JIT-compiles validators with `new Function`, which the Workers
// runtime blocks anywhere it runs at request time (never in the client/SSR graph).
const themeMap = type({ "[string]": "string <= 120" });
const updateThemeDraftInput = type({
  theme: {
    "modePolicy?": "'adaptive' | 'fixed'",
    "fixedMode?": "'light' | 'dark'",
    "light?": themeMap,
    "dark?": themeMap,
    "radius?": themeMap,
    "spacing?": themeMap,
    "fonts?": themeMap,
  },
});

type UpdateThemeDraftTheme = typeof updateThemeDraftInput.infer.theme;

/** Trim values + drop empties, then run through `parseBrandTheme` so the stored
 * draft is allow-list-filtered (unknown keys dropped) and clean. Sanitization of
 * the values themselves happens at render time in `brandThemeToCss`. */
function compactThemeInput(input: UpdateThemeDraftTheme | undefined): BrandTheme {
  if (!input) return {};
  const trimMap = (m: Record<string, string> | undefined) => {
    if (!m) return undefined;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(m)) {
      const t = (v ?? "").trim();
      if (t.length > 0) out[k] = t;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  };
  return parseBrandTheme(
    JSON.stringify({
      modePolicy: input.modePolicy,
      fixedMode: input.fixedMode,
      light: trimMap(input.light),
      dark: trimMap(input.dark),
      radius: trimMap(input.radius),
      spacing: trimMap(input.spacing),
      fonts: trimMap(input.fonts),
    }),
  );
}

/**
 * Save the DRAFT theme. The live theme is untouched until `publishTheme`.
 * Upserts a `brand_theme` row for orgs that don't have one yet (`ON
 * CONFLICT(org_id)`), so onboarding doesn't need a separate "create" step.
 * `brand_id` is the envelope's, never input. Brand-Admin gated; audited.
 */
export const updateThemeDraft = createServerFn({ method: "POST" })
  .middleware([requireBrandAdmin])
  .inputValidator(updateThemeDraftInput)
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const actorId = context.principal.actor.id;
    await assertBrandAdmin(brandId, context.principal.actor.role);

    const draftThemeJson = JSON.stringify(compactThemeInput(data.theme));
    const now = Date.now();

    const db = createDb(env.DB);
    await db
      .insert(brandTheme)
      .values({
        id: ulid(),
        orgId: brandId,
        draftThemeJson,
        state: "draft",
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: brandTheme.orgId,
        set: { draftThemeJson, updatedAt: now },
      });

    await writeAudit({
      brandId,
      action: "theme.update",
      actorId,
      targetType: "brand_theme",
      targetId: brandId,
    });

    return { ok: true };
  });

/**
 * Publish the theme: copy `draft_theme_json` → `live_theme_json`, set
 * `state = 'live'`, and stamp `live_published_at`. After this the public portal
 * (which reads only the live column) shows the new skin. No-op-safe: throws if
 * no theme row exists yet (nothing to publish). Brand-Admin gated; audited.
 */
export const publishTheme = createServerFn({ method: "POST" })
  .middleware([requireBrandAdmin])
  .handler(async ({ context }): Promise<{ ok: true; publishedAt: number }> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const actorId = context.principal.actor.id;
    await assertBrandAdmin(brandId, context.principal.actor.role);

    const db = createDb(env.DB);
    const exists = (
      await db
        .select({ id: brandTheme.id })
        .from(brandTheme)
        .where(eq(brandTheme.orgId, brandId))
        .limit(1)
    ).at(0);
    if (!exists) throw new Error("nothing_to_publish");

    const now = Date.now();
    await db
      .update(brandTheme)
      .set({
        liveThemeJson: sql`${brandTheme.draftThemeJson}`,
        state: "live",
        livePublishedAt: now,
        updatedAt: now,
      })
      .where(eq(brandTheme.orgId, brandId));

    await writeAudit({
      brandId,
      action: "theme.publish",
      actorId,
      targetType: "brand_theme",
      targetId: brandId,
      meta: { publishedAt: now },
    });

    return { ok: true, publishedAt: now };
  });

// ─── PORTAL-CONTENT path (live-edit) ─────────────────────────────────────────

/**
 * The Setup screen's editable view of the content config. Non-null even for a
 * fresh org (defaults) so the screen renders without a create step.
 */
export interface AdminPortalConfigView {
  name: string;
  tagline: string;
  feedLabel: string;
  logoRef: string | null;
  sections: SectionToggle[];
}

/** Gated admin read of the caller's portal content config (live-edit data). */
export const getAdminPortalConfig = createServerFn({ method: "GET" })
  .middleware([requireBrandAdmin])
  .handler(async ({ context }): Promise<AdminPortalConfigView> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null

    const db = createDb(env.DB);
    const [cfgRows, dirRows] = await db.batch([
      db
        .select({
          name: portalConfig.name,
          tagline: portalConfig.tagline,
          feedLabel: portalConfig.feedLabel,
          logoRef: portalConfig.logoRef,
          sectionsJson: portalConfig.sectionsJson,
        })
        .from(portalConfig)
        .where(eq(portalConfig.orgId, brandId))
        .limit(1),
      db
        .select({ name: orgBrandDirectory.name, logoRef: orgBrandDirectory.logoRef })
        .from(orgBrandDirectory)
        .where(eq(orgBrandDirectory.orgId, brandId))
        .limit(1),
    ]);
    const cfg = cfgRows.at(0);
    const dir = dirRows.at(0);

    return {
      name: cfg?.name || dir?.name || "",
      tagline: cfg?.tagline ?? "",
      feedLabel: cfg?.feedLabel || DEFAULT_FEED_LABEL,
      logoRef: cfg?.logoRef ?? dir?.logoRef ?? null,
      sections: parseSections(cfg?.sectionsJson),
    };
  });

// A section toggle from the client. `order` is advisory — the handler
// re-normalizes to a contiguous 0..n-1 over the canonical key set, so a client
// can never inject a non-canonical key or a duplicate.
const updatePortalConfigInput = type({
  name: "string >= 1",
  "tagline?": "string <= 200",
  "feedLabel?": "string <= 80",
  sections: type({
    key: "string >= 1",
    enabled: "boolean",
    order: "number >= 0",
  }).array(),
});

/**
 * The ONE portal-content write: name, tagline, feed label, and the section
 * toggles, saved together and IMMEDIATELY LIVE (no draft/flip — same model as
 * hero slides). Sections are projected onto the canonical six-key enum:
 * unknown keys are dropped, missing keys appended disabled, `order` rewritten
 * to a contiguous 0..n-1. Upserts the per-org row. `brand_id` is the
 * envelope's, never input. Brand-Admin gated; audited.
 */
export const updatePortalConfig = createServerFn({ method: "POST" })
  .middleware([requireBrandAdmin])
  .inputValidator(updatePortalConfigInput)
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const actorId = context.principal.actor.id;
    await assertBrandAdmin(brandId, context.principal.actor.role);

    const tagline = data.tagline ?? "";
    const feedLabel = (data.feedLabel ?? "").trim() || DEFAULT_FEED_LABEL;

    // Project the client array onto the canonical key set, preserving the
    // client's relative order for known keys and dropping anything non-canonical.
    const byKey = new Map<string, { enabled: boolean; order: number }>();
    data.sections.forEach((s, i) => {
      if (!isSectionKey(s.key) || byKey.has(s.key)) return;
      byKey.set(s.key, { enabled: s.enabled, order: s.order ?? i });
    });
    const ordered = SECTION_KEYS.map((key) => ({
      key,
      enabled: byKey.get(key)?.enabled ?? true,
      order: byKey.get(key)?.order ?? Number.MAX_SAFE_INTEGER,
    }))
      .sort((a, b) => a.order - b.order)
      .map((s, idx): SectionToggle => ({ key: s.key, enabled: s.enabled, order: idx }));

    const sectionsJson = JSON.stringify(ordered);
    const now = Date.now();

    const db = createDb(env.DB);
    await db
      .insert(portalConfig)
      .values({
        id: ulid(),
        orgId: brandId,
        name: data.name,
        tagline,
        feedLabel,
        sectionsJson,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: portalConfig.orgId,
        set: { name: data.name, tagline, feedLabel, sectionsJson, updatedAt: now },
      });

    await writeAudit({
      brandId,
      action: "portal.update",
      actorId,
      targetType: "portal_config",
      targetId: brandId,
      meta: { name: data.name, feedLabel, sections: ordered },
    });

    return { ok: true };
  });

// ─── Dashboard stats ─────────────────────────────────────────────────────────

/** Quick-stats counts the admin dashboard surfaces. Hero slides + banners are
 * P1.C tables; the queries are scoped to the caller's brand and degrade to 0
 * before those tables have rows. `sectionsEnabled` reflects the LIVE toggles
 * (content is live-edit now), defaulting a fresh org to all six; theme state
 * comes from `brand_theme` (the only surface that still drafts). */
export interface AdminDashboardStats {
  state: "draft" | "live";
  livePublishedAt: number | null;
  heroSlides: number;
  banners: number;
  sectionsEnabled: number;
  sectionsTotal: number;
}

/**
 * Gated dashboard rollup for the admin home. `brand_id` is the envelope's
 * (NEVER input). Counts ride the per-brand indexes
 * (`hero_slides_brand_order_idx`, `banner_cards_brand_idx`). Returns a neutral
 * "draft, all-six-enabled, zero content" view when no rows exist yet.
 */
export const getAdminDashboardStats = createServerFn({ method: "GET" })
  .middleware([requireBrandAdmin])
  .handler(async ({ context }): Promise<AdminDashboardStats> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const total = SECTION_KEYS.length;

    const db = createDb(env.DB);
    const [theme, cfg, hero, banners] = await Promise.all([
      db
        .select({ state: brandTheme.state, livePublishedAt: brandTheme.livePublishedAt })
        .from(brandTheme)
        .where(eq(brandTheme.orgId, brandId))
        .limit(1)
        .then((rows) => rows.at(0)),
      db
        .select({ sectionsJson: portalConfig.sectionsJson })
        .from(portalConfig)
        .where(eq(portalConfig.orgId, brandId))
        .limit(1)
        .then((rows) => rows.at(0)),
      db
        .select({ n: count() })
        .from(heroSlides)
        .where(eq(heroSlides.brandId, brandId))
        .then((rows) => rows.at(0)),
      db
        .select({ n: count() })
        .from(bannerCards)
        .where(eq(bannerCards.brandId, brandId))
        .then((rows) => rows.at(0)),
    ]);

    const toggles = parseSections(cfg?.sectionsJson);
    const sectionsEnabled = toggles.length === 0 ? total : toggles.filter((t) => t.enabled).length;

    return {
      state: theme?.state === "live" ? "live" : "draft",
      livePublishedAt: theme?.livePublishedAt ?? null,
      heroSlides: hero?.n ?? 0,
      banners: banners?.n ?? 0,
      sectionsEnabled,
      sectionsTotal: total,
    };
  });

// ─── P1.B — Hero-slide management (Brand-Admin, envelope-scoped) ─────────────

/**
 * A hero slide as the Setup manager renders it. Carries the management fields
 * the public `listHeroSlides` read (in `landing.functions.ts`) deliberately
 * omits — `imageRef` (the raw roadie handle, NOT a signed URL), `enabled`, and
 * `orderIdx` — plus a resolved `imageUrl` for the thumbnail preview (null when
 * roadie is inert locally, or the blob won't resolve, so the manager renders a
 * placeholder rather than a broken image).
 *
 * NOTE on field naming: the journey report calls these "caption/tagline/link",
 * but the established schema + the public `HeroSlide` contract the portal shell
 * reads carry exactly `category` (the badge tag) and `headline`. Hero slides link
 * NOWHERE (the spec's hero is logo + tagline + "Enter Portal" only — there is no
 * per-slide link, unlike banner cards). We honour the schema; see notes[].
 */
export interface AdminHeroSlideView {
  id: string;
  imageRef: string;
  /** Short-lived signed thumbnail URL, or null when roadie is inert / unresolved. */
  imageUrl: string | null;
  category: string | null;
  headline: string | null;
  enabled: boolean;
  orderIdx: number;
  createdAt: number;
}

const HERO_COLS = {
  id: heroSlides.id,
  imageRef: heroSlides.imageRef,
  category: heroSlides.category,
  headline: heroSlides.headline,
  enabled: heroSlides.enabled,
  orderIdx: heroSlides.orderIdx,
  createdAt: heroSlides.createdAt,
} as const;

/**
 * Gated admin read: EVERY hero slide for the caller's brand — incl. disabled —
 * in `order_idx`, each with a resolved thumbnail URL for the manager grid. Unlike
 * the public `listHeroSlides`, a slide whose URL doesn't resolve is KEPT (with
 * `imageUrl: null`) so the admin can still edit/reorder/delete it. brand =
 * envelope `activeOrgId`, never input. Brand-role gated so a plain budtender
 * can't enumerate the brand's hero config.
 */
export const listAdminHeroSlides = createServerFn({ method: "GET" })
  .middleware([requireBrandAdmin])
  .handler(async ({ context }): Promise<AdminHeroSlideView[]> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    await assertBrandAdmin(brandId, context.principal.actor.role);

    const db = createDb(env.DB);
    const rows = await db
      .select(HERO_COLS)
      .from(heroSlides)
      .where(eq(heroSlides.brandId, brandId))
      .orderBy(asc(heroSlides.orderIdx), asc(heroSlides.id));

    const roadie = getRoadie();
    const out: AdminHeroSlideView[] = [];
    for (const row of rows) {
      let imageUrl: string | null = null;
      // Skip resolving placeholders (`pending:*`) — the bytes were never pushed
      // (roadie inert at register time); the manager shows the "needs R2" state.
      if (!row.imageRef.startsWith("pending:")) {
        try {
          const res = await roadie.getReadUrl({
            referenceId: row.imageRef,
            disposition: "inline",
            permissionScope: `brand:${brandId}`,
          });
          if (res.ok) imageUrl = res.value.url;
        } catch {
          imageUrl = null; // roadie inert / failed — manager shows a placeholder
        }
      }
      out.push({
        id: row.id,
        imageRef: row.imageRef,
        imageUrl,
        category: row.category,
        headline: row.headline,
        enabled: row.enabled !== 0,
        orderIdx: row.orderIdx,
        createdAt: row.createdAt,
      });
    }
    return out;
  });

const registerHeroUploadInput = type({
  hash: /^[a-f0-9]{64}$/,
  size: "number >= 0",
  contentType: "string >= 1",
  "category?": "string <= 80",
  "headline?": "string <= 160",
});

export interface RegisterHeroUploadResult {
  slideId: string;
  /** Reference handle to thread back into `finalizeHeroSlide`. */
  referenceId: string;
  /** Presigned PUT envelope for the browser, or null when roadie is inert. */
  upload: { url: string; headers: Record<string, string> } | null;
}

/**
 * Admin: open a draft hero slide. Registers the upload with roadie (returning the
 * presigned PUT envelope for the browser to push the image bytes) and INSERTs the
 * row APPENDED to the end of the order (`order_idx = max + 1`). The slide is
 * created DISABLED (`enabled = 0`) so a half-uploaded image never flashes on the
 * public hero — `finalizeHeroSlide` enables it once the bytes land. When roadie
 * is inert (local dev, no R2) the row still lands with a `pending:` placeholder
 * ref and `upload` is null; the manager surfaces the "needs R2" state. brand =
 * envelope `activeOrgId`, never input. Brand-Admin gated; audited.
 */
export const registerHeroUpload = createServerFn({ method: "POST" })
  .middleware([requireBrandAdmin])
  .inputValidator(registerHeroUploadInput)
  .handler(async ({ data, context }): Promise<RegisterHeroUploadResult> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const actorId = context.principal.actor.id;
    await assertBrandAdmin(brandId, context.principal.actor.role);

    const slideId = ulid();
    const now = Date.now();
    const category = data.category?.trim() ? data.category.trim() : null;
    const headline = data.headline?.trim() ? data.headline.trim() : null;

    // Register with roadie first so the returned referenceId becomes image_ref.
    // The placeholder stays if roadie is inert; finalize then fails gracefully
    // (the row is still a recoverable draft the admin can re-upload into).
    let referenceId = `pending:${slideId}`;
    let upload: RegisterHeroUploadResult["upload"] = null;
    try {
      const res = await getRoadie().registerUpload({
        hash: data.hash,
        size: data.size,
        contentType: data.contentType,
        application: { app: "sprout", resourceType: "hero_slide", resourceId: slideId },
      });
      if (res.ok) {
        referenceId = res.value.referenceId;
        if (res.value.status === "single-part") {
          upload = {
            url: res.value.upload.uploadUrl,
            headers: res.value.upload.requiredHeaders,
          };
        }
        // "ready" (dedup hit) → no upload needed; "multipart" → out of scope for
        // hero images (they're small) — the admin re-tries with a smaller file.
      }
    } catch {
      referenceId = `pending:${slideId}`; // roadie inert — keep the placeholder
      upload = null;
    }

    const db = createDb(env.DB);
    // Append to the end of the brand's order (contiguous tail).
    const max = (
      await db
        .select({ m: sql<number>`coalesce(max(${heroSlides.orderIdx}), -1)` })
        .from(heroSlides)
        .where(eq(heroSlides.brandId, brandId))
    ).at(0);
    const orderIdx = (max?.m ?? -1) + 1;

    await db.insert(heroSlides).values({
      id: slideId,
      brandId,
      imageRef: referenceId,
      category,
      headline,
      orderIdx,
      enabled: 0, // disabled until finalize confirms the bytes landed
      createdAt: now,
    });

    await writeAudit({
      brandId,
      action: "hero.register",
      actorId,
      targetType: "hero_slide",
      targetId: slideId,
      meta: { size: data.size, contentType: data.contentType },
    });

    return { slideId, referenceId, upload };
  });

const finalizeHeroInput = type({
  slideId: "string >= 1",
  referenceId: "string >= 1",
});

/**
 * Admin: finalize a hero-slide upload. Tells roadie the image bytes are fully
 * pushed, then stamps the finalized `image_ref` and flips `enabled = 1` so the
 * slide goes live on the next public hero read. brand = envelope `activeOrgId`;
 * the `brand_id` guard makes a cross-brand finalize a 404. Surfaces a roadie
 * failure (inert / missing parts) as "finalize_failed" so the admin can retry
 * rather than enabling a broken slide. Brand-Admin gated; audited.
 */
export const finalizeHeroSlide = createServerFn({ method: "POST" })
  .middleware([requireBrandAdmin])
  .inputValidator(finalizeHeroInput)
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const actorId = context.principal.actor.id;
    await assertBrandAdmin(brandId, context.principal.actor.role);

    const db = createDb(env.DB);
    const owned = (
      await db
        .select({ id: heroSlides.id })
        .from(heroSlides)
        .where(and(eq(heroSlides.id, data.slideId), eq(heroSlides.brandId, brandId)))
        .limit(1)
    ).at(0);
    if (!owned) throw new Error("not_found");

    let imageRef = data.referenceId;
    try {
      const res = await getRoadie().finalize({ referenceId: data.referenceId });
      if (!res.ok) throw new Error(`finalize_failed:${res.error}`);
      imageRef = res.value.referenceId;
    } catch (e) {
      throw e instanceof Error ? e : new Error("finalize_failed");
    }

    await db
      .update(heroSlides)
      .set({ imageRef, enabled: 1 })
      .where(and(eq(heroSlides.id, data.slideId), eq(heroSlides.brandId, brandId)));

    await writeAudit({
      brandId,
      action: "hero.finalize",
      actorId,
      targetType: "hero_slide",
      targetId: data.slideId,
    });

    return { ok: true };
  });

const upsertHeroMetaInput = type({
  slideId: "string >= 1",
  "category?": "string <= 80",
  "headline?": "string <= 160",
  enabled: "boolean",
});

/**
 * Admin: edit a hero slide's caption text (`category` tag + `headline`) and its
 * `enabled` toggle. The image bytes are immutable here — re-uploading is a new
 * slide. brand = envelope `activeOrgId`; the UPDATE's `brand_id` guard makes a
 * cross-brand edit a no-op → 404. Brand-Admin gated; audited.
 */
export const upsertHeroSlide = createServerFn({ method: "POST" })
  .middleware([requireBrandAdmin])
  .inputValidator(upsertHeroMetaInput)
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const actorId = context.principal.actor.id;
    await assertBrandAdmin(brandId, context.principal.actor.role);

    const category = data.category?.trim() ? data.category.trim() : null;
    const headline = data.headline?.trim() ? data.headline.trim() : null;

    const db = createDb(env.DB);
    const updated = await db
      .update(heroSlides)
      .set({ category, headline, enabled: data.enabled ? 1 : 0 })
      .where(and(eq(heroSlides.id, data.slideId), eq(heroSlides.brandId, brandId)))
      .returning({ id: heroSlides.id });
    if (updated.length === 0) throw new Error("not_found");

    await writeAudit({
      brandId,
      action: "hero.update",
      actorId,
      targetType: "hero_slide",
      targetId: data.slideId,
      meta: { category, headline, enabled: data.enabled },
    });

    return { ok: true };
  });

const reorderHeroInput = type({
  /** The full set of slide ids in the new visual order (top → bottom). */
  order: type("string >= 1").array(),
});

/**
 * Admin: reorder the caller's brand's hero slides to a contiguous `0..n-1`
 * sequence. The client sends the FULL slide-id list in its new order; the handler
 * filters it to ids the brand actually owns (a forged/foreign id is dropped),
 * appends any owned slide the client omitted (preserving its prior relative
 * order), and writes the new `order_idx` per row — all guarded by `brand_id`
 * so the write can never touch another tenant. brand = envelope `activeOrgId`,
 * never input. Brand-Admin gated; audited.
 */
export const reorderHeroSlides = createServerFn({ method: "POST" })
  .middleware([requireBrandAdmin])
  .inputValidator(reorderHeroInput)
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const actorId = context.principal.actor.id;
    await assertBrandAdmin(brandId, context.principal.actor.role);

    const db = createDb(env.DB);
    // The brand's own slides, in their current order — the canonical id set.
    const owned = await db
      .select({ id: heroSlides.id })
      .from(heroSlides)
      .where(eq(heroSlides.brandId, brandId))
      .orderBy(asc(heroSlides.orderIdx), asc(heroSlides.id));
    if (owned.length === 0) return { ok: true };

    const ownedIds = new Set(owned.map((r) => r.id));
    // Take the client's order, keep only ids we own (dropping forged/foreign +
    // duplicates), then append any owned id the client omitted so every slide
    // gets a contiguous index and none is orphaned.
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const id of data.order) {
      if (ownedIds.has(id) && !seen.has(id)) {
        seen.add(id);
        ordered.push(id);
      }
    }
    for (const r of owned) {
      if (!seen.has(r.id)) ordered.push(r.id);
    }

    // Nothing actually moved — skip the write (and the audit churn).
    const unchanged =
      ordered.length === owned.length && ordered.every((id, i) => owned[i]?.id === id);
    if (unchanged) return { ok: true };

    // Write each row's new index. One statement per row keeps it readable and the
    // slide count is tiny (a handful per brand); all guarded by brand_id.
    for (let i = 0; i < ordered.length; i++) {
      await db
        .update(heroSlides)
        .set({ orderIdx: i })
        .where(and(eq(heroSlides.id, ordered[i]!), eq(heroSlides.brandId, brandId)));
    }

    await writeAudit({
      brandId,
      action: "hero.reorder",
      actorId,
      targetType: "brand_config",
      targetId: brandId,
      meta: { order: ordered },
    });

    return { ok: true };
  });

const heroIdInput = type({ slideId: "string >= 1" });

/**
 * Admin: DELETE a hero slide (real DELETE — hero slides are config, not content,
 * so there is no soft-delete path; the public hero simply has one fewer slide).
 * After deleting, the remaining slides are renumbered to a contiguous `0..n-1`
 * sequence so the order never develops gaps. The `brand_id` guard scopes the
 * DELETE so an admin can't reach across tenants; a foreign/unknown `slideId` is
 * a no-op → 404. brand = envelope `activeOrgId`, never input. Brand-Admin gated;
 * audited.
 */
export const deleteHeroSlide = createServerFn({ method: "POST" })
  .middleware([requireBrandAdmin])
  .inputValidator(heroIdInput)
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const actorId = context.principal.actor.id;
    await assertBrandAdmin(brandId, context.principal.actor.role);

    const db = createDb(env.DB);
    const deleted = await db
      .delete(heroSlides)
      .where(and(eq(heroSlides.id, data.slideId), eq(heroSlides.brandId, brandId)))
      .returning({ id: heroSlides.id });
    if (deleted.length === 0) throw new Error("not_found");

    // Renumber the survivors to a contiguous 0..n-1 sequence so the gap left by
    // the removed slide doesn't accumulate. brand_id guards every write.
    const remaining = await db
      .select({ id: heroSlides.id, orderIdx: heroSlides.orderIdx })
      .from(heroSlides)
      .where(eq(heroSlides.brandId, brandId))
      .orderBy(asc(heroSlides.orderIdx), asc(heroSlides.id));
    for (let i = 0; i < remaining.length; i++) {
      if (remaining[i]!.orderIdx !== i) {
        await db
          .update(heroSlides)
          .set({ orderIdx: i })
          .where(and(eq(heroSlides.id, remaining[i]!.id), eq(heroSlides.brandId, brandId)));
      }
    }

    await writeAudit({
      brandId,
      action: "hero.delete",
      actorId,
      targetType: "hero_slide",
      targetId: data.slideId,
    });

    return { ok: true };
  });
