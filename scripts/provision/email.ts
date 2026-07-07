/// <reference types="bun" />
/**
 * Idempotent Email Routing for the `mail.<zone>` subdomain -> the standalone
 * inbox worker (`agentic-inbox-si`).
 *
 * Ports `agentic-inbox`'s `scripts/setup-email-routing.mjs` to the official
 * SDK, with one deliberate change: it targets the MAIL SUBDOMAIN, not the
 * zone apex. Cloudflare's `emailRouting.dns.create({ zone_id, name })` takes
 * an explicit subdomain `name` and provisions MX + SPF records scoped to
 * JUST that name — the apex (`somewhatintelligent.ca`, serving the web app)
 * never gets a Cloudflare-managed MX record and is untouched. That's also
 * why the zone-wide `catch_all` rule is safe to point at the inbox worker
 * here: with no MX record at the apex, nothing routes there through
 * Cloudflare Email Routing, so in effect the catch-all only ever fires for
 * `mail.<zone>` addresses.
 *
 *   ⚠️  That said, a catch-all is still a catch-all for whatever domain DOES
 *       have the MX record: EVERY address at `mail.<zone>` (anything@mail.…)
 *       lands in the inbox worker. Don't reuse mail.<zone> for anything else.
 *
 * What it does (every step find-or-create, safe to re-run):
 *   1. Resolves the zone owning `mail.<zone>` via longest-suffix match
 *      (mirrors the source template's zone lookup) — not hardcoded, so this
 *      also works if the mail host ever moves to its own zone.
 *   2. Ensures Email Routing DNS records exist for the subdomain (checks
 *      real DNS first; only calls the provisioning endpoint if the MX record
 *      for the subdomain doesn't already exist).
 *   3. Ensures the zone catch-all is enabled and forwards to the inbox
 *      worker (resolved from `inbox/wrangler.jsonc` when present, else the
 *      known name `agentic-inbox-si`).
 *
 * Usage:
 *   bun scripts/provision/email.ts --env staging --dry-run
 *   bun scripts/provision/email.ts --env staging
 */
import Cloudflare from "cloudflare";
import {
  accountId,
  cfClient,
  Env,
  envScope,
  findWranglerConfigs,
  findZoneForHost,
  logCreate,
  logDryRun,
  logFound,
  logSkip,
  logUpdate,
  logWarn,
  parseCliArgs,
  zoneName,
  type WorkerConfigFile,
  type ZoneLike,
} from "./lib";

/** Fallback when `inbox/` hasn't landed in this checkout yet (parallel rebrand). */
export const DEFAULT_INBOX_WORKER_NAME = "agentic-inbox-si";

export function mailHost(zone: string = zoneName()): string {
  return `mail.${zone}`;
}

export function resolveInboxWorkerName(configs: WorkerConfigFile[], env: Env): string {
  const inbox = configs.find((c) => c.dir === "inbox");
  if (!inbox) {
    logWarn(
      `inbox/wrangler.jsonc not found in this checkout — using default name "${DEFAULT_INBOX_WORKER_NAME}"`,
    );
    return DEFAULT_INBOX_WORKER_NAME;
  }
  const scope = envScope(inbox.parsed, env);
  return scope?.name ?? inbox.parsed.name ?? DEFAULT_INBOX_WORKER_NAME;
}

async function listAccountZones(cf: Cloudflare, account: string): Promise<ZoneLike[]> {
  const zones: ZoneLike[] = [];
  for await (const z of cf.zones.list({ account: { id: account } })) {
    if (z.id && z.name) zones.push({ id: z.id, name: z.name });
  }
  return zones;
}

async function hasMxRecord(cf: Cloudflare, zoneId: string, host: string): Promise<boolean> {
  for await (const rec of cf.dns.records.list({
    zone_id: zoneId,
    name: { exact: host },
    type: "MX",
  })) {
    return true;
  }
  return false;
}

export async function ensureSubdomainRouting(
  cf: Cloudflare,
  zoneId: string,
  host: string,
  dryRun: boolean,
): Promise<void> {
  const already = await hasMxRecord(cf, zoneId, host);
  if (already) {
    logFound(`Email Routing DNS records for "${host}" already present`);
    return;
  }
  if (dryRun) {
    logDryRun(`would provision Email Routing MX/SPF records for "${host}"`);
    return;
  }
  await cf.emailRouting.dns.create({ zone_id: zoneId, name: host });
  logCreate(`provisioned Email Routing MX/SPF records for "${host}"`);
}

function catchAllRoutesToWorker(
  rule: { enabled?: boolean; actions?: Array<{ type?: string; value?: string[] }> } | undefined,
  worker: string,
): boolean {
  return (
    !!rule?.enabled &&
    (rule.actions ?? []).some((a) => a.type === "worker" && (a.value ?? []).includes(worker))
  );
}

export async function ensureCatchAll(
  cf: Cloudflare,
  zoneId: string,
  worker: string,
  dryRun: boolean,
): Promise<void> {
  const current = await cf.emailRouting.rules.catchAlls.get({ zone_id: zoneId });
  if (catchAllRoutesToWorker(current, worker)) {
    logFound(`catch-all already routes to worker "${worker}"`);
    return;
  }
  if (dryRun) {
    logDryRun(
      `would set catch-all -> worker "${worker}" (currently enabled=${current.enabled}, ` +
        `actions=${JSON.stringify(current.actions)})`,
    );
    return;
  }
  await cf.emailRouting.rules.catchAlls.update({
    zone_id: zoneId,
    enabled: true,
    matchers: [{ type: "all" }],
    actions: [{ type: "worker", value: [worker] }],
    name: `${worker} catch-all`,
  });
  logUpdate(`set catch-all -> worker "${worker}"`);
}

async function main(): Promise<void> {
  const args = parseCliArgs();
  const account = accountId();
  const zone = zoneName();
  const host = mailHost(zone);
  console.log(
    `Provisioning Email Routing for ${host} (env=${args.env})${args.dryRun ? " [dry-run]" : ""}`,
  );

  const cf = cfClient();
  const zones = await listAccountZones(cf, account);
  const matched = findZoneForHost(host, zones);
  if (!matched) {
    throw new Error(
      `No zone found for "${host}" on account ${account}. Add ${zone} to this account first.`,
    );
  }
  console.log(`Zone: ${matched.name} (${matched.id})`);

  console.log("\n→ Ensuring subdomain DNS records…");
  await ensureSubdomainRouting(cf, matched.id, host, args.dryRun);

  const configs = findWranglerConfigs();
  const worker = resolveInboxWorkerName(configs, args.env);
  console.log(`\n→ Ensuring catch-all routes to worker "${worker}"…`);
  await ensureCatchAll(cf, matched.id, worker, args.dryRun);

  console.log(
    `\n✓ Done.\n` +
      `  Receiving at : anything@${host}\n` +
      `  Routed to    : Worker "${worker}"\n` +
      `  ⚠️  A catch-all delivers EVERY address at ${host} to this worker — ` +
      `don't reuse this subdomain for anything else.`,
  );
  if (!configs.some((c) => c.dir === "inbox")) {
    logSkip(
      `inbox/wrangler.jsonc not present yet — worker name "${worker}" is a placeholder default.`,
    );
  }
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(`✗ ${(e as Error).message}`);
    process.exit(1);
  });
}
