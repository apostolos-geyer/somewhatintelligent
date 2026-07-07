/**
 * Server-only brand resolution. Reads the app's own D1 (org_brand_directory +
 * brand_theme + portal_config) to turn a request host into the runtime brand
 * skin, and separately into the portal CONTENT config. Imported only by
 * `brand.functions.ts` server-fn handlers, so it never reaches the client
 * bundle (the `cloudflare:workers` import would fail there anyway).
 */
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import {
  DEFAULT_FEED_LABEL,
  parseBrandTheme,
  parseSections,
  slugFromHost,
  type BrandRuntime,
  type PortalContent,
} from "@/lib/brand";
import { createDb } from "@/lib/db";
import { brandTheme, orgBrandDirectory, portalConfig } from "@/schema";

/**
 * host → runtime brand skin, or null for the apex/Hub and any unknown host.
 * The slug is resolved against the org_brand_directory mirror (slug → org_id),
 * then the org's LIVE theme + display identity are loaded from the app's own
 * D1. `brand_id` is therefore derived from the RESOLVED org, never from input —
 * a stale mirror only shows an old name/logo, never another brand's data.
 */
export async function resolveBrandForHost(
  host: string | null | undefined,
): Promise<BrandRuntime | null> {
  return resolveBrandBySlug(slugFromHost(host));
}

/**
 * slug → runtime brand SKIN (identity + live theme — the root/blocking read),
 * or null for null/unknown slugs. Deliberately does NOT carry portal content
 * (tagline / sections / feed label) — that's `resolvePortalContentBySlug`,
 * fetched by the portal page in parallel, never on the root path. The slug only
 * selects the public SKIN; tenancy is always the verified envelope's
 * `activeOrgId`, never this slug.
 */
export async function resolveBrandBySlug(
  slug: string | null | undefined,
): Promise<BrandRuntime | null> {
  if (!slug) return null;

  const db = createDb(env.DB);

  const dir = (
    await db
      .select({
        orgId: orgBrandDirectory.orgId,
        name: orgBrandDirectory.name,
        logoRef: orgBrandDirectory.logoRef,
      })
      .from(orgBrandDirectory)
      .where(eq(orgBrandDirectory.slug, slug))
      .limit(1)
  ).at(0);
  if (!dir) return null;

  // One D1 round-trip for both point reads.
  const [themeRows, cfgRows] = await db.batch([
    db
      .select({ liveThemeJson: brandTheme.liveThemeJson })
      .from(brandTheme)
      .where(eq(brandTheme.orgId, dir.orgId))
      .limit(1),
    db
      .select({ name: portalConfig.name, logoRef: portalConfig.logoRef })
      .from(portalConfig)
      .where(eq(portalConfig.orgId, dir.orgId))
      .limit(1),
  ]);
  const theme = themeRows.at(0);
  const cfg = cfgRows.at(0);

  return {
    orgId: dir.orgId,
    slug,
    name: cfg?.name || dir.name,
    logoRef: cfg?.logoRef ?? dir.logoRef ?? null,
    theme: parseBrandTheme(theme?.liveThemeJson),
  };
}

/**
 * slug → portal CONTENT config (tagline / feed label / section toggles), or
 * null for null/unknown slugs. LIVE-EDIT data (no draft/live). A brand with no
 * `portal_config` row yet degrades to defaults so a fresh org still renders the
 * full six-section grid.
 */
export async function resolvePortalContentBySlug(
  slug: string | null | undefined,
): Promise<PortalContent | null> {
  if (!slug) return null;

  const db = createDb(env.DB);

  const dir = (
    await db
      .select({ orgId: orgBrandDirectory.orgId })
      .from(orgBrandDirectory)
      .where(eq(orgBrandDirectory.slug, slug))
      .limit(1)
  ).at(0);
  if (!dir) return null;

  const cfg = (
    await db
      .select({
        tagline: portalConfig.tagline,
        feedLabel: portalConfig.feedLabel,
        sectionsJson: portalConfig.sectionsJson,
      })
      .from(portalConfig)
      .where(eq(portalConfig.orgId, dir.orgId))
      .limit(1)
  ).at(0);

  return {
    tagline: cfg?.tagline ?? "",
    feedLabel: cfg?.feedLabel || DEFAULT_FEED_LABEL,
    sections: parseSections(cfg?.sectionsJson),
  };
}
