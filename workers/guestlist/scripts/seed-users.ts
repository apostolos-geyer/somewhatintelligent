#!/usr/bin/env bun
/**
 * Seed users into the guestlist's D1 database via the auth HTTP API.
 * Idempotent — safe to run multiple times with the same input.
 *
 * guestlist has no public host; better-auth is reached through the gateway
 * (identity's `/api` proxy in dev, bouncer in prod). The sign-up URL defaults
 * to LOCAL_IDENTITY_URL for local dev; pass `--url` for remote environments.
 *
 * Usage:
 *   bun scripts/seed-users.ts '<json array of users>'
 *   bun scripts/seed-users.ts --remote --env staging --url https://identity-staging.<sub>.workers.dev '<json array>'
 *   bun scripts/seed-users.ts --remote --env production --url https://identity.<domain> '<json array>'
 *
 * User shape: { email, password, name?, role? }
 * Defaults: name = "User", role = "user"
 *
 * Examples:
 *   bun scripts/seed-users.ts '[{"email":"admin@greenroom.example","password":"admin123","name":"Admin","role":"admin"}]'
 */
import { $ } from "bun";
import { resolve, dirname } from "node:path";
import { LOCAL_IDENTITY_URL } from "../../../scripts/dev-config";

interface SeedUser {
  email: string;
  password: string;
  name?: string;
  role?: "admin" | "user";
}

// Parse args
const args = process.argv.slice(2);
let remote = false;
let wranglerEnv = "";
let authBaseUrl = "";
let usersJson = "";

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case "--remote":
      remote = true;
      break;
    case "--env":
      wranglerEnv = args[++i]!;
      break;
    case "--url":
      authBaseUrl = args[++i]!;
      break;
    default:
      usersJson = args[i]!;
  }
}

if (!usersJson) {
  console.error(
    "Usage: bun scripts/seed-users.ts [--remote] [--env <env>] [--url <url>] '<json array>'",
  );
  process.exit(1);
}

const serviceDir = resolve(dirname(import.meta.path), "..");

if (!authBaseUrl) {
  if (remote) {
    console.error(
      "--remote requires --url <gateway-url> (e.g. https://identity.<domain>); " +
        "the deployed auth gateway can't be inferred.",
    );
    process.exit(1);
  }
  // Local dev: guestlist has no public host — better-auth is reached through
  // identity's `/api` proxy (the same surface bootstrap.ts probes).
  authBaseUrl = LOCAL_IDENTITY_URL;
}

// Bun's fetch rejects portless's local self-signed cert (SELF_SIGNED_CERT_IN_CHAIN).
// Relax verification for *.localhost only — never for real remote TLS.
const isLocalTls = new URL(authBaseUrl).hostname.endsWith(".localhost");

const users: SeedUser[] = JSON.parse(usersJson);
// Staging is the top-level (unnamed) wrangler config — only "production" has
// a named env block, so "staging" gets no --env flag.
const d1Flags = [
  remote && "--remote",
  wranglerEnv && wranglerEnv !== "staging" && `--env=${wranglerEnv}`,
].filter(Boolean);

console.log(
  `Seeding ${users.length} user(s) → ${authBaseUrl} (D1: ${remote ? "remote" : "local"}${wranglerEnv ? ` env=${wranglerEnv}` : ""})`,
);

$.cwd(serviceDir);

// Optional Cloudflare Access service-token headers, for remote environments
// gated by Zero Trust Access (e.g. staging.<zone> — see
// scripts/provision/access.ts + docs/ops/provisioning.md at the repo root).
// Additive/no-op when unset — local dev and any ungated remote URL are
// unaffected.
const accessHeaders: Record<string, string> = {};
if (process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET) {
  accessHeaders["CF-Access-Client-Id"] = process.env.CF_ACCESS_CLIENT_ID;
  accessHeaders["CF-Access-Client-Secret"] = process.env.CF_ACCESS_CLIENT_SECRET;
}

for (const u of users) {
  const email = u.email;
  const password = u.password;
  const name = u.name ?? "User";
  const role = u.role ?? "user";

  console.log(`  → ${email} (${role})`);

  // Sign up — ignore errors (user may already exist)
  const signupInit: RequestInit = {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: authBaseUrl, ...accessHeaders },
    body: JSON.stringify({ email, password, name }),
  };
  if (isLocalTls) {
    (signupInit as { tls?: { rejectUnauthorized: boolean } }).tls = { rejectUnauthorized: false };
  }
  const res = await fetch(`${authBaseUrl}/api/auth/sign-up/email`, signupInit).catch(() => null);

  if (res?.ok) {
    console.log("    created");
  } else {
    console.log(`    exists (${res?.status ?? "unreachable"}), continuing`);
  }

  // Set role + verify email via D1 (idempotent)
  await $`vp exec wrangler d1 execute DB ${d1Flags} --command ${`UPDATE user SET role='${role}', email_verified=1 WHERE email='${email}';`}`.quiet();

  console.log(`    role=${role}, verified`);
}

console.log("Done.");
