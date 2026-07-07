/**
 * Hub server functions (P2.E) — the leaderboard read. `getLeaderboard` is a GATED
 * GET that serves the MATERIALIZED `user_brand_scores` snapshot for the caller's
 * brand + a period (default = the current UTC month). The cron (`jobs/cron.ts`) is
 * the only writer of that table; this read never re-runs the score math, it just
 * sorts + ranks the snapshot.
 *
 * Tenancy: `brand_id` is the verified envelope's `activeOrgId`, NEVER input —
 * leaderboards are brand-scoped this phase (a cross-brand period is the caller's
 * own brand's). A forged `period` only changes WHICH month's snapshot you see for
 * YOUR brand; it can never leak another brand's rows.
 *
 * Ranking matches `user_brand_scores_leaderboard_idx` ordering: score DESC, ties
 * broken by `computed_at` ASC then `user_id` ASC (stable, deterministic). The top
 * 25 are returned; the caller's own rank is computed even when they fall outside
 * that window (a COUNT of strictly-better rows + 1). `displayName` is null for now
 * — names resolve from guestlist in a later phase.
 */
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { type } from "arktype";
import { and, asc, count, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { ulid } from "@greenroom/kit/ids";
import { createDb } from "@/lib/db";
import {
  brandTheme,
  notifications,
  orgBrandDirectory,
  portalAccessRequests,
  portalConfig,
  userBrandScores,
} from "@/schema";
import { portalEntryUrl } from "@/lib/brand-resolution";
import { brandAccent, parseBrandTheme } from "@/lib/brand";
import { getRoadie } from "@/lib/roadie";
import {
  requireUserMiddleware,
  requireBrandAudience,
  requireAdminMiddleware,
} from "@/lib/middleware/auth";
import { currentPeriod } from "@/lib/score";
import { resolveMemberNames } from "@/lib/member-names";
import { ensurePortalMember, listPortalBrandIds } from "@/lib/portal-members";
import { assertBrandAdmin, listCallerOrgs } from "@/lib/runtime.server";
import { writeAudit } from "@/lib/audit";
import { emitNotification } from "@/lib/notify";

/** One ranked leaderboard row as the table renders it. */
export interface LeaderboardEntry {
  userId: string;
  /** Resolved from guestlist (org members); null if the lookup can't resolve it. */
  displayName: string | null;
  score: number;
  rank: number;
}

export interface LeaderboardView {
  period: string;
  entries: LeaderboardEntry[];
  /** The caller's rank even when outside the top 25; null if unranked this period. */
  ownRank: number | null;
  /** The caller's score this period; null if they have no score row. */
  ownScore: number | null;
}

const TOP_N = 25;

const leaderboardInput = type({ "period?": "string" });

// resolveMemberNames moved to `@/lib/member-names` (shared with analytics).

/**
 * Gated: the caller's brand's leaderboard for a period. `brand_id` is the
 * envelope's `activeOrgId` (never input); `period` defaults to the current UTC
 * month. No active org → an empty board for the resolved period.
 */
export const getLeaderboard = createServerFn({ method: "GET" })
  .middleware([requireBrandAudience])
  .inputValidator(leaderboardInput)
  .handler(async ({ data, context }): Promise<LeaderboardView> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const userId = context.principal.actor.id;
    const period = data.period?.trim() ? data.period.trim() : currentPeriod(Date.now());

    const db = createDb(env.DB);

    // Top N for the board. Ordering mirrors user_brand_scores_leaderboard_idx
    // (brand_id, period, score) with deterministic tie-breaks so equal scores
    // rank stably across reads.
    const top = await db
      .select({
        userId: userBrandScores.userId,
        score: userBrandScores.score,
        computedAt: userBrandScores.computedAt,
      })
      .from(userBrandScores)
      .where(and(eq(userBrandScores.brandId, brandId), eq(userBrandScores.period, period)))
      .orderBy(
        desc(userBrandScores.score),
        asc(userBrandScores.computedAt),
        asc(userBrandScores.userId),
      )
      .limit(TOP_N);

    const names = await resolveMemberNames(brandId);
    const entries: LeaderboardEntry[] = top.map((row, i) => ({
      userId: row.userId,
      displayName: names.get(row.userId) ?? null,
      score: row.score,
      rank: i + 1,
    }));

    // The caller's own score row (if any) for this brand+period.
    const own = (
      await db
        .select({
          userId: userBrandScores.userId,
          score: userBrandScores.score,
          computedAt: userBrandScores.computedAt,
        })
        .from(userBrandScores)
        .where(
          and(
            eq(userBrandScores.brandId, brandId),
            eq(userBrandScores.period, period),
            eq(userBrandScores.userId, userId),
          ),
        )
        .limit(1)
    ).at(0);

    if (!own) return { period, entries, ownRank: null, ownScore: null };

    // Rank = (# rows strictly better) + 1, where "better" uses the SAME total
    // order as the board: higher score, or equal score with an earlier
    // computed_at, or equal score+computed_at with a smaller user_id.
    const better = (
      await db
        .select({ n: count() })
        .from(userBrandScores)
        .where(
          and(
            eq(userBrandScores.brandId, brandId),
            eq(userBrandScores.period, period),
            or(
              sql`${userBrandScores.score} > ${own.score}`,
              and(
                eq(userBrandScores.score, own.score),
                sql`${userBrandScores.computedAt} < ${own.computedAt}`,
              ),
              and(
                eq(userBrandScores.score, own.score),
                eq(userBrandScores.computedAt, own.computedAt),
                sql`${userBrandScores.userId} < ${userId}`,
              ),
            ),
          ),
        )
    ).at(0);

    const ownRank = (better?.n ?? 0) + 1;
    return { period, entries, ownRank, ownScore: own.score };
  });

// ─── P5.A — Hub: Your Portals + Portals You Can Join ─────────────────────────
//
// The Hub server fns are platform-wide (cross-brand) UNLIKE every brand surface,
// which reads `activeOrgId`. They read the caller's OWN memberships — the user id
// from the verified envelope (`context.principal.actor.id`), NEVER another user.
// Membership is guestlist-owned (the better-auth org plugin); `org_brand_directory`
// is the read-only slug/name/logo mirror, and `portal_access_requests` is only the
// join QUEUE. A Hub read therefore never returns a brand the caller isn't a member
// of — except the public "brands you can join" directory.

/** One portal tile: a brand the caller is a member of, with its unread badge. */
export interface PortalSummary {
  orgId: string;
  slug: string;
  name: string;
  logoRef: string | null;
  /** The brand's resolved logo image URL (roadie inline / inline data URL), or
   *  null when the brand has no logo or the blob can't resolve (dev/no R2) — the
   *  tile then falls back to the tinted brand initial. */
  logoUrl: string | null;
  /** The brand's identity colour (its retinted `--color-sprout`), or null — the
   *  Hub tile washes itself in this so each brand keeps its own colour. */
  accent: string | null;
  /** Unread notifications for THIS brand (read_at IS NULL), for the badge. */
  unreadCount: number;
  /** Cross-host URL of this brand's portal — `<slug>.<apex>` (derived, not input). */
  portalUrl: string;
}

/** One directory row the caller is not an audience member of — either actionable
 *  ("Request Access") or already requested (a pending request, shown badged). */
export interface JoinableBrand {
  orgId: string;
  slug: string;
  name: string;
  logoRef: string | null;
  /** Resolved logo URL (see PortalSummary) — null falls back to the brand initial. */
  logoUrl: string | null;
  /** The brand's identity colour for the tile wash; null = neutral. */
  accent: string | null;
  /** True when the caller has a PENDING access request for this brand — the tile
   *  renders the disabled "Requested" badge instead of the action button, and this
   *  persists across reloads/devices (not just the in-session optimistic flip). */
  requested: boolean;
}

/**
 * Build a brand's cross-host portal URL from the Hub's apex. `env.SPROUT_URL` is
 * the apex origin (e.g. `https://sproutportal.ca` / `https://sproutportal.localhost`);
 * the brand portal lives at the single-label subdomain `<slug>.<apex-host>`,
 * mirroring `slugFromHost` in `lib/brand.ts`. The slug comes from the directory
 * mirror (guestlist-owned), never from caller input, so this can't be steered to
 * a foreign host.
 */
function portalUrlForSlug(slug: string): string {
  return portalEntryUrl(env.SPROUT_URL, slug);
}

/**
 * The brands the caller is an AUDIENCE member of — the single source of truth for
 * portal visibility (`portal_members`), which is exactly what `requireBrandAudience`
 * admits. This is what "Your Portals" lists: viewing a brand portal is about brand
 * AUDIENCE membership, NOT org membership.
 *
 * Budtenders already have their rows (from approved join requests). Org staff are
 * folded into the audience HERE, driven by the RELIABLE cross-org membership signal
 * (`listCallerOrgs` → `organization.list()`) rather than the session-active-org-scoped
 * `getActiveMemberRole`. Materializing the org→staff row up front — before the caller
 * ever opens the portal — is what makes the Hub agree with the gate: an org owner/staff
 * member's brand shows in "Your Portals" AND `getPortalRole` admits them on click, so
 * there is no "listed but 404s" gap. A brand the caller is neither an audience nor an
 * org member of is absent here and therefore surfaces under "Brands you can join".
 *
 * Idempotent: only the org rows not already present are written (`ensurePortalMember`
 * is `ON CONFLICT DO NOTHING`, so a pre-existing budtender row is never downgraded).
 */
async function listAudienceBrandIds(userId: string): Promise<string[]> {
  const [orgs, existing] = await Promise.all([listCallerOrgs(), listPortalBrandIds(userId)]);
  const have = new Set(existing);
  const missing = orgs.filter((o) => !have.has(o.id));
  if (missing.length === 0) return existing;
  await Promise.all(
    missing.map((o) => ensurePortalMember({ brandId: o.id, userId, role: "staff", source: "org" })),
  );
  return [...existing, ...missing.map((o) => o.id)];
}

/** A brand's Hub-tile skin: its identity colour + logo handle, read cross-brand
 *  from `brand_config` (the Hub can't resolve a per-host runtime skin). */
interface BrandSkin {
  accent: string | null;
  logoRef: string | null;
}

/**
 * Load the per-brand tile skin (identity colour + logo ref) for a set of brand
 * ids in ONE batch (theme + content config are split tables now). The accent is
 * the brand's retinted `--color-sprout` parsed out of
 * `brand_theme.live_theme_json` (the public/live skin, never the draft); the
 * logo comes from `portal_config`. A brand with no rows simply has no skin
 * (neutral tile).
 */
async function loadBrandSkins(
  db: ReturnType<typeof createDb>,
  brandIds: string[],
): Promise<Map<string, BrandSkin>> {
  const skins = new Map<string, BrandSkin>();
  if (brandIds.length === 0) return skins;
  const [themeRows, cfgRows] = await db.batch([
    db
      .select({ orgId: brandTheme.orgId, liveThemeJson: brandTheme.liveThemeJson })
      .from(brandTheme)
      .where(inArray(brandTheme.orgId, brandIds)),
    db
      .select({ orgId: portalConfig.orgId, logoRef: portalConfig.logoRef })
      .from(portalConfig)
      .where(inArray(portalConfig.orgId, brandIds)),
  ]);
  const logoByOrg = new Map(cfgRows.map((r) => [r.orgId, r.logoRef] as const));
  for (const id of brandIds) {
    const theme = themeRows.find((r) => r.orgId === id);
    const logoRef = logoByOrg.get(id) ?? null;
    if (!theme && logoRef === null) continue;
    skins.set(id, {
      accent: theme ? brandAccent(parseBrandTheme(theme.liveThemeJson)) : null,
      logoRef,
    });
  }
  return skins;
}

/**
 * Resolve a logo handle to a displayable URL, mirroring the hero/asset pattern:
 * an http/data handle is used verbatim (seeded demo art / no R2 in dev); an R2
 * referenceId is signed via roadie `getReadUrl`. ALWAYS degrades to null (never
 * throws) so the tile falls back to the brand initial rather than a broken image.
 */
async function resolveLogoUrl(
  roadie: ReturnType<typeof getRoadie>,
  logoRef: string | null,
  brandId: string,
): Promise<string | null> {
  if (!logoRef) return null;
  if (/^(https?:|data:)/i.test(logoRef)) return logoRef;
  try {
    const res = await roadie.getReadUrl({
      referenceId: logoRef,
      disposition: "inline",
      permissionScope: `brand:${brandId}`,
    });
    return res.ok ? res.value.url : null;
  } catch {
    return null; // roadie inert / denied — degrade to the initial
  }
}

/**
 * Gated GET: the caller's portals — one tile per brand they are an AUDIENCE member
 * of (`listAudienceBrandIds`: budtenders + folded org staff), joined to
 * `org_brand_directory` for the slug/name/logo and the caller's own unread count.
 * The directory row is REQUIRED: a brand with no mirror row has no resolvable portal
 * (the portal host resolves the slug back through the SAME mirror), so it is skipped
 * rather than rendered as a tile that would 404 on tap. Sorted by name.
 */
export const listMyPortals = createServerFn({ method: "GET" })
  .middleware([requireUserMiddleware])
  .handler(async ({ context }): Promise<PortalSummary[]> => {
    const userId = context.principal.actor.id;
    const brandIds = await listAudienceBrandIds(userId);
    if (brandIds.length === 0) return [];

    const db = createDb(env.DB);

    // Directory mirror (slug/name/logo) for every brand the caller belongs to.
    const dirRows = await db
      .select({
        orgId: orgBrandDirectory.orgId,
        slug: orgBrandDirectory.slug,
        name: orgBrandDirectory.name,
        logoRef: orgBrandDirectory.logoRef,
      })
      .from(orgBrandDirectory)
      .where(inArray(orgBrandDirectory.orgId, brandIds));
    const byOrg = new Map(dirRows.map((r) => [r.orgId, r]));

    // Per-brand unread counts for the caller (read_at IS NULL). Scoped to the
    // caller's own user_id + the brand set, so it can never count another user.
    const unreadRows = await db
      .select({ brandId: notifications.brandId, n: count() })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          isNull(notifications.readAt),
          inArray(notifications.brandId, brandIds),
        ),
      )
      .groupBy(notifications.brandId);
    const unreadByBrand = new Map(unreadRows.map((r) => [r.brandId, r.n]));

    // Per-brand tile skin (identity colour + logo) — read cross-brand from
    // brand_config, then resolve each logo handle to a URL (degrades to null).
    const skins = await loadBrandSkins(db, brandIds);
    const roadie = getRoadie();

    const tiles = await Promise.all(
      brandIds.map(async (brandId): Promise<PortalSummary | null> => {
        const dir = byOrg.get(brandId);
        const slug = dir?.slug;
        const name = dir?.name;
        if (!slug || !name) return null; // no directory mirror → no resolvable portal — skip
        const skin = skins.get(brandId);
        const logoRef = dir?.logoRef ?? skin?.logoRef ?? null;
        return {
          orgId: brandId,
          slug,
          name,
          logoRef,
          logoUrl: await resolveLogoUrl(roadie, logoRef, brandId),
          accent: skin?.accent ?? null,
          unreadCount: unreadByBrand.get(brandId) ?? 0,
          portalUrl: portalUrlForSlug(slug),
        };
      }),
    );

    return tiles
      .filter((p): p is PortalSummary => p !== null)
      .sort((a, b) => a.name.localeCompare(b.name));
  });

/**
 * Gated GET: the public directory MINUS brands the caller is already an AUDIENCE
 * member of (`listAudienceBrandIds` — budtenders + folded org staff). Brands the
 * caller has a PENDING request for are KEPT (tagged `requested: true`) so the tile
 * persists a disabled "Requested" badge across reloads/devices rather than silently
 * vanishing until an admin decides. Because org staff are folded into the audience,
 * an owner never sees "request access" to their own brand. Sorted actionable-first
 * (un-requested before requested), then by name.
 */
export const listJoinableBrands = createServerFn({ method: "GET" })
  .middleware([requireUserMiddleware])
  .handler(async ({ context }): Promise<JoinableBrand[]> => {
    const userId = context.principal.actor.id;
    const db = createDb(env.DB);

    const [audienceBrandIds, dir, pending] = await Promise.all([
      listAudienceBrandIds(userId),
      db
        .select({
          orgId: orgBrandDirectory.orgId,
          slug: orgBrandDirectory.slug,
          name: orgBrandDirectory.name,
          logoRef: orgBrandDirectory.logoRef,
        })
        .from(orgBrandDirectory),
      db
        .select({ brandId: portalAccessRequests.brandId })
        .from(portalAccessRequests)
        .where(
          and(eq(portalAccessRequests.userId, userId), eq(portalAccessRequests.status, "pending")),
        ),
    ]);

    const memberOf = new Set(audienceBrandIds);
    const queued = new Set(pending.map((r) => r.brandId));

    // Keep queued brands (badged), drop only audience members. Actionable rows
    // ("Request Access") sort ahead of already-"Requested" ones, then by name.
    const visible = dir
      .filter((r) => !memberOf.has(r.orgId))
      .sort((a, b) => {
        const ra = queued.has(a.orgId) ? 1 : 0;
        const rb = queued.has(b.orgId) ? 1 : 0;
        return ra - rb || a.name.localeCompare(b.name);
      });

    // Tile skin for the joinable grid — same colour/logo treatment as the
    // member tiles so the "Brands you can join" row carries brand identity too.
    const skins = await loadBrandSkins(
      db,
      visible.map((r) => r.orgId),
    );
    const roadie = getRoadie();

    return Promise.all(
      visible.map(async (r): Promise<JoinableBrand> => {
        const skin = skins.get(r.orgId);
        const logoRef = r.logoRef ?? skin?.logoRef ?? null;
        return {
          orgId: r.orgId,
          slug: r.slug,
          name: r.name,
          logoRef,
          logoUrl: await resolveLogoUrl(roadie, logoRef, r.orgId),
          accent: skin?.accent ?? null,
          requested: queued.has(r.orgId),
        };
      }),
    );
  });

/** The platform's "featured brand of the month" — a GLOBAL editorial spotlight,
 *  NOT scoped to the viewer's memberships (the Hub is a cross-brand space). */
export interface FeaturedBrand {
  orgId: string;
  slug: string;
  name: string;
  tagline: string | null;
  logoUrl: string | null;
  accent: string | null;
  /** Cross-host URL of the brand's portal (anyone can view the public landing). */
  portalUrl: string;
  /** True when the viewer already belongs to this brand (CTA → Open vs. Join). */
  isMember: boolean;
}

/**
 * Gated GET: the month's featured brand — a platform-wide spotlight picked
 * DETERMINISTICALLY from the whole `org_brand_directory` by a monthly rotation
 * (`(year*12 + month) % brandCount`), so every budtender sees the same brand this
 * month and it advances when the period turns (no editorial table yet — this is
 * the stub that "still works"). Global by construction: it reads the full
 * directory, never the viewer's activeOrgId. `isMember` only personalises the CTA
 * label, derived from the caller's own membership set.
 */
export const getFeaturedBrand = createServerFn({ method: "GET" })
  .middleware([requireUserMiddleware])
  .handler(async ({ context }): Promise<FeaturedBrand | null> => {
    const db = createDb(env.DB);
    const dir = await db
      .select({
        orgId: orgBrandDirectory.orgId,
        slug: orgBrandDirectory.slug,
        name: orgBrandDirectory.name,
        logoRef: orgBrandDirectory.logoRef,
      })
      .from(orgBrandDirectory)
      .orderBy(asc(orgBrandDirectory.slug));
    if (dir.length === 0) return null;

    // Deterministic monthly rotation over the directory (stable within a period).
    const [y, m] = currentPeriod(Date.now()).split("-").map(Number);
    const ordinal = (y ?? 0) * 12 + ((m ?? 1) - 1);
    const pick = dir[((ordinal % dir.length) + dir.length) % dir.length]!;

    // The featured brand's tagline + skin (single-row reads — still global).
    const [featThemeRows, featCfgRows] = await db.batch([
      db
        .select({ liveThemeJson: brandTheme.liveThemeJson })
        .from(brandTheme)
        .where(eq(brandTheme.orgId, pick.orgId))
        .limit(1),
      db
        .select({ tagline: portalConfig.tagline, logoRef: portalConfig.logoRef })
        .from(portalConfig)
        .where(eq(portalConfig.orgId, pick.orgId))
        .limit(1),
    ]);
    const featTheme = featThemeRows.at(0);
    const cfg = featCfgRows.at(0);

    const logoRef = pick.logoRef ?? cfg?.logoRef ?? null;
    const userId = context.principal.actor.id;
    const audienceBrandIds = await listAudienceBrandIds(userId);

    return {
      orgId: pick.orgId,
      slug: pick.slug,
      name: pick.name,
      tagline: cfg?.tagline?.trim() ? cfg.tagline.trim() : null,
      logoUrl: await resolveLogoUrl(getRoadie(), logoRef, pick.orgId),
      accent: featTheme ? brandAccent(parseBrandTheme(featTheme.liveThemeJson)) : null,
      portalUrl: portalUrlForSlug(pick.slug),
      isMember: audienceBrandIds.includes(pick.orgId),
    };
  });

const requestAccessInput = type({ brandId: "string >= 1", "message?": "string <= 500" });

/**
 * Gated POST: queue a join request for a brand the caller isn't a member of. The
 * row is INSERTed `ON CONFLICT(brand_id, user_id) DO NOTHING` against
 * `portal_access_requests_unique_idx`, so a caller can never double-queue — a
 * second tap is a silent no-op and the UI keeps its optimistic "Requested" state.
 * This only enqueues; membership is added by `approveAccess` (guestlist-owned).
 */
export const requestAccess = createServerFn({ method: "POST" })
  .middleware([requireUserMiddleware])
  .inputValidator(requestAccessInput)
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const userId = context.principal.actor.id;
    const message = data.message?.trim() ? data.message.trim() : null;
    const db = createDb(env.DB);

    await db
      .insert(portalAccessRequests)
      .values({
        id: ulid(),
        brandId: data.brandId,
        userId,
        message,
        status: "pending",
        createdAt: Date.now(),
      })
      .onConflictDoNothing({
        target: [portalAccessRequests.brandId, portalAccessRequests.userId],
      });

    await writeAudit({
      brandId: data.brandId,
      action: "access.request",
      actorId: userId,
      targetType: "portal_access_request",
      targetId: data.brandId,
    });

    return { ok: true };
  });

/** Per-brand unread count for the Hub poll. */
export interface UnreadCount {
  brandId: string;
  unreadCount: number;
}

/**
 * Gated GET: the caller's unread notification count per brand (the lightweight
 * read the Hub polls). Scoped to `user_id = caller`, so it never counts another
 * user; brands with zero unread are omitted (the tile defaults to 0). Independent
 * of guestlist membership — it reads the notifications the caller actually owns.
 */
export const getUnreadCounts = createServerFn({ method: "GET" })
  .middleware([requireUserMiddleware])
  .handler(async ({ context }): Promise<UnreadCount[]> => {
    const userId = context.principal.actor.id;
    const db = createDb(env.DB);
    const rows = await db
      .select({ brandId: notifications.brandId, n: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
      .groupBy(notifications.brandId);
    return rows.map((r) => ({ brandId: r.brandId, unreadCount: r.n }));
  });

const syncOrgDirectoryInput = type({
  orgId: "string >= 1",
  slug: "string >= 1",
  name: "string >= 1",
  "logoRef?": "string | null",
});

/**
 * Gated POST: the guestlist org-hook target. Guestlist calls this on org
 * create/update to refresh the read-only `org_brand_directory` mirror (slug →
 * org id, name, logo). UPSERT on the `org_id` PK so a re-sync just freshens the
 * row + `synced_at`. The slug uniqueness is enforced by `org_brand_dir_slug_idx`;
 * a conflicting slug surfaces as the DB error to the caller (guestlist) rather
 * than silently shadowing another org. The mirror is advisory — host→brand
 * resolution always re-derives `brand_id` from the resolved org, so a stale row
 * only shows an old label, never another brand's data.
 */
export const syncOrgDirectory = createServerFn({ method: "POST" })
  .middleware([requireAdminMiddleware])
  .inputValidator(syncOrgDirectoryInput)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const logoRef = data.logoRef ?? null;
    const syncedAt = Date.now();
    const db = createDb(env.DB);
    await db
      .insert(orgBrandDirectory)
      .values({
        orgId: data.orgId,
        slug: data.slug,
        name: data.name,
        logoRef,
        syncedAt,
      })
      .onConflictDoUpdate({
        target: orgBrandDirectory.orgId,
        set: {
          slug: data.slug,
          name: data.name,
          logoRef,
          syncedAt,
        },
      });
    return { ok: true };
  });

const approveAccessInput = type({ brandId: "string >= 1", userId: "string >= 1" });

/**
 * Gated POST: approve a queued join request for a brand the caller administers.
 * Authority is decided in-handler against the TARGET brand (`assertBrandAdmin`) —
 * the Hub is cross-brand, so the gate is `brandId`, not the envelope's activeOrgId.
 * On approval: make the requester a PORTAL member (budtender, not a guestlist org
 * member), flip the request to `approved`, and notify them. Audited; idempotent.
 */
export const approveAccess = createServerFn({ method: "POST" })
  .middleware([requireUserMiddleware])
  .inputValidator(approveAccessInput)
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { brandId, userId } = data;
    const actorId = context.principal.actor.id;

    // Target-brand admin gate (NOT the envelope's activeOrgId — the Hub is
    // cross-brand). assertBrandAdmin lets platform admins through regardless.
    await assertBrandAdmin(brandId, context.principal.actor.role);

    const db = createDb(env.DB);

    // Only act on a still-pending request — idempotent + can't approve a row that
    // was declined or already approved.
    const request = (
      await db
        .select({ id: portalAccessRequests.id })
        .from(portalAccessRequests)
        .where(
          and(
            eq(portalAccessRequests.brandId, brandId),
            eq(portalAccessRequests.userId, userId),
            eq(portalAccessRequests.status, "pending"),
          ),
        )
        .limit(1)
    ).at(0);
    if (!request) return { ok: true };

    // The requester becomes a portal member (budtender), never an org member.
    await ensurePortalMember({ brandId, userId, role: "budtender", source: "request" });

    const now = Date.now();
    await db
      .update(portalAccessRequests)
      .set({ status: "approved", decidedBy: actorId, decidedAt: now })
      .where(eq(portalAccessRequests.id, request.id));

    await writeAudit({
      brandId,
      action: "access.approve",
      actorId,
      targetType: "portal_access_request",
      targetId: request.id,
      meta: { userId },
    });

    await emitNotification({
      brandId,
      userId,
      type: "access_approved",
      title: "You're in",
      body: "Your request to join this portal was approved.",
      refType: "portal_access_request",
      refId: request.id,
    });

    return { ok: true };
  });
