# @si/contracts

Single source of truth for the typed contracts shared across the RFC-0001
control plane — the **Operator**, **Publisher**, **Store**, and **Site** workers
all compile against these types instead of keeping divergent copies.

This is track **T0** of
[`docs/exec-plans/active/0004-unified-publishing-commerce-control-plane.md`](../../docs/exec-plans/active/0004-unified-publishing-commerce-control-plane.md);
the shapes are transcribed verbatim from the **Contracts** and **Fixed page
document contracts** sections of
[`docs/rfc/0001-unified-publishing-commerce-control-plane.md`](../../docs/rfc/0001-unified-publishing-commerce-control-plane.md).

## What lives here

| Module      | Contents                                                                                                                 |
| ----------- | ------------------------------------------------------------------------------------------------------------------------ |
| `result`    | `DomainResult<T, E>` and the `ok`/`err` constructors                                                                     |
| `operator`  | `OperatorActor`, `OperatorMeta`, `OperatorCall<T>`, `OperatorCommandInput<T>`, `deriveIdempotencyKey`, `commandIdSchema` |
| `deletion`  | `DeletionImpact`, `DeletionPlan`, `ConfirmDeletionInput`, `DeletionError`                                                |
| `access`    | `OperatorAccessConfig`, `OperatorEnv`                                                                                    |
| `media`     | `PublicMediaRef`, `ProductMediaDTO`, `PublisherMediaDTO`, `MediaMutationError`                                           |
| `version`   | `SEMVER_PATTERN`, `isValidVersion`, `versionSchema`                                                                      |
| `cart`      | `CART_STORAGE_KEY`, `CartV1`, `cartV1Schema`, `normalizeCart`                                                            |
| `pages`     | `PageKey`, the five `*DocumentV1` types, `PageDocumentByKey`, `validatePageDocument`                                     |
| `store`     | `StoreCatalog*` / `StoreOperator*` DTOs + entrypoint interfaces + the `/api/store` HTTP types                            |
| `publisher` | `PublisherPublic*` / `PublisherOperator*` DTOs + entrypoint interfaces                                                   |

## What does **not** live here

- The private `MediaStorage {put/read/delete}` port — it is a backend-internal
  adapter (RFC D10), not exported from any RPC entrypoint (track T5).
- D1 schemas, server-function factories, and Access middleware — those are the
  owning worker's implementation.

## Boundary validators

`@si/contracts` owns the runtime validators the RFC's contract-test tier
requires: SemVer accept/reject (`versionSchema`), `CartV1` normalization
(`normalizeCart`), and per-key page-document validation (`validatePageDocument`,
which rejects unknown/arbitrary fields per INV-PAGE-1). Validators use
[arktype](https://arktype.io), the repo's validation library.
