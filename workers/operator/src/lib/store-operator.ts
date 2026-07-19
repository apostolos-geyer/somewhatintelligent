/**
 * Server-side StoreOperator mutation client (RFC-0001 D7). Operator binds
 * `STORE` with entrypoint `StoreOperator`; the generated Env types it as a bare
 * `Service`, so the frozen `@si/contracts` interface is asserted here — the one
 * place that cast lives. Cross-worker RPC types never auto-resolve for a
 * TanStack Start target, so the interface is asserted, not imported by class.
 *
 * Every method takes an `OperatorCall<T>` envelope: the caller supplies the
 * domain `input` and the server-derived `OperatorMeta` (from `buildOperatorMeta`).
 */
import { env } from "cloudflare:workers";
import type { StoreOperatorEntrypoint } from "@si/contracts";

export type {
  OrderStatus,
  OrderListInput,
  OrderListResult,
  OrderDetailDTO,
  OrderMutationError,
  SetOrderStatusInput,
  FulfillOrderInput,
} from "@si/contracts";

/** The STORE service binding, typed to the operator-mutation contract. */
export function storeOperator(): StoreOperatorEntrypoint {
  return env.STORE as unknown as StoreOperatorEntrypoint;
}
