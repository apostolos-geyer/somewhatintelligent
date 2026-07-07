# e2e — Playwright specs

On-demand browser tests. **Not in CI** — run them yourself or have an agent run
them. Full setup notes: [`docs/browser-automation.md`](../docs/browser-automation.md).

```sh
bun run browsers:install     # one-time: provision Chromium (+ OS libs on Linux)
bun run test:e2e             # run specs, headless
bun run test:e2e:report      # open the last HTML report
```

`smoke.spec.ts` is a hermetic check that Chromium runs and screenshots — enough
to confirm the harness works. Add real specs here (`*.spec.ts`) as needed; use
absolute URLs (the platform spans many subdomains, so there's no shared baseURL).
Artifacts land in `test-results/` + `playwright-report/` (gitignored).
