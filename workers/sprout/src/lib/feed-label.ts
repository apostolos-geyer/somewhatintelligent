/**
 * The default media-feed label, used wherever a brand hasn't set its own
 * `brand_config.feed_label`. SINGLE source of truth — the schema column default,
 * the runtime/admin fallbacks, and the empty-state render all read this so the
 * literal never drifts across layers.
 *
 * Kept in its own dependency-FREE leaf module (no `@/` alias imports) so
 * `schema.ts` can import it via a relative path: drizzle-kit's schema bundler
 * resolves relative imports but not the tsconfig `@/*` alias.
 */
export const DEFAULT_FEED_LABEL = "Enter the Grow";
