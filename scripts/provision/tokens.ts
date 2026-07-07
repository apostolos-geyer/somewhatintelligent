/// <reference types="bun" />
/**
 * Idempotent provisioning of the account-scoped API tokens the rest of this
 * suite (and CI) authenticate with. Mints them from a higher-privileged
 * "master" token (the live `CLOUDFLARE_API_TOKEN`, which must itself have
 * Account API Tokens = Edit so it can create/update other tokens).
 *
 * Tokens minted (find-or-create by NAME — safe to re-run):
 *
 *   si-deploy         Workers Scripts Write, D1 Write, Workers Routes Write,
 *                     DNS Write, SSL and Certificates Write (zone-scoped).
 *                     Lets `wrangler deploy` push code, run D1 migrations,
 *                     AND create the `custom_domain: true` routes this repo's
 *                     wrangler.jsonc files declare (a custom domain needs a
 *                     zone DNS record + an edge cert, which is why DNS Write
 *                     and SSL/Certificates Write are here and not just
 *                     Workers Routes Write).
 *
 *   si-preview        Workers Scripts Write + Account Settings Read only —
 *                     enough for PR-preview deploys (generate-preview-tasks
 *                     / rwx-github-deployment), nothing else.
 *
 *   si-access-admin   Access: Apps and Policies Write, Access: Organizations/
 *                     IdP/Groups Write, Access: Service Tokens Write (for
 *                     access.ts's si-smoke token), Email Routing Rules
 *                     Write, DNS Write, Zone Read — everything access.ts and
 *                     email.ts need and nothing more (deliberately no
 *                     Workers Scripts scope).
 *
 * Secrets are written to `.provision/tokens/<name>.json` (chmod 600, never
 * committed — see .gitignore) ONLY when this run actually has the plaintext
 * value: on first create, or when rolled via `ROLL=1`. Reconciling an
 * existing token's permission groups never exposes its secret (Cloudflare
 * doesn't return it), so the on-disk copy is left alone in that case.
 *
 * Usage:
 *   bun scripts/provision/tokens.ts --dry-run
 *   bun scripts/provision/tokens.ts
 *   ROLL=1 bun scripts/provision/tokens.ts            # rotate every token's secret
 *   ROLL=1 bun scripts/provision/tokens.ts --only=si-deploy
 */
import Cloudflare from "cloudflare";
import {
  accountId,
  buildTokenPolicies,
  cfClient,
  CliError,
  isAuthError,
  logCreate,
  logDryRun,
  logFound,
  logSkip,
  logUpdate,
  parseCliArgs,
  resolvePermissionGroups,
  writeProvisionFile,
  zoneName,
  type PermissionGroup,
  type TokenLike,
} from "./lib";

export interface TokenSpec {
  name: string;
  permissionGroups: string[];
  purpose: string;
}

export const TOKEN_SPECS: TokenSpec[] = [
  {
    name: "si-deploy",
    purpose: "wrangler deploy: push Worker code, run D1 migrations, create custom-domain routes",
    permissionGroups: [
      "Workers Scripts Write",
      "D1 Write",
      "Workers Routes Write",
      "DNS Write",
      "SSL and Certificates Write",
      // `wrangler deploy` VALIDATES bindings against their APIs before upload:
      // R2 buckets (roadie, inbox), Workers AI + send_email (inbox). Without
      // these the deploy 403s on the binding check, not on the upload itself.
      "Workers R2 Storage Write",
      "Workers AI Read",
      "Email Sending Write",
    ],
  },
  {
    name: "si-preview",
    purpose: "PR-preview deploys: push Worker code only",
    permissionGroups: ["Workers Scripts Write", "Account Settings Read"],
  },
  {
    name: "si-access-admin",
    purpose:
      "Zero Trust Access apps/policies/service-tokens + Email Routing + DNS (this provisioning suite)",
    permissionGroups: [
      "Access: Apps and Policies Write",
      "Access: Organizations, Identity Providers, and Groups Write",
      "Access: Service Tokens Write",
      "Email Routing Rules Write",
      "DNS Write",
      "Zone Read",
    ],
  },
];

export function currentGroupIds(token: TokenLike): Set<string> {
  const ids = new Set<string>();
  for (const p of token.policies ?? [])
    for (const g of p.permission_groups ?? []) if (g.id) ids.add(g.id);
  return ids;
}

export function sameGroupSet(wanted: PermissionGroup[], have: Set<string>): boolean {
  if (wanted.length !== have.size) return false;
  return wanted.every((g) => have.has(g.id));
}

async function findTokenByName(cf: Cloudflare, account: string, name: string) {
  for await (const t of cf.accounts.tokens.list({ account_id: account })) {
    if (t.name === name) return t;
  }
  return undefined;
}

async function resolveZoneId(
  cf: Cloudflare,
  account: string,
  zone: string,
): Promise<string | undefined> {
  for await (const z of cf.zones.list({ account: { id: account }, name: zone })) {
    return z.id;
  }
  return undefined;
}

export async function provisionToken(
  cf: Cloudflare,
  account: string,
  zoneId: string | undefined,
  spec: TokenSpec,
  opts: { dryRun: boolean; roll: boolean },
): Promise<void> {
  console.log(`\n-- ${spec.name} — ${spec.purpose}`);
  const resolved = await resolvePermissionGroups(cf, account, spec.permissionGroups);
  console.log(`   scopes: ${resolved.map((g) => g.name).join(", ")}`);
  const policies = buildTokenPolicies(resolved, account, zoneId);

  const existing = await findTokenByName(cf, account, spec.name);

  if (!existing) {
    if (opts.dryRun) {
      logDryRun(`would create token "${spec.name}" and write .provision/tokens/${spec.name}.json`);
      return;
    }
    const created = await cf.accounts.tokens.create({
      account_id: account,
      name: spec.name,
      policies,
    });
    logCreate(`token "${spec.name}" (${created.id})`);
    if (!created.value) throw new Error(`token create for "${spec.name}" returned no secret value`);
    writeProvisionFile(`tokens/${spec.name}.json`, {
      id: created.id,
      name: spec.name,
      value: created.value,
      permissionGroups: resolved.map((g) => g.name),
      mintedAt: new Date().toISOString(),
    });
    return;
  }

  logFound(`token "${spec.name}" (${existing.id})`);
  const wantSame = sameGroupSet(resolved, currentGroupIds(existing));
  if (!wantSame) {
    if (opts.dryRun) {
      logDryRun(
        `would reconcile permission groups on "${spec.name}" to: ${resolved.map((g) => g.name).join(", ")}`,
      );
    } else {
      await cf.accounts.tokens.update(existing.id!, {
        account_id: account,
        name: spec.name,
        policies,
      });
      logUpdate(`reconciled permission groups on "${spec.name}"`);
    }
  } else {
    logSkip(`"${spec.name}" permission groups already match`);
  }

  if (opts.roll) {
    if (opts.dryRun) {
      logDryRun(`would roll secret for "${spec.name}"`);
      return;
    }
    const rolled = await cf.accounts.tokens.value.update(existing.id!, {
      account_id: account,
      body: {},
    });
    const value = typeof rolled === "string" ? rolled : (rolled as { value?: string })?.value;
    if (!value) throw new Error(`roll for "${spec.name}" returned no secret value`);
    writeProvisionFile(`tokens/${spec.name}.json`, {
      id: existing.id,
      name: spec.name,
      value,
      permissionGroups: resolved.map((g) => g.name),
      mintedAt: new Date().toISOString(),
      rolled: true,
    });
    logUpdate(`rolled secret for "${spec.name}" -> .provision/tokens/${spec.name}.json`);
  } else {
    logSkip(`"${spec.name}" secret left untouched (pass ROLL=1 to rotate)`);
  }
}

async function main(): Promise<void> {
  const args = parseCliArgs();
  const roll = process.env.ROLL === "1" || process.env.ROLL === "true";
  const only = args.values.get("only");

  const account = accountId();
  const zone = zoneName();
  console.log(
    `Provisioning API tokens on account ${account}${args.dryRun ? " [dry-run]" : ""}${roll ? " [ROLL]" : ""}`,
  );

  const cf = cfClient();
  let zoneId: string | undefined;
  try {
    zoneId = await resolveZoneId(cf, account, zone);
    if (zoneId) console.log(`Zone "${zone}" -> ${zoneId}`);
    else
      console.log(
        `Zone "${zone}" not found on this account (zone-scoped groups will fail to attach).`,
      );
  } catch (e) {
    if (isAuthError(e)) {
      console.error(`\n✗ Authentication error resolving zone "${zone}": ${(e as Error).message}`);
      process.exit(1);
    }
    throw e;
  }

  const specs = only ? TOKEN_SPECS.filter((s) => s.name === only) : TOKEN_SPECS;
  if (only && specs.length === 0)
    throw new CliError(`--only=${only} does not match any token spec`);

  for (const spec of specs) {
    await provisionToken(cf, account, zoneId, spec, { dryRun: args.dryRun, roll });
  }

  console.log(
    "\nDone. Secrets (when freshly minted/rolled) are under .provision/tokens/*.json (chmod 600).",
  );
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(`✗ ${(e as Error).message}`);
    process.exit(1);
  });
}
