/// <reference types="bun" />
/**
 * Idempotent D1 database provisioning.
 *
 * For every `d1_databases` entry found by scanning `workers/*​/wrangler.jsonc`
 * (+ `inbox/wrangler.jsonc`) for the selected `--env`:
 *   1. find-or-create the database by `database_name` (Cloudflare has no
 *      "rename" — name is the stable identity we key on);
 *   2. backfill the real `database_id` into that worker's checked-in
 *      wrangler.jsonc IN PLACE, preserving every comment/format choice
 *      (see lib.ts's `backfillDatabaseId` — a targeted string replace inside
 *      just that JSON object, not a reserialize);
 *   3. print a diff summary (old id -> new id, or "unchanged").
 *
 * Never deletes a database. Re-running is a no-op once ids are backfilled.
 *
 * Usage:
 *   bun scripts/provision/d1.ts --env staging --dry-run
 *   bun scripts/provision/d1.ts --env staging
 *   bun scripts/provision/d1.ts --env production
 */
import { writeFileSync } from "node:fs";
import Cloudflare from "cloudflare";
import {
  accountId,
  backfillDatabaseId,
  cfClient,
  envScope,
  findWranglerConfigs,
  logCreate,
  logDryRun,
  logFound,
  logSkip,
  logUpdate,
  parseCliArgs,
  PLACEHOLDER_UUID,
  type WorkerConfigFile,
} from "./lib";

async function findDatabaseByName(cf: Cloudflare, account: string, name: string) {
  for await (const db of cf.d1.database.list({ account_id: account, name })) {
    if (db.name === name) return db;
  }
  return undefined;
}

export interface D1ProvisionOutcome {
  workerDir: string;
  databaseName: string;
  databaseId: string;
  created: boolean;
  backfilled: boolean;
  previousId?: string;
}

export async function provisionD1(
  cf: Cloudflare,
  account: string,
  configs: WorkerConfigFile[],
  env: "staging" | "production",
  dryRun: boolean,
): Promise<D1ProvisionOutcome[]> {
  const outcomes: D1ProvisionOutcome[] = [];

  for (const cfg of configs) {
    const scope = envScope(cfg.parsed, env);
    if (!scope?.d1_databases?.length) continue;

    let raw = cfg.raw;
    let fileChanged = false;

    for (const d1 of scope.d1_databases) {
      const label = `D1 "${d1.database_name}" (${cfg.dir}, binding ${d1.binding ?? "DB"})`;
      const existing = await findDatabaseByName(cf, account, d1.database_name);

      let databaseId: string;
      let created = false;
      if (existing?.uuid) {
        logFound(`${label} -> ${existing.uuid}`);
        databaseId = existing.uuid;
      } else if (dryRun) {
        logDryRun(`would create ${label}`);
        databaseId = "<dry-run-database-id>";
      } else {
        const createdDb = await cf.d1.database.create({
          account_id: account,
          name: d1.database_name,
        });
        if (!createdDb.uuid)
          throw new Error(`D1 create for "${d1.database_name}" returned no uuid`);
        logCreate(`${label} -> ${createdDb.uuid}`);
        databaseId = createdDb.uuid;
        created = true;
      }

      const needsBackfill =
        !dryRun &&
        databaseId !== "<dry-run-database-id>" &&
        (d1.database_id === undefined ||
          d1.database_id === PLACEHOLDER_UUID ||
          d1.database_id !== databaseId);

      if (needsBackfill) {
        const result = backfillDatabaseId(raw, d1.database_name, databaseId);
        if (result.changed) {
          raw = result.raw;
          fileChanged = true;
          logUpdate(
            `backfilled database_id for "${d1.database_name}" in ${cfg.dir}/wrangler.jsonc: ` +
              `${result.oldValue || "(missing)"} -> ${databaseId}`,
          );
        }
      } else if (dryRun && (d1.database_id === undefined || d1.database_id === PLACEHOLDER_UUID)) {
        logDryRun(
          `would backfill database_id for "${d1.database_name}" in ${cfg.dir}/wrangler.jsonc ` +
            `(currently ${d1.database_id ?? "(missing)"})`,
        );
      } else {
        logSkip(`database_id for "${d1.database_name}" already up to date (${d1.database_id})`);
      }

      outcomes.push({
        workerDir: cfg.dir,
        databaseName: d1.database_name,
        databaseId,
        created,
        backfilled: needsBackfill,
        previousId: d1.database_id,
      });
    }

    if (fileChanged) {
      writeFileSync(cfg.path, raw);
      logUpdate(`wrote ${cfg.dir}/wrangler.jsonc`);
    }
  }

  return outcomes;
}

async function main(): Promise<void> {
  const args = parseCliArgs();
  const account = accountId();
  console.log(
    `Provisioning D1 databases for env=${args.env} on account ${account}${args.dryRun ? " [dry-run]" : ""}`,
  );

  const configs = findWranglerConfigs();
  const cf = cfClient();
  const outcomes = await provisionD1(cf, account, configs, args.env, args.dryRun);

  if (outcomes.length === 0) {
    console.log("No d1_databases entries found for this env.");
    return;
  }

  console.log("\nSummary:");
  for (const o of outcomes) {
    const change = o.created
      ? "created"
      : o.backfilled
        ? `backfilled (${o.previousId || "(missing)"} -> ${o.databaseId})`
        : "unchanged";
    console.log(`  ${o.workerDir}: ${o.databaseName} -> ${o.databaseId} [${change}]`);
  }
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(`✗ ${(e as Error).message}`);
    process.exit(1);
  });
}
