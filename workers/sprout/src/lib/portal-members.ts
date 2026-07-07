/**
 * Portal-membership helpers — the audience layer, separate from org membership
 * (which confers Brand-Admin authority). A budtender is a portal member with no
 * org membership; org staff are lazily synced in too. Server-only; `brandId` is
 * always caller-derived (verified envelope / host→org), never client input.
 */
import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { ulid } from "@greenroom/kit/ids";
import { createDb } from "@/lib/db";
import { portalMembers } from "@/schema";

/** The PORTAL standing — orthogonal to the org role. `budtender` joins via the
 *  request→approval queue; `staff` is an org member lazily synced into the
 *  audience. Neither value implies any org authority. */
export type PortalRole = "budtender" | "staff";

function isPortalRole(v: string | undefined): v is PortalRole {
  return v === "budtender" || v === "staff";
}

/**
 * Idempotently record a portal membership for (brandId, userId). `ON CONFLICT DO
 * NOTHING` keeps the FIRST membership, so a budtender who later becomes org staff
 * keeps their original row and a repeat lazy-sync is a no-op. Returns nothing —
 * callers re-read the standing if they need it.
 */
export async function ensurePortalMember(opts: {
  brandId: string;
  userId: string;
  role: PortalRole;
  source: "request" | "org";
}): Promise<void> {
  const db = createDb(env.DB);
  await db
    .insert(portalMembers)
    .values({
      id: ulid(),
      brandId: opts.brandId,
      userId: opts.userId,
      role: opts.role,
      source: opts.source,
      createdAt: Date.now(),
    })
    .onConflictDoNothing({ target: [portalMembers.brandId, portalMembers.userId] });
}

/**
 * The caller's portal standing for one brand, or null when they're not a member.
 * A pure read (no lazy sync) — the sync decision lives with the caller that knows
 * the org role.
 */
export async function getPortalRole(brandId: string, userId: string): Promise<PortalRole | null> {
  const db = createDb(env.DB);
  const row = (
    await db
      .select({ role: portalMembers.role })
      .from(portalMembers)
      .where(and(eq(portalMembers.brandId, brandId), eq(portalMembers.userId, userId)))
      .limit(1)
  ).at(0);
  return isPortalRole(row?.role) ? row.role : null;
}

/** The brand ids the caller is a portal member of (for the Hub "Your Portals"
 *  union with org memberships). Caller-scoped by `userId`. */
export async function listPortalBrandIds(userId: string): Promise<string[]> {
  const db = createDb(env.DB);
  const rows = await db
    .select({ brandId: portalMembers.brandId })
    .from(portalMembers)
    .where(eq(portalMembers.userId, userId));
  return rows.map((r) => r.brandId);
}

/** The user ids that are portal members of a brand — the brand's audience. Used
 *  to resolve display names for the leaderboard / analytics matrix, where members
 *  may be budtenders with NO org membership (so the org plugin wouldn't list them). */
export async function listPortalMemberIds(brandId: string): Promise<string[]> {
  const db = createDb(env.DB);
  const rows = await db
    .select({ userId: portalMembers.userId })
    .from(portalMembers)
    .where(eq(portalMembers.brandId, brandId));
  return rows.map((r) => r.userId);
}
