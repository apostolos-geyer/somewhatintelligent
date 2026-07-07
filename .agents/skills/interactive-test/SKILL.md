---
name: interactive-test
metadata:
  version: "1.1.0"
description: >-
  Spin up the local Sprout stack and drive it in a real browser (agent-browser)
  to verify journeys interactively. TRIGGER when: asked to "test in the
  browser", "walk the journey", "check the portal/sign-in live", verify UI
  changes, reproduce a bug interactively, or take screenshots of running
  surfaces.
---

# Interactive testing (local stack + agent-browser)

Verified 2026-07-06. Deviate only if a step fails, then update this skill.
Failure modes + fixes live in the runbook
(`docs/sprout/10-local-stack-and-testing-runbook.md` §2) — check there BEFORE
improvising.

## 1. Boot + seed (skip what's already running)

```sh
bun run dev            # ONE plain command from root, run as a background task
bun run seed           # only if D1 is fresh — idempotent; users are pre-verified
bun run dev:doctor     # THE health probe — surfaces + orphan-fleet detection
```

No pipes/redirects/env overrides on `bun run dev`; read its task log for
readiness. Stop the fleet by stopping that task — NEVER `pkill` workerd/vite
(runbook gotcha #2: survivors squat ports and blanket-404 a hostname).

| Surface      | URL                                                | Demo logins                          |
| ------------ | -------------------------------------------------- | ------------------------------------ |
| Sign-in      | `https://identity.sproutportal.localhost/sign-in`  | `alice@example.com` / `alicepwd123` (acme admin) |
| Brand portal | `https://acme.sprout.sproutportal.localhost/`      | `bob@example.com` / `bobpwd1234` (budtender)     |
| Hub          | `https://sprout.sproutportal.localhost/`           | `super@user.com` / `superuserdo` (platform admin)|

## 2. The authed browser walk (copy-paste)

One `$AB` command per shell call, strictly sequential, always foreground —
never chain with `&&`/pipes or background them (runbook gotcha #5; wedged
daemon ⇒ `agent-browser close --all`, or `pkill -9 -f agent-browser` if that
hangs, then re-`open` — in containers add
`--executable-path /opt/pw-browsers/chromium --ignore-https-errors` to that
first re-`open`).

```sh
AB=node_modules/.bin/agent-browser
$AB --session dev open https://identity.sproutportal.localhost/sign-in
$AB --session dev snapshot -i          # @refs; RE-RUN after any reload/navigation
$AB --session dev fill @e7 "alice@example.com"
$AB --session dev fill @e8 "alicepwd123"
$AB --session dev press Tab            # blur — TanStack Form validates onBlur
$AB --session dev click @e3            # Sign In
$AB --session dev wait 3000
$AB --session dev open https://acme.sprout.sproutportal.localhost/
$AB --session dev screenshot proof.png # then Read the png to verify visually
```

The `.sproutportal.localhost` cookie spans all subdomains — one sign-in covers
hub + every brand portal. Debugging: `$AB --session dev errors` / `console`;
server side, grep the `bun run dev` task log. Form traps (fill-then-Tab, no
`.value` via eval, Base-UI Selects) — runbook §3.

## 3. Scripted (no-browser) authed checks — WARM stack only

Browser walk first on a fresh fleet: the first authed request after a cold
boot can stall via curl in agent containers (runbook gotcha #6 has the
one-line fix). better-auth 403s without an Origin header:

```sh
CJ=$(mktemp)
curl -sk -c "$CJ" -X POST https://identity.sproutportal.localhost/api/auth/sign-in/email \
  -H 'content-type: application/json' -H 'Origin: https://identity.sproutportal.localhost' \
  -d '{"email":"alice@example.com","password":"alicepwd123"}'
curl -sk -b "$CJ" https://acme.sprout.sproutportal.localhost/   # 200 + full SSR HTML
```

## Reference

Topology, gotchas, form traps, test tiers:
`docs/sprout/10-local-stack-and-testing-runbook.md`. Playwright + Chromium
provisioning: `docs/browser-automation.md`.
