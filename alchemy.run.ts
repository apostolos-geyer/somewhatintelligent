/**
 * somewhatintelligent — the Alchemy-managed slice of the fleet, one Stack for
 * every app that has left the RWX/wrangler deploy lanes:
 *
 *   worker      physical name            notes
 *   ---------   ----------------------   -------------------------------------
 *   publisher   si-publisher-<stage>     D1 + migrations, media-GC cron, RPC
 *   store       si-store-<stage>         D1 + migrations, Stripe queues + DLQ,
 *                                        reconciliation cron, RPC entrypoints
 *   site        si-site-<stage>          Astro SSR — Command.Build runs
 *                                        `astro build`, the dist ships as-is
 *   operator    si-operator-<stage>      TanStack Start console on desk.*,
 *                                        Command.Build runs the vite build
 *   inbox       agentic-inbox-si         production stage only — declared in
 *                                        inbox/alchemy.run.ts, yielded here
 *
 * The REST of the platform (bouncer, guestlist, roadie, promoter, identity)
 * still deploys via wrangler + RWX; this stack references those workers by
 * script name only. Physical names are pinned to the live fleet and every
 * resource adopts in place (AdoptPolicy below), so first deploy takes
 * ownership of the running workers/DBs/queues without replacing them.
 *
 * Service bindings use the `$binding: "service"` descriptor (local alchemy
 * patch, patches/alchemy@2.0.0-beta.62.patch) because the platform's RPC
 * targets are named WorkerEntrypoint classes — upstream alchemy cannot yet
 * express `entrypoint` on a service binding. `props.callerApp` is NOT set:
 * roadie's readCallerApp falls back to the per-call `meta.callerApp` every
 * client wrapper already sends, and nothing else reads binding props.
 *
 * ── Commands ──────────────────────────────────────────────────────────────
 *
 *   bun alchemy plan   --stage staging|production   # preview, mutates nothing
 *   bun alchemy deploy --stage staging|production
 *
 * Credentials come from the alchemy profile (`bun alchemy login`), never from
 * exported CLOUDFLARE_* vars. Secrets are read from the environment (or .env)
 * at deploy time and FAIL THE DEPLOY loudly when missing, because alchemy
 * re-declares the full binding set on every deploy — a secret missing here is
 * a secret DELETED from the live worker:
 *
 *   PREVIEW_SIGNING_SECRET   required; one value bound to operator AND site
 *   OPERATOR_POLICY_AUD      required; aud of the stage's desk.* Access app
 *   TEAM_DOMAIN              required; https://<team>.cloudflareaccess.com
 *   STORE_STRIPE_SECRET_KEY / STORE_STRIPE_WEBHOOK_SIGNING_SECRET
 *                            optional; omitted -> store webhook stays 503-gated
 *                            (same as an unset wrangler secret today)
 *
 * The Access allow-list for the desk.* console and the inbox is ONE shared
 * constant (ADMIN_ALLOWED_EMAILS) reconciled into both Access policies on
 * every deploy. The Access APPLICATIONS stay dashboard/script-managed —
 * alchemy cannot adopt an existing app by domain yet (see the note in
 * inbox/alchemy.run.ts).
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import * as Alchemy from "alchemy";
import * as AdoptPolicy from "alchemy/AdoptPolicy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Command from "alchemy/Command";
import type * as Input from "alchemy/Input";
import * as Output from "alchemy/Output";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";

import { inboxResources } from "./inbox/alchemy.run.ts";

/**
 * Everyone allowed through Cloudflare Access onto desk.* (operator console)
 * AND mail.* (inbox). Edit + deploy to grant or revoke; both policies are
 * fully reconciled from this list.
 */
const ADMIN_ALLOWED_EMAILS = ["apostoli.geyer@geyerconsulting.com", "hello@somewhatintelligent.ca"];

/** Reusable Access policy names — pinned to what setup scripts created. */
const OPERATOR_POLICY_NAME = "si-operator-access";

const workerVersion = (dir: string): string => {
  try {
    const pkg = JSON.parse(readFileSync(`${dir}/package.json`, "utf8")) as {
      version?: string;
    };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
};

const gitCommit = (): string => {
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    return "unknown";
  }
};

/**
 * Service binding to a Worker by script name + named entrypoint class.
 * In-stack workers pass their `workerName` Output so the dependency edge
 * orders their deploys; fleet workers outside this stack pass a literal.
 */
const service = (service: Input.Input<string>, entrypoint: string) =>
  ({ $binding: "service", service, entrypoint }) as const;

const COMMIT = gitCommit();

const previewSigningSecret = Config.redacted("PREVIEW_SIGNING_SECRET");
const operatorPolicyAud = Config.redacted("OPERATOR_POLICY_AUD");
const teamDomain = Config.redacted("TEAM_DOMAIN");

// Optional Stripe secrets: mirror today's contract, where the webhook route
// 503s until BOTH are provisioned. Absent env vars mean absent bindings.
const stripeSecretKey = process.env.STORE_STRIPE_SECRET_KEY;
const stripeWebhookSecret = process.env.STORE_STRIPE_WEBHOOK_SIGNING_SECRET;
if (!stripeSecretKey || !stripeWebhookSecret) {
  console.warn(
    "[alchemy.run] STORE_STRIPE_SECRET_KEY / STORE_STRIPE_WEBHOOK_SIGNING_SECRET " +
      "not set — store deploys WITHOUT Stripe secrets (webhook stays 503-gated).",
  );
}

export default Alchemy.Stack(
  "SomewhatIntelligent",
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function* () {
    const stage = yield* Alchemy.Stage;
    if (stage !== "staging" && stage !== "production") {
      return yield* Effect.die(
        `Unknown stage "${stage}" — this stack deploys --stage staging or --stage production only.`,
      );
    }
    const prod = stage === "production";
    const apex = prod ? "somewhatintelligent.ca" : "staging.somewhatintelligent.ca";
    const deskHost = `desk.${apex}`;
    const n = (worker: string) => `si-${worker}-${stage}`;

    // Cron + observability mirror the wrangler configs: full head sampling in
    // production, defaults in staging.
    const observability = prod ? { enabled: true, headSamplingRate: 1 } : { enabled: true };

    // ── Access: ONE allow-list for the whole admin surface ────────────────
    // Reusable policy already attached to both desk.* Access applications
    // (created by workers/operator/scripts/setup-access.ts). Adopted by name;
    // the include rules are replaced from ADMIN_ALLOWED_EMAILS on deploy.
    yield* Cloudflare.Access.Policy("OperatorAccessPolicy", {
      name: OPERATOR_POLICY_NAME,
      decision: "allow",
      include: ADMIN_ALLOWED_EMAILS.map((email) => ({ email: { email } })),
      adopt: true,
    });

    // ── store ─────────────────────────────────────────────────────────────
    const storeDb = yield* Cloudflare.D1.Database("StoreDb", {
      name: `store-${stage}-db`,
      migrationsDir: "workers/store/migrations",
    });

    const stripeEvents = yield* Cloudflare.Queues.Queue("StripeEvents", {
      name: `si-stripe-events-${stage}`,
    });
    const stripeEventsDlq = yield* Cloudflare.Queues.Queue("StripeEventsDlq", {
      name: `si-stripe-events-dlq-${stage}`,
    });

    const store = yield* Cloudflare.Worker("Store", {
      name: n("store"),
      main: "workers/store/src/worker.ts",
      compatibility: { date: "2026-04-16", flags: ["nodejs_compat"] },
      url: !prod,
      crons: ["*/15 * * * *"],
      observability,
      env: {
        ENVIRONMENT: stage,
        STORE_URL: `https://${apex}/shop`,
        SITE_URL: `https://${apex}`,
        STRIPE_PUBLISHABLE_KEY: "",
        WORKER_VERSION: workerVersion("workers/store"),
        WORKER_COMMIT: COMMIT,
        DB: storeDb,
        STRIPE_EVENTS: stripeEvents,
        GUESTLIST: service(n("guestlist"), "Guestlist"),
        ROADIE: service(n("roadie"), "Roadie"),
        ...(stripeSecretKey ? { STRIPE_SECRET_KEY: Redacted.make(stripeSecretKey) } : {}),
        ...(stripeWebhookSecret
          ? { STRIPE_WEBHOOK_SIGNING_SECRET: Redacted.make(stripeWebhookSecret) }
          : {}),
      },
    });

    // Consumer wiring matches wrangler: events -> DLQ after 5 retries; the
    // DLQ consumer is terminal (no dead letter behind it) — processDlqBatch
    // acks after persisting evidence.
    yield* Cloudflare.Queues.Consumer("StripeEventsConsumer", {
      queueId: stripeEvents.queueId,
      scriptName: store.workerName,
      deadLetterQueue: stripeEventsDlq.queueName,
      settings: { maxRetries: 5 },
    });
    yield* Cloudflare.Queues.Consumer("StripeEventsDlqConsumer", {
      queueId: stripeEventsDlq.queueId,
      scriptName: store.workerName,
      settings: { maxRetries: 5 },
    });

    // ── publisher ─────────────────────────────────────────────────────────
    const publisherDb = yield* Cloudflare.D1.Database("PublisherDb", {
      name: `publisher-${stage}-db`,
      migrationsDir: "workers/publisher/migrations",
    });

    const publisher = yield* Cloudflare.Worker("Publisher", {
      name: n("publisher"),
      main: "workers/publisher/src/index.ts",
      compatibility: { date: "2026-04-19", flags: ["nodejs_compat"] },
      url: false,
      crons: ["*/15 * * * *"],
      observability,
      env: {
        ENVIRONMENT: stage,
        WORKER_VERSION: workerVersion("workers/publisher"),
        WORKER_COMMIT: COMMIT,
        DB: publisherDb,
        ROADIE: service(n("roadie"), "Roadie"),
        STORE: service(store.workerName, "StoreCatalog"),
      },
    });

    // ── site ──────────────────────────────────────────────────────────────
    // `astro build` emits dist/server (the @astrojs/cloudflare no_bundle
    // worker) + dist/client (static assets, prerendered pages). The build is
    // content-hash memoized; the Worker ships the output byte-for-byte.
    const siteBuild = yield* Command.Build("SiteBuild", {
      command: "bun run build",
      cwd: "workers/site",
      outdir: "dist",
      memo: {
        include: ["**/*", "../../packages/*/src/**"],
        lockfile: true,
      },
    });

    // Astro sessions KV. The binding name (SESSION) is fixed by the adapter;
    // the namespace itself is stack-owned (sessions are ephemeral).
    const siteSession = yield* Cloudflare.KV.Namespace("SiteSession", {
      title: `si-site-${stage}-session`,
    });

    const site = yield* Cloudflare.Worker("Site", {
      name: n("site"),
      main: Output.interpolate`${siteBuild.outdir}/server/entry.mjs`,
      bundle: false,
      assets: { directory: Output.interpolate`${siteBuild.outdir}/client` },
      compatibility: { date: "2026-04-19", flags: ["nodejs_compat"] },
      url: false,
      observability,
      env: {
        ENVIRONMENT: stage,
        SITE_URL: `https://${apex}`,
        WORKER_VERSION: workerVersion("workers/site"),
        WORKER_COMMIT: COMMIT,
        SESSION: siteSession,
        PUBLISHER: service(publisher.workerName, "PublisherPublic"),
        STORE: service(store.workerName, "StoreCatalog"),
        PREVIEW_SIGNING_SECRET: previewSigningSecret,
      },
    });

    // ── operator ──────────────────────────────────────────────────────────
    // The vite build (cloudflare vite plugin) bakes the stage's client vars
    // from wrangler.jsonc, so the build command is stage-dependent — same
    // invocations as the old deploy:staging / deploy:production scripts.
    const operatorBuild = yield* Command.Build("OperatorBuild", {
      command: "vp run build",
      cwd: "workers/operator",
      outdir: "dist",
      env: prod ? { CLOUDFLARE_ENV: "production" } : { SI_BUILD: "1" },
      memo: {
        include: ["**/*", "../../packages/*/src/**"],
        lockfile: true,
      },
    });

    const operator = yield* Cloudflare.Worker("Operator", {
      name: n("operator"),
      main: Output.interpolate`${operatorBuild.outdir}/server/index.js`,
      bundle: false,
      assets: { directory: Output.interpolate`${operatorBuild.outdir}/client` },
      compatibility: { date: "2026-04-19", flags: ["nodejs_compat"] },
      // Access-gated console: desk.* custom domain is the ONLY hostname —
      // workers.dev and previews stay off so nothing bypasses Access (D6).
      url: false,
      domain: deskHost,
      observability,
      env: {
        ENVIRONMENT: stage,
        OPERATOR_URL: `https://${deskHost}`,
        SITE_PREVIEW_URL: `https://${apex}/__preview`,
        WORKER_VERSION: workerVersion("workers/operator"),
        WORKER_COMMIT: COMMIT,
        STORE: service(store.workerName, "StoreOperator"),
        PUBLISHER: service(publisher.workerName, "PublisherOperator"),
        POLICY_AUD: operatorPolicyAud,
        TEAM_DOMAIN: teamDomain,
        PREVIEW_SIGNING_SECRET: previewSigningSecret,
      },
    });

    // ── inbox (production only) ───────────────────────────────────────────
    // Lives at mail.somewhatintelligent.ca with no staging twin. Resources
    // are declared in inbox/alchemy.run.ts and adopted from the retired
    // standalone AgenticInbox stack; the shared allow-list feeds its Access
    // policy too.
    const inbox = prod ? yield* inboxResources(ADMIN_ALLOWED_EMAILS) : undefined;

    return {
      stage,
      store: store.workerName,
      publisher: publisher.workerName,
      site: site.workerName,
      operator: operator.workerName,
      operatorUrl: `https://${deskHost}`,
      inbox: inbox?.url,
    };
  }).pipe(AdoptPolicy.adopt(true)),
);
