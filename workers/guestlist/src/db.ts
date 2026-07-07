import { drizzle } from "drizzle-orm/d1";
import { env } from "./env";
import * as schema from "./schema";

export function createDb(binding: D1Database) {
  return drizzle(binding, { schema });
}

export type Database = ReturnType<typeof createDb>;

export const db = createDb(env.DB);
