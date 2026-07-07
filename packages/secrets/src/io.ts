/**
 * Filesystem side of the provisioner: the gitignored per-env value store
 * (`.secrets/<env>.env`), `.dev.vars` writes for local, and syncing a freshly
 * generated attestation public key into `packages/config/src/bouncer-attestation.ts`.
 *
 * Paths are resolved relative to the repo root (this file's location), so the
 * CLI works from any cwd.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mergeDevVars, parseDotenv, serializeDotenv } from "./dotenv";
import { SERVICE_DIR, type Env, type ServiceName } from "./manifest";

const HERE = dirname(fileURLToPath(import.meta.url));
/** packages/secrets/src → repo root. */
export const REPO_ROOT = resolve(HERE, "../../..");
const SECRETS_DIR = join(REPO_ROOT, ".secrets");
const ATT_CONFIG = join(REPO_ROOT, "packages/config/src/bouncer-attestation.ts");

export function storePath(env: Env): string {
  return join(SECRETS_DIR, `${env}.env`);
}

/** Load the gitignored value store for an env (empty if absent). */
export function loadStore(env: Env): Record<string, string> {
  const path = storePath(env);
  return existsSync(path) ? parseDotenv(readFileSync(path, "utf8")) : {};
}

/** Persist the value store for an env (generated secrets land here). */
export function saveStore(env: Env, values: Record<string, string>): void {
  if (!existsSync(SECRETS_DIR)) mkdirSync(SECRETS_DIR, { recursive: true });
  const header = `# @si/secrets value store for ${env} — gitignored, DO NOT COMMIT\n`;
  writeFileSync(storePath(env), header + serializeDotenv(values));
}

/** Merge secret keys into a service's local `.dev.vars`; returns the path. */
export function writeDevVarsSecrets(service: ServiceName, updates: Record<string, string>): string {
  const path = join(REPO_ROOT, SERVICE_DIR[service], ".dev.vars");
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  writeFileSync(path, mergeDevVars(existing, updates));
  return path;
}

/**
 * Set the public key for a kid in `BOUNCER_ATTESTATION_KEYS`. Used after
 * generating a new production attestation keypair so verifiers ship the match.
 */
export function syncAttestationPublicKey(kid: string, spkiB64: string): void {
  const src = readFileSync(ATT_CONFIG, "utf8");
  const re = new RegExp(`(\\b${kid}:\\s*")[^"]*(")`);
  if (!re.test(src)) {
    throw new Error(`attestation kid "${kid}" not found in ${ATT_CONFIG}`);
  }
  writeFileSync(ATT_CONFIG, src.replace(re, `$1${spkiB64}$2`));
}
