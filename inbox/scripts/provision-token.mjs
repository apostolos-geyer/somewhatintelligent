#!/usr/bin/env node
// Idempotent provisioning of the account-scoped Cloudflare API token that the
// other setup scripts (setup-access, setup-email-routing) use.
//
// Why this exists: the setup scripts need an API token with Access + Email
// Routing + DNS permissions, which the `wrangler login` OAuth token does not
// have. Rather than mint that token by hand, this script creates/updates it
// from a higher-privileged "master" token, idempotently.
//
// What it does (safe to re-run):
//   1. Resolves the desired permission groups by NAME (so scopes are readable).
//   2. Find-or-creates an account-owned token named TOKEN_NAME.
//      - create -> writes the new secret to OUT (chmod 600)
//      - exists -> reconciles its permission groups to the desired set (PUT)
//   3. Ensures OUT holds a usable secret:
//      - on create, writes the returned value
//      - if the token exists but OUT is missing (or ROLL=1), rolls the secret
//        and writes the new value (the old secret stops working)
//      - otherwise leaves the existing secret untouched
//   4. Optionally revokes superseded tokens listed in REVOKE_NAMES.
//
// The provisioned token is account-scoped to CLOUDFLARE_ACCOUNT_ID only.
//
// Usage:
//   CLOUDFLARE_ACCOUNT_ID=<id> \
//   CLOUDFLARE_MASTER_TOKEN="$(cat /path/to/master-token)" \
//     node scripts/provision-token.mjs
//
// Env vars:
//   CLOUDFLARE_ACCOUNT_ID   (required) account the token is scoped to
//   CLOUDFLARE_MASTER_TOKEN (required) a token allowed to manage API tokens and
//                           grant the requested permissions (e.g. a user API
//                           token with "all permissions").
//   TOKEN_NAME              managed token name (default "agentic-inbox-setup")
//   SCOPES                  comma-separated permission-group NAMES (default: the
//                           full set the setup scripts need)
//   OUT                     file to write the token secret to
//                           (default "<repo>/.cf-setup-token", gitignored)
//   ROLL=1                  force-roll the secret even if OUT already has one
//   REVOKE_NAMES            comma-separated token names to revoke if present
//   DRY_RUN=1               print intended actions, change nothing

import { writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const API = "https://api.cloudflare.com/client/v4";
const DRY_RUN = process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true";
const ROLL = process.env.ROLL === "1" || process.env.ROLL === "true";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const die = (m) => {
  console.error(`\n✖ ${m}\n`);
  process.exit(1);
};
const log = (m) => console.log(m);

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const masterToken = process.env.CLOUDFLARE_MASTER_TOKEN;
if (!accountId) die("CLOUDFLARE_ACCOUNT_ID is required.");
if (!masterToken)
  die(
    "CLOUDFLARE_MASTER_TOKEN is required (a token allowed to manage API tokens " +
      "and grant the requested permissions).",
  );

const tokenName = process.env.TOKEN_NAME || "agentic-inbox-setup";
const outPath = process.env.OUT || join(repoRoot, ".cf-setup-token");

// Default scope set needed by setup-access.mjs + setup-email-routing.mjs.
const DEFAULT_SCOPES = [
  "Access: Apps and Policies Write",
  "Access: Apps Write",
  "Access: Policies Write",
  "Access: Organizations, Identity Providers, and Groups Write",
  "Email Routing Rules Write",
  "DNS Write",
  "Zone Read",
];
const scopeNames = process.env.SCOPES
  ? process.env.SCOPES.split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  : DEFAULT_SCOPES;

const revokeNames = (process.env.REVOKE_NAMES || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

async function cf(path, { method = "GET", body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${masterToken}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json;
  try {
    json = await res.json();
  } catch {
    die(`${method} ${path} -> ${res.status} (non-JSON response)`);
  }
  if (!json.success) {
    const errs = (json.errors || []).map((e) => `${e.code ?? "?"}: ${e.message}`).join("; ");
    const err = new Error(errs || `${method} ${path} failed (${res.status})`);
    err.cfErrors = json.errors || [];
    err.status = res.status;
    throw err;
  }
  return json.result;
}

const resource = `com.cloudflare.api.account.${accountId}`;

// Resolve permission-group names -> IDs (a name may map to >1 id; keep all).
async function resolveGroups(names) {
  const all = await cf(`/accounts/${accountId}/tokens/permission_groups`);
  const byName = new Map();
  for (const g of all || []) {
    if (!byName.has(g.name)) byName.set(g.name, []);
    byName.get(g.name).push(g.id);
  }
  const ids = [];
  for (const name of names) {
    const matched = byName.get(name);
    if (!matched || !matched.length)
      die(`Permission group not found: "${name}". Check the exact name.`);
    ids.push(...matched);
  }
  return [...new Set(ids)];
}

function policyFor(ids) {
  return [
    {
      effect: "allow",
      permission_groups: ids.map((id) => ({ id })),
      resources: { [resource]: "*" },
    },
  ];
}

function currentGroupIds(token) {
  const ids = [];
  for (const p of token.policies || []) for (const g of p.permission_groups || []) ids.push(g.id);
  return new Set(ids);
}

function sameSet(a, bSet) {
  if (a.length !== bSet.size) return false;
  return a.every((x) => bSet.has(x));
}

async function findTokenByName(name) {
  const tokens = await cf(`/accounts/${accountId}/tokens?per_page=50`);
  return (tokens || []).find((t) => t.name === name) || null;
}

function writeSecret(value) {
  writeFileSync(outPath, value, { mode: 0o600 });
  log(`  wrote token secret -> ${outPath} (chmod 600)`);
}

async function main() {
  log(`Provisioning API token "${tokenName}" for account ${accountId}`);
  if (DRY_RUN) log("(dry run — no changes will be made)");

  log("→ Resolving permission groups…");
  const wantIds = await resolveGroups(scopeNames);
  log(`  ${scopeNames.length} scopes -> ${wantIds.length} permission group ids`);

  log("→ Find-or-create token…");
  const existing = await findTokenByName(tokenName);

  if (!existing) {
    if (DRY_RUN) {
      log(`  [dry-run] would create token "${tokenName}" and write secret to ${outPath}`);
    } else {
      const created = await cf(`/accounts/${accountId}/tokens`, {
        method: "POST",
        body: { name: tokenName, policies: policyFor(wantIds) },
      });
      log(`  created token (${created.id})`);
      writeSecret(created.value);
    }
  } else {
    log(`  token exists (${existing.id})`);
    // Reconcile scopes.
    if (!sameSet(wantIds, currentGroupIds(existing))) {
      if (DRY_RUN) {
        log("  [dry-run] would update permission groups to match desired set");
      } else {
        await cf(`/accounts/${accountId}/tokens/${existing.id}`, {
          method: "PUT",
          body: { name: tokenName, policies: policyFor(wantIds) },
        });
        log("  reconciled permission groups");
      }
    } else {
      log("  permission groups already match");
    }
    // Ensure we have a usable secret on disk.
    const haveSecret = existsSync(outPath);
    if (!haveSecret || ROLL) {
      if (DRY_RUN) {
        log(`  [dry-run] would roll secret (${haveSecret ? "ROLL=1" : "no secret file"})`);
      } else {
        const rolled = await cf(`/accounts/${accountId}/tokens/${existing.id}/value`, {
          method: "PUT",
          body: {},
        });
        // The roll endpoint returns the new secret as the bare result.
        const value = typeof rolled === "string" ? rolled : rolled?.value;
        if (!value) die("Roll did not return a new secret value.");
        log(`  rolled secret (${haveSecret ? "forced" : "no local secret"})`);
        writeSecret(value);
      }
    } else {
      log(`  existing secret at ${outPath} left untouched`);
    }
  }

  // Revoke superseded tokens.
  for (const name of revokeNames) {
    if (name === tokenName) continue;
    const t = await findTokenByName(name);
    if (!t) {
      log(`→ revoke "${name}": not present (ok)`);
      continue;
    }
    if (DRY_RUN) {
      log(`→ revoke "${name}" (${t.id}): [dry-run] would delete`);
      continue;
    }
    await cf(`/accounts/${accountId}/tokens/${t.id}`, { method: "DELETE" });
    log(`→ revoked "${name}" (${t.id})`);
  }

  log("\n✓ Token provisioning complete.");
  if (!DRY_RUN)
    log(
      `  Use it:  CLOUDFLARE_API_TOKEN="$(cat ${outPath})" npm run setup:access` +
        `  (or setup:email)`,
    );
}

main().catch((e) => {
  if (e.cfErrors?.length) die(`Cloudflare API error: ${e.message}`);
  die(e.stack || e.message);
});
