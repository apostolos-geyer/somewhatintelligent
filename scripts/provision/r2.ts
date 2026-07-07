/// <reference types="bun" />
/**
 * Idempotent R2 provisioning: buckets, CORS, and the Roadie S3 keypair.
 *
 * 1. Find-or-create every `r2_buckets` entry found by scanning
 *    `workers/*​/wrangler.jsonc` (+ `inbox/wrangler.jsonc`) for `--env` — today
 *    that's roadie's `BLOBS` bucket; `inbox`'s bucket joins automatically
 *    once that worker lands, no script change needed.
 * 2. Apply the canonical CORS policy to each bucket found (mirrors
 *    `workers/roadie/scripts/setup-cors.ts`): presigned browser-direct
 *    PUT/GET/HEAD from the environment's portal origin(s).
 * 3. For the roadie worker specifically: mint (or reuse) an account-owned R2
 *    read+write token and derive the S3-compatible keypair roadie's
 *    `sign.ts` needs — Access Key ID = token id, Secret Access Key =
 *    SHA-256 hex of the token value (Cloudflare's documented derivation;
 *    see docs/runbooks/roadie-r2-provisioning.md).
 *    Prints `wrangler secret put` instructions by default; pass
 *    `--write-secrets` to run them (env-stripped, so wrangler's own OAuth
 *    login is used, never this suite's API token).
 *
 * Never deletes a bucket. Re-running is a no-op once the keypair + CORS are
 * in place (pass `ROLL=1` to rotate the roadie R2 keypair).
 *
 * Usage:
 *   bun scripts/provision/r2.ts --env staging --dry-run
 *   bun scripts/provision/r2.ts --env staging
 *   bun scripts/provision/r2.ts --env production --write-secrets
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import Cloudflare from "cloudflare";
import {
  accountId,
  cfClient,
  corsOriginsForEnv,
  Env,
  findWranglerConfigs,
  listR2Entries,
  logCreate,
  logDryRun,
  logFound,
  logSkip,
  logUpdate,
  logWarn,
  parseCliArgs,
  PROVISION_DIR,
  readProvisionFile,
  REPO_ROOT,
  resolvePermissionGroups,
  writeProvisionFile,
  writeWranglerSecret,
  type R2Entry,
  type TokenLike,
} from "./lib";

async function findBucketByName(cf: Cloudflare, account: string, name: string) {
  const page = await cf.r2.buckets.list({ account_id: account, name_contains: name });
  return page.buckets?.find((b) => b.name === name);
}

export async function ensureBucket(
  cf: Cloudflare,
  account: string,
  entry: R2Entry,
  dryRun: boolean,
): Promise<{ created: boolean }> {
  const label = `R2 bucket "${entry.bucketName}" (${entry.workerDir}, binding ${entry.binding})`;
  const existing = await findBucketByName(cf, account, entry.bucketName);
  if (existing) {
    logFound(label);
    return { created: false };
  }
  if (dryRun) {
    logDryRun(`would create ${label}`);
    return { created: false };
  }
  await cf.r2.buckets.create({ account_id: account, name: entry.bucketName });
  logCreate(label);
  return { created: true };
}

export async function ensureCors(
  cf: Cloudflare,
  account: string,
  bucketName: string,
  origins: string[],
  dryRun: boolean,
): Promise<void> {
  const wantedRules = [
    {
      allowed: {
        origins,
        methods: ["GET", "PUT", "HEAD"] as Array<"GET" | "PUT" | "HEAD">,
        headers: [
          "Content-Type",
          "Content-Length",
          "x-amz-content-sha256",
          "x-amz-checksum-sha256",
        ],
      },
      exposeHeaders: ["ETag"],
      maxAgeSeconds: 3600,
    },
  ];

  let current: string | undefined;
  try {
    const existing = await cf.r2.buckets.cors.get(bucketName, { account_id: account });
    current = JSON.stringify(existing.rules?.[0]?.allowed?.origins?.slice().sort() ?? []);
  } catch {
    current = undefined; // no CORS policy yet
  }
  const wanted = JSON.stringify([...origins].sort());

  if (current === wanted) {
    logSkip(`CORS for "${bucketName}" already matches (${origins.join(", ")})`);
    return;
  }
  if (dryRun) {
    logDryRun(`would set CORS for "${bucketName}" -> origins: ${origins.join(", ")}`);
    return;
  }
  await cf.r2.buckets.cors.update(bucketName, { account_id: account, rules: wantedRules });
  logUpdate(`set CORS for "${bucketName}" -> origins: ${origins.join(", ")}`);
}

/**
 * Mints (or reuses) the account-owned R2 read+write token for roadie's S3
 * keypair, one per environment so staging/production rotate independently.
 * Only writes a NEW secret file when this run actually has the plaintext —
 * a pre-existing remote token with no local secret file cannot be recovered
 * (Cloudflare never returns a token's value again) and needs `ROLL=1`.
 */
export async function ensureRoadieS3Keypair(
  cf: Cloudflare,
  account: string,
  env: Env,
  opts: { dryRun: boolean; roll: boolean; writeSecrets: boolean },
): Promise<void> {
  const tokenName = `si-roadie-${env}-r2`;
  const secretRelPath = `r2/${env}-s3-keys.json`;
  console.log(`\n-- Roadie S3 keypair (${env}) — token "${tokenName}"`);

  const groups = await resolvePermissionGroups(cf, account, [
    "Workers R2 Storage Write",
    "Workers R2 Storage Read",
  ]);
  const policies = [
    {
      effect: "allow" as const,
      permission_groups: groups.map((g) => ({ id: g.id })),
      resources: { [`com.cloudflare.api.account.${account}`]: "*" },
    },
  ];

  let existing: TokenLike | undefined;
  for await (const t of cf.accounts.tokens.list({ account_id: account })) {
    if (t.name === tokenName) {
      existing = t;
      break;
    }
  }

  let tokenId: string | undefined = existing?.id;
  let value: string | undefined;

  if (!existing) {
    if (opts.dryRun) {
      logDryRun(`would create token "${tokenName}" for the roadie S3 keypair`);
    } else {
      const created = await cf.accounts.tokens.create({
        account_id: account,
        name: tokenName,
        policies,
      });
      logCreate(`token "${tokenName}" (${created.id})`);
      tokenId = created.id;
      value = created.value;
    }
  } else {
    logFound(`token "${tokenName}" (${existing.id})`);
    if (opts.roll) {
      if (opts.dryRun) {
        logDryRun(`would roll secret for "${tokenName}"`);
      } else {
        const rolled = await cf.accounts.tokens.value.update(existing.id!, {
          account_id: account,
          body: {},
        });
        value = typeof rolled === "string" ? rolled : (rolled as { value?: string })?.value;
        if (!value) throw new Error(`roll for "${tokenName}" returned no secret value`);
        logUpdate(`rolled secret for "${tokenName}"`);
      }
    } else if (!readProvisionFile(secretRelPath)) {
      logWarn(
        `"${tokenName}" exists remotely but ${join(".provision", secretRelPath)} is missing locally — ` +
          `re-run with ROLL=1 to rotate it (the old secret is unrecoverable).`,
      );
    } else {
      logSkip(`"${tokenName}" secret left untouched (pass ROLL=1 to rotate)`);
    }
  }

  if (value && tokenId) {
    const accessKeyId = tokenId;
    const secretAccessKey = createHash("sha256").update(value).digest("hex");
    writeProvisionFile(secretRelPath, {
      env,
      tokenId,
      accessKeyId,
      secretAccessKey,
      mintedAt: new Date().toISOString(),
    });
    logCreate(`wrote ${join(".provision", secretRelPath)} (chmod 600)`);
  }

  // Emit (or run) the wrangler secret puts regardless of whether this run
  // freshly minted the keypair — re-running should always be able to push
  // an already-on-disk keypair to wrangler.
  const stored = value
    ? { accessKeyId: tokenId!, secretAccessKey: createHash("sha256").update(value).digest("hex") }
    : parseStoredKeys(readProvisionFile(secretRelPath));

  const roadieDir = join(REPO_ROOT, "workers", "roadie");
  if (!existsSync(roadieDir)) {
    logWarn(
      "workers/roadie not found — skipping wrangler secret put (no roadie worker in this checkout)",
    );
    return;
  }
  const wranglerEnv = env === "production" ? "production" : undefined;

  if (!stored) {
    console.log(
      `  (no keypair available locally yet — run this script without --dry-run first, or with ROLL=1)`,
    );
    return;
  }

  if (opts.writeSecrets) {
    writeWranglerSecret({
      cwd: roadieDir,
      name: "S3_ACCESS_KEY_ID",
      value: stored.accessKeyId,
      wranglerEnv,
      dryRun: opts.dryRun,
    });
    writeWranglerSecret({
      cwd: roadieDir,
      name: "S3_SECRET_ACCESS_KEY",
      value: stored.secretAccessKey,
      wranglerEnv,
      dryRun: opts.dryRun,
    });
  } else {
    const envFlag = wranglerEnv ? ` --env ${wranglerEnv}` : "";
    console.log(
      `  Next step (pass --write-secrets to run these automatically):\n` +
        `    cd workers/roadie\n` +
        `    printf %s "<accessKeyId>" | bunx wrangler secret put S3_ACCESS_KEY_ID${envFlag}\n` +
        `    printf %s "<secretAccessKey>" | bunx wrangler secret put S3_SECRET_ACCESS_KEY${envFlag}\n` +
        `  (values are in .provision/${secretRelPath})`,
    );
  }
}

function parseStoredKeys(
  raw: string | undefined,
): { accessKeyId: string; secretAccessKey: string } | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (parsed.accessKeyId && parsed.secretAccessKey) return parsed;
  } catch {
    // fall through
  }
  return undefined;
}

async function main(): Promise<void> {
  const args = parseCliArgs();
  const roll = process.env.ROLL === "1" || process.env.ROLL === "true";
  const account = accountId();
  console.log(
    `Provisioning R2 for env=${args.env} on account ${account}${args.dryRun ? " [dry-run]" : ""}${roll ? " [ROLL]" : ""}`,
  );

  const configs = findWranglerConfigs();
  const entries = listR2Entries(configs, args.env);
  const cf = cfClient();

  if (entries.length === 0) {
    console.log("No r2_buckets entries found for this env.");
  }

  const origins = corsOriginsForEnv(args.env);
  console.log(`CORS origins for ${args.env}: ${origins.join(", ")}`);

  for (const entry of entries) {
    await ensureBucket(cf, account, entry, args.dryRun);
    await ensureCors(cf, account, entry.bucketName, origins, args.dryRun);
  }

  const hasRoadie = configs.some((c) => c.dir.toLowerCase().endsWith("roadie"));
  if (hasRoadie) {
    await ensureRoadieS3Keypair(cf, account, args.env, {
      dryRun: args.dryRun,
      roll,
      writeSecrets: args.writeSecrets,
    });
  }

  console.log(
    `\nDone. Secrets (when minted) are under ${PROVISION_DIR.replace(REPO_ROOT + "/", "")}/r2/*.json.`,
  );
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(`✗ ${(e as Error).message}`);
    process.exit(1);
  });
}
