/// <reference types="bun" />
/**
 * Seeds idempotent staging smoke-test users against
 * `https://staging.<zone>/api`, wrapping (not duplicating)
 * `workers/guestlist/scripts/seed-users.ts` — that script already does the
 * better-auth-HTTP-signup + `wrangler d1 execute` role/verify flip
 * idempotently; this just builds the user list and supplies the Cloudflare
 * Access service-token headers so the request clears Access on a gated
 * staging host.
 *
 * Headers come from (in order): `--client-id`/`--client-secret` flags, else
 * `CF_ACCESS_CLIENT_ID`/`CF_ACCESS_CLIENT_SECRET` env vars, else
 * `.provision/access/si-smoke.json` (written by `access.ts`).
 *
 * Usage:
 *   bun scripts/provision/seed-users.ts --dry-run
 *   bun scripts/provision/seed-users.ts
 *   bun scripts/provision/seed-users.ts --count=5 --url=https://staging.somewhatintelligent.ca
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { logDryRun, logSkip, parseCliArgs, readProvisionFile, REPO_ROOT, zoneName } from "./lib";

export interface SeedUserSpec {
  email: string;
  password: string;
  name: string;
  role: "admin" | "user";
}

/** Deterministic, idempotent by construction — same `count`/`prefix` always yields the same users. */
export function buildSeedUsers(
  count: number,
  opts: { prefix?: string; domain?: string } = {},
): SeedUserSpec[] {
  if (count < 1) throw new Error("count must be >= 1");
  const prefix = opts.prefix ?? "si-smoke";
  const domain = opts.domain ?? "smoke.somewhatintelligent.test";
  const users: SeedUserSpec[] = [];
  for (let i = 1; i <= count; i++) {
    users.push({
      email: `${prefix}-${i}@${domain}`,
      password: `${prefix}-Passw0rd-${i}!`,
      name: `SI Smoke User ${i}`,
      role: i === 1 ? "admin" : "user",
    });
  }
  return users;
}

export interface AccessCredentials {
  clientId: string;
  clientSecret: string;
}

/** Resolves Access service-token creds: CLI flags > env vars > .provision/access/si-smoke.json. */
export function resolveAccessCredentials(args: {
  clientId?: string;
  clientSecret?: string;
}): AccessCredentials | undefined {
  if (args.clientId && args.clientSecret)
    return { clientId: args.clientId, clientSecret: args.clientSecret };
  if (process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET) {
    return {
      clientId: process.env.CF_ACCESS_CLIENT_ID,
      clientSecret: process.env.CF_ACCESS_CLIENT_SECRET,
    };
  }
  const raw = readProvisionFile("access/si-smoke.json");
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (parsed.clientId && parsed.clientSecret)
      return { clientId: parsed.clientId, clientSecret: parsed.clientSecret };
  } catch {
    // fall through
  }
  return undefined;
}

async function main(): Promise<void> {
  const args = parseCliArgs();
  const count = Number(args.values.get("count") ?? "3");
  const url = args.values.get("url") ?? `https://staging.${zoneName()}`;
  const users = buildSeedUsers(count, { prefix: args.values.get("prefix") });

  console.log(`Seeding ${users.length} idempotent test user(s) against ${url}`);
  console.log(users.map((u) => `  ${u.email} (${u.role})`).join("\n"));

  const creds = resolveAccessCredentials({
    clientId: args.values.get("client-id"),
    clientSecret: args.values.get("client-secret"),
  });
  if (creds) console.log("Access service-token headers: found");
  else
    logSkip(
      "no Access service-token credentials found — request will be sent WITHOUT CF-Access-* headers",
    );

  const guestlistScript = join(REPO_ROOT, "workers", "guestlist", "scripts", "seed-users.ts");
  const cliArgs = ["--remote", "--env", args.env, "--url", url, JSON.stringify(users)];

  if (args.dryRun) {
    logDryRun(
      `would run: bun ${guestlistScript} ${cliArgs.map((a) => JSON.stringify(a)).join(" ")}`,
    );
    return;
  }

  const env = { ...process.env };
  if (creds) {
    env.CF_ACCESS_CLIENT_ID = creds.clientId;
    env.CF_ACCESS_CLIENT_SECRET = creds.clientSecret;
  }

  const res = spawnSync("bun", [guestlistScript, ...cliArgs], { stdio: "inherit", env });
  if (res.status !== 0) {
    console.error(`✗ guestlist seed-users.ts exited ${res.status}`);
    process.exit(res.status ?? 1);
  }
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(`✗ ${(e as Error).message}`);
    process.exit(1);
  });
}
