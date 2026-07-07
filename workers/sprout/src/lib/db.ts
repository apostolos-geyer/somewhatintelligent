/**
 * The app's Drizzle D1 client — the single runtime query path.
 *
 * Per docs/sprout/02-data-model.md: the authored `schema.ts` is the source of
 * truth for BOTH migration generation AND runtime queries. Server fns build
 * their reads/writes with the Drizzle query-builder (type-safe, schema-mapped)
 * over `env.DB`, NOT raw `env.DB.prepare(SQL)`. Complex aggregate/window/json
 * queries use Drizzle's `sql` template escape hatch (still through this client).
 *
 * Mirrors the services' pattern (workers/guestlist/src/db.ts,
 * workers/roadie/src/db.ts): a `createDb(binding)` factory per call site. There
 * is deliberately NO module-level `env` import here, so this module is safe to
 * pull into any graph (no `cloudflare:workers` leak) — each server fn does
 * `const db = createDb(env.DB)` inside its handler, exactly like roadie's methods
 * do `createDb(roadie.env.DB)`.
 */
import { drizzle } from "drizzle-orm/d1";
import * as schema from "@/schema";

export function createDb(binding: D1Database) {
  return drizzle(binding, { schema });
}

export type Database = ReturnType<typeof createDb>;
