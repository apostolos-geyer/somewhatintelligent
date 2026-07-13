import { defineConfig } from "drizzle-kit";

// Durable Object SQLite: `drizzle-kit generate` emits ./migrations/*.sql plus
// a bundled ./migrations/migrations.js that the DO imports and applies at
// construction via drizzle-orm/durable-sqlite/migrator (no wrangler d1
// migrations — the schema ships inside the worker and applies per tenant DO).
export default defineConfig({
  dialect: "sqlite",
  driver: "durable-sqlite",
  schema: "./src/do/schema.ts",
  out: "./migrations",
});
