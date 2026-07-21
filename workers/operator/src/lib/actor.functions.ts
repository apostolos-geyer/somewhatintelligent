/**
 * Actor server functions. `whoAmI` is the minimal smoke-test proving the
 * Access gate → request context → server-fn pipeline (RFC-0001 D7): it returns
 * the resolved `OperatorActor` read via `requireOperatorActor`, never a browser
 * assertion. The root route's `beforeLoad` calls it to seed router context.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireOperatorActor } from "@/lib/server-fn-actor";

export const whoAmI = createServerFn({ method: "GET" })
  .middleware([requireOperatorActor])
  .handler(({ context }) => {
    return { actor: context.actor };
  });
