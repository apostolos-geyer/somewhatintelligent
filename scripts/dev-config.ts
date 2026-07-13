import { existsSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { resolve } from "node:path";

// Dev scripts often hit `https://*.platform.localhost`, signed by
// portless's local CA. New devs don't have to remember
// `NODE_EXTRA_CA_CERTS=~/.portless/ca.pem`.
//
// Behaviour per process:
//   - Current process: set `NODE_TLS_REJECT_UNAUTHORIZED=0` so in-process
//     `fetch()` accepts the self-signed cert. Bun's TLS context is
//     already initialised before this module loads, so the more targeted
//     `NODE_EXTRA_CA_CERTS` env var is a no-op mid-process.
//   - Subprocesses: bun's `process.env` mutations DON'T propagate via
//     spread (`{ ...process.env }` doesn't see them). So we build
//     `DEV_SPAWN_ENV` once here, capturing the override values, and have
//     callers explicitly pass it as `spawnSync(..., { env: DEV_SPAWN_ENV })`.
//
// Safe because this module is dev-only (gitignored `.dev.vars`, never
// bundled into a Worker).
const portlessCa = resolve(homedir(), ".portless/ca.pem");
const portlessAvailable = existsSync(portlessCa) && !process.env.NODE_EXTRA_CA_CERTS;
if (portlessAvailable) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

// Eagerly snapshot process.env so subprocesses inherit a base set, then
// layer in the TLS overrides. spawnSync's default env behaviour is broken
// on bun once process.env has been mutated post-startup; pass this
// explicitly via the `env` option.
export const DEV_SPAWN_ENV: NodeJS.ProcessEnv = (() => {
  const out: Record<string, string> = {};
  for (const k of Object.keys(process.env)) {
    const v = process.env[k];
    if (typeof v === "string") out[k] = v;
  }
  if (portlessAvailable) {
    out.NODE_EXTRA_CA_CERTS = portlessCa;
    out.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  }
  // Cast: roadie's global ProcessEnv augmentation declares required keys that
  // a runtime snapshot of process.env can't prove it carries.
  return out as NodeJS.ProcessEnv;
})();

// Local-dev defaults shared by every package's `scripts/bootstrap.ts`.
// These values are used exclusively for `vp run -r dev` on the developer
// machine; nothing here ships to staging or production.
//
// LOCAL_BETTER_AUTH_SECRET is a per-template dev placeholder. Rotate it
// for your fork (any 32-byte base64 string works) — it only signs cookies
// in `.somewhatintelligent.localhost`, so it can be public in this file.
export const LOCAL_BETTER_AUTH_SECRET = "//oc0iA9surRLIWnCKmFs9DlnrN3brN7mt4lMahzW0M=";
export const LOCAL_IDENTITY_URL = "https://identity.somewhatintelligent.localhost";
export const LOCAL_AUTH_DOMAIN = ".somewhatintelligent.localhost";

// LOCAL_BNC_ATT_PRIV is the well-known dev Ed25519 private key used by bouncer
// to sign attestation envelopes on `.somewhatintelligent.localhost`. The paired public
// key lives in `packages/config/src/bouncer-attestation.ts` under `kid: "dev"`.
// Rotate both per fork before any non-local deploy.
//
// PKCS8 PEM (no surrounding headers — the dev .dev.vars writer wraps it).
export const LOCAL_BNC_ATT_PRIV_B64 =
  "MC4CAQAwBQYDK2VwBCIEINzNgiuDD9xbqVEPkfMt8twPcq7hTnIbAdKKHPjM7TmU";
export const LOCAL_BNC_ATT_PRIV = `-----BEGIN PRIVATE KEY-----
${LOCAL_BNC_ATT_PRIV_B64}
-----END PRIVATE KEY-----`;
export const LOCAL_BNC_ATT_KID = "dev";

// LOCAL_VAULT_* are vault's well-known dev key material: the v1 KEK that
// wraps per-grant DEKs and the HMAC key that signs OAuth state. Local-only
// (encrypts nothing that leaves the machine); staging/production get unique
// generated values via packages/secrets. Rotate per fork if you care.
export const LOCAL_VAULT_KEK_V1 = "vGbPpVdLiGQp903ookg1Bvkux+WnvN7bAddxIbqKTq8=";
export const LOCAL_VAULT_STATE_HMAC = "nYhDB5QNxWOKnaERgn7z0oqYkTaFONRBEdnGi4jXF/Q=";

// Shared `.dev.vars` template for non-guestlist apps/services. BETTER_AUTH_SECRET
// is intentionally NOT included — session verification lives entirely in
// guestlist (which holds the secret in its own env). Apps reach guestlist over
// the service binding for `getSession`.
export const PLATFORM_DEV_VARS = `ENVIRONMENT=development
IDENTITY_URL=${LOCAL_IDENTITY_URL}
AUTH_DOMAIN=${LOCAL_AUTH_DOMAIN}
`;

export function writeDevVarsIfMissing(path: string, content: string, label: string): boolean {
  if (existsSync(path)) {
    console.log(`  [skip] ${label}: .dev.vars exists`);
    return false;
  }
  writeFileSync(path, content);
  console.log(`  [write] ${label}: created .dev.vars`);
  return true;
}

export function applyD1MigrationsLocal(cwd: string, label: string): void {
  console.log(`  [migrate] ${label}: wrangler d1 migrations apply DB --local`);
  const result = spawnSync("bunx", ["wrangler", "d1", "migrations", "apply", "DB", "--local"], {
    cwd,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`${label}: wrangler d1 migrations apply failed (exit ${result.status})`);
  }
}

// ─── D1 query/exec helpers (local-dev only) ────────────────────────────
//
// Thin wrappers around `wrangler d1 execute DB --local`. Each call shells
// out — fine for seed scripts where DX > throughput. `cwd` is the package
// dir whose `wrangler.jsonc` binds the target D1 (e.g. workers/guestlist
// or workers/roadie).

interface D1JsonShape<T = Record<string, unknown>> {
  results?: T[];
}

/**
 * Which D1 a helper targets. Default (omitted) = the LOCAL wrangler SQLite file,
 * the only safe target for `bootstrap`/dev seeding. `{ remote: true, env }`
 * targets the deployed D1 for that wrangler env — used by `seed-staging` to seed
 * the live staging databases. The `env` selects the wrangler env block whose `DB`
 * binding (and thus `database_id`) is used.
 */
export interface D1Target {
  remote?: boolean;
  env?: string;
}

function d1TargetFlags(target?: D1Target): string[] {
  if (target?.remote) {
    // Staging is the top-level (unnamed) wrangler config — only production has
    // a named `env.production` block, so "staging" gets no --env flag.
    return ["--remote", ...(target.env && target.env !== "staging" ? [`--env=${target.env}`] : [])];
  }
  return ["--local"];
}

export function d1Exec(cwd: string, sql: string, target?: D1Target): void {
  const result = spawnSync(
    "bunx",
    ["wrangler", "d1", "execute", "DB", ...d1TargetFlags(target), `--command=${sql}`],
    { cwd, stdio: ["ignore", "pipe", "pipe"], env: DEV_SPAWN_ENV },
  );
  if (result.status !== 0) {
    throw new Error(
      `d1 exec failed in ${cwd} (exit ${result.status})\nSQL: ${sql}\n` +
        `${result.stderr?.toString() ?? ""}`,
    );
  }
}

export function d1Query<T = Record<string, unknown>>(
  cwd: string,
  sql: string,
  target?: D1Target,
): T[] {
  const result = spawnSync(
    "bunx",
    ["wrangler", "d1", "execute", "DB", ...d1TargetFlags(target), "--json", `--command=${sql}`],
    { cwd, stdio: ["ignore", "pipe", "pipe"], env: DEV_SPAWN_ENV },
  );
  if (result.status !== 0) {
    throw new Error(
      `d1 query failed in ${cwd} (exit ${result.status})\nSQL: ${sql}\n` +
        `${result.stderr?.toString() ?? ""}`,
    );
  }
  const parsed = JSON.parse(result.stdout?.toString() ?? "[]") as D1JsonShape<T>[];
  return parsed[0]?.results ?? [];
}
