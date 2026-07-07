---
name: interactive-test
metadata:
  version: "1.2.0"
description: >-
  Spin up the local stack and drive it in a real browser (agent-browser)
  to verify journeys interactively. TRIGGER when: asked to "test in the
  browser", "walk the journey", "check sign-in live", verify UI
  changes, reproduce a bug interactively, or take screenshots of running
  surfaces.
---

# Interactive testing (local stack + agent-browser)

Verified 2026-07-07 (updated after the sprout/marketing prune — the previous
extended runbook this skill pointed at, `docs/sprout/10-local-stack-and-testing-runbook.md`,
was removed with the sprout product). Deviate only if a step fails, then
update this skill.

## 1. Boot + seed (skip what's already running)

```sh
bun run dev            # ONE plain command from root, run as a background task
bun run seed           # only if D1 is fresh — idempotent; users are pre-verified
bun run dev:doctor     # THE health probe — surfaces + orphan-fleet detection
```

No pipes/redirects/env overrides on `bun run dev`; read its task log for
readiness. Stop the fleet by stopping that task — NEVER `pkill` workerd/vite
(survivors squat ports and blanket-404 a hostname).

| Surface      | URL                                                | Demo logins                          |
| ------------ | -------------------------------------------------- | ------------------------------------ |
| Sign-in      | `https://identity.somewhatintelligent.localhost/sign-in`  | `alice@example.com` / `alicepwd123` (acme admin) |
| Account      | `https://identity.somewhatintelligent.localhost/account`  | (after signing in) |

Note: local dev is dev-direct (no bouncer in front), so identity serves at
its own root here — the `/account` vmf mount (`workers/bouncer/wrangler.jsonc`)
only exists on staging/production, where bouncer fronts the single-host apex.

## 2. The authed browser walk (copy-paste)

One `$AB` command per shell call, strictly sequential, always foreground —
never chain with `&&`/pipes or background them (wedged daemon ⇒
`agent-browser close --all`, or `pkill -9 -f agent-browser` if that hangs,
then re-`open` — in containers add
`--executable-path /opt/pw-browsers/chromium --ignore-https-errors` to that
first re-`open`).

```sh
AB=node_modules/.bin/agent-browser
$AB --session dev open https://identity.somewhatintelligent.localhost/sign-in
$AB --session dev snapshot -i          # @refs; RE-RUN after any reload/navigation
$AB --session dev click @e9            # focus Email
$AB --session dev keyboard type "alice@example.com"
$AB --session dev click @e11           # focus Password
$AB --session dev keyboard type "alicepwd123"
$AB --session dev press Tab            # blur — TanStack Form validates onBlur
$AB --session dev press Enter          # submit (or click the Sign In @ref)
$AB --session dev wait 3000
$AB --session dev open https://identity.somewhatintelligent.localhost/account
$AB --session dev screenshot proof.png # then Read the png to verify visually

> **Do NOT use `fill` on the auth forms** (verified 2026-07-07): `fill`
> sets the DOM value without the keystroke events TanStack Form's field
> state listens to, so `handleSubmit` validates an EMPTY form and silently
> does nothing — no POST, no error toast. Use `click` + `keyboard type`
> per field, blur (Tab) after the password, then Enter. The API itself is
> healthy either way (curl POST to /api/auth/sign-in/email returns 200).
```

Debugging: `$AB --session dev errors` / `console`; server side, grep the
`bun run dev` task log.

## 3. Scripted (no-browser) authed checks — WARM stack only

Browser walk first on a fresh fleet: the first authed request after a cold
boot can stall via curl in agent containers. better-auth 403s without an
Origin header:

```sh
CJ=$(mktemp)
curl -sk -c "$CJ" -X POST https://identity.somewhatintelligent.localhost/api/auth/sign-in/email \
  -H 'content-type: application/json' -H 'Origin: https://identity.somewhatintelligent.localhost' \
  -d '{"email":"alice@example.com","password":"alicepwd123"}'
curl -sk -b "$CJ" https://identity.somewhatintelligent.localhost/account   # 200 + full SSR HTML
```

## Reference

Playwright + Chromium provisioning: `docs/browser-automation.md`. Bouncer's
`/account` vmf mount (staging/production only): `workers/bouncer/wrangler.jsonc`
+ `workers/bouncer/src/proxy.ts` (`handleMountedApp`).
