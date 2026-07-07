import { applyD1Migrations, env } from "cloudflare:test";

// Setup files run outside isolated storage and may run multiple times.
// applyD1Migrations is idempotent — it only applies migrations that haven't
// already been applied. See guestlist's pattern.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
