#!/usr/bin/env bun
// Demo users/orgs/memberships seeding — needs the dev stack UP (probes
// identity's BA handler and defers cleanly when absent). Split out of the old
// bootstrap.ts per docs/ops/05: `bun run env:init` (vars) and
// `bun run db:migrate:local` (schema) are its prerequisites; root
// `bun run seed` fans this out after `bun run dev` is serving.
import { resolve, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { DEV_SPAWN_ENV, LOCAL_IDENTITY_URL, d1Exec, d1Query } from "../../../scripts/dev-config";

const pkgDir = resolve(dirname(import.meta.path), "..");
const label = "workers/guestlist";

// Probe identity's BA-handler proxy (bouncer routing in prod, identity's
// /api/$.ts proxy in dev) — guestlist has no public surface post-unification,
// so we can't hit it directly. The probe URL still resolves to guestlist.
// `tls.rejectUnauthorized: false` — Bun's fetch otherwise rejects portless's
// local self-signed cert (SELF_SIGNED_CERT_IN_CHAIN). Local *.localhost only.
const probeInit = { method: "GET" } as RequestInit & { tls?: { rejectUnauthorized: boolean } };
probeInit.tls = { rejectUnauthorized: false };
const probe = await fetch(`${LOCAL_IDENTITY_URL}/api/auth/ok`, probeInit).catch(() => null);

if (!probe) {
  console.log(
    `  [defer] ${label}: identity not reachable at ${LOCAL_IDENTITY_URL}; ` +
      `re-run \`bun run seed\` after the stack is up to seed users/orgs.`,
  );
  process.exit(0);
}

// ─── Step 1: seed users via BA's sign-up endpoint ───────────────────────
// super = platform operator (god-mode). alice admins acme, dave admins beta
// (org members). bob is a plain user with no org membership. Idempotent.
console.log(`  [seed] ${label}: users (super + alice + bob + dave)`);
const seedUsers = [
  { email: "super@user.com", password: "superuserdo", name: "Super", role: "admin" },
  { email: "alice@example.com", password: "alicepwd123", name: "Alice", role: "user" },
  { email: "bob@example.com", password: "bobpwd1234", name: "Bob", role: "user" },
  { email: "dave@example.com", password: "davepwd123", name: "Dave", role: "user" },
];
const seedResult = spawnSync(
  "bun",
  ["scripts/seed-users.ts", "--url", LOCAL_IDENTITY_URL, JSON.stringify(seedUsers)],
  { cwd: pkgDir, stdio: "inherit", env: DEV_SPAWN_ENV },
);
if (seedResult.status !== 0) {
  throw new Error(`${label}: seed-users.ts failed (exit ${seedResult.status})`);
}

// ─── Step 2: seed BA organizations + memberships ────────────────────────
// Wave-7 multi-tenancy fixture. Direct D1 INSERT OR IGNORE keeps it simple
// — `auth.api.createOrganization` would need a super session cookie
// roundtrip just to write the same rows.
//
// `acme` and `beta` are the two test brands. Org-scoped authz dispatches on
// `principal.activeOrgId` which BA's session middleware auto-sets when a
// user has exactly one membership, so the test users land on the right
// brand without manual switching.
console.log(`  [seed] ${label}: orgs (acme + beta) + memberships`);
const createdAtMs = Date.now();
const orgs = [
  { id: "acme", name: "Acme Cannabis", slug: "acme" },
  { id: "beta", name: "Beta Greens", slug: "beta" },
];
for (const o of orgs) {
  d1Exec(
    pkgDir,
    `INSERT OR IGNORE INTO organization (id, name, slug, logo, created_at, metadata) ` +
      `VALUES ('${o.id}', '${o.name}', '${o.slug}', NULL, ${createdAtMs}, NULL);`,
  );
}

// Resolve real org ids by slug: a pre-existing org (e.g. created through
// the UI before seeding) wins the slug-unique race, the OR IGNORE above
// silently skips, and our hardcoded id would FK-fail on memberships.
const orgRows = d1Query<{ id: string; slug: string }>(
  pkgDir,
  `SELECT id, slug FROM organization WHERE slug IN (${orgs.map((o) => `'${o.slug}'`).join(",")});`,
);
const orgBySlug = new Map(orgRows.map((r) => [r.slug, r.id] as const));
const acmeOrgId = orgBySlug.get("acme");
const betaOrgId = orgBySlug.get("beta");
if (!acmeOrgId || !betaOrgId) {
  throw new Error(`${label}: missing seeded org id (acme=${acmeOrgId} beta=${betaOrgId})`);
}

// Read back real user.ids by email so memberships bind correctly. (User
// rows come from BA's sign-up, so the ids are BA-shaped strings, not
// anything we control here.)
const emails = seedUsers
  .filter((u) => u.email !== "super@user.com")
  .map((u) => `'${u.email}'`)
  .join(",");
const userRows = d1Query<{ id: string; email: string }>(
  pkgDir,
  `SELECT id, email FROM user WHERE email IN (${emails});`,
);
const byEmail = new Map(userRows.map((r) => [r.email, r.id] as const));
const aliceId = byEmail.get("alice@example.com");
const bobId = byEmail.get("bob@example.com");
const daveId = byEmail.get("dave@example.com");
if (!aliceId || !bobId || !daveId) {
  throw new Error(
    `${label}: missing seeded user id (alice=${aliceId} bob=${bobId} dave=${daveId})`,
  );
}

// Org memberships are LP STAFF only (alice admins acme, dave admins beta). bob
// is intentionally absent — a plain user with no org membership. If an
// earlier seed made bob an org member, drop it so re-runs converge.
d1Exec(pkgDir, `DELETE FROM member WHERE user_id='${bobId}';`);

const memberships = [
  { userId: aliceId, orgId: acmeOrgId, role: "admin" },
  { userId: daveId, orgId: betaOrgId, role: "admin" },
];
for (const m of memberships) {
  // No unique constraint on (organization_id, user_id) in BA's schema, so
  // dedupe by check-then-insert. Pull a stable id from rand bytes;
  // re-runs preserve the original id since we don't write when one exists.
  const existing = d1Query<{ id: string }>(
    pkgDir,
    `SELECT id FROM member WHERE organization_id='${m.orgId}' AND user_id='${m.userId}';`,
  );
  if (existing.length > 0) continue;
  const id = crypto.randomUUID();
  d1Exec(
    pkgDir,
    `INSERT INTO member (id, organization_id, user_id, role, created_at) ` +
      `VALUES ('${id}', '${m.orgId}', '${m.userId}', '${m.role}', ${createdAtMs});`,
  );
}

console.log(`         super@user.com    / superuserdo   (platform admin)`);
console.log(`         alice@example.com / alicepwd123   (admin of acme — org)`);
console.log(`         bob@example.com   / bobpwd1234    (plain user, not org)`);
console.log(`         dave@example.com  / davepwd123    (admin of beta — org)`);
