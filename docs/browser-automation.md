# Browser automation & e2e

**Status: set up and working.** This repo ships everything an agent (or human)
needs to drive a real browser — locally or in an ephemeral cloud/CI container.
Two consumers, one provisioning command:

| Consumer                            | What it's for                                                       | Run                              |
| ----------------------------------- | ------------------------------------------------------------------- | -------------------------------- |
| **agent-browser**                   | AI-agent web automation — navigate, snapshot, click, **screenshot** | `agent-browser --cdp 9222 <cmd>` |
| **Playwright** (`@playwright/test`) | on-demand e2e specs in `e2e/`                                       | `bun run test:e2e`               |

Both are devDependencies (`agent-browser`, `@playwright/test`, `playwright-core`).
One browser binary — **Playwright's Chromium** — serves both: provision it once
per machine/container and agent-browser attaches to it over CDP (it does **not**
download its own browser; see [agent-browser](#agent-browser-for-agents) below).

## Provision (the one command)

```sh
bun run browsers:install
```

Installs **Playwright's Chromium** and, on Linux, the shared OS libraries it
needs (`libnss3`, `libgbm`, `libdrm`, fonts, …) via Playwright's `--with-deps`.
Idempotent — safe to re-run. Playwright honors `PLAYWRIGHT_BROWSERS_PATH` (e.g.
`/opt/pw-browsers` in the cloud agent container), so nothing is hardcoded.
Script: [`scripts/setup-browsers.ts`](../scripts/setup-browsers.ts).

### In the cloud / ephemeral containers

Containers are wiped between sessions, so browsers must be re-provisioned. A
**SessionStart hook** (in `.claude/settings.json`) does this automatically:

- `bun scripts/setup-browsers.ts --ensure` runs on every session start.
- Already provisioned → instant no-op.
- Missing **in a cloud container** (Linux running as root, or
  `GREENROOM_PROVISION_BROWSERS=1`) → provisions in the **background** (never blocks
  the session or trips the hook timeout); tail `.browser-provision.log`.
- Missing **locally** → prints a one-line hint, no surprise downloads.
- Force on/off with `GREENROOM_PROVISION_BROWSERS=1` / `=0`.

Need a browser _right now_ (don't wait on the background run)? Just run
`bun run browsers:install` — it's idempotent and blocks until ready.

Preconditions in the container (held in our cloud sandbox): root (so `apt-get`
works), `apt-get` present, and outbound egress to the Playwright CDN.
True headless — no display needed.

## Playwright specs

```sh
bun run test:e2e             # run e2e/*.spec.ts, headless
bun run test:e2e:ui          # interactive UI mode (local only)
bun run test:e2e:report      # open the last HTML report
bun run typecheck:e2e        # typecheck the specs
```

- Specs live in `e2e/`, named `*.spec.ts` — deliberately separate from the
  package suites' vitest `*.test.ts`, so the two runners never collide.
- `e2e/smoke.spec.ts` is a hermetic check (no network/app) that Chromium runs
  and screenshots — the canonical "is the harness alive?" test.
- Config: [`playwright.config.ts`](../playwright.config.ts). No shared `baseURL`
  — the platform spans many subdomains, so specs use absolute URLs.
- Artifacts: `test-results/` and `playwright-report/` (gitignored).

## agent-browser (for agents)

Two ways to run it:

**Standalone (local default).** Current agent-browser versions manage their
own Chrome (under `~/.agent-browser/browsers`) — no CDP setup needed:

```sh
node_modules/.bin/agent-browser --session dev open https://example.com
node_modules/.bin/agent-browser --session dev snapshot -i
```

One command per call, strictly sequential — the per-session daemon serializes
commands, and concurrent or backgrounded invocations wedge it ("Resource
temporarily unavailable (os error 35)"; recover with
`agent-browser close --all`). The verified authed-portal walk lives in
`docs/sprout/10-local-stack-and-testing-runbook.md` §3.

**CDP attach (containers / shared browser).** To reuse the **Playwright
Chromium** provisioned above instead, start it with a debugging port, then
drive with `--cdp` (no prior `connect` needed):

```sh
# Launch the provisioned Chromium with a CDP port, once per session (add
# --ignore-certificate-errors behind a TLS-intercepting egress proxy):
CHROME="$(bun -e 'import {chromium} from "playwright-core"; process.stdout.write(chromium.executablePath())')"
"$CHROME" --headless=new --no-sandbox --remote-debugging-port=9222 about:blank &

agent-browser --cdp 9222 open https://example.com
agent-browser --cdp 9222 screenshot shot.png   # then read shot.png and show the user
agent-browser --cdp 9222 snapshot               # accessibility tree with @refs
```

Load the up-to-date workflow guide with `agent-browser skills get core` first
(the CLI serves version-matched docs). One browser action per call; don't batch
loops. Screenshots are PNGs an agent can read back and present.

## Not in CI (yet)

Browser tests are intentionally **manual / on-demand** — they are not part of
`bun run ready` or the CI gate, and there is no e2e GitHub workflow. Provision
and run them when a task needs them.
