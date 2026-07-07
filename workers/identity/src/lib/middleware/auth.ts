import { redirect } from "@tanstack/react-router";
import { createPrincipalGate, type Principal } from "@greenroom/kit/react-start";
import { isAdminRole } from "@greenroom/kit/roles";
import { envelopeMiddleware } from "@/lib/platform";

export { envelopeMiddleware };

type UserPrincipal = Extract<Principal, { kind: "user" }>;

export const requireUserMiddleware = createPrincipalGate({
  envelope: envelopeMiddleware,
  predicate: (p): p is UserPrincipal => p.kind === "user",
  onReject: () => {
    throw redirect({ href: "/sign-in" });
  },
});

export const requireAdminMiddleware = createPrincipalGate({
  envelope: envelopeMiddleware,
  predicate: (p): p is UserPrincipal => p.kind === "user" && isAdminRole(p.actor.role),
  onReject: () => {
    throw redirect({ href: "/account" });
  },
});
