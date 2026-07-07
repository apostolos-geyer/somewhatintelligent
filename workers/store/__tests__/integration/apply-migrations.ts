import { applyD1Migrations, env } from "cloudflare:test";

// Runs once outside isolated storage; applyD1Migrations is idempotent (only
// applies what's missing). Mirrors workers/guestlist + greenroom/workers/sprout.
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS!);
