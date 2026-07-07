/**
 * Shared demo-brand identity constants — the SINGLE source imported by both
 * `__tests__/fixtures.ts` and `scripts/seed.ts` so names/slugs/ids never
 * drift (09 §8 prerequisite).
 *
 * The brands are LINKED to the guestlist demo orgs: `workers/guestlist`
 * bootstrap seeds orgs `acme` (members alice + bob) and `beta` (dave), so a
 * signed-in demo user actually sees their own org as a fully themed portal in the
 * Hub (`<slug>.sprout.<apex>`). Two deliberately different skins prove "one
 * engine, infinite skins" from the same worker.
 */
export interface DemoHeroSlide {
  category: string;
  headline: string;
}

export interface DemoBrand {
  /** = the guestlist organization.id — the sprout brand IS the org. */
  orgId: string;
  slug: string;
  name: string;
  tagline: string;
  theme: { colors: { primary: string; accent: string; background: string } };
  /** Rotating-hero slides; seeded as self-contained gradient art (no R2 in dev). */
  heroSlides: readonly DemoHeroSlide[];
}

export const DEMO_BRANDS: readonly DemoBrand[] = [
  {
    orgId: "acme",
    slug: "acme",
    name: "Acme Cannabis",
    tagline: "Quebec's finest, fresh every drop.",
    theme: { colors: { primary: "#1f6f3c", accent: "#caa14b", background: "#f7f4ec" } },
    heroSlides: [
      { category: "New Batch", headline: "Garlic Breath — Lot 248 just landed" },
      { category: "Education", headline: "Know the Craft — this month's PK call" },
      { category: "Live", headline: "Enter the Grow — Week 6 flower" },
    ],
  },
  {
    orgId: "beta",
    slug: "beta",
    name: "Beta Greens",
    tagline: "Craft hash, small batches.",
    theme: { colors: { primary: "#7b2d8e", accent: "#e0723d", background: "#faf6fb" } },
    heroSlides: [
      { category: "Drop", headline: "Live Rosin — small-batch run #14" },
      { category: "Restock", headline: "Temple Ball back on shelves" },
      { category: "Quiz", headline: "Test your terpenes — new certification" },
    ],
  },
];
