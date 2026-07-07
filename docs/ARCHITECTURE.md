---
title: Platform Architecture
subtitle: C4 reference for the platform-template monorepo
date: 2026-05-19
---

# Platform Architecture

A C4-style reference for the `platform-template` monorepo. Describes the platform as it currently runs.

> **Caveat.** This is a descriptive map, not a contract — it drifts as the code evolves. Treat claims here as a starting point for understanding the shape of things, not as ground truth. When a specific behavior matters (a file path, a function signature, an exact list of fields, an enforcement rule), verify against the source before relying on it. If you find a mismatch worth fixing, update this doc.

The platform is a Cloudflare Workers monorepo. Public traffic enters through a single Worker called **bouncer**. Bouncer resolves the user's session, stamps a signed attestation onto the forwarded request, and dispatches to one of several upstream Workers (apps or internal services) via service bindings. Apps trust bouncer's attestation, skip the redundant session lookup, and render. The session authority — Better Auth + the user database — lives in a Worker called **guestlist**, which only ever receives traffic over service bindings.

The template is opinionated about **TanStack Start** apps but the underlying primitives are framework-agnostic. You can drop in a Hono Worker, a plain `fetch` handler, or an Astro-on-Workers app and consume the same shared primitives (envelope verifier, guestlist client, request context, canonical log). The Start-specific helpers (`createPlatformStartApp`, the kit's `createDevEnvelopeStamper`) layer on top — but the worker `fetch` entry stays hand-written per app to keep the `@cloudflare/vite-plugin` HMR contract intact (see §3.3).

Dev/prod parity is explicit. Apps run alone in development (no bouncer in front, just service bindings to guestlist) and the same code paths route to guestlist. The same apps in production require a valid bouncer attestation envelope or return 403. The behavioral split is two `ENVIRONMENT` checks, both encoded inside `@si/auth`'s verifier — never scattered across app code.

---

# §1 — Context

The system from outside in.

```mermaid
flowchart LR
  user(["End User<br/>browser"]):::person
  dev(["Developer<br/>operator"]):::person

  subgraph platform["Platform"]
    spine["Platform Spine<br/><i>Cloudflare Workers monorepo</i><br/>bouncer · apps · guestlist · roadie · promoter"]:::system
  end

  cf["Cloudflare Edge<br/><i>TLS / DDoS / routing</i>"]:::ext
  d1[("Cloudflare D1<br/><i>guestlist + roadie</i>")]:::ext
  r2[("Cloudflare R2 / S3<br/><i>roadie blobs</i>")]:::ext
  resend["Resend<br/><i>outbound email</i>"]:::ext
  idp["OAuth providers<br/><i>Google · Microsoft · Facebook · LinkedIn</i>"]:::ext

  user -->|HTTPS| cf
  cf -->|service binding to bouncer| spine
  dev -->|wrangler dev / deploy| spine
  spine -->|SQL| d1
  spine -->|S3 API + signed URLs| r2
  spine -->|REST| resend
  spine -->|OAuth 2.1 / OIDC| idp

  classDef person fill:#08427b,stroke:#073b6f,color:#fff
  classDef system fill:#1168bd,stroke:#0b4884,color:#fff
  classDef ext fill:#999,stroke:#6b6b6b,color:#fff
```

**Actors.**

- **End User** — a browser. Uses one or more apps mounted under the platform's single host per environment (e.g., `platform.example/account` for identity, `platform.example/shop` for a storefront app). One Better Auth cookie scoped to the apex domain authenticates all apps.
- **Developer / Operator** — the person running the monorepo. Runs `bun run dev` locally or `wrangler deploy` to ship. Operates the platform; not an end user of the apps it hosts.

**External dependencies.**

- **Cloudflare Edge** — TLS termination + DDoS + request routing. Every public host in the platform is a CF Custom Domain pointing at the bouncer Worker.
- **Cloudflare D1** — relational store. Guestlist owns the auth schema (users, sessions, accounts, two-factor, organizations). Roadie owns the blob index. No app directly accesses any D1.
- **Cloudflare R2 / S3-compatible storage** — roadie's blob backend. App workers never touch R2 directly; they request signed PUT/GET URLs from roadie.
- **Resend** — promoter's email backend. App workers never call Resend directly.
- **OAuth providers** — Google, Microsoft, Facebook, LinkedIn. Optional. Wired in guestlist's `auth-config.ts` when client ids/secrets are present in env.

---

# §2 — Containers

The deployed Workers and what they do.

```mermaid
flowchart LR
  user(["End User<br/>browser"]):::person

  subgraph platform["Platform Spine — Cloudflare Workers"]
    direction TB
    bouncer["<b>bouncer</b><br/><i>TS Worker</i><br/>public ingress · session refresh<br/>envelope mint · dispatch"]:::ctr

    subgraph apps["Apps — TSS or any CF framework"]
      direction LR
      identity["<b>identity</b><br/><i>TSS app</i><br/>sign-in · account · admin"]:::ctr
      other["<b>other apps</b><br/><i>store · ...</i>"]:::ctr
    end

    guestlist["<b>guestlist</b><br/><i>TS Worker — Elysia + BA</i><br/>auth API · session authority"]:::ctr
    roadie["<b>roadie</b><br/><i>TS Worker</i><br/>blob storage + signed URLs"]:::ctr
    promoter["<b>promoter</b><br/><i>TS Worker</i><br/>outbound email"]:::ctr
  end

  d1b[("guestlist D1<br/><i>users · sessions · accounts</i>")]:::db
  d1r[("roadie D1<br/><i>blob index</i>")]:::db
  r2[("R2<br/><i>object storage</i>")]:::ext
  resend["Resend<br/><i>email</i>"]:::ext

  user -->|"HTTPS baseDomain (path-mounted)"| bouncer
  bouncer -->|"session resolve · /api proxy"| guestlist
  bouncer -->|"stamped request + envelope"| identity
  bouncer -->|"stamped request + envelope"| other

  identity -.->|"fallback + admin RPC"| guestlist
  other -.->|"fallback"| guestlist
  other -->|"blob grants"| roadie
  other -->|"email send"| promoter

  guestlist --> d1b
  roadie --> d1r
  roadie --> r2
  promoter --> resend

  classDef person fill:#08427b,stroke:#073b6f,color:#fff
  classDef ctr fill:#438dd5,stroke:#2e6295,color:#fff
  classDef db fill:#3a6a9e,stroke:#1d3a5c,color:#fff
  classDef ext fill:#999,stroke:#6b6b6b,color:#fff
```

## §2.1 Containers in detail

| Container          | Role                                                                                                                                                                                                                                                                                                                                                                                                                | Public host?                                                                                                                                   | Holds secrets?                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **bouncer**        | Single public ingress. Resolves session via guestlist. Mints + stamps bouncer attestation envelope. Dispatches to apps (passthrough or mounted-microfrontend mode). Strips privileged headers from inbound and outbound traffic.                                                                                                                                                                                    | Yes — every public hostname is a bouncer Custom Domain.                                                                                        | `BNC_ATT_PRIV` (Ed25519 private key for envelope signing). No `BETTER_AUTH_SECRET`.              |
| **guestlist**      | Sole authority on session validity. Owns Better Auth wiring, the user database, plugin set (passkey, twoFactor, oauthProvider, admin, organization). Exposes `/api/auth/*` (BA handler), `/api/avatar/*` (presigned-upload flow via roadie), `/admin/*` (sessions, stats, API keys, OAuth clients), `/user/connections`, `/u/avatar/:refId` (public avatar read broker), `/providers`, `/.well-known/*`, `/health`. | No public Custom Domain in the target topology. Reached only via service bindings (from bouncer for `/api`/`/u`, from apps for session/admin). | `BETTER_AUTH_SECRET`, OAuth client secrets, internal API tokens.                                 |
| **roadie**         | Blob storage and signed-URL minting for app-uploaded files. Apps request "give me a PUT URL for blob X for user Y"; roadie validates and returns a presigned R2 URL.                                                                                                                                                                                                                                                | No public Custom Domain.                                                                                                                       | `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, signed-meta secret.                                  |
| **promoter**       | Outbound transactional email. Wraps Resend behind a typed RPC surface (`sendVerificationEmail`, `sendMagicLinkEmail`, etc.). Apps don't speak to Resend; they speak to promoter over a service binding.                                                                                                                                                                                                             | No public Custom Domain.                                                                                                                       | `RESEND_API_KEY`, signed-meta secret.                                                            |
| **identity** (app) | Sign-in, sign-up, account settings, admin sessions surface. The reference TanStack Start app.                                                                                                                                                                                                                                                                                                                       | No direct host. `<baseDomain>/account` is bouncer → identity (vmf-mounted).                                                                    | None at the app level. `BOUNCER_ATTESTATION_KEYS` is committed code (public keys), not a secret. |
| **other apps**     | Product-specific. Each app reaches the same primitives via the same kit factories. May be TSS or any other CF-deployable framework.                                                                                                                                                                                                                                                                                 | Each gets a path mount under the shared host, owned by bouncer (passthrough or vmf) — e.g. `store` at `<baseDomain>/shop`.                     | None.                                                                                            |

## §2.2 Service binding graph

The trust graph is a DAG:

```mermaid
flowchart TD
  edge[Cloudflare Edge] --> gw[bouncer]
  gw --> idn[identity]
  gw --> other[other apps]
  gw -->|"session resolve · /api proxy"| bnc[(guestlist)]
  idn -.->|"fallback + admin RPC"| bnc
  other -.->|"fallback"| bnc
  other --> roadie[(roadie)]
  other --> promoter[(promoter)]

  classDef def fill:#e8e8ff,stroke:#5b5b9c
  class edge,gw,idn,other,bnc,roadie,promoter def
```

- **Bouncer** binds to every app and to guestlist. Bouncer never binds to roadie or promoter (no use case).
- **Apps** bind to guestlist (session fallback + `/api/auth` proxy + user search for in-app pickers), and where useful to roadie (blob grants) and promoter (email).
- **Apps** do not bind to each other. App-to-app communication, when needed, is mediated by bouncer or by a shared service.
- **Guestlist, roadie, promoter** do not bind to anything inside the platform — they're leaves.

This shape is what makes the security model tractable: the platform's only inbound surface from the public Internet is bouncer, and the platform's authority chain converges on guestlist.

---

# §3 — Components

This section drops one level deeper into each Worker. Component diagrams + the load-bearing files.

## §3.1 bouncer

```mermaid
flowchart LR
  subgraph gw["bouncer Worker — request stages"]
    direction LR
    entry[entry<br/>src/index.ts]:::cmp
    refresh[session refresh<br/>src/session.ts]:::cmp
    envelope[envelope mint<br/>src/envelope.ts]:::cmp
    routematch[route match<br/>src/routes.ts]:::cmp
    stamp[header stamp<br/>src/proxy.ts]:::cmp
    dispatch[dispatch<br/>src/proxy.ts]:::cmp
    rstrip[response strip<br/>src/proxy.ts]:::cmp

    entry --> refresh --> envelope --> routematch --> stamp --> dispatch --> rstrip
  end

  routes_cfg[(ROUTES<br/>wrangler var)]:::db
  bnc_secret[(BNC_ATT_PRIV<br/>wrangler secret)]:::db

  envelope -.->|signs with| bnc_secret
  routematch -.->|reads| routes_cfg

  classDef cmp fill:#85bbf0,stroke:#5d82a8,color:#000
  classDef db fill:#3a6a9e,stroke:#1d3a5c,color:#fff
```

| stage             | file              | what it does                                                                                             |
| ----------------- | ----------------- | -------------------------------------------------------------------------------------------------------- |
| `entry`           | `src/index.ts`    | fetch handler; opens request context; runs stages in order                                               |
| `session refresh` | `src/session.ts`  | calls `guestlist.getSession()` over service binding; captures actor, session projection, refresh cookies |
| `envelope mint`   | `src/envelope.ts` | builds Ed25519-signed attestation payload from resolved `{ actor, session }`                             |
| `route match`     | `src/routes.ts`   | compiled host+path matcher; produces a route binding + mode                                              |
| `header stamp`    | `src/proxy.ts`    | strips inbound `x-platform-*`; stamps bouncer-authored values + the envelope                             |
| `dispatch`        | `src/proxy.ts`    | forwards to upstream via service binding (passthrough or VMF mode)                                       |
| `response strip`  | `src/proxy.ts`    | strips `x-platform-att` from upstream response before returning                                          |

**Request lifecycle.**

```mermaid
sequenceDiagram
  autonumber
  participant U as Browser
  participant CF as Cloudflare Edge
  participant GW as bouncer
  participant B as guestlist
  participant A as app

  U->>CF: HTTPS GET /dashboard
  CF->>GW: forwards (cf-request-id set by edge)
  GW->>GW: extractPlatformRequestId(request)
  GW->>B: getSession(cookies) over service binding
  B-->>GW: { user, session } | null (+ possible cookie refresh)
  GW->>GW: mintEnvelope({ actor, host, exp, iat, kid })
  GW->>GW: strip + stamp x-platform-* headers
  GW->>A: forwarded request (with x-platform-att + browser cookies)
  A->>A: verifyEnvelope(headers, host)
  alt route only needs identity
    A->>A: platform.getEnvelope() → { actor, session projection }
  else route needs full BA session
    A->>B: platform.getSession() over service binding (cookies forwarded)
    B-->>A: full BA-inferred PlatformSession
  end
  A-->>GW: response
  GW->>GW: strip x-platform-att from response
  GW-->>CF: response (+ Set-Cookie from refresh)
  CF-->>U: HTTPS response
```

**Notes.**

- Step 4 is bouncer's only guestlist hop. Whether app pays a second hop is the app's choice (step 9 vs. step 11): identity-only consumers call `platform.getEnvelope()` and pay nothing; routes that need full BA session metadata (`twoFactorEnabled`, `createdAt`, etc.) call `platform.getSession()` which RPCs guestlist with the inbound cookies (~1ms same-colo).
- Browser cookies flow through bouncer to the app unchanged — bouncer's strip-and-stamp only touches `x-platform-*` headers (see §4.1.3). That's what lets `platform.getSession()` authenticate at guestlist without any envelope-to-session synthesis: the cookie is the source of truth, the envelope is the signed origin assertion.
- Step 6's strip is the hygiene rule: never let a client-supplied `x-platform-*` header survive into upstream.
- If step 4's `guestlist.getSession()` returns `null` (no session, or expired), the envelope carries `actor: null` and `session: null`. The envelope is still stamped — every bouncer-forwarded request gets one, so the prod enforcement check is uniform. The verifier enforces the cross-field invariant `actor === null ⟺ session === null`.
- Bouncer's `ROUTES` config carries no auth-requirement flag — it dispatches every matched route the same way regardless of `actor`. Redirecting anonymous users to sign-in is the app's responsibility (route guards built on `createPrincipalGate` / `requireUserMiddleware`), not bouncer's.

## §3.2 guestlist

```mermaid
flowchart LR
  subgraph bnc["guestlist Worker"]
    direction LR
    b_entry[entry + ALS<br/>src/index.ts]:::cmp
    b_routes[Elysia routes<br/>src/index.ts]:::cmp
    b_ba[Better Auth<br/>src/auth-config.ts]:::cmp
    b_schema[schema<br/>src/schema.ts]:::cmp
  end

  b_client[client factory<br/>src/client/guestlist.ts<br/><i>consumed by apps</i>]:::cmp
  d1[(guestlist D1)]:::db
  ba_secret[(BETTER_AUTH_SECRET)]:::db

  b_entry --> b_routes --> b_ba --> b_schema --> d1
  b_ba -.->|"signs cookies with"| ba_secret

  classDef cmp fill:#85bbf0,stroke:#5d82a8,color:#000
  classDef db fill:#3a6a9e,stroke:#1d3a5c,color:#fff
```

| component      | role                                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| entry + ALS    | wraps fetch in `executionContext` + `withRequestContext`; reads `x-platform-*` as log correlation only                                |
| Elysia routes  | mounts `/api/auth/*`, `/api/avatar/*`, `/admin/*`, `/user/connections`, `/u/avatar/:refId`, `/health`, `/providers`, `/.well-known/*` |
| Better Auth    | BA instance with plugin set (passkey, twoFactor, oauthProvider, admin, organization)                                                  |
| schema         | Drizzle schema: user, session, account, twoFactor, organization tables                                                                |
| client factory | `createGuestlistClient(...)` — apps consume this to call guestlist over their service binding                                         |

**Invariants.**

1. **Guestlist is the sole holder of `BETTER_AUTH_SECRET`.** No other Worker. Cookie validation lives where the secret lives.
2. **Guestlist is reached only via service binding in the target topology.** It has no public Custom Domain. The bouncer proxies `/api/auth/*` and `/u/*` under the shared host to guestlist; that proxy is the only public path to guestlist.
3. **`x-platform-actor-*` headers at guestlist's boundary are log-correlation only.** They never feed authz. Authoritative actor identity at guestlist always derives from the cookie. (Comment that pins this lives at `workers/guestlist/src/index.ts` boundary; see §4.1.4.)

## §3.3 apps (identity)

```mermaid
flowchart LR
  subgraph idn["app Worker — TanStack Start"]
    direction LR
    w_entry[worker entry<br/>src/worker.ts<br/><i>hand-written</i>]:::cmp
    platform_obj[platform<br/>src/lib/platform.ts]:::cmp
    routes_node[TSS routes<br/>src/routes/]:::cmp
    session_fn[loadSession<br/>src/lib/session.functions.ts]:::cmp
  end

  subgraph kit["@si/* primitives"]
    direction TB
    kit_env[envelope verifier]:::extcmp
    kit_bnc[guestlist client]:::extcmp
    kit_ctx[request context]:::extcmp
    kit_dev[dev envelope stamper]:::extcmp
  end

  w_entry --> platform_obj
  routes_node --> platform_obj
  routes_node --> session_fn
  session_fn --> platform_obj
  platform_obj --> kit_env
  platform_obj --> kit_bnc
  platform_obj -.-> kit_ctx
  platform_obj -.->|opt-in| kit_dev

  classDef cmp fill:#85bbf0,stroke:#5d82a8,color:#000
  classDef extcmp fill:#cccccc,stroke:#888,color:#000
```

| component      | role                                                                                                                                                                                                                                                                                                                    |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `worker entry` | Hand-written `export default { fetch(...) }` that imports `@tanstack/react-start/server-entry` directly. Wrapping it inside a workspace package's factory breaks `@cloudflare/vite-plugin` HMR (the static `server-entry` import can't be roundtripped through a kit module), so each app keeps its own ~10-line entry. |
| `platform`     | `createPlatformStartApp({ name, ... })` — single wiring file; exposes `getEnvelope`, `getSession`, `getActiveOrgId`, `getGuestlist`, `envelopeMiddleware`, `apiProxyHandlers`, `makeAuthProvider`, `devEnvelopeStamper`.                                                                                                |
| `TSS routes`   | identity: sign-in / sign-up / account / admin-sessions / `/api/$` catch-all.                                                                                                                                                                                                                                            |
| `loadSession`  | `createServerFn` wrapper around `platform.getSession(getRequestHeaders())` — 5 lines, required at app top-level by the TSS compiler                                                                                                                                                                                     |

**Per-app file budget.** Roughly ~50 code lines + ~80 lines of load-bearing comment per TSS app — most of the comment volume documents constraints (TSS HMR / bundle-leakage / `Register.server.requestContext` augmentation) that bite if you forget them.

```
workers/identity/src/
├── worker.ts                       # ~10 code lines (+ 21-line HMR rationale comment)
├── lib/
│   ├── platform.ts                 # ~10 code lines (+ 16-line comment block)
│   ├── session.functions.ts        # 5 code lines  — createServerFn wrapper (required by TSS compiler)
│   ├── auth-context.ts             # ~10 lines — wraps kit's createReactStartAuthProvider
│   ├── guestlist.ts                # ~10 lines — wires createGuestlistFactory with the app's name
│   └── (app-specific helpers)
├── routes/
│   ├── api/$.ts                    # ~30 code lines — apiProxyHandlers + request-context header seeding
│   ├── __root.tsx                  # standard TSS root; uses AuthProvider + loadSession
│   └── ...
├── app-brand.ts                    # APP_PRODUCT_NAME (per-app)
└── wrangler.jsonc         # bindings: GUESTLIST, ROADIE?, PROMOTER?
```

The kit's `createDevEnvelopeStamper` is opt-in per app (passed via `devEnvelopeSigner` + `devEnvelopeGuestlist` to `createPlatformStartApp`). Identity doesn't opt in — its TSS server fns cookie-authenticate against guestlist directly. See §4.5.

## §3.4 roadie

Roadie is a small Worker that owns the platform's blob plane. Apps don't directly hold S3 credentials; they request signed PUT/GET URLs from roadie. Roadie records the blob in its D1 index and returns presigned R2 URLs. The S3 SigV4 credentials live in roadie's secret set; the R2 bucket binding lives only in roadie's `wrangler.jsonc`.

```mermaid
flowchart LR
  App[App Worker] -->|"requestBlobUploadUrl({ blob meta })"| Roadie
  Roadie -->|"validate meta + record in D1"| D1[(roadie D1)]
  Roadie -->|"return signed PUT URL"| App
  App -->|"return signed URL to browser"| Browser
  Browser -->|"PUT bytes directly to R2"| R2[(R2)]
```

**Trust model.** Roadie is reached only over service bindings from app workers inside the platform — no public Custom Domain, no inbound traffic from outside the trust boundary. Identity travels in the RPC `meta` parameter the calling app provides (validated for shape but not for cryptographic origin), so roadie trusts the caller absolutely. The protection that matters is keeping roadie unreachable from outside the platform — the wrangler-config lint forbids `workers_dev: true` and any `routes`/`custom_domain` entries on leaf services. A future hardening would have roadie run the bouncer envelope verifier on the inbound request the same way an app does (the envelope flows through bouncer → app → roadie unchanged); the primitive exists in `@si/auth` already. Same goes for issuing a signed-meta token alongside the R2 URL so the browser PUT can't be forged from a leaked URL without the matching token. Not implemented today.

## §3.5 promoter

Promoter is similar in shape but for email. Apps call typed RPCs over a service binding (`send({ kind: "verification", to, code })` and friends); promoter formats via templates and dispatches via Resend. Apps never hold `RESEND_API_KEY`.

**Trust model.** Same posture as roadie: service-binding-only callee, no public Custom Domain, identity from the RPC `meta` parameter. Same future hardening applies — envelope verification on the inbound side, a signed-meta token for outbound-email idempotency. Not implemented today.

---

# §4 — Shared Patterns

The substance. This section documents the cross-cutting patterns every app and service participates in.

## §4.1 Security

### §4.1.1 The internal header contract: `x-platform-*`

The platform speaks one well-typed internal header family. **Only bouncer translates `cf-*` to `x-platform-*`.** Apps and services never read `cf-*` directly.

```ts
// @si/auth/platform-headers (target — moved out of guestlist client)
export const PLATFORM_HEADERS = {
  rid: "x-platform-rid", // canonical request id
  att: "x-platform-att", // bouncer attestation envelope (JWS)
  caller: "x-platform-caller", // calling worker name: "bouncer", "identity", ...
  actor: {
    kind: "x-platform-actor-kind", // "user" | "service"  — log correlation only
    id: "x-platform-actor-id", // string              — log correlation only
  },
} as const;

export interface PlatformRequestContract {
  rid: string; // required on every internal request
  att?: string; // present on bouncer → app traffic; absent on worker → worker traffic
  caller?: string;
  actorKind?: "user" | "service";
  actorId?: string;
}
```

Why this exists:

- **One family, one place to grep.** Every privileged header has the `x-platform-` prefix. Adding a sixth field is a one-file edit.
- **Type-safe.** The constant + interface get imported anywhere the boundary reads or writes.
- **Framework-agnostic.** The contract has nothing to do with TanStack Start, Hono, or any other web framework. It applies to every CF Worker that participates in the platform.
- **Decouples from Cloudflare.** A future port to a non-CF runtime touches bouncer only; everything else already speaks the internal contract.

### §4.1.2 Bouncer attestation envelope

Bouncer stamps an Ed25519-signed JWS envelope on every forwarded request — authed or not, public-page or admin-only.

**Envelope shape (signed payload).**

```ts
type EnvelopePayload = {
  v: 1; // version
  iss: "bouncer"; // issuer
  iat: number; // epoch seconds (issue time)
  exp: number; // iat + 30 seconds
  host: string; // public host bouncer routed (lowercased, no port)
  actor: EnvelopeActorUser | null; // null for public/optional traffic
  session: EnvelopeSessionData | null; // null iff actor is null
  activeOrgId?: string | null; // BA org plugin's resolved active org id,
  // denormalized at mint time so apps can
  // gate org-scoped UI without a guestlist
  // hop. `null` for actors with no active org.
};

type EnvelopeActorUser = {
  kind: "user";
  id: string;
  role: string | null;
  // Common UX fields — enough to render avatar/menu/header
  // without an app-side guestlist hop. Anything beyond this
  // (org membership, 2FA state, etc.) goes through guestlist.
  name?: string;
  email?: string;
  image?: string | null;
};

// Safe subset of BA's full session — id/userId/expiresAt only. No `token`
// (that's the cookie itself), no `ipAddress`/`userAgent` (stale by verify
// time — apps read current values from `cf-connecting-ip` / `user-agent`).
type EnvelopeSessionData = {
  id: string;
  userId: string;
  expiresAt: number; // epoch seconds
};
```

The verifier enforces a cross-field invariant: `actor === null ⟺ session === null`. A signed envelope with one populated and the other null is rejected as `invalid: "actor_session_mismatch"`. `activeOrgId` is not coupled to the invariant — an authenticated actor with no active org has `activeOrgId: null`.

**Header (JOSE-compact).**

```
x-platform-att: <b64url(joseHeader)>.<b64url(payload)>.<b64url(sig)>

joseHeader = { "alg": "EdDSA", "kid": "gw-2026-05" }
```

**Crypto choice.** Ed25519 (`alg: "EdDSA"`):

- Bouncer holds the private key as a single wrangler secret (`BNC_ATT_PRIV`).
- Apps hold only the public key set, committed as code in `packages/config/src/bouncer-attestation.ts`. **Public keys are not secrets.** Zero new secrets to manage on apps.
- Verification cost ~0.1 ms per request inside a CF Worker.
- `kid` lets the verifier accept a key set (old + new) during rotation; no flag day.

**Anti-replay properties.**

- `host` field binds the envelope to the routed hostname. A stolen envelope minted for `staging.<baseDomain>` is rejected on `<baseDomain>` (production), and vice versa. Apps sharing one host via path mounts (e.g. `/account`, `/shop`) share that host's envelope trust — the mount boundary between them is enforced by bouncer's routing, not by the envelope.
- `exp = iat + 30s`. Replay window is 30 seconds, matching the standard JWT compromise — no server-side nonce store required.
- `alg` is hardcoded `"EdDSA"` in the verifier; `alg: "none"` and algorithm-confusion attacks are rejected.
- Unknown `kid` is rejected (no fall-open behavior).

### §4.1.3 Header strip + stamp at bouncer

Bouncer is the only worker that writes `x-platform-*` headers onto requests. The strip-then-stamp rule guarantees no client-supplied privileged header survives the proxy boundary, regardless of how the client crafted the request.

```ts
// workers/bouncer/src/proxy.ts (target shape)
function stampUpstreamHeaders(
  request: Request,
  envelope: string,
  actor: { kind: "user"; id: string } | null,
): Request {
  const headers = new Headers(request.headers);

  // STRIP — privileged platform-family headers; client values never survive.
  headers.delete("x-platform-rid");
  headers.delete("x-platform-att");
  headers.delete("x-platform-caller");
  headers.delete("x-platform-actor-kind");
  headers.delete("x-platform-actor-id");

  // STAMP — values authored by bouncer from its request context.
  headers.set("x-platform-rid", getPlatformRid());
  headers.set("x-platform-caller", "bouncer");
  headers.set("x-platform-att", envelope);
  if (actor) {
    headers.set("x-platform-actor-kind", actor.kind);
    headers.set("x-platform-actor-id", actor.id);
  }

  // cf-* headers are LEFT IN PLACE — they're informational (cf-connecting-ip,
  // cf-ipcountry, etc.) and apps are free to consume them. They are NEVER the
  // source of identity or request id downstream.

  return new Request(request, { headers });
}
```

**On the response side**, bouncer also strips `x-platform-att` from upstream responses before returning to the client. The envelope is internal-only; it should never leak to a browser.

### §4.1.4 Verification on the app side

Apps verify envelopes through a single shared primitive in `@si/auth`.

```ts
// @si/auth/createBouncerEnvelopeVerifier (framework-agnostic)
export function createBouncerEnvelopeVerifier(opts: {
  keys: Record<string, string>; // kid → base64-PEM Ed25519 pubkey
  env: "development" | "staging" | "production";
  expectedHost: (req: Request) => string; // typically req.url.hostname
}): (req: Request) => Promise<EnvelopeResult>;

type EnvelopeResult =
  | {
      kind: "valid";
      actor: EnvelopeActorUser | null;
      session: EnvelopeSessionData | null;
    }
  | { kind: "missing" } // no x-platform-att header
  | { kind: "invalid"; reason: string };
```

**Dev/prod enforcement matrix.** Baked into the verifier — apps don't repeat the logic.

| `ENVIRONMENT` | envelope missing                                            | envelope invalid                   |
| ------------- | ----------------------------------------------------------- | ---------------------------------- |
| `development` | `kind: "missing"` → apps fall back to direct guestlist call | log + same fallback                |
| `staging`     | same as dev (warning log)                                   | same as dev (warning log)          |
| `production`  | **throw `403 — bouncer_required`**                          | **throw `403 — envelope_invalid`** |

The verifier factory itself **asserts at construction time that `keys` is non-empty when `env === "production"`**. A worker deployed to production with no key set fails to boot, not silently fails open at request time.

### §4.1.5 Defense in depth

Two layers always hold:

1. **The app's own route guards** (`createPrincipalGate` / `requireUserMiddleware` and friends) enforce UX policy — redirecting anonymous users to sign-in, gating admin routes. Bouncer dispatches every matched route uniformly and attaches the actor for downstream to read; it does not gate on auth itself.
2. **The app's verifier runs as a precondition** on every `platform.getEnvelope()` and `platform.getSession()` call inside loaders/middleware. In prod the verifier throws `403 — bouncer_required` / `envelope_invalid` on missing/tampered envelopes — that's the security backstop; in dev/staging it returns `kind: "missing"` and identity-only consumers see `null` (apps that need full session still cookie-authenticate against guestlist the same way).

A route guard that forgets to gate a page is a UX bug, not a security hole — a missing or tampered envelope in prod is still caught by the verifier (403). Both must hold; neither replaces the other.

## §4.2 User identity & session access

Apps never deal with JWS, headers, or envelopes directly. The platform exposes **three reader functions** — the envelope is intentionally not synthesized into a "session" by the kit, because the envelope's narrow payload can't honestly satisfy Better Auth's full plugin-merged session shape. Picking which one to call is the only thing app code thinks about.

```ts
// Fast path — narrow, signed, no I/O.
// Use for auth gates, log correlation, header chrome.
const env = await platform.getEnvelope(headers);
if (env) {
  env.actor.id;
  env.actor.role;
  env.actor.email; // optional
  env.session.expiresAt; // epoch seconds
}

// Org id — narrow, signed, no I/O. Pre-stamped on the envelope at mint time.
// Use for org-scoped UI gates that don't need full membership metadata.
const orgId = await platform.getActiveOrgId(headers); // string | null

// Full path — BA-inferred `PlatformSession`, ~1ms service-binding hop.
// Use for plugin-extended fields (twoFactorEnabled, createdAt, username, etc.).
const session = await platform.getSession(headers);
if (session) {
  session.user.id;
  session.user.twoFactorEnabled; // BA admin/2FA plugin field
  session.session.token; // BA-managed cookie value
}
```

All three run the envelope verifier as a precondition, so production's "every request must originate through bouncer" guarantee holds. The split is purely about whether the caller is willing to make a guestlist service-binding RPC (`getSession`) or can read what the envelope already carries (`getEnvelope`, `getActiveOrgId`).

`createPlatformStartApp` also returns supporting middleware and provider factories so apps don't have to wire the readers per route:

- `envelopeMiddleware` — TSS middleware that runs the verifier once and exposes `ctx.principal` (`{ kind: "user", actor, session, activeOrgId }` or `{ kind: "anonymous" }`). Used by `createPrincipalGate(...)` to build per-app `requireUserMiddleware` / `requireAdminMiddleware`.
- `apiProxyHandlers` — handlers object for `/api/$.ts` that proxies `/api/auth/*` and `/api/avatar/*` to guestlist over the service binding, seeding the platform header contract.
- `makeAuthProvider` — session-driven `AuthProvider` factory for client-side auth state; not used by `identity` today (which uses `envelopeMiddleware` and `createReactStartAuthProvider` directly). `@si/kit` has no `sessionMiddleware`/`createSessionMiddleware` export — `makeAuthProvider` is the kit's only session-driven client-auth factory.
- `devEnvelopeStamper` — per-app opt-in for dev-direct topology; see §4.5.

**Type relationship.** `PlatformSession` is a strict superset of `EnvelopeData`'s relevant fields — same `user.id`, same `user.email`, etc. Anywhere envelope data is enough, the full session also works; anywhere the full session is required, the envelope can't substitute (it doesn't carry the BA-plugin extras). Apps don't have to choose one model — they pick per call site:

- Route loader for a public-page header → `getEnvelope()`.
- Route loader for `/account` (reads `twoFactorEnabled`, `emailVerified`) → `getSession()`.
- Server-fn auth gate (just needs `user.id`) → `envelopeMiddleware` → `ctx.principal.actor.id`.
- Org-scoped server-fn (gates on the caller's active org) → `getActiveOrgId()`.
- Admin impersonation panel (reads `session.impersonatedBy`) → `getSession()`.

**Cookies still flow through.** Bouncer's strip-and-stamp doesn't touch the `Cookie` header. Apps' guestlist client (`getCookies()` from `@tanstack/react-start/server` → service-binding RPC) authenticates against the same session the browser sent. The envelope is the signed bouncer-origin assertion; the cookie remains the actual auth credential.

**Apps authenticate via the envelope, not a local cookie reader.** `@si/auth` exposes no entrypoint for apps to verify the session cookie directly. No app needs `BETTER_AUTH_SECRET` — that secret lives in guestlist alone (§3.2 invariant #1).

## §4.3 Cross-worker communication

All worker-to-worker communication is via Cloudflare service bindings. **Never via public HTTP.** Three patterns:

### §4.3.1 App → guestlist

Apps wire `createGuestlistClient(...)` once via `createPlatformStartApp`. The returned client looks like:

```ts
platform.getGuestlist().getSession();
platform.getGuestlist().listUserSessions({ userId });
platform.getGuestlist().admin.banUser({ userId, reason });
```

The factory sets the `x-platform-caller` header to the app's name, forwards `x-platform-rid` from the active request context, and passes through cookies on calls that need them (e.g., `getSession`). Guestlist reads these headers as log-correlation context only.

### §4.3.2 App → roadie / promoter

Same pattern. Each service exposes a typed RPC client (`createRoadieClient`, `createPromoterClient`) plumbed through the same `createPlatformStartApp`-returned object:

```ts
platform.getRoadie().requestUploadUrl({ blobMeta });
platform.getPromoter().sendVerificationEmail({ to, code });
```

### §4.3.3 Bouncer → app

Bouncer uses the raw `Fetcher` from its service binding (no typed client) because bouncer is proxying arbitrary HTTP, not making typed RPCs. The fetcher dispatches the (modified) `Request` to the upstream worker via `upstream.fetch(request)`. Same call pattern handles WebSocket upgrades (see §4.6).

## §4.4 Request lifecycle & correlation

Every Worker opens an ALS request scope at its `fetch` boundary. The scope carries `{ requestId, actorKind, actorId, callerApp }` and is read by canonical-log emission, service-client headers, and middleware.

```ts
// Every worker entry follows this shape:
export default {
  async fetch(request, env, ctx) {
    return withRequestContext({ requestId: extractPlatformRequestId(request) }, () =>
      withRequestLog({ service: "<name>" }, request, async (log) => {
        // ... actual handler
      }),
    );
  },
} satisfies ExportedHandler<Env>;
```

Every app hand-writes its `worker.ts` along these lines — the kit deliberately does **not** ship a factory wrapper. Wrapping the entry inside a workspace package's factory breaks `@cloudflare/vite-plugin` HMR: the static import of `@tanstack/react-start/server-entry` from a kit module can't be roundtripped on HMR re-eval, so `createStartHandler` resolves to `undefined` after the first route-file edit. Keeping the entry flat lets the vite plugin handle the static import correctly. The kit exports `extractPlatformStartContext(request)` to do the request-context seeding, but the surrounding `export default { fetch }` stays in the app.

**`extractPlatformRequestId(request)` fallback chain.** A tiered lookup that works in every topology:

```ts
export function extractPlatformRequestId(req: Request): string {
  // 1. Internal contract — set by bouncer, or by an upstream platform caller.
  const internal = req.headers.get(PLATFORM_HEADERS.rid);
  if (internal) return internal;
  // 2. Only bouncer gets here when CF is in front — it reads cf-request-id
  //    via its dedicated extractor. Other workers don't, because they're
  //    only reached via service binding from another platform worker that
  //    has already set x-platform-rid.
  // 3. Dev-app-alone, or any path without an upstream platform caller — mint.
  return crypto.randomUUID();
}
```

Bouncer itself has a slightly different entry — it reads `cf-request-id` because it sits behind CF's edge and the public Internet's "client" doesn't speak the platform contract.

## §4.5 Dev/prod parity & the dev-direct topology

Apps must run alone in development without bouncer in front. The same code runs in both topologies; the behavioral difference is encoded in `ENVIRONMENT`.

**The two topologies.**

```mermaid
flowchart LR
  subgraph prod [Production topology]
    direction LR
    P_user[Browser] --> P_cf[CF edge]
    P_cf --> P_gw[bouncer]
    P_gw -->|x-platform-att| P_app[app]
    P_app -.->|fallback only| P_bnc[guestlist]
    P_gw --> P_bnc
  end

  subgraph dev [Dev-direct topology]
    direction LR
    D_user[Browser] --> D_app[app]
    D_app -->|every request| D_bnc[guestlist]
  end
```

**What the app does differently.**

```mermaid
flowchart TD
  start([request arrives]) --> rid["extractPlatformRequestId(request)<br/>mint if no x-platform-rid"]
  rid --> stamper{"app opted into<br/>devEnvelopeStamper?"}
  stamper -->|"yes & ENV=development & no x-platform-att"| self["self-mint envelope<br/>(read cookie → guestlist →<br/>sign with LOCAL_BNC_ATT_PRIV)"]
  stamper -->|"no, or ENV != development"| verify
  self --> verify["verifyEnvelope(headers)<br/>(verifier reads ENVIRONMENT)"]
  verify -->|missing & prod| reject["throw 403<br/>bouncer_required"]
  verify -->|invalid & prod| reject2["throw 403<br/>envelope_invalid"]
  verify -->|otherwise| ctx["update request-context<br/>{ actorKind, actorId }"]
  ctx --> choice{caller picks}
  choice -->|"platform.getEnvelope()"| env["return EnvelopeData<br/>{ actor, session, activeOrgId } (or null)"]
  choice -->|"platform.getSession()"| bnc["service-binding RPC<br/>guestlist.getSession() (cookies forwarded)"]
  bnc --> full["return PlatformSession<br/>(full BA-inferred shape)"]
  env --> render([continue request])
  full --> render
```

The verifier is the entire dev/prod story. Apps don't have `if (ENVIRONMENT === ...)` branches in their own code — `getEnvelope()` and `getSession()` both feed off the same precondition. Which one the caller invokes is a per-route choice based on whether BA-extended fields are needed.

**The `devEnvelopeStamper` opt-in.** Most TSS apps work fine with the "envelope absent → `getEnvelope()` returns null → `getSession()` cookie-authenticates via guestlist" path that the verifier already handles in dev. Some apps would need a _valid envelope on the inbound request itself_ before TSS or a downstream consumer ever runs — e.g. a Durable Object WS-upgrade handler that verifies the envelope directly on `ctx.request` (DOs have no TSS context) and would see a missing envelope and reject with `unauthenticated` in dev-direct topology without one.

- **Identity** does _not_ opt in — every identity request goes through TSS server fns or middleware, which fall back to cookie auth through guestlist; no consumer reads `ctx.request.headers["x-platform-att"]` directly.

When an app opts in, the kit's `createDevEnvelopeStamper` runs at the worker `fetch` boundary, _before_ TSS captures the H3 event. It reads the inbound `Cookie` header (via `@si/auth`'s `parseRequestCookies`), calls guestlist to resolve the session, signs an Ed25519 envelope with `LOCAL_BNC_ATT_PRIV` + `kid: "dev"`, and stamps the platform header contract onto a forwarded `Request`. **Hard no-op outside `ENVIRONMENT === "development"`** — the stamper short-circuits before doing any work and never touches the request. Production bouncer remains the sole minter; the well-known dev `kid` lives in `BOUNCER_ATTESTATION_KEYS` alongside real prod keys, so the verifier accepts dev-stamped envelopes locally but the kid would mean nothing in prod (no holder of the matching private key).

**Why this is safe in production.**

1. `ENVIRONMENT === "production"` is a strict string compare, no truthy fallback.
2. `BOUNCER_ATTESTATION_KEYS` is asserted non-empty when constructing the verifier in production — a misconfigured worker fails to boot, not silently fails open.
3. Apps have no public Custom Domain in production; they're reached only via service binding from bouncer. CI enforces this via wrangler-config linting (see §6.3).
4. `createDevEnvelopeStamper` is a hard no-op outside dev — even if an app ships `BNC_ATT_PRIV` in a non-dev wrangler secret store (it shouldn't), the stamper won't fire and won't sign anything.

**Why this works in development.**

1. No CF edge → no `cf-request-id` → app's entry shim mints one.
2. No bouncer → no `x-platform-att` on the wire. Two sub-cases:
   - Apps **without** `devEnvelopeStamper`: verifier returns `kind: "missing"` → `getEnvelope()` returns `null`; `getSession()` proceeds to its guestlist service-binding hop using cookies on the inbound request.
   - Apps **with** `devEnvelopeStamper`: the stamper self-mints from the cookie before the verifier runs, so the verifier sees a valid envelope just like in prod.
3. App's `GUESTLIST` service binding is wired in every environment's `wrangler.jsonc` (including dev) — `getSession()` always has somewhere to land, stamper or no stamper.

A developer pulls the repo, runs `bun install && bun run bootstrap && bun run migrate`, then `cd workers/identity && bun run dev` (or `bun run dev` from root to boot the whole stack), and sign-in works against a local guestlist — no bouncer involved.

## §4.6 WebSocket upgrades

Bouncer proxies WebSocket upgrades transparently. The attestation lives on the upgrade request headers; framed messages are not annotated.

```mermaid
sequenceDiagram
  participant U as Browser
  participant GW as bouncer
  participant A as app

  U->>GW: GET /ws<br/>Upgrade: websocket
  GW->>GW: refresh session + mint envelope
  GW->>A: forwarded upgrade<br/>(x-platform-att on upgrade request)
  A->>A: verifyEnvelope on the upgrade
  A-->>GW: 101 Switching Protocols<br/>+ WebSocketPair
  GW-->>U: 101 + WebSocketPair
  Note over U,A: framed messages flow direct — no per-frame envelope checks
```

The actor is "frozen" at upgrade time. If the user's session is revoked mid-connection, the WebSocket stays open until the app closes it on its own logic. This matches the existing semantics of `getSession()` in route loaders — point-in-time identity.

## §4.7 Canonical logging

Every Worker emits **one canonical log line per request** at the boundary. Per-request `log.add({...})` calls accrue fields into a single ALS-scoped builder; the final line is JSON, contains the resolved actor + caller + request id + outcome + timings.

```ts
withRequestLog({ service: "identity" }, request, async (log) => {
  log.add({ route: "/dashboard" });
  // ... handler
  log.outcome("ok"); // or "internal_error", "http_404", etc.
  // single JSON line emitted on scope close
});
```

The shape is consistent across bouncer, guestlist, apps, roadie, promoter. Log aggregation (Workers Logs, Logpush) keys off `request_id` to join lines from different services for the same end-user request.

---

# §5 — Adding a new app

The 90% case is a TanStack Start app. The non-Start path is a documented 10% case for when you need to drop in a Hono or plain-Workers app.

## §5.1 Adding a TanStack Start app

```mermaid
flowchart LR
  copy[Copy workers/identity to workers/&lt;new&gt;] --> rename[Rename in 3 files:<br/>app-brand.ts, platform.ts,<br/>worker.ts]
  rename --> wrangler[Adjust wrangler.jsonc:<br/>name, bindings]
  wrangler --> routes[Add bouncer routes entry<br/>in workers/bouncer/wrangler.jsonc]
  routes --> deploy[Add per-env service binding<br/>in bouncer's services list]
  deploy --> done([done])
```

**The required edits.** The fastest way to start is `cp -r workers/identity workers/<new>` and edit. Most files only need the app name swapped; the load-bearing pieces are:

1. `workers/<new>/src/lib/platform.ts` — wires the platform object. Identity's version is ~10 code lines + a 16-line comment explaining the `createServerOnlyFn` bundle-leakage constraint; copy it verbatim and change the `name`:
   ```ts
   export const platform = createPlatformStartApp({
     name: "<new>",
     getGuestlist,
     guestlistFetcher: guestlistFetcher as () => typeof fetch,
     getEnvironment: createServerOnlyFn(() => env.ENVIRONMENT),
     expectedHost: createServerOnlyFn(() => new URL(env.<NEW>_URL).hostname.toLowerCase()),
   });
   export const { getSession, getEnvelope, getActiveOrgId, envelopeMiddleware, apiProxyHandlers } = platform;
   ```
2. `workers/<new>/src/lib/session.functions.ts` — copy verbatim (TSS-compiler constraint that the `createServerFn` call lives at module top-level):
   ```ts
   import { createServerFn } from "@tanstack/react-start";
   import { getRequestHeaders } from "@tanstack/react-start/server";
   import { platform } from "@/lib/platform";
   export const loadSession = createServerFn({ method: "GET" }).handler(() =>
     platform.getSession(getRequestHeaders()),
   );
   ```
3. `workers/<new>/src/worker.ts` — copy identity's hand-written entry verbatim. Do **not** wrap this in a kit factory (see §3.3 / §4.4 — HMR breaks). The full file is ~10 code lines plus a 21-line comment block that future-you will thank you for:

   ```ts
   import startEntry from "@tanstack/react-start/server-entry";
   import { extractPlatformStartContext } from "@si/kit/react-start";

   declare module "@tanstack/react-start" {
     interface Register {
       server: { requestContext: { requestId: string; callerApp?: string } };
     }
   }

   export default {
     async fetch(request: Request): Promise<Response> {
       return startEntry.fetch(request, { context: extractPlatformStartContext(request) });
     },
   } satisfies ExportedHandler<Env>;
   ```

4. `workers/<new>/src/routes/api/$.ts` — handlers + request-context header seeding for guestlist correlation. Copy identity's file (~30 code lines).
5. `workers/<new>/src/lib/auth-context.ts` + `lib/guestlist.ts` — thin wrappers around `createReactStartAuthProvider` and `createGuestlistFactory` respectively. ~10 lines each; copy from identity.
6. `workers/<new>/src/app-brand.ts` — set `APP_PRODUCT_NAME`.
7. `workers/<new>/wrangler.jsonc` — name, service bindings to `GUESTLIST` (+ `ROADIE`, `PROMOTER` if used). Apps must have `workers_dev: false` and no `routes`/`custom_domain` — bouncer owns the public hostname.
8. `workers/bouncer/wrangler.jsonc` — add a `services` binding entry for the new app and a `ROUTES` entry mapping a path mount on the shared host (e.g. `/<new>`) to the new binding, in `passthrough` or `vmf` mode as appropriate.

Apps that need an envelope on the inbound `Request` itself in dev (see §4.5) additionally pass `devEnvelopeSigner` + `devEnvelopeGuestlist` to `createPlatformStartApp` and call the returned `devEnvelopeStamper` from their worker `fetch` before TSS runs.

Total: ~50 code lines + ~80 lines of load-bearing comment across 8 files, of which ~5 are app-name string substitutions.

## §5.2 Adding a non-TanStack-Start app

A non-Start app composes the same framework-agnostic primitives directly. The canonical entry looks like:

```ts
import { createBouncerEnvelopeVerifier, PLATFORM_HEADERS } from "@si/auth";
import { createGuestlistClient } from "@si/guestlist-service/client";
import { withRequestContext, extractPlatformRequestId } from "@si/kit/request-context";
import { withRequestLog } from "@si/kit/log";
import { BOUNCER_ATTESTATION_KEYS } from "@si/config";

const verifyEnvelope = createBouncerEnvelopeVerifier({
  keys: BOUNCER_ATTESTATION_KEYS,
  env: env.ENVIRONMENT,
  expectedHost: (req) => new URL(req.url).hostname.toLowerCase(),
});

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const rid = extractPlatformRequestId(request);
    return withRequestContext({ requestId: rid }, () =>
      withRequestLog({ service: "<name>" }, request, async (log) => {
        const result = await verifyEnvelope(request);
        // result.kind === "valid"   → result.actor and result.session are
        //                              both present, or both null (verifier
        //                              enforces actor ⟺ session invariant)
        // result.kind === "missing" → no x-platform-att (dev/staging only;
        //                              prod throws 403 inside the verifier)
        // result.kind === "invalid" → tampered or expired (same)
        // For full BA session metadata, call guestlist over the service
        // binding the same way TSS apps do — cookies on the inbound request
        // flow through bouncer unchanged.

        // ... your framework's routing here (Hono, plain handlers, etc.)
        return new Response("ok");
      }),
    );
  },
} satisfies ExportedHandler<Env>;
```

Everything else (config, secrets, bouncer wiring) is the same as the TSS path. The app gets a wrangler config, a service binding to guestlist, a bouncer route — identical infrastructure.

---

# §6 — Config & Secrets

## §6.1 Config split

A small set of files owns the platform's branding and deploy surface.

| File                                         | What lives here                                                                                                                                                                  | When you edit it                                          |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `packages/config/src/brand.ts`               | `brand.{name, short, supportEmail}`; `cookies.prefix`; `auth.{providerId, passkeyRpName, twoFactorIssuer}`                                                                       | Once per fork. Sets the visible identity of the platform. |
| `packages/config/src/deploy.ts`              | `baseDomain`, `devDomain`, `workerPrefix`, `cloudflareAccountId` — code-consumed values only. Per-env D1 ids, routes, and domains live in each worker's `wrangler.jsonc` (§6.2). | Once per fork.                                            |
| `packages/config/src/bouncer-attestation.ts` | `BOUNCER_ATTESTATION_KEYS` — `kid → public-key` map                                                                                                                              | On Ed25519 key rotation (see §6.4).                       |
| `workers/<app>/src/app-brand.ts`             | `APP_PRODUCT_NAME` per app (each app is its own product)                                                                                                                         | Once per app.                                             |

These files cover every brandable / deployable constant in the platform. **Anything that needs branding reads from `@si/config`** (or from the app's local `app-brand.ts`). No platform-name literal lives outside these files.

## §6.2 Wrangler configs

Each service/app has one checked-in `wrangler.jsonc` (source, not generated): the top level is staging and the single `env.production` block is the production deploy. Domain/account/id/name literals live directly in these files; `packages/config/src/deploy.ts` retains only the values that runtime/build/test code imports (baseDomain, devDomain, workerPrefix, cloudflareAccountId).

There is no render step. `wrangler deploy` (no `--env`) ships staging; `wrangler deploy --env production` ships production; local dev runs against the staging top level with `.dev.vars` overrides. After editing a `wrangler.jsonc` or `deploy.ts`, regenerate per-service worker types: `cd <service> && bun run types`.

## §6.3 Secrets matrix

| Secret                                      | Per env | Holder             | Purpose                                                                         |
| ------------------------------------------- | ------- | ------------------ | ------------------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET`                        | yes     | **guestlist only** | Better Auth cookie signing. Single holder by design — no app holds it.          |
| `BNC_ATT_PRIV`                              | yes     | **bouncer only**   | Ed25519 private key for envelope signing. Single secret, single rotation point. |
| `RESEND_API_KEY`                            | yes     | promoter           | Outbound email.                                                                 |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | yes     | roadie             | R2 SigV4 credentials.                                                           |
| OAuth client id/secret pairs                | yes     | guestlist          | Google, Microsoft, Facebook, LinkedIn — wired conditionally.                    |

Things that are **not secrets** (public values, committed to repo or `vars`):

- `BETTER_AUTH_URL`, `IDENTITY_URL`, `AUTH_DOMAIN` — public URLs.
- `EMAIL_FROM` — the From: address (the API key is the secret).
- `BOUNCER_ATTESTATION_KEYS` — public-key set; lives in `packages/config/src/bouncer-attestation.ts`.
- D1 ids, account ids — non-sensitive identifiers.

## §6.4 Rotation runbooks

### `BETTER_AUTH_SECRET` (guestlist)

Single-holder rotation is one command and one moment of session invalidation:

```sh
echo "$(openssl rand -base64 32)" | \
  bunx wrangler secret put BETTER_AUTH_SECRET --env production --cwd workers/guestlist
```

Every active session is invalidated. Users sign in again. No coordination across services needed (because the secret only lives in guestlist).

### `BNC_ATT_PRIV` (bouncer, with overlap window)

Public-key publication is via committed code, so rotation is a code change + a secret rotation in sequence:

1. Generate keypair: `openssl genpkey -algorithm ed25519 -out priv.pem; openssl pkey -in priv.pem -pubout -out pub.pem`.
2. **PR #1** — add new `kid: pub.pem` entry to `BOUNCER_ATTESTATION_KEYS` (both old + new in the set). Deploy all apps.
3. **PR #2** — `wrangler secret put BNC_ATT_PRIV` on bouncer with the new private key. Update `BNC_ATT_KID` env var on bouncer to the new kid. Deploy bouncer. From this moment, bouncer signs with the new kid; apps accept both during the overlap.
4. **PR #3** — drop the old `kid` from `BOUNCER_ATTESTATION_KEYS`. Deploy apps. Old envelopes (max 30s lifetime) are gone by then.

No flag day. The overlap window is bounded by the envelope's `exp` (30s), not by deploy coordination.

---

# Appendix A — Topology decision matrix

When the platform is running, one of these topologies is in effect.

| Topology                                   | Where                                                                                     | What's in front of apps | Envelope present                            | Identity resolution                                                                                                                                          |
| ------------------------------------------ | ----------------------------------------------------------------------------------------- | ----------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Production**                             | `<baseDomain>` (+ `www`) via CF Custom Domain, apps path-mounted (`/account`, `/shop`, …) | bouncer                 | always                                      | `getEnvelope()` = signed payload, no I/O. `getSession()` = guestlist service-binding RPC (cookies passed through bouncer). Verifier enforces.                |
| **Staging**                                | `staging.<baseDomain>` via CF Custom Domain (`workers_dev: false`), same path mounts      | bouncer                 | always                                      | same as prod (or dev fallback, see §4.1.4)                                                                                                                   |
| **Dev (full)**                             | `<devDomain>` via portless, same path mounts                                              | bouncer (run locally)   | always                                      | same as prod                                                                                                                                                 |
| **Dev-direct, no stamper** (e.g. identity) | `<host>.<devDomain>` via portless, or `127.0.0.1:<port>` via wrangler dev                 | nothing                 | never                                       | `getEnvelope()` returns `null` (verifier kind `missing` in dev). `getSession()` still hits guestlist over service binding via inbound cookies.               |
| **Dev-direct, with stamper**               | `<host>.<devDomain>` via portless                                                         | nothing                 | always (app self-mints at `fetch` boundary) | `createDevEnvelopeStamper` reads cookie → guestlist → signs with `LOCAL_BNC_ATT_PRIV`. Verifier accepts the dev-kid envelope just like prod; same code path. |

The `getEnvelope()` fast path costs nothing — JWS verify is sub-millisecond. The `getSession()` path costs one service-binding RPC, same in every topology that has a guestlist binding. The dev-stamper itself adds one guestlist RPC at the worker `fetch` boundary in dev only (no-op outside dev).

# Appendix B — Glossary

- **Guestlist** — the Worker that owns the user database and Better Auth. The sole authority on session validity.
- **Envelope** — the bouncer attestation, a JWS-compact value carried in `x-platform-att`. Signed with Ed25519. Lives 30 seconds. Payload: `{ actor, session, host, iat, exp, ... }` — narrow safe projection of the resolved BA session.
- **`EnvelopeData`** — the verified envelope's `{ actor, session }` pair, returned by `platform.getEnvelope()`. Narrow, signed, no I/O.
- **`PlatformSession`** — Better Auth's full plugin-inferred session, returned by `platform.getSession()` after a guestlist service-binding hop. Strict superset of `EnvelopeData`'s relevant fields.
- **Bouncer** — the single public-ingress Worker. Translates `cf-*` → `x-platform-*`. Mints envelopes.
- **Dev envelope stamper** — `createDevEnvelopeStamper` in `@si/kit/react-start`. Per-app opt-in factory that self-mints an envelope at the worker `fetch` boundary in dev-direct topology (hard no-op outside `ENVIRONMENT=development`). Identity doesn't need it.
- **Identity** (the app) — the reference TanStack Start app. Owns sign-in, sign-up, account, admin sessions surface.
- **Kid** — key id. A short string in the JWS header identifying which Ed25519 key signed the envelope. Allows key-set rotation. The well-known dev kid (`"dev"`) is committed alongside prod kids in `BOUNCER_ATTESTATION_KEYS`.
- **Platform contract** — the `x-platform-*` header family. The only privileged header set apps and services read.
- **Promoter** — the Worker that owns outbound email. Wraps Resend.
- **Roadie** — the Worker that owns blob storage. Wraps R2 with signed-URL minting.
- **VMF** — virtual microfrontend; bouncer's `mode: "vmf"` rewrites HTML/CSS/Location/cookies when mounting an upstream app under a path prefix. `"passthrough"` (no rewriting) is used for mounts where the upstream is already prefix-aware, such as `/api` → guestlist. **Status:** implemented in `workers/bouncer/src/proxy.ts` and covered by `__tests__/routing.test.ts` + `__tests__/template-parity.test.ts`; the production route table uses `mode: "vmf"` for the `/account` (identity) and `/shop` (store) mounts.
