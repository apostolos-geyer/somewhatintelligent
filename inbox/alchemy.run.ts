/**
 * Agentic Inbox — the entire deployment declared as an Alchemy Effect Stack.
 *
 * This file owns EVERYTHING the inbox worker needs to exist and function:
 *
 *   - the app build (runs this package's own `react-router build` — the
 *     upstream @cloudflare/vite-plugin toolchain, untouched)
 *   - the Worker `agentic-inbox-si` (built server bundle + client assets,
 *     custom domain, all runtime bindings)
 *   - the R2 attachments bucket
 *   - the three SQLite Durable Object namespaces (MailboxDO, EmailAgent,
 *     EmailMCP — classes exported by the built worker entry)
 *   - the Workers AI + send_email bindings
 *   - the Cloudflare Access policy + self-hosted application gating the app
 *     (POLICY_AUD is DERIVED from the application resource's `aud` output —
 *     no more hand-copied secret; replaces scripts/setup-access.mjs)
 *   - zone Email Routing + the catch-all rule forwarding inbound mail to the
 *     worker (replaces scripts/setup-email-routing.mjs)
 *
 * `wrangler.jsonc` is NO LONGER a deploy artifact. It remains in the repo
 * solely as the build/dev/typegen input for @cloudflare/vite-plugin
 * (`react-router dev`, `react-router build`, `wrangler types`). Deploys go
 * exclusively through this stack — do not run `wrangler deploy` or the
 * legacy setup:* scripts against this instance again; two owners will fight.
 *
 * ── First deploy (adopts the LIVE instance in place) ─────────────────────
 *
 *   # credentials: either `bun alchemy login` once (stored profile), or
 *   # non-interactive env-token auth with CI=1:
 *   CI=1
 *   CLOUDFLARE_API_TOKEN=...    # token with Workers/R2/Access/Email Routing/Zone scopes
 *   CLOUDFLARE_ACCOUNT_ID=c735c5a53d864bee37400befb7f4c7f4
 *   TEAM_DOMAIN=https://<team>.cloudflareaccess.com   # your Zero Trust team domain
 *
 *   bun alchemy deploy --stage prod
 *
 *   - adoption is baked into the stack (`AdoptPolicy.adopt(true)` piped on
 *     the stack effect below — no `--adopt` flag needed): the existing
 *     worker (incl. its live DO classes — matched by binding name, no new
 *     migrations), the R2 bucket, and the zone's email-routing state are
 *     all taken over in place.
 *   - the first run also bootstraps Alchemy's state-store worker into the
 *     account (prompted; pass --yes to auto-accept).
 *   - acceptance: a second `bun alchemy deploy` must show an EMPTY plan,
 *     then send yourself an email and check it lands.
 *
 * Subsequent deploys: `bun run deploy` (or `bun alchemy plan` to preview).
 */
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as AdoptPolicy from "alchemy/AdoptPolicy";
import * as Command from "alchemy/Command";
import * as Output from "alchemy/Output";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";

/** Physical worker name — matches the live instance; DO data is keyed to it. */
const WORKER_NAME = "agentic-inbox-si";

/** The zone that receives mail and hosts the web UI's custom domain. */
const ZONE = "somewhatintelligent.ca";

/** Web UI hostname AND the mail-receiving domain (the app's DOMAINS var). */
const APP_DOMAIN = "mail.somewhatintelligent.ca";

/**
 * Who may pass Cloudflare Access into the inbox. Edit this list to grant or
 * revoke access — it fully reconciles the Access policy on deploy.
 */
const ACCESS_ALLOWED_EMAILS = ["apostoli.geyer@geyerconsulting.com"];

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
const ACCESS_APP_AUD =
  "a0046cb0773459b27a32ff7123e52e18d985c2e4aa75df35ba35828ca096443f";

export default Alchemy.Stack(
  "AgenticInbox",
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function* () {
    // ── Build ────────────────────────────────────────────────────────────
    // The app's own toolchain, memoized: unchanged sources skip the build
    // and the worker upload diffs to a no-op.
    const build = yield* Command.Build("AppBuild", {
      command: "bun run build",
      outdir: "build",
    });

    // ── Data plane ───────────────────────────────────────────────────────
    // Existing bucket: name pinned to the live one; adopted via --adopt.
    const bucket = yield* Cloudflare.R2.Bucket("Bucket", {
      name: WORKER_NAME,
    });

    // ── Capability bindings ──────────────────────────────────────────────
    // The native `ai` binding (env.AI, plain Workers AI at runtime) is
    // produced by binding an AI Gateway resource — the gateway itself is the
    // only way alchemy models Workers AI for async workers.
    const ai = yield* Cloudflare.AI.Gateway("Ai", {
      id: WORKER_NAME,
    });

    // send_email: unrestricted, mirroring the current wrangler binding.
    const email = yield* Cloudflare.Email.SendEmail("Email");

    // ── Access (replaces setup-access.mjs) ───────────────────────────────
    const accessPolicy = yield* Cloudflare.Access.Policy("AccessPolicy", {
      name: ACCESS_POLICY_NAME,
      decision: "allow",
      include: ACCESS_ALLOWED_EMAILS.map((addr) => ({ email: { email: addr } })),
      adopt: true,
    });

    // NOTE: the Access application is deliberately NOT declared — see the
    // ACCESS_APP_AUD comment above. The adopted policy remains attached to
    // the dashboard-managed app; its allow-list still reconciles from
    // ACCESS_ALLOWED_EMAILS.
    void accessPolicy;

    // The Zero Trust team domain has no read-only lookup resource, so it is
    // the one deploy-time input (TEAM_DOMAIN in the environment / .env).
    const teamDomain = Config.string("TEAM_DOMAIN");

    // ── The worker ───────────────────────────────────────────────────────
    const worker = yield* Cloudflare.Worker("Inbox", {
      name: WORKER_NAME,
      main: Output.map(build.outdir, (dir) => `${dir}/server/index.js`),
      // The vite build's output is a prebuilt multi-module worker (the
      // generated wrangler.json sets no_bundle + ESModule rules). Re-bundling
      // it rewrites React Router's dynamic chunk imports and breaks routing
      // at runtime (site 404s) — upload it byte-for-byte instead. Alchemy's
      // default module rules match the generated config (ESModule **/*.js).
      bundle: false,
      // AssetsWithHash: the plain string/directory shape has no hash for the
      // differ to compare, so every plan conservatively reports the worker
      // as changed (WorkerProvider `hasChanged`). Passing Command.Build's
      // authoritative output hash restores the empty-plan no-op property.
      // (Cast mirrors upstream StaticSite.ts — the const-generic inference
      // can't see an Output-valued `hash` inside the assets literal.)
      assets: {
        directory: "build/client",
        hash: Output.map(build.hash, (h) => h.output ?? ""),
      } as unknown as Cloudflare.AssetsWithHash,
      compatibility: { date: "2025-11-28", flags: ["nodejs_compat"] },
      domain: APP_DOMAIN,
      // workers.dev disabled: mail.<zone> is the single, Access-gated
      // surface. (An ungated hostname would 403 anyway — the app fails
      // closed without the Access JWT — so the extra hostname is dead
      // weight.) Flip to `url: true` if you want the preview URL back.
      url: false,
      observability: { enabled: true },
      env: {
        DOMAINS: APP_DOMAIN,
        EMAIL_ADDRESSES: [],
        POLICY_AUD: ACCESS_APP_AUD,
        TEAM_DOMAIN: teamDomain,
        BUCKET: bucket,
        AI: ai,
        EMAIL: email,
        MAILBOX: Cloudflare.DurableObject("MailboxDO"),
        EMAIL_AGENT: Cloudflare.DurableObject("EmailAgent"),
        EMAIL_MCP: Cloudflare.DurableObject("EmailMCP"),
      },
    });

    // ── Inbound mail (replaces setup-email-routing.mjs) ──────────────────
    // Zone referenced by NAME — resolved via lookup, never owned by this
    // stack. Routing enable provisions MX/TXT; the catch-all is a per-zone
    // singleton whose prior state alchemy restores on destroy.
    const routing = yield* Cloudflare.Email.Routing("EmailRouting", {
      zone: ZONE,
    });

    yield* Cloudflare.Email.CatchAll("EmailCatchAll", {
      zone: routing.zoneId,
      name: "agentic-inbox catch-all",
      enabled: true,
      actions: [{ type: "worker", value: [worker.workerName] }],
    });

    return {
      url: `https://${APP_DOMAIN}`,
      workerName: worker.workerName,
      bucket: bucket.bucketName,
      accessAud: ACCESS_APP_AUD,
    };
    // Adoption is declared here, not via the `--adopt` CLI flag: this stack
    // deliberately takes over the pre-existing live instance, so any
    // resource whose read reports Unowned is adopted rather than failing.
  }).pipe(AdoptPolicy.adopt(true)),
);
