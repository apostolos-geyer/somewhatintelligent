#!/usr/bin/env bun
// Idempotent Cloudflare Access setup for the Operator worker (RFC-0001 D6),
// ported from the proven inbox/scripts/setup-access.mjs and extended to
// operator's TWO deployed environments:
//
//   staging     si-operator-staging      desk.staging.somewhatintelligent.ca
//   production  si-operator-production   desk.somewhatintelligent.ca
//
// Every step is find-or-create, so re-running is safe:
//   1. Reads the account id, worker names, and hostnames from wrangler.jsonc
//      (top level = staging, env.production = production).
//   2. Reads the Zero Trust org's auth_domain -> TEAM_DOMAIN.
//   3. Find-or-creates ONE reusable Allow policy holding OPERATOR_EMAILS.
//   4. Per environment: find-or-creates the self-hosted Access application
//      for that hostname, ensures the policy is attached -> POLICY_AUD
//      (the app's `aud`).
//   5. Writes POLICY_AUD and TEAM_DOMAIN as Worker secrets via
//      `wrangler secret put` (no --env for staging, --env production for
//      production).
//
// A successful Worker deploy or DNS resolution is NEVER treated as proof that
// Access is configured (RFC-0001 "Operational configuration"): this script is
// the only path that establishes the Access application and secrets, and the
// worker itself fails closed (500/403) until they exist.
//
// Why two different credentials:
//   - CLOUDFLARE_API_TOKEN  -> used for the Access API. Needs:
//         Access: Apps and Policies            = Edit
//         Access: Organizations, Identity Providers, and Groups = Read
//     Create one at https://dash.cloudflare.com/profile/api-tokens
//   - The `wrangler` OAuth login (from `wrangler login`) -> used to write the
//     Worker secrets. Needs Workers Scripts = Edit, which the OAuth login has.
//   The Access token is deliberately NOT passed to wrangler, otherwise wrangler
//   would try to authenticate the secret write with an Access-only token and 403.
//
// Usage:
//   bun scripts/setup-access.ts --dry-run      # print the plan, touch nothing
//   CLOUDFLARE_API_TOKEN=<token> bun scripts/setup-access.ts
//
// Env vars:
//   CLOUDFLARE_API_TOKEN   (required unless --dry-run) Access-scoped token, see above
//   TEAM_NAME              only used if NO Zero Trust org exists yet; becomes
//                          <TEAM_NAME>.cloudflareaccess.com. Pick something unique.
//
// --dry-run requires no token and performs NO network calls and NO Cloudflare
// mutations — its output is the auditable P1 exit-gate artifact (exec-plan
// 0004 T4): the intended policy, allow-list, applications, hostnames, and
// secret writes for both environments.

import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// =============================================================================
// OPERATOR ACCESS ALLOW-LIST — the only email addresses the reusable Allow
// policy lets through Access onto desk.*. Edit this list to grant/revoke an
// operator, then re-run the script (policy rules are replaced in place).
// =============================================================================
const OPERATOR_EMAILS: string[] = ["hello@somewhatintelligent.ca"];

const POLICY_NAME = "si-operator-access";
const SESSION_DURATION = "24h";

const API = "https://api.cloudflare.com/client/v4";
const DRY_RUN = process.argv.includes("--dry-run");

const workerRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function die(msg: string): never {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

function log(msg: string): void {
  console.log(msg);
}

// --- wrangler.jsonc-derived configuration -----------------------------------

interface WranglerEnvConfig {
  name: string;
  hostname: string;
}

/** Parse wrangler.jsonc (tolerating // and block comments and trailing commas). */
function readWranglerConfig(): {
  accountId: string;
  staging: WranglerEnvConfig;
  production: WranglerEnvConfig;
} {
  const raw = readFileSync(join(workerRoot, "wrangler.jsonc"), "utf8");
  const cfg = JSON.parse(
    raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1")
      .replace(/,(\s*[}\]])/g, "$1"),
  ) as {
    account_id?: string;
    name?: string;
    routes?: Array<{ pattern?: string }>;
    env?: { production?: { name?: string; routes?: Array<{ pattern?: string }> } };
  };

  const accountId = cfg.account_id;
  if (!accountId) die("wrangler.jsonc has no top-level account_id.");

  const stagingName = cfg.name;
  const stagingHost = cfg.routes?.[0]?.pattern;
  const productionName = cfg.env?.production?.name;
  const productionHost = cfg.env?.production?.routes?.[0]?.pattern;
  if (!stagingName || !stagingHost || !productionName || !productionHost) {
    die(
      "wrangler.jsonc must declare top-level name + routes[0].pattern (staging) " +
        "and env.production name + routes[0].pattern (production).",
    );
  }
  return {
    accountId,
    staging: { name: stagingName, hostname: stagingHost },
    production: { name: productionName, hostname: productionHost },
  };
}

interface EnvTarget extends WranglerEnvConfig {
  key: "staging" | "production";
  /** Extra args for `wrangler secret put` — named envs need --env. */
  wranglerEnvArgs: string[];
  appName: string;
}

// --- Cloudflare Access API ----------------------------------------------------

interface CfError {
  code?: number;
  message: string;
}

class CfApiError extends Error {
  constructor(
    message: string,
    readonly cfErrors: CfError[],
    readonly status: number,
  ) {
    super(message);
  }
}

const apiToken = process.env.CLOUDFLARE_API_TOKEN;

async function cf<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json",
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });

  let json: { success: boolean; errors?: CfError[]; result: T };
  try {
    json = (await res.json()) as typeof json;
  } catch {
    die(`${init.method ?? "GET"} ${path} -> ${res.status} (non-JSON response)`);
  }

  if (!json.success) {
    const errs = (json.errors ?? []).map((e) => `${e.code ?? "?"}: ${e.message}`).join("; ");
    throw new CfApiError(
      errs || `${init.method ?? "GET"} ${path} failed (${res.status})`,
      json.errors ?? [],
      res.status,
    );
  }
  return json.result;
}

// --- 2. Zero Trust org -> TEAM_DOMAIN ----------------------------------------

/** Resolve the org auth_domain; create the org only on explicit TEAM_NAME opt-in. */
async function resolveTeamDomain(accountId: string): Promise<string> {
  interface AccessOrg {
    auth_domain?: string;
  }

  let org: AccessOrg | null;
  try {
    org = await cf<AccessOrg | null>(`/accounts/${accountId}/access/organizations`);
  } catch (e) {
    // Don't silently treat a permission/auth failure as "no org" — that masks a
    // bad token and sends setup down the wrong "create an org" path.
    if (e instanceof CfApiError) {
      const code = e.cfErrors[0]?.code;
      if (e.status === 401 || e.status === 403 || code === 10000) {
        die(
          `Could not read the Zero Trust org: ${e.message}. Your CLOUDFLARE_API_TOKEN ` +
            `is likely missing the "Access: Organizations, Identity Providers, and ` +
            `Groups" permission for this account.`,
        );
      }
    }
    org = null;
    log(`  (no Zero Trust org found: ${(e as Error).message})`);
  }

  if (org?.auth_domain) return `https://${org.auth_domain}`;

  const teamName = (process.env.TEAM_NAME || "").trim();
  if (!teamName) {
    die(
      "No Zero Trust organization found on this account, so there is no team " +
        "domain yet. Re-run with TEAM_NAME=<unique-team-slug> to create one " +
        "(it becomes <TEAM_NAME>.cloudflareaccess.com), or enable Zero Trust " +
        "once in the dashboard.",
    );
  }
  const authDomain = `${teamName}.cloudflareaccess.com`;
  const created = await cf<AccessOrg>(`/accounts/${accountId}/access/organizations`, {
    method: "POST",
    body: { name: teamName, auth_domain: authDomain },
  });
  log(`  created Zero Trust org: ${created.auth_domain}`);
  return `https://${created.auth_domain}`;
}

// --- 3. find-or-create the reusable policy ------------------------------------

function describeAllow(): string {
  return OPERATOR_EMAILS.join(", ");
}

async function ensurePolicy(accountId: string): Promise<string> {
  interface AccessPolicy {
    id: string;
    name: string;
  }

  const policies = await cf<AccessPolicy[]>(`/accounts/${accountId}/access/policies`);
  const existing = (policies ?? []).find((p) => p.name === POLICY_NAME);
  const include = OPERATOR_EMAILS.map((email) => ({ email: { email } }));

  if (existing) {
    // Keep the allow-list truthful: replace the include rules so removing an
    // address from OPERATOR_EMAILS + re-running actually revokes access.
    await cf(`/accounts/${accountId}/access/policies/${existing.id}`, {
      method: "PUT",
      body: { name: POLICY_NAME, decision: "allow", include },
    });
    log(`  policy "${POLICY_NAME}" already exists (${existing.id}); allow-list refreshed`);
    return existing.id;
  }

  const created = await cf<AccessPolicy>(`/accounts/${accountId}/access/policies`, {
    method: "POST",
    body: { name: POLICY_NAME, decision: "allow", include },
  });
  log(`  created policy "${POLICY_NAME}" (${created.id}) allowing ${describeAllow()}`);
  return created.id;
}

// --- 4. find-or-create the Access application per hostname --------------------

interface AccessApp {
  id: string;
  name: string;
  aud: string;
  domain?: string;
  self_hosted_domains?: string[];
  session_duration?: string;
  policies?: Array<string | { id: string }>;
}

function appMatchesHost(app: AccessApp, hostname: string): boolean {
  if (app.domain === hostname) return true;
  if (Array.isArray(app.self_hosted_domains)) return app.self_hosted_domains.includes(hostname);
  return false;
}

async function ensureApp(accountId: string, target: EnvTarget, policyId: string): Promise<string> {
  const apps = await cf<AccessApp[]>(`/accounts/${accountId}/access/apps`);
  const existing = (apps ?? []).find((a) => appMatchesHost(a, target.hostname));

  if (existing) {
    log(`  Access app for ${target.hostname} already exists (${existing.id})`);
    const attached = (existing.policies ?? []).some((p) =>
      typeof p === "string" ? p === policyId : p.id === policyId,
    );
    if (!attached) {
      const policyIds = [
        ...(existing.policies ?? []).map((p) => (typeof p === "string" ? p : p.id)),
        policyId,
      ];
      await cf(`/accounts/${accountId}/access/apps/${existing.id}`, {
        method: "PUT",
        body: {
          name: existing.name,
          domain: target.hostname,
          type: "self_hosted",
          session_duration: existing.session_duration || SESSION_DURATION,
          policies: policyIds,
        },
      });
      log(`  attached policy ${policyId} to existing app`);
    }
    return existing.aud;
  }

  const created = await cf<AccessApp>(`/accounts/${accountId}/access/apps`, {
    method: "POST",
    body: {
      name: target.appName,
      domain: target.hostname,
      type: "self_hosted",
      session_duration: SESSION_DURATION,
      app_launcher_visible: false,
      policies: [policyId],
    },
  });
  log(`  created Access app "${target.appName}" for ${target.hostname} (${created.id})`);
  return created.aud;
}

// --- 5. write Worker secrets via wrangler (NOT the Access token) --------------

function wranglerBin(): string {
  // The workspace hoists wrangler to the repo-root node_modules.
  const hoisted = join(workerRoot, "..", "..", "node_modules", ".bin", "wrangler");
  return existsSync(hoisted) ? hoisted : "wrangler";
}

function putSecret(target: EnvTarget, accountId: string, name: string, value: string): void {
  // Use the wrangler OAuth login for the Workers write. Strip the Access API
  // token from the child env so wrangler doesn't try to use it.
  const env: Record<string, string | undefined> = {
    ...process.env,
    CLOUDFLARE_ACCOUNT_ID: accountId,
  };
  delete env.CLOUDFLARE_API_TOKEN;
  delete env.CLOUDFLARE_API_KEY;
  delete env.CLOUDFLARE_EMAIL;

  const res = spawnSync(wranglerBin(), ["secret", "put", name, ...target.wranglerEnvArgs], {
    cwd: workerRoot,
    env,
    input: value,
    stdio: ["pipe", "inherit", "inherit"],
  });
  if (res.status !== 0) {
    die(
      `wrangler secret put ${name} ${target.wranglerEnvArgs.join(" ")} failed (exit ${res.status}).`,
    );
  }
}

// --- dry-run plan --------------------------------------------------------------

function printDryRunPlan(targets: EnvTarget[], accountId: string): void {
  log("DRY RUN — no Cloudflare API calls, no wrangler writes, nothing mutates.\n");
  log(`Cloudflare account: ${accountId} (from wrangler.jsonc)`);
  log("");
  log("Intended writes:");
  log("");
  log(`  1. Reusable Access policy (shared by both applications)`);
  log(`       name     : ${POLICY_NAME}`);
  log(`       decision : allow`);
  log(`       include  : ${OPERATOR_EMAILS.map((e) => `email=${e}`).join(", ")}`);
  log(`       action   : resolve by name, or create; if it exists, refresh the`);
  log(`                  include rules to match the list above exactly`);
  log("");
  log(`  2. Zero Trust team domain`);
  log(`       action   : read the account's Access organization auth_domain`);
  log(`       value    : <resolved from API, e.g. https://<team>.cloudflareaccess.com>`);
  log("");
  let step = 3;
  for (const target of targets) {
    log(`  ${step}. [${target.key}] Access application`);
    log(`       hostname   : ${target.hostname} (from wrangler.jsonc)`);
    log(`       name       : ${target.appName}`);
    log(`       type       : self_hosted, session ${SESSION_DURATION}, app-launcher hidden`);
    log(`       policy     : attach "${POLICY_NAME}" if not already attached`);
    log(`       POLICY_AUD : <aud of the resolved/created application>`);
    log("");
    step += 1;
  }
  log(`  ${step}. Worker secrets (via wrangler's authenticated write path, NOT the`);
  log(`     Access API token):`);
  for (const target of targets) {
    const envArgs = target.wranglerEnvArgs.length ? ` ${target.wranglerEnvArgs.join(" ")}` : "";
    log(`       [${target.key}] ${target.name}`);
    log(`         wrangler secret put POLICY_AUD${envArgs}   <- <app aud>`);
    log(`         wrangler secret put TEAM_DOMAIN${envArgs}  <- <org auth_domain URL>`);
  }
  log("");
  log("Post-run invariants this plan establishes (RFC-0001 D6):");
  log("  - each desk.* hostname sits behind a self-hosted Access application;");
  log("  - the worker verifies Cf-Access-Jwt-Assertion against the team JWKS,");
  log("    issuer, and audience on every non-development request;");
  log("  - workers.dev / preview URLs stay disabled, so no unprotected hostname");
  log("    bypasses Access.");
  log("");
  log("Reminder: a successful deploy or DNS resolution is NOT proof Access is");
  log("configured — only running this script (without --dry-run) is.");
}

// --- run ------------------------------------------------------------------------

async function main(): Promise<void> {
  const { accountId, staging, production } = readWranglerConfig();
  const targets: EnvTarget[] = [
    {
      ...staging,
      key: "staging",
      wranglerEnvArgs: [], // top level of wrangler.jsonc IS staging
      appName: "Operator (staging)",
    },
    {
      ...production,
      key: "production",
      wranglerEnvArgs: ["--env", "production"],
      appName: "Operator (production)",
    },
  ];

  if (OPERATOR_EMAILS.length === 0) {
    die("OPERATOR_EMAILS is empty — the Access policy would let no one in.");
  }

  if (DRY_RUN) {
    printDryRunPlan(targets, accountId);
    return;
  }

  if (!apiToken) {
    die(
      "CLOUDFLARE_API_TOKEN is required (Access: Apps and Policies = Edit, " +
        "Access: Organizations… = Read). Create one at " +
        "https://dash.cloudflare.com/profile/api-tokens — or run with --dry-run " +
        "to print the plan without a token.",
    );
  }

  log(`Setting up Cloudflare Access for Operator (account ${accountId})\n`);

  log("→ Resolving team domain…");
  const teamDomain = await resolveTeamDomain(accountId);
  log(`  TEAM_DOMAIN: ${teamDomain}`);

  log("→ Ensuring reusable Access policy…");
  const policyId = await ensurePolicy(accountId);

  for (const target of targets) {
    log(`→ [${target.key}] Ensuring Access application for ${target.hostname}…`);
    const aud = await ensureApp(accountId, target, policyId);
    log(`  POLICY_AUD: ${aud}`);

    log(`→ [${target.key}] Writing Worker secrets on ${target.name}…`);
    putSecret(target, accountId, "POLICY_AUD", aud);
    putSecret(target, accountId, "TEAM_DOMAIN", teamDomain);
  }

  log("\n✓ Cloudflare Access is configured for both environments.");
  log("  Summary:");
  log(`    Policy       : ${POLICY_NAME} (allows ${describeAllow()})`);
  log(`    TEAM_DOMAIN  : ${teamDomain}`);
  for (const target of targets) {
    log(`    [${target.key}] ${target.hostname} -> ${target.name}`);
  }
  log("\n  Redeploy each environment if needed so the secrets take effect:");
  log("    bun run deploy:staging && bun run deploy:production");
}

main().catch((e: unknown) => {
  if (e instanceof CfApiError) {
    die(`Cloudflare API error: ${e.message}`);
  }
  die(e instanceof Error ? (e.stack ?? e.message) : String(e));
});
