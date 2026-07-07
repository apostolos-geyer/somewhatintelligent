#!/usr/bin/env node
// Idempotent Cloudflare Email Routing setup for this Worker.
//
// Routes inbound mail for your domain to the Worker via a catch-all rule, so
// the app's email() handler receives messages. Every step is find-or-update,
// so re-running is safe.
//
// What it does:
//   1. Finds the Cloudflare zone for RECEIVE_DOMAIN (defaults to DOMAINS in
//      wrangler.jsonc).
//   2. Ensures Email Routing is enabled on the zone (provisions MX/TXT if not).
//   3. Ensures the catch-all rule is enabled and forwards to the Worker.
//
//   ⚠️  A catch-all routes EVERY address at the domain (e.g. anything@your.domain)
//       into this app. Use a domain/zone you're comfortable dedicating to it.
//
// Credentials — CLOUDFLARE_API_TOKEN needs (scoped to the zone/account):
//       Zone : Email Routing Rules = Edit
//       Zone : DNS                 = Edit   (only needed to first-enable routing)
//       Zone : Zone                = Read
//   Create one at https://dash.cloudflare.com/profile/api-tokens
//
// Usage:
//   CLOUDFLARE_API_TOKEN=<token> node scripts/setup-email-routing.mjs
//
// Env vars:
//   CLOUDFLARE_API_TOKEN   (required) see scopes above
//   CLOUDFLARE_ACCOUNT_ID  (optional) narrows the zone lookup to one account
//   RECEIVE_DOMAIN         domain to receive at (default: DOMAINS in wrangler.jsonc)
//   WORKER_NAME            Worker to route to (default: `name` in wrangler.jsonc)
//   RULE_NAME              catch-all rule name (default "agentic-inbox catch-all")
//   DRY_RUN=1              print intended actions, change nothing

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const API = "https://api.cloudflare.com/client/v4";
const DRY_RUN = process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");

const die = (m) => {
  console.error(`\n✖ ${m}\n`);
  process.exit(1);
};
const log = (m) => console.log(m);

const apiToken = process.env.CLOUDFLARE_API_TOKEN;
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID; // optional
if (!apiToken) {
  die(
    "CLOUDFLARE_API_TOKEN is required (Zone: Email Routing Rules = Edit, " +
      "DNS = Edit, Zone = Read). Create one at " +
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
const receiveDomain = process.env.RECEIVE_DOMAIN || wranglerCfg.vars?.DOMAINS;
const workerName = process.env.WORKER_NAME || wranglerCfg.name;
const ruleName = process.env.RULE_NAME || "agentic-inbox catch-all";

if (!receiveDomain) die("Could not determine RECEIVE_DOMAIN (set it explicitly).");
if (!workerName) die("Could not determine WORKER_NAME (set it explicitly).");

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

// --- find the zone for the receive domain --------------------------------

async function findZone(domain) {
  const q = accountId ? `&account.id=${accountId}` : "";
  // Exact zone match first (apex domains).
  let zones = await cf(`/zones?name=${encodeURIComponent(domain)}${q}`);
  if (zones?.length) return zones[0];
  // Otherwise pick the longest registered zone that is a suffix of the domain
  // (handles subdomains like mail.example.com living under the example.com zone).
  zones = await cf(`/zones?per_page=50${q}`);
  const candidates = (zones || [])
    .filter((z) => domain === z.name || domain.endsWith(`.${z.name}`))
    .sort((a, b) => b.name.length - a.name.length);
  if (candidates[0]) return candidates[0];
  die(
    `No Cloudflare zone found for "${domain}". Add the domain to this account ` +
      `(and account if scoped) first.`,
  );
}

// --- ensure Email Routing is enabled -------------------------------------

async function ensureEnabled(zoneId) {
  let enabled = null;
  try {
    const s = await cf(`/zones/${zoneId}/email/routing`);
    enabled = !!s?.enabled;
  } catch (e) {
    log(`  (could not read Email Routing status: ${e.message})`);
  }
  if (enabled) {
    log("  Email Routing already enabled");
    return;
  }
  if (DRY_RUN) {
    log("  [dry-run] would enable Email Routing (provisions MX/TXT records)");
    return;
  }
  try {
    await cf(`/zones/${zoneId}/email/routing/enable`, { method: "POST", body: {} });
    log("  enabled Email Routing (provisioned MX/TXT records)");
  } catch (e) {
    // If the MX records already exist this can report a benign conflict; don't
    // hard-fail, the catch-all step will surface a real problem if routing is off.
    log(`  note: enable call returned: ${e.message} (continuing)`);
  }
}

// --- ensure catch-all -> Worker ------------------------------------------

function routesToWorker(rule, worker) {
  return (
    rule?.enabled &&
    (rule.actions || []).some((a) => a.type === "worker" && (a.value || []).includes(worker))
  );
}

async function ensureCatchAll(zoneId, worker) {
  const current = await cf(`/zones/${zoneId}/email/routing/rules/catch_all`);
  if (routesToWorker(current, worker)) {
    log(`  catch-all already routes to Worker "${worker}"`);
    return;
  }
  if (DRY_RUN) {
    log(
      `  [dry-run] would set catch-all -> Worker "${worker}" ` +
        `(currently: enabled=${current.enabled}, actions=${JSON.stringify(current.actions)})`,
    );
    return;
  }
  await cf(`/zones/${zoneId}/email/routing/rules/catch_all`, {
    method: "PUT",
    body: {
      name: ruleName,
      enabled: true,
      matchers: [{ type: "all" }],
      actions: [{ type: "worker", value: [worker] }],
    },
  });
  log(`  set catch-all -> Worker "${worker}"`);
}

// --- run -----------------------------------------------------------------

async function main() {
  log(`Setting up Email Routing for ${receiveDomain} -> Worker "${workerName}"`);
  if (DRY_RUN) log("(dry run — no changes will be made)");

  log("→ Finding zone…");
  const zone = await findZone(receiveDomain);
  log(`  zone: ${zone.name} (${zone.id})`);

  log("→ Ensuring Email Routing is enabled…");
  await ensureEnabled(zone.id);

  log("→ Ensuring catch-all routes to the Worker…");
  await ensureCatchAll(zone.id, workerName);

  // Verify final state.
  if (!DRY_RUN) {
    const finalRule = await cf(`/zones/${zone.id}/email/routing/rules/catch_all`);
    const ok = routesToWorker(finalRule, workerName);
    log("\n" + (ok ? "✓" : "✖") + " Email Routing configured.");
    log("  Summary:");
    log(`    Zone        : ${zone.name}`);
    log(`    Receiving at : anything@${receiveDomain}`);
    log(
      `    Catch-all    : enabled=${finalRule.enabled}, ` +
        `actions=${JSON.stringify(finalRule.actions)}`,
    );
    if (!ok) {
      die("Catch-all is not routing to the Worker — check the output above.");
    }
    log("\n  Note: a catch-all delivers EVERY address at this domain to the app.");
  } else {
    log("\n✓ dry run complete.");
  }
}

main().catch((e) => {
  if (e.cfErrors?.length) die(`Cloudflare API error: ${e.message}`);
  die(e.stack || e.message);
});
