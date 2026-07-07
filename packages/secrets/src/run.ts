/**
 * Orchestrator: resolve the plan for an env, generate any missing generated
 * secrets (persisting them to the value store + syncing the attestation public
 * key), then apply — `.dev.vars` merges for local, `wrangler secret put` for
 * remote. Idempotent: re-running with the same store re-applies identical values.
 *
 * `wrangler` is invoked through an injected {@link Exec} so the whole thing is
 * unit-testable with a mock executor (no network, no real CLI).
 */
import { generateBetterAuthSecret, generateEd25519, publicFromPrivatePem } from "./generate";
import * as realIo from "./io";
import { ATT_KID, SECRETS, type Env, type ServiceName } from "./manifest";
import { buildPlan, type PlanEntry, type PlanFilter } from "./resolve";

/** Runs `wrangler <args>` with `stdin` piped in; resolves its exit code. */
export type Exec = (args: string[], stdin: string) => Promise<{ code: number; stderr: string }>;

/**
 * The filesystem/config effects the orchestrator performs, injected so it can
 * be exercised entirely in-memory by tests. Defaults to the real {@link realIo}.
 */
export interface SecretsIO {
  loadStore(env: Env): Record<string, string>;
  saveStore(env: Env, values: Record<string, string>): void;
  writeDevVarsSecrets(service: ServiceName, updates: Record<string, string>): string;
  syncAttestationPublicKey(kid: string, spkiB64: string): void;
}

const defaultIo: SecretsIO = {
  loadStore: realIo.loadStore,
  saveStore: realIo.saveStore,
  writeDevVarsSecrets: realIo.writeDevVarsSecrets,
  syncAttestationPublicKey: realIo.syncAttestationPublicKey,
};

export interface ProvisionOptions {
  /** Plan + generate-to-store, but don't apply. */
  dryRun?: boolean;
  /** Skip generation of missing generated secrets (default: generate). */
  noGenerate?: boolean;
  filter?: PlanFilter;
}

export interface ProvisionResult {
  env: Env;
  /** Final plan after any generation. */
  plan: PlanEntry[];
  /** Names of secrets generated this run. */
  generated: string[];
  /** Secrets applied, with their target (dev.vars path or worker name). */
  applied: Array<{ secret: string; target: string }>;
  /** Required secrets with no value — blocks apply. */
  missingRequired: PlanEntry[];
  /** Optional secrets skipped because no value was provided. */
  skippedOptional: PlanEntry[];
  /** Attestation public key synced into config (when a keypair was generated). */
  pubkeySynced?: { kid: string; spki: string };
}

const noopExec: Exec = async () => ({ code: 0, stderr: "" });

export async function provision(
  env: Env,
  options: ProvisionOptions = {},
  exec: Exec = noopExec,
  io: SecretsIO = defaultIo,
): Promise<ProvisionResult> {
  const { dryRun = false, noGenerate = false, filter = {} } = options;
  const store = io.loadStore(env);
  const generated: string[] = [];
  let pubkeySynced: ProvisionResult["pubkeySynced"];

  // 1. Generate any missing generated secrets, persist, sync attestation pubkey.
  if (!dryRun && !noGenerate) {
    const initial = buildPlan(env, store, filter);
    const toGenerate = [
      ...new Set(initial.filter((e) => e.status === "to-generate").map((e) => e.secret)),
    ];
    for (const name of toGenerate) {
      const spec = SECRETS.find((s) => s.name === name);
      if (spec === undefined || spec.kind.type !== "generated") continue;
      if (spec.kind.algo === "ed25519") {
        const keypair = generateEd25519();
        store[name] = keypair.privatePem;
        io.syncAttestationPublicKey(ATT_KID[env], keypair.publicSpkiB64);
        pubkeySynced = { kid: ATT_KID[env], spki: keypair.publicSpkiB64 };
      } else {
        store[name] = generateBetterAuthSecret();
      }
      generated.push(name);
    }
    if (generated.length > 0) io.saveStore(env, store);
  }

  const plan = buildPlan(env, store, filter);
  // After generation, anything still not "ready" is unresolved: required ones
  // block the apply; optional ones are simply skipped. (With noGenerate, a
  // generated secret stays "to-generate" and correctly counts as unresolved.)
  const missingRequired = plan.filter((e) => e.status !== "ready" && e.required);
  const skippedOptional = plan.filter((e) => e.status !== "ready" && !e.required);

  const applied: Array<{ secret: string; target: string }> = [];
  if (!dryRun && missingRequired.length === 0) {
    if (env === "local") {
      // Group ready secrets by service, then upsert each service's .dev.vars once.
      const byService = new Map<ServiceName, Record<string, string>>();
      for (const e of plan) {
        if (e.status !== "ready" || e.value === undefined) continue;
        const updates = byService.get(e.service) ?? {};
        updates[e.secret] = e.value;
        byService.set(e.service, updates);
      }
      for (const [service, updates] of byService) {
        const path = io.writeDevVarsSecrets(service, updates);
        for (const key of Object.keys(updates)) applied.push({ secret: key, target: path });
      }
    } else {
      // Keep the committed attestation pubkey in lockstep with the stored
      // private key even when we didn't just generate it (idempotent self-heal).
      const att = plan.find((e) => e.secret === "BNC_ATT_PRIV" && e.source === "generate");
      if (att?.value !== undefined && pubkeySynced === undefined) {
        io.syncAttestationPublicKey(ATT_KID[env], publicFromPrivatePem(att.value));
      }
      for (const e of plan) {
        if (e.status !== "ready" || e.value === undefined) continue;
        const result = await exec(["secret", "put", e.secret, "--name", e.target], e.value);
        if (result.code !== 0) {
          throw new Error(
            `wrangler secret put ${e.secret} → ${e.target} failed (exit ${result.code}): ${result.stderr}`,
          );
        }
        applied.push({ secret: e.secret, target: e.target });
      }
    }
  }

  return { env, plan, generated, applied, missingRequired, skippedOptional, pubkeySynced };
}
