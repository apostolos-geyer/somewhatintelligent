import { drizzle } from "drizzle-orm/d1";
import { env } from "cloudflare:workers";
import { createServerOnlyFn } from "@tanstack/react-start";
import * as schema from "@/db/schema";

/** Bind a drizzle client to a D1 database. Pure — the test/pool tier passes the
 *  miniflare `env.DB` here directly (see __tests__/integration). */
export function createDb(binding: D1Database) {
  return drizzle(binding, { schema });
}

/** The request-time db, bound to the worker's `env.DB`. Server-only. */
export const getDb = createServerOnlyFn(() => createDb(env.DB));

export type Db = ReturnType<typeof createDb>;
