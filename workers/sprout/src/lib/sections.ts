/**
 * The ONE canonical six-key section enum — used 1:1 for BOTH
 * `brand_config.live_sections_json` AND the `?section=` URL param (no mapping
 * table, per D-SECTION-KEYS). Pure module (no React/cloudflare) so it's shared by
 * the grid, the layer stack, the brand resolver, and unit tests.
 */
export const SECTION_KEYS = ["assets", "decks", "quizzes", "feed", "chat", "contact"] as const;

export type SectionKey = (typeof SECTION_KEYS)[number];

export function isSectionKey(v: unknown): v is SectionKey {
  return typeof v === "string" && (SECTION_KEYS as readonly string[]).includes(v);
}

export interface SectionMeta {
  key: SectionKey;
  /** "01".."06" — the grid number chip. */
  num: string;
  title: string;
  description: string;
}

/**
 * Static metadata for the six-card section grid. The `feed` title is the default
 * ("Enter the Grow"); a brand may rename it via `brand_config.feed_label`, applied
 * at render time, not here.
 */
export const SECTION_META: Record<SectionKey, SectionMeta> = {
  assets: {
    key: "assets",
    num: "01",
    title: "Store Assets",
    description: "Brochures, shelf-talkers, and downloadable kit.",
  },
  decks: {
    key: "decks",
    num: "02",
    title: "PK Decks",
    description: "Flip through product-knowledge decks.",
  },
  quizzes: {
    key: "quizzes",
    num: "03",
    title: "Quizzes",
    description: "Earn certifications and climb the leaderboard.",
  },
  feed: {
    key: "feed",
    num: "04",
    title: "Enter the Grow",
    description: "The brand's media feed.",
  },
  chat: {
    key: "chat",
    num: "05",
    title: "Group Chat",
    description: "Talk live with the brand team.",
  },
  contact: {
    key: "contact",
    num: "06",
    title: "Contact",
    description: "Reach a human at the brand.",
  },
};

export const SECTION_META_LIST: readonly SectionMeta[] = SECTION_KEYS.map((k) => SECTION_META[k]);
