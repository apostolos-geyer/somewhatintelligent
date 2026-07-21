/**
 * Agentic Inbox — declared here, deployed by the ROOT stack: the repo-root
 * alchemy.run.ts yields `inboxResources` on its production stage (the inbox
 * has no staging twin). On the golden path: `Cloudflare.Website.Vite` owns
 * the Vite build, local dev, and deploy. There is NO wrangler.jsonc — Alchemy
 * injects its own fork of the Cloudflare Vite plugin into this project's
 * vite.config.ts at build and dev time.
 *
 * This file owns EVERYTHING the inbox needs to exist and function:
 *
 *   - the React Router app build + Worker `agentic-inbox-si` (custom entry
 *     `workers/app.ts` so the deployed Worker exports the Durable Object
 *     classes and the email() handler alongside the fetch handler)
 *   - the R2 attachments bucket
 *   - the three SQLite Durable Object namespaces (MailboxDO, EmailAgent,
 *     EmailMCP)
 *   - the Workers AI + send_email bindings (the AI Gateway resource is how
 *     alchemy models the native `ai` binding; runtime env.AI is plain
 *     Workers AI, the gateway itself is dormant)
 *   - the Cloudflare Access policy (allow-list reconciled from code)
 *   - zone Email Routing + the catch-all rule forwarding inbound mail to
 *     the worker
 *
 * The one dashboard-managed exception is the Access APPLICATION — see
 * ACCESS_APP_AUD below.
 *
 * ── Commands (run from the REPO ROOT — this file is part of its stack) ────
 *
 *   bun run plan                     # cd .. && alchemy plan --stage production
 *   bun run deploy                   # cd .. && alchemy deploy --stage production
 *
 * Credentials: `bun alchemy login` once (profile), or non-interactive
 * CI=1 + CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID. TEAM_DOMAIN comes
 * from the root .env. Adoption is declared by the root stack
 * (AdoptPolicy.adopt(true)) — no --adopt flag.
 *
 * App code reads its typed env from this file: `WorkerEnv` below is derived
 * from the declared bindings (Cloudflare.InferEnv), so the env can never
 * drift from the infrastructure that produced it.
 */
import * as Cloudflare from "alchemy/Cloudflare";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";

// Type-only imports of the DO classes so the derived WorkerEnv types each
// namespace as DurableObjectNamespace<Class> (typed stubs in app code).
import type { EmailAgent } from "./workers/agent";
import type { MailboxDO } from "./workers/durableObject";
import type { EmailMCP } from "./workers/mcp";

/** Physical worker name — matches the live instance; DO data is keyed to it. */
const WORKER_NAME = "agentic-inbox-si";

/** The zone that receives mail and hosts the web UI's custom domain. */
const ZONE = "somewhatintelligent.ca";

/** Web UI hostname AND the mail-receiving domain (the app's DOMAINS var). */
const APP_DOMAIN = "mail.somewhatintelligent.ca";

/**
 * Name of the pre-existing Access policy. `adopt: true` matches on this
 * name — keep it in sync with what exists in the dashboard.
 */
const ACCESS_POLICY_NAME = `${WORKER_NAME}-access`;

/**
 * The `aud` of the live Access application "mail.somewhatintelligent.ca"
 * (app id ff35743f-8c54-46e3-9938-e2c8a7ff65df), read from the Access API.
 *
 * HARDCODED EXCEPTION: the Access application itself is the one piece of
 * this deployment still managed in the dashboard. Alchemy's
 * `Access.Application` cannot adopt an existing app on a greenfield deploy
 * (its observe step only matches by persisted applicationId or by
 * `olds.domain` after state loss — a first deploy would blind-create a
 * duplicate app with a fresh aud on the same domain). Once upstream supports
 * adopt-by-domain, declare the app here and replace this const with the
 * application resource's `aud` output.
 */
const ACCESS_APP_AUD: string = "a0046cb0773459b27a32ff7123e52e18d985c2e4aa75df35ba35828ca096443f";

/** Addresses the UI pre-creates mailboxes for (app's EMAIL_ADDRESSES var). */
const EMAIL_ADDRESSES: string[] = [];

/**
 * The app: React Router built by this project's own vite.config.ts (with
 * Alchemy's Cloudflare plugin appended), deployed as the Worker. `main`
 * points at the custom entry so the deployed Worker exports the DO classes
 * and the email() handler, not just the framework fetch handler.
 *
 * Class form so the app derives its typed env (`WorkerEnv` below).
 */
export class Inbox extends Cloudflare.Website.Vite<Inbox>()("Inbox", {
  name: WORKER_NAME,
  main: "workers/app.ts",
  // The root stack deploys from the repo root; the Vite project lives here.
  rootDir: "inbox",
  compatibility: { date: "2025-11-28", flags: ["nodejs_compat"] },
  domain: APP_DOMAIN,
  // workers.dev disabled: mail.<zone> is the single, Access-gated surface.
  url: false,
  observability: { enabled: true },
  env: {
    DOMAINS: APP_DOMAIN,
    EMAIL_ADDRESSES,
    POLICY_AUD: ACCESS_APP_AUD,
    // The Zero Trust team domain has no read-only lookup resource, so it is
    // the one deploy-time input (TEAM_DOMAIN in the environment / .env).
    TEAM_DOMAIN: Config.string("TEAM_DOMAIN"),
    // Existing bucket: name pinned to the live one; adopted in place.
    BUCKET: Cloudflare.R2.Bucket("Bucket", { name: WORKER_NAME }),
    // The native `ai` binding (env.AI, plain Workers AI at runtime) is
    // produced by binding an AI Gateway resource — the only way alchemy
    // models Workers AI. The gateway itself is inert.
    AI: Cloudflare.AI.Gateway("Ai", { id: WORKER_NAME }),
    // send_email: unrestricted, as before.
    EMAIL: Cloudflare.Email.SendEmail("Email"),
    // SQLite DOs hosted by this worker (classes exported from workers/app.ts).
    MAILBOX: Cloudflare.DurableObject<MailboxDO>("MailboxDO"),
    EMAIL_AGENT: Cloudflare.DurableObject<EmailAgent>("EmailAgent"),
    EMAIL_MCP: Cloudflare.DurableObject<EmailMCP>("EmailMCP"),
  },
}) {}

/** Typed runtime env, derived from the declared bindings — used by the app. */
export type WorkerEnv = Cloudflare.InferEnv<typeof Inbox>;

/**
 * The inbox's full resource set, yielded by the root stack on its production
 * stage. `allowedEmails` is the shared admin allow-list (one constant in the
 * root alchemy.run.ts covers the inbox and the operator console) — it fully
 * reconciles this app's Access policy on every deploy. Adoption is the root
 * stack's policy (AdoptPolicy.adopt(true)): resources here were owned by the
 * retired standalone AgenticInbox stack and adopt in place by pinned name.
 */
export const inboxResources = (allowedEmails: readonly string[]) =>
  Effect.gen(function* () {
    // Access allow-list as code (attached to the dashboard-managed app).
    yield* Cloudflare.Access.Policy("AccessPolicy", {
      name: ACCESS_POLICY_NAME,
      decision: "allow",
      include: allowedEmails.map((addr) => ({ email: { email: addr } })),
      adopt: true,
    });

    const site = yield* Inbox;

    // Inbound mail: zone referenced by NAME (resolved via lookup, never
    // owned). Routing enable provisions MX/TXT; the catch-all is a per-zone
    // singleton whose prior state alchemy restores on destroy.
    const routing = yield* Cloudflare.Email.Routing("EmailRouting", {
      zone: ZONE,
    });

    yield* Cloudflare.Email.CatchAll("EmailCatchAll", {
      zone: routing.zoneId,
      name: "agentic-inbox catch-all",
      enabled: true,
      actions: [{ type: "worker", value: [site.workerName] }],
    });

    return {
      url: `https://${APP_DOMAIN}`,
      workerName: site.workerName,
      accessAud: ACCESS_APP_AUD,
    };
  });
