---
name: release
metadata:
  version: "1.0.0"
description: >-
  How code ships: staging promote-on-merge, per-worker release-please
  production releases, single-worker reship, and the levers when something
  needs forcing. TRIGGER when: asked to release, deploy, ship to staging or
  production, re-deploy one worker, or explain/monitor the CD lanes.
---

# Releasing & deploying

CI/CD is entirely RWX (no GitHub Actions). Monitor any lane with
`rwx results --wait` or the run URL it prints.

## Staging — automatic on merge to main

`.rwx/ci.yml` gates, then calls `.rwx/promote-staging.yml`: affected workers
only (`scripts/changed-workers.sh`; packages/* or an RPC-worker change fans
out to the full release-managed fleet — promoter, roadie, guestlist, identity,
store, publisher, site, bouncer), migrate-before-code per worker, promote the
PR-built version when one exists, otherwise full build+deploy, then smoke test
(`scripts/smoke-test.sh`). Nothing to do manually — EXCEPT operator: it has no
CI/CD lane by owner decision and deploys manually
(`cd workers/operator && bun run deploy:staging` / `deploy:production`).

Force a full-fleet staging ship (disaster lever):

```sh
rwx run .rwx/promote-staging.yml --init deploy=true --init force-full=true --init commit-sha=<sha>
```

## Production — merge the release PR

release-please (manifest mode, per-worker components) maintains a release PR
on main. Merging it creates per-worker tags `<worker>-v<x.y.z>`;
`.rwx/release-please.yml` then deploys ONLY the released workers, in canonical
order (bouncer last), migrate-before-code, smoke test after. Versions are
per-worker (`.release-please-manifest.json` is the live ledger);
`release-please-config.json` is the component map.

## Re-ship a single worker (rollback / re-deploy)

```sh
rwx dispatch si-reship-worker --param worker=<name> --param tag=<worker>-v<x.y.z>
```

One worker per dispatch (`.rwx/release.yml`). Tags are the deployable ledger —
`git tag -l '<worker>-v*'` lists what can be shipped.

## Previews (per-PR versions)

`.rwx/preview.yml` uploads 0%-traffic versions per changed worker with URLs
`pr-<n>-<worker>.<account>.workers.dev`; the staging lane promotes those
same versions on merge. The PR trigger is enabled once the unlocked
`si_preview` vault exists (header of preview.yml documents the exact
token scope). CLI test: `rwx run .rwx/preview.yml --init pr-number=<open PR#>`.

## Non-negotiables

- Cloudflare API tokens must be minted FROM this fork's CF account
  (`packages/config/src/deploy.ts` `cloudflareAccountId`) — a foreign-account
  token throws D1 7403s.
- Migrations always run before code, per worker (`scripts/deploy-worker.sh`
  is the shared mechanic all lanes call).
- Deploy order is canonical with bouncer LAST: a worker's service binding
  requires the Worker it points to already exist, or `wrangler deploy` fails
  with Cloudflare API error 10143 (`docs/runbooks/PRODUCTION-DEPLOY.md`
  §3 "Deploy order").
