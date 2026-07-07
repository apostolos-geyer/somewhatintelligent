# 10 — Local Stack & Testing Runbook

> **Why this exists.** `07-deployment.md` covers _deploy_; `06`/`06b` design
> the _test_ tiers; `docs/browser-automation.md` covers the browser harness.
> This runbook is the local-dev operating manual: booting the stack, the
> topologies (full fleet, subsets, solo-vs-staging, parallel worktrees), the
> browser recipes, and the test layering — verified end-to-end on 2026-07-05
> (fresh D1 → seeded → authed branded portal in agent-browser).

---

## 1. Booting the stack

One command from the repo root boots the portal-journey fleet:

```sh
bun install
bun run dev            # cached prep (env:init + local D1 migrations), then guestlist + identity + sprout + roadie
bun run seed           # first boot only: demo users/orgs/brands — needs the stack up
```

`bun run dev <worker…>` boots any subset (`bun run dev sprout identity`), and
each worker runs identically on its own: `cd workers/<w> && bun run dev`. The
supervisor (`scripts/dev-stack.ts`) starts the portless HTTPS proxy
(`--wildcard`, :443) when it isn't already up, and tears the whole stack down
loudly if any worker exits. `bun run seed` (root) now seeds EVERYTHING —
users, orgs, brand skins, and all journey/demo content (products, decks,
quizzes, feed) — via the one consolidated `workers/sprout/scripts/seed.ts`;
`bun scripts/seed.ts --target staging` runs the same seed against staging.

Local dev is the **dev-direct topology** (`docs/ARCHITECTURE.md` §4.5): each
app serves its own host and stamps its own dev envelope. Bouncer fronts
traffic in staging/production only — it is not part of the local stack.

URLs (pinned host topology — `workers/sprout/src/lib/brand.ts`):

| Surface           | URL                                            |
| ----------------- | ---------------------------------------------- |
| Brand portal      | `https://<slug>.sprout.sproutportal.localhost` |
| Hub (apex)        | `https://sprout.sproutportal.localhost`        |
| Sign-in / account | `https://identity.sproutportal.localhost`      |

Demo logins (guestlist bootstrap): `alice@example.com / alicepwd123` (acme admin),
`bob@example.com / bobpwd1234` (acme budtender), `dave@example.com / davepwd123`
(beta admin), `super@user.com / superuserdo` (platform admin). The session cookie
is `Domain=.sproutportal.localhost`, so one sign-in carries across every brand
subdomain **and** the apex.

---

### Isolation — parallel worktrees

- **The dev registry is per-worktree** (`<repo>/.wrangler/dev-registry`).
  Every entry point derives the path from its own location (the vite configs,
  the wrangler-dev workers' scripts, the supervisor), so two worktrees' fleets
  never cross-bind and every clean boot starts from an empty registry.
- **Inspectors are off by default**, so workerd's shared 9229 default can't
  race — set `inspectorPort` in an app's vite config, or
  `GUESTLIST_INSPECTOR_PORT` / `ROADIE_INSPECTOR_PORT`, when you need
  DevTools.
- **Service ports** default to guestlist 8787 / roadie 8790; override with
  `GUESTLIST_PORT` / `ROADIE_PORT` to run a second worktree's stack alongside.
- The `*.sproutportal.localhost` hostname space and the :443 proxy are
  machine-global: run the full HTTPS auth journey from one worktree at a
  time. Tests, typechecks, and per-worker dev parallelize freely.

### Solo mode — one worker against the deployed staging fleet

```sh
cd workers/<name> && bun run dev:solo     # needs CLOUDFLARE_API_TOKEN or `wrangler login`
```

`scripts/dev-solo.ts` stamps `remote: true` onto the staging bindings (a
gitignored `wrangler.solo.jsonc` overlay beside the real config) so
D1/services/R2/queue producers resolve to the live staging workers — no local
siblings needed. Wrangler flags pass through after `--`, e.g.
`bun run dev:solo -- --port 8795`.

---

## 2. Gotchas

1. **Remote-only bindings (sprout: `AI`, `VECTORIZE`, `BROWSER`) need
   Cloudflare auth.** With `wrangler login` or `CLOUDFLARE_API_TOKEN` they
   proxy to the real services; without, the `env.AI?` guards keep the app up
   with those features dark.

2. **Stop the fleet via the supervisor — never `pkill`.** Ctrl-C the
   supervisor (or stop the background task that runs it). A broad
   `pkill -f workerd|vite` routinely leaves a survivor holding a service
   port; the next boot's worker then logs "Port NNNN is in use, trying
   another one…" and binds port+1 while the portless proxy still routes the
   hostname to the dead port — that surface blanket-404s until the squatter
   dies. `bun run dev:doctor` detects this (two dev servers in one worker
   dir) and names the pid to kill. `pkill -f portless` is worse still — it
   kills the shared proxy other work may be using.

3. **The dev-envelope key was stored wrong (fixed).** `.dev.vars` ships
   `BNC_ATT_PRIV` on one line with **escaped** `\n`; passed raw to `importPKCS8`
   it throws "Invalid PKCS8 input", silently disabling the dev-envelope stamper —
   and with it the Durable-Object/WebSocket auth (Group Chat send, feed live
   fan-out). Fixed via `normalizePrivPem` in `workers/sprout/src/lib/platform.ts`
   (unit-tested in `__tests__/pem.test.ts`). If you fork another dev-direct app,
   apply the same normalization.

4. **R2 blobs aren't seedable from D1.** Deck PDFs, asset files, post media live
   in roadie/R2. The D1 seed gives every D1-backed surface real data; the blob
   viewers degrade gracefully (the deck flip-viewer shows "Preview needs R2",
   etc.). To exercise real PDFs/thumbnails, upload through roadie or run
   `BROWSER`/derive against the remote binding.

5. **agent-browser commands run strictly one at a time, foreground.**
   The CLI talks to a per-session daemon that serializes commands; concurrent
   or backgrounded invocations — including chaining several calls in one
   shell line with `&&`/pipes — wedge it: later calls fail with "Resource
   temporarily unavailable (os error 35)" or every call reporting "CDP
   command timed out". Recover with `agent-browser close --all`; if that
   itself hangs, `pkill -9 -f agent-browser` and re-`open` (cookies are lost;
   in containers pass `--executable-path /opt/pw-browsers/chromium
--ignore-https-errors` on that first re-`open`). `open` blocks until load,
   and `wait <ms|selector>` covers the rest — no `sleep` chains needed.

6. **Cold-boot authed stall (agent containers).** The FIRST authenticated
   SSR after a fresh `bun run dev` can hang indefinitely when driven by
   scripted curl, while anonymous requests and the in-browser walk work.
   Reproduced on unmodified main in a containerized agent environment;
   never observed on a developer machine. It is NOT an app bug and a fleet
   restart makes it worse (see gotcha #2): `touch` any server-side source
   file — the HMR invalidation un-wedges the request path — and prefer the
   browser walk for the first authed hit on a fresh fleet.

---

## 3. Driving the browser

Two consumers (`docs/browser-automation.md`):

- **agent-browser** for exploratory walks. Locally it manages its own Chrome —
  no CDP setup needed; the portless self-signed cert is accepted out of the box
  (`--ignore-https-errors` exists as a fallback). The verified sign-in walk:

  ```sh
  AB=node_modules/.bin/agent-browser
  $AB --session dev open https://identity.sproutportal.localhost/sign-in
  $AB --session dev snapshot -i                    # get @refs (re-run after any reload)
  $AB --session dev fill @e7 "alice@example.com"
  $AB --session dev fill @e8 "alicepwd123"
  $AB --session dev press Tab                      # blur — TanStack Form validates onBlur
  $AB --session dev click @e3                      # Sign In
  $AB --session dev wait 2000
  $AB --session dev open https://acme.sprout.sproutportal.localhost/
  $AB --session dev screenshot proof.png           # authed branded portal
  ```

  The `.sproutportal.localhost` session cookie carries across every subdomain.
  One command per call, strictly sequential — see gotcha #5. (The CDP-attach
  recipe in `docs/browser-automation.md` is for sharing Playwright's Chromium
  in containers, not a prerequisite.)

- **Scripted auth without a browser**: `POST /api/auth/sign-in/email` on
  identity requires an `Origin: https://identity.sproutportal.localhost`
  header (better-auth trusted-origin check) or it 403s; with it, the curl
  cookie jar works against any portal host.
- **Playwright** specs in `e2e/sprout/` (`bun run test:e2e`).

**Form-automation trap (cost me real time):** the auth + admin forms are TanStack
Form and validate **onBlur**, and several inputs are controlled such that a
synthetic value-set does **not** update React state. The reliable recipe:
`fill(value)` **then blur** (Tab), or real keystrokes (`pressSequentially` /
agent-browser `type`) — and wait for the submit button to enable. A click before
hydration does a native form POST that renders the raw auth JSON; wait for the
auth response or for the page to leave `/sign-in`. Base-UI `Select` widgets
(province, topic) don't take synthetic events at all — drive them by clicking the
option. See `e2e/sprout/helpers.ts` (`typeInto`, `signIn`, `enterPortal`).

---

## 4. Test layering (the pyramid, not E2E-for-everything)

| Tier                 | Where                              | Runner                                                | Covers                                                                                                                                |
| -------------------- | ---------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Unit (pure)**      | `__tests__/*.test.ts`              | `bun run test` (node)                                 | grading (all 5 question types incl. the matching `config.pairs`/`option.config.right` shape), brand theming, score, PEM normalization |
| **Integration (D1)** | `__tests__/integration/*.itest.ts` | `bun run test:pool` (vitest-pool-workers / miniflare) | real D1 constraints: reviews CHECK + unique + hard-delete (INV-3), FK cascade, leaderboard/cert unique keys                           |
| **E2E / boundary**   | `e2e/sprout/*.spec.ts`             | `bun run test:e2e` (Playwright)                       | web→server→db round-trips: sign-in→grid, review submit persists, runtime brand skin, publish surface, INV-2 no-instant-call           |

The pool harness (`vitest.pool.config.ts`) declares miniflare bindings
**explicitly** (D1 + the migrations bundle) instead of pointing at
`wrangler.jsonc` — that config carries the remote-only AI/Vectorize/Browser
bindings miniflare can't boot, and the DB-boundary tests need none of them. Pool
tests are `*.itest.ts` (not `*.test.ts`) so the node runner never tries to run
them. Note `TEST_MIGRATIONS` is declared **optional** in
`__tests__/integration/env.d.ts` because sprout's tsconfig includes `__tests__`
in the app program (unlike workers/roadie, which excludes it) — a required
augmentation would leak into the app `Env`.

---

## 5. Query hygiene

List reads must not `SELECT *` an unbounded table. `listReviews` derives its
count/average from a SQL **aggregate** and returns a capped page
(`REVIEW_PAGE_SIZE`); `listAdminReviews` is bounded by `ADMIN_REVIEW_PAGE_SIZE`.
Apply the same when adding list endpoints — a sensible `limit` (and cursor paging
where a surface needs more) over a whole-table scan.
