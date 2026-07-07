#!/usr/bin/env node
// Idempotent Cloudflare Access setup for this Worker.
//
// What it does (every step is find-or-create, so re-running is safe):
//   1. Resolves the Worker's public hostname (e.g. agentic-inbox.<subdomain>.workers.dev)
//   2. Reads the Zero Trust org's auth_domain  -> TEAM_DOMAIN
//   3. Find-or-creates a reusable Access policy (who is allowed in)
//   4. Find-or-creates the self-hosted Access application for the hostname
//      and makes sure the policy is attached  -> POLICY_AUD (the app's `aud`)
//   5. Sets POLICY_AUD and TEAM_DOMAIN as Worker secrets via `wrangler secret put`
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
//   CLOUDFLARE_ACCOUNT_ID=<id> CLOUDFLARE_API_TOKEN=<token> \
//     ACCESS_EMAILS="you@example.com" \
//     node scripts/setup-access.mjs
//
// Env vars:
//   CLOUDFLARE_ACCOUNT_ID   (required)
//   CLOUDFLARE_API_TOKEN    (required) Access-scoped token, see above
//   ACCESS_EMAILS           comma-separated emails to allow (e.g. "a@x.com,b@y.com")
//   ACCESS_EMAIL_DOMAIN     allow an entire email domain (e.g. "example.com")
//                           Provide ACCESS_EMAILS and/or ACCESS_EMAIL_DOMAIN.
//   WORKER_NAME             defaults to `name` in wrangler.jsonc
//   WORKER_HOSTNAME         override the auto-detected workers.dev hostname
//   TEAM_NAME               only used if NO Zero Trust org exists yet; becomes
//                           <TEAM_NAME>.cloudflareaccess.com. Pick something unique.
//   POLICY_NAME             reusable policy name (default "<WORKER_NAME>-access")
//   APP_NAME                Access application name (default "Agentic Inbox")
//   SESSION_DURATION        Access session length (default "24h")
//   DRY_RUN=1               print what would happen, set no secrets, create nothing
//   SKIP_SECRETS=1          do everything except writing wrangler secrets

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const API = "https://api.cloudflare.com/client/v4";
const DRY_RUN = process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true";
const SKIP_SECRETS = process.env.SKIP_SECRETS === "1" || process.env.SKIP_SECRETS === "true";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

function die(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

function log(msg) {
  console.log(msg);
}

// --- read required config -------------------------------------------------

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;

if (!accountId) die("CLOUDFLARE_ACCOUNT_ID is required.");
if (!apiToken) {
  die(
    "CLOUDFLARE_API_TOKEN is required (Access: Apps and Policies = Edit, " +
      "Access: Organizations… = Read). Create one at " +
      "https://dash.cloudflare.com/profile/api-tokens",
  );
}

// Read wrangler.jsonc (tolerating // comments). This is a single-instance
// config (no named `env.*` blocks), so the top level is always the answer.
function readWranglerConfig() {
  try {
    const raw = readFileSync(join(repoRoot, "wrangler.jsonc"), "utf8");
    return JSON.parse(raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1"));
  } catch {
    return {};
  }
}

const wranglerCfg = readWranglerConfig();
const workerName = process.env.WORKER_NAME || wranglerCfg.name || null;
if (!workerName) die("Could not determine WORKER_NAME (set it explicitly).");

// Build the Access policy include rules from the allow-list config.
const emails = (process.env.ACCESS_EMAILS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const emailDomain = (process.env.ACCESS_EMAIL_DOMAIN || "").trim();

const include = [
  ...emails.map((email) => ({ email: { email } })),
  ...(emailDomain ? [{ email_domain: { domain: emailDomain } }] : []),
];

if (include.length === 0) {
  die(
    'No allow-list configured. Set ACCESS_EMAILS="you@example.com" and/or ' +
      'ACCESS_EMAIL_DOMAIN="example.com" so the Access policy lets someone in.',
  );
}

// Per-instance policy name, derived from the Worker so each environment gets
// its own allow-list (e.g. "agentic-inbox-access", "agentic-inbox-si-access").
const policyName = process.env.POLICY_NAME || `${workerName}-access`;
const appName = process.env.APP_NAME || "Agentic Inbox";
const sessionDuration = process.env.SESSION_DURATION || "24h";

// --- Cloudflare API helper ------------------------------------------------

async function cf(path, { method = "GET", body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiToken}`,
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

// --- 1. resolve the Worker hostname --------------------------------------

async function resolveHostname() {
  if (process.env.WORKER_HOSTNAME) return process.env.WORKER_HOSTNAME;
  try {
    const sub = await cf(`/accounts/${accountId}/workers/subdomain`);
    if (sub?.subdomain) return `${workerName}.${sub.subdomain}.workers.dev`;
  } catch (e) {
    // The Access-scoped token usually can't read the Workers subdomain.
    log(
      `  (could not auto-detect workers.dev subdomain: ${e.message}. ` +
        `Set WORKER_HOSTNAME to skip this.)`,
    );
  }
  die(
    "Could not determine the Worker hostname. Set WORKER_HOSTNAME, e.g. " +
      `WORKER_HOSTNAME=${workerName}.<your-subdomain>.workers.dev`,
  );
}

// --- 2. Zero Trust org -> TEAM_DOMAIN ------------------------------------

async function resolveTeamDomain() {
  let org;
  try {
    org = await cf(`/accounts/${accountId}/access/organizations`);
  } catch (e) {
    // Don't silently treat a permission/auth failure as "no org" — that masks a
    // bad token and sends setup down the wrong "create an org" path.
    const code = e.cfErrors?.[0]?.code;
    if (e.status === 401 || e.status === 403 || code === 10000) {
      die(
        `Could not read the Zero Trust org: ${e.message}. Your CLOUDFLARE_API_TOKEN ` +
          `is likely missing the "Access: Organizations, Identity Providers, and ` +
          `Groups" permission for this account.`,
      );
    }
    org = null; // genuine "no org yet"
    log(`  (no Zero Trust org found: ${e.message})`);
  }

  if (org?.auth_domain) return `https://${org.auth_domain}`;

  // No Zero Trust org exists. Creating one assigns a permanent team name, so we
  // only do it when the user explicitly opts in via TEAM_NAME.
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
  if (DRY_RUN) {
    log(`  [dry-run] would create Zero Trust org with auth_domain ${authDomain}`);
    return `https://${authDomain}`;
  }
  const created = await cf(`/accounts/${accountId}/access/organizations`, {
    method: "POST",
    body: { name: teamName, auth_domain: authDomain },
  });
  log(`  created Zero Trust org: ${created.auth_domain}`);
  return `https://${created.auth_domain}`;
}

// --- 3. find-or-create the reusable policy -------------------------------

async function ensurePolicy() {
  const policies = await cf(`/accounts/${accountId}/access/policies`);
  const existing = (policies || []).find((p) => p.name === policyName);
  if (existing) {
    log(`  policy "${policyName}" already exists (${existing.id})`);
    return existing.id;
  }
  if (DRY_RUN) {
    log(`  [dry-run] would create policy "${policyName}" allowing ${describeAllow()}`);
    return "<dry-run-policy-id>";
  }
  const created = await cf(`/accounts/${accountId}/access/policies`, {
    method: "POST",
    body: { name: policyName, decision: "allow", include },
  });
  log(`  created policy "${policyName}" (${created.id}) allowing ${describeAllow()}`);
  return created.id;
}

function describeAllow() {
  const parts = [];
  if (emails.length) parts.push(emails.join(", "));
  if (emailDomain) parts.push(`*@${emailDomain}`);
  return parts.join(" and ");
}

// --- 4. find-or-create the Access application ----------------------------

function appMatchesHost(app, hostname) {
  if (app.domain === hostname) return true;
  if (Array.isArray(app.self_hosted_domains)) return app.self_hosted_domains.includes(hostname);
  return false;
}

async function ensureApp(hostname, policyId) {
  const apps = await cf(`/accounts/${accountId}/access/apps`);
  const existing = (apps || []).find((a) => appMatchesHost(a, hostname));

  if (existing) {
    log(`  Access app for ${hostname} already exists (${existing.id})`);
    const attached = (existing.policies || []).some((p) => p === policyId || p?.id === policyId);
    if (!attached && !DRY_RUN) {
      const policyIds = [
        ...(existing.policies || []).map((p) => (typeof p === "string" ? p : p.id)),
        policyId,
      ];
      await cf(`/accounts/${accountId}/access/apps/${existing.id}`, {
        method: "PUT",
        body: {
          name: existing.name,
          domain: hostname,
          type: "self_hosted",
          session_duration: existing.session_duration || sessionDuration,
          policies: policyIds,
        },
      });
      log(`  attached policy ${policyId} to existing app`);
    } else if (!attached) {
      log(`  [dry-run] would attach policy ${policyId} to existing app`);
    }
    return existing.aud;
  }

  if (DRY_RUN) {
    log(`  [dry-run] would create self-hosted Access app for ${hostname}`);
    return "<dry-run-aud>";
  }
  const created = await cf(`/accounts/${accountId}/access/apps`, {
    method: "POST",
    body: {
      name: appName,
      domain: hostname,
      type: "self_hosted",
      session_duration: sessionDuration,
      app_launcher_visible: false,
      policies: [policyId],
    },
  });
  log(`  created Access app "${appName}" for ${hostname} (${created.id})`);
  return created.aud;
}

// --- 5. write Worker secrets via wrangler (NOT the Access token) ----------

function putSecret(name, value) {
  if (SKIP_SECRETS) {
    log(`  (SKIP_SECRETS) not setting ${name}`);
    return;
  }
  if (DRY_RUN) {
    log(`  [dry-run] would run: wrangler secret put ${name}`);
    return;
  }
  // Use the wrangler OAuth login for the Workers write. Strip the Access API
  // token from the child env so wrangler doesn't try to use it.
  const env = { ...process.env, CLOUDFLARE_ACCOUNT_ID: accountId };
  delete env.CLOUDFLARE_API_TOKEN;
  delete env.CLOUDFLARE_API_KEY;
  delete env.CLOUDFLARE_EMAIL;

  const res = spawnSync("npx", ["wrangler", "secret", "put", name], {
    cwd: repoRoot,
    env,
    input: value,
    stdio: ["pipe", "inherit", "inherit"],
  });
  if (res.status !== 0) {
    die(`wrangler secret put ${name} failed (exit ${res.status}).`);
  }
}

// --- run ------------------------------------------------------------------

async function main() {
  log(`Setting up Cloudflare Access for Worker "${workerName}"`);
  if (DRY_RUN) log("(dry run — no changes will be made)\n");

  log("→ Resolving Worker hostname…");
  const hostname = await resolveHostname();
  log(`  hostname: ${hostname}`);

  log("→ Resolving team domain…");
  const teamDomain = await resolveTeamDomain();
  log(`  TEAM_DOMAIN: ${teamDomain}`);

  log("→ Ensuring Access policy…");
  const policyId = await ensurePolicy();

  log("→ Ensuring Access application…");
  const aud = await ensureApp(hostname, policyId);
  log(`  POLICY_AUD: ${aud}`);

  log("→ Setting Worker secrets…");
  putSecret("POLICY_AUD", aud);
  putSecret("TEAM_DOMAIN", teamDomain);

  log("\n✓ Cloudflare Access is configured.");
  log("  Summary:");
  log(`    App hostname : ${hostname}`);
  log(`    POLICY_AUD   : ${aud}`);
  log(`    TEAM_DOMAIN  : ${teamDomain}`);
  log(`    Allowed      : ${describeAllow()}`);
  if (!DRY_RUN && !SKIP_SECRETS) {
    log("\n  Redeploy if needed so the secrets take effect: npm run deploy");
  }
}

main().catch((e) => {
  if (e.cfErrors?.length) {
    die(`Cloudflare API error: ${e.message}`);
  }
  die(e.stack || e.message);
});
