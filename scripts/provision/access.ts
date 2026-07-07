/// <reference types="bun" />
/**
 * Idempotent Cloudflare Zero Trust Access setup, ported from
 * `agentic-inbox/scripts/setup-access.mjs` to the official SDK and extended
 * to cover the whole staging surface + a CI service token.
 *
 * What it does (every step find-or-create, safe to re-run):
 *   1. Resolves the Zero Trust org's `auth_domain` -> TEAM_DOMAIN. Creates an
 *      org ONLY when `TEAM_NAME` is explicitly passed (an org's auth_domain
 *      is permanent once picked, so this is never done implicitly).
 *   2. Find-or-creates a reusable "allow" policy from `ACCESS_EMAILS`
 *      (comma list) and/or `ACCESS_EMAIL_DOMAIN`.
 *   3. Find-or-creates self-hosted Access apps (app_launcher_visible=false,
 *      24h sessions) for:
 *        - staging.<zone>            (the staging portal)
 *        - mail.<zone>                (the inbox's Email Routing subdomain —
 *          it has no HTTP surface today, but gating it costs nothing and
 *          future-proofs any admin UI the inbox worker grows)
 *        - every `*-staging` worker's workers.dev host (resolved from the
 *          account's workers.dev subdomain + config scanning — NOT a
 *          hardcoded fleet list)
 *   4. Find-or-creates an Access SERVICE TOKEN (`si-smoke`) plus a
 *      `non_identity` policy for it, attached to every app above, so CI
 *      smoke tests can pass Access with CF-Access-Client-Id/Secret headers
 *      instead of an interactive login.
 *   5. Reports every app's `aud`. With `--write-secrets`, pushes
 *      POLICY_AUD/TEAM_DOMAIN as Worker secrets for the inbox worker (env-
 *      stripped wrangler, so OAuth is used — never this token); otherwise
 *      prints the values + commands.
 *
 * Usage:
 *   bun scripts/provision/access.ts --dry-run
 *   bun scripts/provision/access.ts
 *   TEAM_NAME=somewhatintelligent bun scripts/provision/access.ts   # only if no org exists yet
 *   bun scripts/provision/access.ts --write-secrets
 *
 * Env vars:
 *   ACCESS_EMAILS         comma-separated allow-listed emails
 *   ACCESS_EMAIL_DOMAIN   allow an entire email domain
 *   TEAM_NAME             create the Zero Trust org if (and only if) none exists
 */
import Cloudflare from "cloudflare";
import {
  accountId,
  cfClient,
  CliError,
  envScope,
  findWranglerConfigs,
  listWorkersDevEnabled,
  logCreate,
  logDryRun,
  logFound,
  logSkip,
  logUpdate,
  parseCliArgs,
  REPO_ROOT,
  writeProvisionFile,
  writeWranglerSecret,
  zoneName,
  type WorkerConfigFile,
} from "./lib";
import { join } from "node:path";

const POLICY_NAME = "si-staff-access";
const SERVICE_AUTH_POLICY_NAME = "si-smoke-service-auth";
const SERVICE_TOKEN_NAME = "si-smoke";
const SESSION_DURATION = "24h";

export interface AccessTarget {
  label: string;
  hostname: string;
}

/** Reads the account's workers.dev subdomain (e.g. "example-account"). */
async function resolveWorkersDevSubdomain(cf: Cloudflare, account: string): Promise<string> {
  const res = await cf.workers.subdomains.get({ account_id: account });
  const subdomain = (res as { subdomain?: string }).subdomain;
  if (!subdomain) throw new Error("Could not resolve the account's workers.dev subdomain.");
  return subdomain;
}

export function buildTargets(
  configs: WorkerConfigFile[],
  zone: string,
  workersDevSubdomain: string,
): AccessTarget[] {
  const targets: AccessTarget[] = [
    { label: "staging portal", hostname: `staging.${zone}` },
    { label: "mail subdomain", hostname: `mail.${zone}` },
  ];
  for (const w of listWorkersDevEnabled(configs)) {
    targets.push({
      label: w.workerName,
      hostname: `${w.workerName}.${workersDevSubdomain}.workers.dev`,
    });
  }
  return targets;
}

// ---------------------------------------------------------------------------
// org / TEAM_DOMAIN
// ---------------------------------------------------------------------------

async function resolveTeamDomain(
  cf: Cloudflare,
  account: string,
  dryRun: boolean,
): Promise<string> {
  let org: { auth_domain?: string } | undefined;
  try {
    org = await cf.zeroTrust.organizations.list({ account_id: account });
  } catch (e) {
    if (e instanceof Cloudflare.APIError && e.status === 400) {
      org = undefined; // no org configured yet
    } else {
      throw e;
    }
  }
  if (org?.auth_domain) {
    logFound(`Zero Trust org (${org.auth_domain})`);
    return org.auth_domain;
  }

  const teamName = (process.env.TEAM_NAME ?? "").trim();
  if (!teamName) {
    throw new CliError(
      "No Zero Trust organization found on this account. Re-run with TEAM_NAME=<unique-slug> to " +
        "create one (it becomes <TEAM_NAME>.cloudflareaccess.com) — this is only ever done when " +
        "explicitly requested, since the auth_domain is permanent once picked.",
    );
  }
  const authDomain = `${teamName}.cloudflareaccess.com`;
  if (dryRun) {
    logDryRun(`would create Zero Trust org with auth_domain ${authDomain}`);
    return authDomain;
  }
  const created = await cf.zeroTrust.organizations.create({
    account_id: account,
    name: teamName,
    auth_domain: authDomain,
  });
  logCreate(`Zero Trust org (${created.auth_domain})`);
  return created.auth_domain!;
}

// ---------------------------------------------------------------------------
// reusable policies
// ---------------------------------------------------------------------------

function describeAllow(emails: string[], emailDomain: string): string {
  const parts: string[] = [];
  if (emails.length) parts.push(emails.join(", "));
  if (emailDomain) parts.push(`*@${emailDomain}`);
  return parts.join(" and ") || "(nothing configured)";
}

async function findPolicyByName(cf: Cloudflare, account: string, name: string) {
  for await (const p of cf.zeroTrust.access.policies.list({ account_id: account })) {
    if (p.name === name) return p;
  }
  return undefined;
}

async function ensureStaffPolicy(
  cf: Cloudflare,
  account: string,
  dryRun: boolean,
): Promise<string> {
  const emails = (process.env.ACCESS_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const emailDomain = (process.env.ACCESS_EMAIL_DOMAIN ?? "").trim();
  const include = [
    ...emails.map((email) => ({ email: { email } })),
    ...(emailDomain ? [{ email_domain: { domain: emailDomain } }] : []),
  ];
  if (include.length === 0) {
    throw new CliError(
      'No allow-list configured. Set ACCESS_EMAILS="you@example.com" and/or ' +
        'ACCESS_EMAIL_DOMAIN="example.com" so the Access policy lets someone in.',
    );
  }

  const existing = await findPolicyByName(cf, account, POLICY_NAME);
  if (existing?.id) {
    logFound(
      `policy "${POLICY_NAME}" allowing ${describeAllow(emails, emailDomain)} (${existing.id})`,
    );
    return existing.id;
  }
  if (dryRun) {
    logDryRun(
      `would create policy "${POLICY_NAME}" allowing ${describeAllow(emails, emailDomain)}`,
    );
    return "<dry-run-policy-id>";
  }
  const created = await cf.zeroTrust.access.policies.create({
    account_id: account,
    decision: "allow",
    name: POLICY_NAME,
    include: include as unknown as Cloudflare.ZeroTrust.Access.PolicyCreateParams["include"],
  });
  logCreate(
    `policy "${POLICY_NAME}" allowing ${describeAllow(emails, emailDomain)} (${created.id})`,
  );
  return created.id!;
}

async function ensureServiceAuthPolicy(
  cf: Cloudflare,
  account: string,
  serviceTokenId: string,
  dryRun: boolean,
): Promise<string> {
  const existing = await findPolicyByName(cf, account, SERVICE_AUTH_POLICY_NAME);
  if (existing?.id) {
    logFound(`policy "${SERVICE_AUTH_POLICY_NAME}" (${existing.id})`);
    return existing.id;
  }
  if (dryRun) {
    logDryRun(
      `would create non_identity policy "${SERVICE_AUTH_POLICY_NAME}" for service token ${serviceTokenId}`,
    );
    return "<dry-run-service-policy-id>";
  }
  const created = await cf.zeroTrust.access.policies.create({
    account_id: account,
    decision: "non_identity",
    name: SERVICE_AUTH_POLICY_NAME,
    include: [
      { service_token: { token_id: serviceTokenId } },
    ] as unknown as Cloudflare.ZeroTrust.Access.PolicyCreateParams["include"],
  });
  logCreate(`policy "${SERVICE_AUTH_POLICY_NAME}" (${created.id})`);
  return created.id!;
}

// ---------------------------------------------------------------------------
// service token
// ---------------------------------------------------------------------------

async function ensureServiceToken(
  cf: Cloudflare,
  account: string,
  dryRun: boolean,
): Promise<string> {
  for await (const t of cf.zeroTrust.access.serviceTokens.list({ account_id: account })) {
    if (t.name === SERVICE_TOKEN_NAME && t.id) {
      logFound(`service token "${SERVICE_TOKEN_NAME}" (${t.id})`);
      return t.id;
    }
  }
  if (dryRun) {
    logDryRun(`would create service token "${SERVICE_TOKEN_NAME}"`);
    return "<dry-run-service-token-id>";
  }
  const created = await cf.zeroTrust.access.serviceTokens.create({
    account_id: account,
    name: SERVICE_TOKEN_NAME,
  });
  if (!created.id || !created.client_id || !created.client_secret) {
    throw new Error("service token create returned an incomplete response");
  }
  logCreate(`service token "${SERVICE_TOKEN_NAME}" (${created.id})`);
  writeProvisionFile("access/si-smoke.json", {
    id: created.id,
    name: SERVICE_TOKEN_NAME,
    clientId: created.client_id,
    clientSecret: created.client_secret,
    mintedAt: new Date().toISOString(),
  });
  logCreate("wrote .provision/access/si-smoke.json (chmod 600)");
  return created.id;
}

// ---------------------------------------------------------------------------
// apps
// ---------------------------------------------------------------------------

function appDomain(app: unknown): string | undefined {
  return (app as { domain?: string }).domain;
}
function appPolicyIds(app: unknown): string[] {
  const policies = (app as { policies?: Array<string | { id?: string }> }).policies ?? [];
  return policies.map((p) => (typeof p === "string" ? p : (p.id ?? ""))).filter(Boolean);
}

export interface AccessAppResult {
  target: AccessTarget;
  id: string;
  aud: string;
}

async function ensureApp(
  cf: Cloudflare,
  account: string,
  target: AccessTarget,
  staffPolicyId: string,
  servicePolicyId: string,
  dryRun: boolean,
): Promise<AccessAppResult> {
  let existing: { id?: string; aud?: string } | undefined;
  for await (const app of cf.zeroTrust.access.applications.list({ account_id: account })) {
    if (appDomain(app) === target.hostname) {
      existing = app as { id?: string; aud?: string };
      break;
    }
  }

  const wantedPolicyIds = [staffPolicyId, servicePolicyId];

  if (existing?.id) {
    logFound(`Access app for "${target.hostname}" (${existing.id})`);
    const havePolicyIds = appPolicyIds(existing);
    const missing = wantedPolicyIds.filter((id) => !havePolicyIds.includes(id));
    if (missing.length) {
      if (dryRun) {
        logDryRun(
          `would attach polic${missing.length > 1 ? "ies" : "y"} ${missing.join(", ")} to "${target.hostname}"`,
        );
      } else {
        await cf.zeroTrust.access.applications.update(existing.id, {
          account_id: account,
          domain: target.hostname,
          type: "self_hosted",
          session_duration: SESSION_DURATION,
          policies: [...havePolicyIds, ...missing],
        } as unknown as Cloudflare.ZeroTrust.Access.ApplicationUpdateParams);
        logUpdate(`attached polic${missing.length > 1 ? "ies" : "y"} to "${target.hostname}"`);
      }
    } else {
      logSkip(`"${target.hostname}" already has both policies attached`);
    }
    return { target, id: existing.id, aud: existing.aud ?? "<unknown-aud>" };
  }

  if (dryRun) {
    logDryRun(`would create self-hosted Access app for "${target.hostname}"`);
    return { target, id: "<dry-run-app-id>", aud: "<dry-run-aud>" };
  }

  const created = await cf.zeroTrust.access.applications.create({
    account_id: account,
    domain: target.hostname,
    type: "self_hosted",
    name: `${target.label} (${target.hostname})`,
    app_launcher_visible: false,
    session_duration: SESSION_DURATION,
    policies: wantedPolicyIds,
  } as unknown as Cloudflare.ZeroTrust.Access.ApplicationCreateParams);
  const createdTyped = created as unknown as { id?: string; aud?: string };
  if (!createdTyped.id)
    throw new Error(`Access app create for "${target.hostname}" returned no id`);
  logCreate(`Access app for "${target.hostname}" (${createdTyped.id})`);
  return { target, id: createdTyped.id, aud: createdTyped.aud ?? "<unknown-aud>" };
}

// ---------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseCliArgs();
  const account = accountId();
  const zone = zoneName();
  console.log(
    `Provisioning Zero Trust Access on account ${account}${args.dryRun ? " [dry-run]" : ""}`,
  );

  const cf = cfClient();

  console.log("\n→ Resolving team domain…");
  const teamDomain = await resolveTeamDomain(cf, account, args.dryRun);
  console.log(`  TEAM_DOMAIN: ${teamDomain}`);

  console.log("\n→ Resolving workers.dev subdomain…");
  const workersDevSubdomain = await resolveWorkersDevSubdomain(cf, account);
  console.log(`  *.${workersDevSubdomain}.workers.dev`);

  const configs = findWranglerConfigs();
  const targets = buildTargets(configs, zone, workersDevSubdomain);
  console.log(`\nTargets (${targets.length}): ${targets.map((t) => t.hostname).join(", ")}`);

  console.log("\n→ Ensuring staff allow-list policy…");
  const staffPolicyId = await ensureStaffPolicy(cf, account, args.dryRun);

  console.log("\n→ Ensuring si-smoke service token + service-auth policy…");
  const serviceTokenId = await ensureServiceToken(cf, account, args.dryRun);
  const servicePolicyId = await ensureServiceAuthPolicy(cf, account, serviceTokenId, args.dryRun);

  console.log("\n→ Ensuring Access apps…");
  const results: AccessAppResult[] = [];
  for (const target of targets) {
    results.push(await ensureApp(cf, account, target, staffPolicyId, servicePolicyId, args.dryRun));
  }

  console.log("\nSummary:");
  for (const r of results) console.log(`  ${r.target.hostname} -> aud ${r.aud}`);

  // Wire POLICY_AUD/TEAM_DOMAIN for the inbox worker, once it exists and has
  // its own workers.dev host among the targets above.
  const inboxCfg = configs.find((c) => c.dir === "inbox");
  const inboxWorkerName = inboxCfg
    ? (envScope(inboxCfg.parsed, "staging")?.name ?? inboxCfg.parsed.name)
    : undefined;
  const inboxResult = inboxWorkerName
    ? results.find((r) => r.target.label === inboxWorkerName)
    : undefined;

  if (!inboxCfg || !inboxResult) {
    console.log(
      `\ninbox/ not present (or has no workers.dev host) in this checkout yet — once it ships, ` +
        `re-run this script and it'll pick up its Access app automatically. For now:\n` +
        `  TEAM_DOMAIN=${teamDomain}\n` +
        `  POLICY_AUD=<the inbox worker's Access app aud, once created>`,
    );
    return;
  }

  const inboxDir = join(REPO_ROOT, "inbox");
  if (args.writeSecrets) {
    writeWranglerSecret({
      cwd: inboxDir,
      name: "POLICY_AUD",
      value: inboxResult.aud,
      dryRun: args.dryRun,
    });
    writeWranglerSecret({
      cwd: inboxDir,
      name: "TEAM_DOMAIN",
      value: teamDomain,
      dryRun: args.dryRun,
    });
  } else {
    console.log(
      `\nNext step (pass --write-secrets to run these automatically):\n` +
        `  cd inbox\n` +
        `  printf %s "${inboxResult.aud}" | bunx wrangler secret put POLICY_AUD\n` +
        `  printf %s "${teamDomain}" | bunx wrangler secret put TEAM_DOMAIN`,
    );
  }
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(`✗ ${(e as Error).message}`);
    process.exit(1);
  });
}
