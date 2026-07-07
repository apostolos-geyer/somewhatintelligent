/// <reference types="bun" />
/**
 * Shared utilities for `scripts/provision/*.ts` — the idempotent Cloudflare
 * provisioning suite for this fork's account. See `docs/ops/provisioning.md`
 * for the runbook; each script is a thin composition of the helpers here.
 *
 * Design notes:
 *  - Every mutating helper checks `dryRun` itself (or the caller checks
 *    before calling it) so a `--dry-run` pass NEVER issues a write call.
 *  - Nothing here hardcodes the worker fleet — `findWranglerConfigs` scans
 *    `workers/* /wrangler.jsonc` (+ `inbox/wrangler.jsonc` if present) at
 *    runtime, so a new worker (e.g. the `si-store-*` pair, or `inbox/`
 *    landing later from the parallel rebrand) is picked up automatically.
 *  - The account id / zone name below are this fork's stable infra identity
 *    (given in `docs/ops/provisioning.md`), not fleet data — they're the one
 *    thing that's safe to default here. Override via env for a different
 *    account/zone entirely.
 */
import Cloudflare from "cloudflare";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type Env = "staging" | "production";

/** "Apostoli.geyer@geyerconsulting.com's Account" — this fork's Cloudflare account. */
export const DEFAULT_ACCOUNT_ID = "c735c5a53d864bee37400befb7f4c7f4";
/** The one zone this fork provisions DNS/Access/Email against. */
export const DEFAULT_ZONE_NAME = "somewhatintelligent.ca";

/** Repo root, resolved from this file's location (scripts/provision/lib.ts). */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Where minted secrets / service-token credentials land. Gitignored, chmod 600 per file. */
export const PROVISION_DIR = join(REPO_ROOT, ".provision");

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

export interface CliArgs {
  env: Env;
  dryRun: boolean;
  writeSecrets: boolean;
  flags: Set<string>;
  values: Map<string, string>;
}

/**
 * Parses `--flag`, `--key=value`, and `--key value` style args. Recognizes
 * `--dry-run`, `--env=staging|production` (default staging), and
 * `--write-secrets` up front; everything else is available via
 * `flags`/`values` for script-specific options.
 */
export function parseCliArgs(argv: string[] = process.argv.slice(2)): CliArgs {
  const flags = new Set<string>();
  const values = new Map<string, string>();

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("--")) continue;
    const body = arg.slice(2);
    const eq = body.indexOf("=");
    if (eq !== -1) {
      values.set(body.slice(0, eq), body.slice(eq + 1));
      continue;
    }
    // `--key value` only when the next token isn't itself a flag.
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--") && KNOWN_VALUE_FLAGS.has(body)) {
      values.set(body, next);
      i++;
      continue;
    }
    flags.add(body);
  }

  const envValue = values.get("env") ?? "staging";
  if (envValue !== "staging" && envValue !== "production") {
    throw new CliError(`--env must be "staging" or "production" (got "${envValue}")`);
  }

  return {
    env: envValue,
    dryRun: flags.has("dry-run"),
    writeSecrets: flags.has("write-secrets"),
    flags,
    values,
  };
}

/** Flags that take a value as a separate argv token (`--env staging`, not just `--env=staging`). */
const KNOWN_VALUE_FLAGS = new Set([
  "env",
  "webhook-url",
  "team-name",
  "count",
  "prefix",
  "url",
  "app-name",
  "only",
  "client-id",
  "client-secret",
]);

export class CliError extends Error {}

// ---------------------------------------------------------------------------
// logging
// ---------------------------------------------------------------------------

type ActionKind = "found" | "create" | "update" | "dry-run" | "skip" | "warn";

const ACTION_PREFIX: Record<ActionKind, string> = {
  found: "[found]",
  create: "[create]",
  update: "[update]",
  "dry-run": "[dry-run]",
  skip: "[skip]",
  warn: "[warn]",
};

export function logAction(kind: ActionKind, msg: string): void {
  const line = `${ACTION_PREFIX[kind]} ${msg}`;
  if (kind === "warn") console.warn(line);
  else console.log(line);
}

export const logFound = (msg: string) => logAction("found", msg);
export const logCreate = (msg: string) => logAction("create", msg);
export const logUpdate = (msg: string) => logAction("update", msg);
export const logDryRun = (msg: string) => logAction("dry-run", msg);
export const logSkip = (msg: string) => logAction("skip", msg);
export const logWarn = (msg: string) => logAction("warn", msg);

// ---------------------------------------------------------------------------
// Cloudflare client
// ---------------------------------------------------------------------------

export function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new CliError(`${name} is required (see docs/ops/provisioning.md).`);
  return v;
}

/** The account this run targets — `CLOUDFLARE_ACCOUNT_ID` env, else the fork default. */
export function accountId(): string {
  return process.env.CLOUDFLARE_ACCOUNT_ID ?? DEFAULT_ACCOUNT_ID;
}

/** The zone this run targets — `CLOUDFLARE_ZONE_NAME` env, else the fork default. */
export function zoneName(): string {
  return process.env.CLOUDFLARE_ZONE_NAME ?? DEFAULT_ZONE_NAME;
}

/**
 * One SDK client per process, authenticated from `CLOUDFLARE_API_TOKEN`
 * (falling back to `CLOUDFLARE_API_KEY` for parity with the RealtimeKit
 * provisioner). Every resource call below takes `account_id`/`zone_id` as an
 * explicit param — nothing is implicitly scoped by the client itself.
 */
export function cfClient(): Cloudflare {
  const token = process.env.CLOUDFLARE_API_TOKEN ?? process.env.CLOUDFLARE_API_KEY;
  if (!token) {
    throw new CliError(
      "Set CLOUDFLARE_API_TOKEN (or CLOUDFLARE_API_KEY) — see docs/ops/provisioning.md for the " +
        "permission sets each script needs.",
    );
  }
  return new Cloudflare({ apiToken: token });
}

/** True when a thrown SDK error means the token is unauthenticated/unauthorized. */
export function isAuthError(e: unknown): boolean {
  return (
    e instanceof Cloudflare.AuthenticationError || e instanceof Cloudflare.PermissionDeniedError
  );
}

// ---------------------------------------------------------------------------
// find-or-create
// ---------------------------------------------------------------------------

export interface FindOrCreateResult<T> {
  item: T;
  created: boolean;
}

/**
 * Generic idempotent find-or-create: look up `existing` by name/predicate; if
 * present, log `[found]` and return it untouched. If absent:
 *  - `--dry-run`: log `[dry-run]` and return `dryRunValue` (a placeholder,
 *    never a real API response) — no write call is made.
 *  - otherwise: call `create()`, log `[create]`, and return the result.
 *
 * Callers own the "is this an update, not just a create" question (e.g.
 * reconciling a token's permission groups) — this helper only covers the
 * existence branch, which is identical across tokens/D1/R2/Access apps/etc.
 */
export async function findOrCreate<T>(opts: {
  label: string;
  existing: T | undefined | null;
  dryRun: boolean;
  create: () => Promise<T>;
  dryRunValue: T;
  describe?: (item: T) => string;
}): Promise<FindOrCreateResult<T>> {
  const { label, existing, dryRun, create, dryRunValue, describe } = opts;
  if (existing) {
    logFound(`${label}${describe ? ` (${describe(existing)})` : ""}`);
    return { item: existing, created: false };
  }
  if (dryRun) {
    logDryRun(`would create ${label}`);
    return { item: dryRunValue, created: false };
  }
  const created = await create();
  logCreate(`${label}${describe ? ` (${describe(created)})` : ""}`);
  return { item: created, created: true };
}

// ---------------------------------------------------------------------------
// permission groups
// ---------------------------------------------------------------------------

/**
 * Structural shape of an Account Owned API token as returned by the SDK
 * (`cf.accounts.tokens.list`/`.create`) — declared locally rather than
 * imported from `cloudflare/resources/shared` because that module isn't
 * re-exported through the top-level `Cloudflare` namespace.
 */
export interface TokenLike {
  id?: string;
  name?: string;
  value?: string;
  policies?: Array<{ permission_groups?: Array<{ id?: string }> }>;
}

export interface PermissionGroup {
  id: string;
  name: string;
  scopes: string[];
}

/** True when a permission group applies to a zone resource rather than the account itself. */
export function isZoneScoped(group: PermissionGroup): boolean {
  return group.scopes.some((s) => s.includes("account.zone"));
}

/**
 * Resolves permission-group NAMEs (readable, e.g. "D1 Write") to their ids by
 * fetching the account's full permission-group catalog once. Throws on any
 * unresolvable name — a token minted with a silently-dropped permission is a
 * worse failure mode than a loud one at provision time.
 */
export interface PermissionGroupResolution {
  resolved: PermissionGroup[];
  missing: string[];
}

/**
 * Pure name->group mapping, split out from `resolvePermissionGroups` so the
 * matching logic (first-wins on duplicate names, exact-name-only matching)
 * is unit-testable without a network call.
 */
export function mapPermissionGroupsByName(
  all: PermissionGroup[],
  names: string[],
): PermissionGroupResolution {
  const byName = new Map<string, PermissionGroup>();
  for (const g of all) if (!byName.has(g.name)) byName.set(g.name, g);

  const resolved: PermissionGroup[] = [];
  const missing: string[] = [];
  for (const name of names) {
    const g = byName.get(name);
    if (g) resolved.push(g);
    else missing.push(name);
  }
  return { resolved, missing };
}

/**
 * Resolves permission-group NAMEs (readable, e.g. "D1 Write") to their ids by
 * fetching the account's full permission-group catalog once. Throws on any
 * unresolvable name — a token minted with a silently-dropped permission is a
 * worse failure mode than a loud one at provision time.
 */
export async function resolvePermissionGroups(
  cf: Cloudflare,
  account: string,
  names: string[],
): Promise<PermissionGroup[]> {
  const all: PermissionGroup[] = [];
  for await (const g of cf.accounts.tokens.permissionGroups.list({ account_id: account })) {
    if (g.id && g.name) all.push({ id: g.id, name: g.name, scopes: (g.scopes as string[]) ?? [] });
  }
  const { resolved, missing } = mapPermissionGroupsByName(all, names);
  if (missing.length) {
    throw new CliError(
      `Permission group(s) not found: ${missing.map((n) => `"${n}"`).join(", ")}. ` +
        `Run with --dry-run to print the full catalog, or check the exact name in the dashboard.`,
    );
  }
  return resolved;
}

/**
 * Splits resolved permission groups into an account-scoped policy and a
 * zone-scoped policy (Cloudflare tokens require the resource type to match
 * the group's scope — you cannot put a zone-scoped group under an account
 * resource or vice versa). Returns only the policies that have groups.
 */
export function buildTokenPolicies(
  groups: PermissionGroup[],
  account: string,
  zone: string | undefined,
): Array<{
  effect: "allow";
  permission_groups: Array<{ id: string }>;
  resources: Record<string, string>;
}> {
  const accountGroups = groups.filter((g) => !isZoneScoped(g));
  const zoneGroups = groups.filter((g) => isZoneScoped(g));

  const policies: Array<{
    effect: "allow";
    permission_groups: Array<{ id: string }>;
    resources: Record<string, string>;
  }> = [];

  if (accountGroups.length) {
    policies.push({
      effect: "allow",
      permission_groups: accountGroups.map((g) => ({ id: g.id })),
      resources: { [`com.cloudflare.api.account.${account}`]: "*" },
    });
  }
  if (zoneGroups.length) {
    if (!zone) {
      throw new CliError(
        `Zone-scoped permission group(s) requested (${zoneGroups.map((g) => g.name).join(", ")}) ` +
          `but no zone id was provided.`,
      );
    }
    policies.push({
      effect: "allow",
      permission_groups: zoneGroups.map((g) => ({ id: g.id })),
      resources: { [`com.cloudflare.api.account.zone.${zone}`]: "*" },
    });
  }
  return policies;
}

// ---------------------------------------------------------------------------
// secret files (.provision/)
// ---------------------------------------------------------------------------

/** Writes `value` (JSON-stringified) to `.provision/<relPath>`, creating parent dirs, chmod 600. */
export function writeProvisionFile(relPath: string, value: unknown): string {
  const fullPath = join(PROVISION_DIR, relPath);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(
    fullPath,
    typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`,
    {
      mode: 0o600,
    },
  );
  chmodSync(fullPath, 0o600);
  return fullPath;
}

export function readProvisionFile(relPath: string): string | undefined {
  const fullPath = join(PROVISION_DIR, relPath);
  if (!existsSync(fullPath)) return undefined;
  return readFileSync(fullPath, "utf8");
}

// ---------------------------------------------------------------------------
// wrangler.jsonc scanning
// ---------------------------------------------------------------------------

/**
 * Strips `//` and `/* *‍/` comments from JSONC while respecting string
 * literals (so a `//` or `/*` inside a quoted string is left alone). Trailing
 * commas are NOT stripped here — `JSON.parse` tolerates them fine only if we
 * also handle that; `parseJsonc` below does both.
 */
export function stripJsonComments(src: string): string {
  let out = "";
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;
  let escaped = false;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    const next = src[i + 1];

    if (inLineComment) {
      if (ch === "\n") {
        inLineComment = false;
        out += ch;
      }
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === "/" && next === "/") {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i++;
      continue;
    }
    out += ch;
  }
  return out;
}

/** Removes trailing commas before `}`/`]` — wrangler.jsonc allows them, JSON.parse doesn't. */
export function stripTrailingCommas(src: string): string {
  return src.replace(/,(\s*[}\]])/g, "$1");
}

export function parseJsonc<T = unknown>(src: string): T {
  return JSON.parse(stripTrailingCommas(stripJsonComments(src))) as T;
}

export interface D1BindingConfig {
  binding?: string;
  database_name: string;
  database_id?: string;
  migrations_dir?: string;
}

export interface R2BindingConfig {
  binding?: string;
  bucket_name: string;
}

export interface WranglerConfig {
  name?: string;
  account_id?: string;
  workers_dev?: boolean;
  routes?: Array<{ pattern?: string; custom_domain?: boolean; zone_name?: string }>;
  d1_databases?: D1BindingConfig[];
  r2_buckets?: R2BindingConfig[];
  vars?: Record<string, unknown>;
  env?: {
    production?: WranglerConfig;
    [key: string]: WranglerConfig | undefined;
  };
  [key: string]: unknown;
}

export interface WorkerConfigFile {
  /** Directory containing wrangler.jsonc, relative to repo root (e.g. "workers/roadie"). */
  dir: string;
  /** Absolute path to the wrangler.jsonc file. */
  path: string;
  /** Raw file text — kept for the comment-preserving backfill helpers below. */
  raw: string;
  parsed: WranglerConfig;
}

/**
 * Scans `workers/*​/wrangler.jsonc` (+ `inbox/wrangler.jsonc` when present) —
 * NOT a hardcoded fleet list, so newly landed workers (e.g. `si-store-*`,
 * or `inbox/` from the parallel rebrand) are picked up on the next run.
 */
export function findWranglerConfigs(root: string = REPO_ROOT): WorkerConfigFile[] {
  const candidateDirs: string[] = [];
  const workersDir = join(root, "workers");
  if (existsSync(workersDir)) {
    for (const entry of readdirSync(workersDir, { withFileTypes: true })) {
      if (entry.isDirectory()) candidateDirs.push(join("workers", entry.name));
    }
  }
  if (existsSync(join(root, "inbox", "wrangler.jsonc"))) candidateDirs.push("inbox");

  const configs: WorkerConfigFile[] = [];
  for (const dir of candidateDirs.sort()) {
    const path = join(root, dir, "wrangler.jsonc");
    if (!existsSync(path)) continue;
    const raw = readFileSync(path, "utf8");
    try {
      configs.push({ dir, path, raw, parsed: parseJsonc<WranglerConfig>(raw) });
    } catch (e) {
      logWarn(`could not parse ${join(dir, "wrangler.jsonc")}: ${(e as Error).message}`);
    }
  }
  return configs;
}

/** Returns the config scope for `env` — the top level for staging, `env.production` for production. */
export function envScope(parsed: WranglerConfig, env: Env): WranglerConfig | undefined {
  if (env === "staging") return parsed;
  return parsed.env?.production;
}

export interface D1Entry {
  workerDir: string;
  workerName: string;
  binding: string;
  databaseName: string;
  databaseId: string | undefined;
}

/** Every d1_databases entry across the fleet for `env` (empty binding/id tolerated, surfaced as-is). */
export function listD1Entries(configs: WorkerConfigFile[], env: Env): D1Entry[] {
  const entries: D1Entry[] = [];
  for (const cfg of configs) {
    const scope = envScope(cfg.parsed, env);
    if (!scope?.d1_databases) continue;
    const workerName = scope.name ?? cfg.parsed.name ?? cfg.dir;
    for (const d1 of scope.d1_databases) {
      entries.push({
        workerDir: cfg.dir,
        workerName,
        binding: d1.binding ?? "DB",
        databaseName: d1.database_name,
        databaseId: d1.database_id,
      });
    }
  }
  return entries;
}

export interface R2Entry {
  workerDir: string;
  workerName: string;
  binding: string;
  bucketName: string;
}

export function listR2Entries(configs: WorkerConfigFile[], env: Env): R2Entry[] {
  const entries: R2Entry[] = [];
  for (const cfg of configs) {
    const scope = envScope(cfg.parsed, env);
    if (!scope?.r2_buckets) continue;
    const workerName = scope.name ?? cfg.parsed.name ?? cfg.dir;
    for (const r2 of scope.r2_buckets) {
      entries.push({
        workerDir: cfg.dir,
        workerName,
        binding: r2.binding ?? "BLOBS",
        bucketName: r2.bucket_name,
      });
    }
  }
  return entries;
}

export interface StagingDevHost {
  workerDir: string;
  workerName: string;
}

/** Workers whose STAGING (top-level) config has `workers_dev: true` — used by access.ts. */
export function listWorkersDevEnabled(configs: WorkerConfigFile[]): StagingDevHost[] {
  const out: StagingDevHost[] = [];
  for (const cfg of configs) {
    if (cfg.parsed.workers_dev && cfg.parsed.name) {
      out.push({ workerDir: cfg.dir, workerName: cfg.parsed.name });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// comment-preserving targeted value replacement (id backfill)
// ---------------------------------------------------------------------------

/**
 * Finds the smallest `{...}` object enclosing `offset`, matching braces by a
 * simple depth counter that assumes object-literal braces never appear
 * unescaped inside a JSON string value in these config files (true for every
 * wrangler.jsonc in this repo — names/ids/urls, no free-form braces).
 */
export function findEnclosingBraces(raw: string, offset: number): [number, number] {
  let depth = 0;
  let start = -1;
  for (let i = offset; i >= 0; i--) {
    const ch = raw[i];
    if (ch === "}") depth++;
    else if (ch === "{") {
      if (depth === 0) {
        start = i;
        break;
      }
      depth--;
    }
  }
  if (start === -1) throw new Error(`no enclosing object found around offset ${offset}`);

  depth = 0;
  let end = -1;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) throw new Error(`unbalanced braces starting at offset ${start}`);
  return [start, end];
}

export interface BackfillResult {
  raw: string;
  changed: boolean;
  oldValue?: string;
}

/**
 * Locates the JSON object containing a match of `anchor` (e.g.
 * `"database_name": "roadie-staging-db"`) and replaces the string value of
 * `targetField` (e.g. `database_id`) within THAT object only — every other
 * byte, including comments and unrelated blocks with the same field name, is
 * left untouched. A no-op (same value) reports `changed: false`.
 */
export function backfillJsonField(
  raw: string,
  anchor: RegExp,
  targetField: string,
  newValue: string,
): BackfillResult {
  const m = anchor.exec(raw);
  if (!m) return { raw, changed: false };

  const [start, end] = findEnclosingBraces(raw, m.index);
  const obj = raw.slice(start, end + 1);
  const fieldRe = new RegExp(`("${targetField}"\\s*:\\s*")([^"]*)(")`);
  const fm = fieldRe.exec(obj);
  if (!fm) return { raw, changed: false };

  const oldValue = fm[2];
  if (oldValue === newValue) return { raw, changed: false, oldValue };

  const newObj =
    obj.slice(0, fm.index) + fm[1] + newValue + fm[3] + obj.slice(fm.index! + fm[0].length);
  const newRaw = raw.slice(0, start) + newObj + raw.slice(end + 1);
  return { raw: newRaw, changed: true, oldValue };
}

/** Backfills `database_id` for the `d1_databases` entry named `databaseName`. */
export function backfillDatabaseId(
  raw: string,
  databaseName: string,
  newId: string,
): BackfillResult {
  const anchor = new RegExp(`"database_name"\\s*:\\s*"${escapeRegExp(databaseName)}"`);
  return backfillJsonField(raw, anchor, "database_id", newId);
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A placeholder id treated the same as "missing" — always eligible for backfill. */
export const PLACEHOLDER_UUID = "00000000-0000-0000-0000-000000000000";

// ---------------------------------------------------------------------------
// longest-suffix zone matching
// ---------------------------------------------------------------------------

export interface ZoneLike {
  id: string;
  name: string;
}

/**
 * Picks the zone that owns `host` — exact match first, else the LONGEST
 * registered zone name that is a suffix of `host` (so `mail.example.co.uk`
 * resolves to the `example.co.uk` zone over a coincidentally-matching
 * shorter zone). Returns `null` when nothing matches.
 */
export function findZoneForHost(host: string, zones: ZoneLike[]): ZoneLike | null {
  const exact = zones.find((z) => z.name === host);
  if (exact) return exact;
  const candidates = zones
    .filter((z) => host.endsWith(`.${z.name}`))
    .sort((a, b) => b.name.length - a.name.length);
  return candidates[0] ?? null;
}

// ---------------------------------------------------------------------------
// CORS origins
// ---------------------------------------------------------------------------

/**
 * The portal origins that need R2 CORS access, mirroring
 * `workers/roadie/scripts/setup-cors.ts` in the source template: production
 * gets the real hosts, staging additionally gets a localhost wildcard for
 * local dev against the staging bucket (`dev:solo`, docs/sprout runbook).
 */
export function corsOriginsForEnv(env: Env, zone: string = zoneName()): string[] {
  if (env === "production") {
    return [`https://${zone}`, `https://www.${zone}`];
  }
  return [
    `https://staging.${zone}`,
    `https://*.${zone.replace(/\.[^.]+$/, "")}.localhost`,
    `https://*.localhost`,
  ];
}

// ---------------------------------------------------------------------------
// wrangler secret put (env-stripped so OAuth, not the Access/DNS token, is used)
// ---------------------------------------------------------------------------

export interface WriteSecretOptions {
  cwd: string;
  name: string;
  value: string;
  wranglerEnv?: "production";
  dryRun: boolean;
}

/**
 * Runs `wrangler secret put <name> [--env production]` with the Cloudflare
 * API-token env vars STRIPPED from the child process, so wrangler falls back
 * to its own OAuth login — mirrors agentic-inbox's setup-access.mjs (the
 * Access/Email/DNS-scoped token this suite mints can't push Worker secrets,
 * and shouldn't be handed a Workers-scripts capability it doesn't need).
 */
export function writeWranglerSecret(opts: WriteSecretOptions): { ok: boolean; message?: string } {
  const { cwd, name, value, wranglerEnv, dryRun } = opts;
  if (dryRun) {
    logDryRun(
      `would run: wrangler secret put ${name}${wranglerEnv ? ` --env ${wranglerEnv}` : ""} (cwd=${cwd})`,
    );
    return { ok: true };
  }
  const env = { ...process.env };
  delete env.CLOUDFLARE_API_TOKEN;
  delete env.CLOUDFLARE_API_KEY;
  delete env.CLOUDFLARE_EMAIL;

  const args = ["wrangler", "secret", "put", name];
  if (wranglerEnv) args.push("--env", wranglerEnv);

  const res = spawnSync("bunx", args, {
    cwd,
    env,
    input: value,
    stdio: ["pipe", "inherit", "inherit"],
  });
  if (res.status !== 0) {
    return { ok: false, message: `wrangler secret put ${name} exited ${res.status}` };
  }
  return { ok: true };
}
