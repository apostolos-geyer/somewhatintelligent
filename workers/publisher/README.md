# @si/publisher-service

Publisher — the focused content authority for **texts**, **software records**,
and **fixed pages** (RFC-0001 D2). A Cloudflare Worker with its own D1 and two
RPC entrypoints:

- **`PublisherPublic`** — bound only to Site, read-only. Returns active
  immutable text/page releases and published software snapshots; it has no draft
  method (INV-PUB-1).
- **`PublisherOperator`** — bound only to Operator, owns every mutation. The
  service binding is the machine-authorization boundary; nothing is exposed over
  public HTTP.

The typed RPC surface it implements lives in
[`@si/contracts`](../../packages/contracts) (`PublisherPublicEntrypoint` /
`PublisherOperatorEntrypoint`).

## Status — SCAFFOLD

This is track **T14** of
[`docs/exec-plans/completed/0004-unified-publishing-commerce-control-plane.md`](../../docs/exec-plans/completed/0004-unified-publishing-commerce-control-plane.md).
The worker builds, imports `@si/contracts`, and declares the dual-entrypoint
shape with a representative slice of each contract. Still to come:

- the full D1 schema — `text_entry`/`text_release`, `software_draft`/
  `software_publication`, `page_entry`/`page_release`, tags, links, media +
  `media_gc_outbox` (T14);
- `PublisherPublic` reads (T15) and `PublisherOperator` text/software/page
  lifecycles (T16/T17);
- the private `MediaStorage` adapter (T5) and the `STORE → StoreCatalog` binding
  for page-reference validation (T17);
- deletion plan/confirm + media GC (T18).

After editing `wrangler.jsonc`, run `bun run types` to refresh
`worker-configuration.d.ts`.
