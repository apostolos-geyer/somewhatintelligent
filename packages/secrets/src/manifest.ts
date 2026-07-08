/**
 * Declarative inventory of every secret the platform's workers consume, where
 * each one is needed (which worker × which environment), and how its value is
 * sourced (generated, well-known dev default, or operator-provided).
 *
 * This is the single source of truth the provisioner (`./run.ts`) reads. To add
 * a secret: append a {@link SecretSpec} here — the CLI, dev-vars writer, and
 * `wrangler secret put` targeting all flow from it. Nothing else to wire.
 */
import { platformDeployConfig } from "@si/config";

export type Env = "local" | "staging" | "production";
export const ENVS = ["local", "staging", "production"] as const satisfies readonly Env[];
export type RemoteEnv = Exclude<Env, "local">;

export type ServiceName = "guestlist" | "bouncer" | "promoter" | "roadie" | "identity" | "store";

/** Repo-relative directory holding each service's `.dev.vars` (the local target). */
export const SERVICE_DIR: Record<ServiceName, string> = {
  guestlist: "workers/guestlist",
  bouncer: "workers/bouncer",
  promoter: "workers/promoter",
  roadie: "workers/roadie",
  identity: "workers/identity",
  store: "workers/store",
};

/**
 * Deployed Cloudflare worker name for a service in a remote env. Mirrors
 * wrangler's behaviour: the rendered `name` is `<prefix>-<service>` and
 * `--env <env>` appends the `-<env>` suffix, so the live worker is
 * `<prefix>-<service>-<env>` (e.g. `si-guestlist-staging`). The prefix is
 * the same per-fork knob the wrangler configs use.
 */
export function workerName(service: ServiceName, env: RemoteEnv): string {
  return `${platformDeployConfig.workerPrefix}-${service}-${env}`;
}

export type SecretKind =
  | { type: "generated"; algo: "betterAuthSecret" }
  | { type: "generated"; algo: "ed25519" }
  | { type: "provided" };

export interface SecretSpec {
  /** Env-var name as the worker reads it (and the `wrangler secret put` key). */
  name: string;
  kind: SecretKind;
  /** When true, a missing value in a targeted env is a hard error. */
  required: boolean;
  description: string;
  /** Consuming services per env. An absent env means "not needed there". */
  perEnv: Partial<Record<Env, ServiceName[]>>;
}

const titleCase = (s: string): string => s.charAt(0) + s.slice(1).toLowerCase();

/** A provider's OAuth client id + secret pair (optional, guestlist-only). */
const oauth = (provider: string): SecretSpec[] =>
  (["CLIENT_ID", "CLIENT_SECRET"] as const).map(
    (suffix): SecretSpec => ({
      name: `${provider}_${suffix}`,
      kind: { type: "provided" },
      required: false,
      description: `${titleCase(provider)} OAuth ${
        suffix === "CLIENT_ID" ? "client id" : "client secret"
      } (guestlist, optional).`,
      perEnv: { local: ["guestlist"], staging: ["guestlist"], production: ["guestlist"] },
    }),
  );

export const SECRETS: SecretSpec[] = [
  {
    name: "BETTER_AUTH_SECRET",
    kind: { type: "generated", algo: "betterAuthSecret" },
    required: true,
    description: "better-auth signing secret (sessions + JWT). guestlist only.",
    perEnv: { local: ["guestlist"], staging: ["guestlist"], production: ["guestlist"] },
  },
  {
    name: "BNC_ATT_PRIV",
    kind: { type: "generated", algo: "ed25519" },
    required: true,
    description:
      "Bouncer attestation Ed25519 private key (PKCS8 PEM). The public half is " +
      "published in packages/config/src/bouncer-attestation.ts. local + staging " +
      "use the well-known dev key (BNC_ATT_KID=dev); production uses a unique keypair.",
    // local: every app that stamps its own dev envelope (no bouncer in
    // dev-direct topology) needs the dev signing key — identity (and store
    // once it lands). staging/production: only bouncer signs (apps verify
    // with the published public key).
    perEnv: {
      local: ["bouncer", "identity"],
      staging: ["bouncer"],
      production: ["bouncer"],
    },
  },
  {
    name: "RESEND_API_KEY",
    kind: { type: "provided" },
    required: false,
    description:
      "Resend API key for the email transport (promoter, resend provider). " +
      "Production sends via the Cloudflare Email binding instead, so it's unused there.",
    perEnv: { local: ["promoter"], staging: ["promoter"] },
  },
  {
    name: "STRIPE_SECRET_KEY",
    kind: { type: "provided" },
    required: false,
    description:
      "Stripe secret key. Unset until Stripe onboarding — gates the better-auth " +
      "stripe plugin (guestlist), which stays out of the plugins array entirely " +
      "until this AND STRIPE_WEBHOOK_SIGNING_SECRET are both set.",
    perEnv: {
      local: ["guestlist", "store"],
      staging: ["guestlist", "store"],
      production: ["guestlist", "store"],
    },
  },
  {
    name: "STRIPE_WEBHOOK_SIGNING_SECRET",
    kind: { type: "provided" },
    required: false,
    description:
      "Stripe webhook signing secret. Unset until Stripe onboarding — see " + "STRIPE_SECRET_KEY.",
    perEnv: {
      local: ["guestlist", "store"],
      staging: ["guestlist", "store"],
      production: ["guestlist", "store"],
    },
  },
  {
    name: "S3_ACCESS_KEY_ID",
    kind: { type: "provided" },
    required: false,
    description: "R2 S3-API access key id (roadie blob SigV4).",
    perEnv: { local: ["roadie"], staging: ["roadie"], production: ["roadie"] },
  },
  {
    name: "S3_SECRET_ACCESS_KEY",
    kind: { type: "provided" },
    required: false,
    description: "R2 S3-API secret access key (roadie blob SigV4).",
    perEnv: { local: ["roadie"], staging: ["roadie"], production: ["roadie"] },
  },
  ...oauth("GOOGLE"),
  ...oauth("MICROSOFT"),
  ...oauth("FACEBOOK"),
  ...oauth("LINKEDIN"),
];

/**
 * Well-known, committed dev secret material. Mirrors `scripts/dev-config.ts`
 * (a test asserts they stay in sync). Used as the value for generated secrets
 * in local (all generated) and staging (BNC_ATT_PRIV only — BNC_ATT_KID is
 * `dev` there, so staging signs with the dev keypair).
 */
export const DEV_DEFAULTS: Record<string, string> = {
  BETTER_AUTH_SECRET: "//oc0iA9surRLIWnCKmFs9DlnrN3brN7mt4lMahzW0M=",
  BNC_ATT_PRIV:
    "-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEINzNgiuDD9xbqVEPkfMt8twPcq7hTnIbAdKKHPjM7TmU\n-----END PRIVATE KEY-----",
};

/** The attestation kid (and thus public key in config) used per env. */
export const ATT_KID: Record<Env, string> = {
  local: "dev",
  staging: "dev",
  production: "production",
};

/** How a secret's value is sourced for a given env. */
export type Source = "devDefault" | "generate" | "provided";

export function sourceFor(spec: SecretSpec, env: Env): Source {
  if (spec.kind.type === "provided") return "provided";
  // Generated secrets: local always uses the committed dev value; staging's
  // attestation key is the dev key too (kid=dev). Everything else is generated
  // per-env and persisted to the value store.
  if (env === "local") return "devDefault";
  if (spec.name === "BNC_ATT_PRIV" && env === "staging") return "devDefault";
  return "generate";
}
