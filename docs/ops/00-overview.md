# Ops / deployment maintenance pass — spec index (2026-07-05)

**All five specs were implemented in-repo 2026-07-05/06** (status headers in each spec carry commits, verification runs, and deviations; Spec 04 awaits one owner action — the `greenroom_preview` vault). Originally authored as dispatch-ready specs: Each is
self-contained (context, verified current state, exact design, verification,
acceptance criteria, sources) and sized for one implementation session on a
cheaper model, with review afterwards. Research grounding: RWX docs pulled via
`rwx docs pull`, real RWX run forensics, real staging+production deploy logs,
Cloudflare + release-please + vite-plus docs (URLs cited per spec).

| #   | spec                                                                                                                   | one-liner                                                                                                                                                                                                                                                      |
| --- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01  | [`01-ci-cross-run-caching.md`](01-ci-cross-run-caching.md)                                                             | Make RWX's cross-run content cache actually hit: filter `install`/`bootstrap`/`types`, stop `.wrangler` sqlite + `~/.bun` system noise from poisoning gate-task keys. Evidence: PR #43 run re-ran all 21 gate tasks for a 4-file sprout change.                |
| 02  | [`02-static-wrangler-configs.md`](02-static-wrangler-configs.md) + [`02a` appendix](02a-wrangler-binding-inventory.md) | Delete render-wrangler templating; per-worker checked-in `wrangler.jsonc`, top-level = staging, `env.production` only env. 02a = per-worker binding audit from real deploy warnings (worker-name trap, workers_dev inversion, BNC_ATT_KID, P-only bindings).   |
| 03  | [`03-workers-dir-and-per-worker-releases.md`](03-workers-dir-and-per-worker-releases.md)                               | Move `apps/*`+`services/*` → `workers/*` (full sweep list); release-please manifest mode with per-worker components/tags (`guestlist-v1.2.0`); production deploys ship only the released subset, in the canonical binding order.                               |
| 04  | [`04-pr-previews-and-promote-on-merge.md`](04-pr-previews-and-promote-on-merge.md)                                     | Per-PR preview URLs for changed workers via `wrangler versions upload` (+ sticky PR comment via `gh`), and staging promote-on-merge via `versions deploy` instead of rebuild. Decision: stay on RWX; Workers Builds rejected (cannot promote without rebuild). |
| 05  | [`05-bootstrap-and-agent-harness.md`](05-bootstrap-and-agent-harness.md)                                               | Split bootstrap (env:init / db:migrate:local / seed), cached vp tasks, fresh-clone command contract, solo-mode dev against staging via remote bindings, one env-var contract table. Framed on harness-engineering principles.                                  |

## Dispatch order — SERIAL, not parallel

These specs overlap on `.rwx/*.yml`, root `package.json`, per-worker configs
and docs. File-system overlap = dependency (hard-learned repo rule): dispatch
one at a time, merging each before starting the next.

```
01  →  02(+02a)  →  03  →  05  →  04
```

- **01 first**: standalone, applies to the current tree, stops the daily
  compute bleed immediately.
- **02 before 03**: fewer files to move once templates are gone. 03's sweep
  updates the paths 01/02 wrote into `.rwx/`.
- **05 after 02** (assumes no render step). If 01 was implemented with its
  "surgical" F3 option, 05 supersedes that task body — expected, not a
  conflict.
- **04 last**: needs 02's `preview_urls`/staging-top-level and 03's
  `workers/` paths + per-worker release model; both phases of 04 are
  independently shippable.

## Cross-cutting notes for implementers

- **Verify, don't trust**: each spec cites the files/runs it derived from.
  Where a spec says "verify at implementation time" (wrangler env semantics,
  vp config field names, remote-bindings key), that's a real instruction —
  those surfaces move fast.
- **platform-template** (sibling repo) is the upstream base and is behind this
  repo (no `.rwx/`, smaller token map, no sprout/marketing). Spec against
  greenroom only; harvest back upstream as a separate pass.
- **Small cleanups to ride along with Spec 03**: `rm -rf apps/chat apps/quiz`
  (untracked debris; already misled two research passes), and rename root
  `package.json` `"name": "platform-template"` → `"greenroom"` (last template
  vestige at root).
- **Docs debt each spec owns**: CLAUDE.md's rendering section (02), local-dev
  workflow section (05), deploy/runbook docs (03/04). A spec is not done until
  its CLAUDE.md/README deltas land — stale docs mislead the next agent.

## Standing decisions made in this pass (don't relitigate in implementation)

1. RWX stays the single CI/CD brain; Cloudflare Workers Builds not adopted.
2. Two-config wrangler layout: top-level = staging, `env.production` = prod;
   local dev = staging config + `.dev.vars` overrides + local sims.
3. Release model: per-worker components via release-please manifest mode,
   `simple` type, one combined Release PR, released-subset ordered deploys;
   shared-package changes ride out (see 03 §B.4 for the hotfix recipe).
4. Preview scope: previews validate single workers against staging infra;
   full-journey validation stays on post-merge staging. Schema-change PRs get
   degraded previews by default; ephemeral per-PR D1 is a reserved, manual
   escape hatch.
