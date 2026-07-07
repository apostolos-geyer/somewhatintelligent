import { createFileRoute, redirect } from "@tanstack/react-router";
import { SignUpForm } from "@/components/auth/sign-up-form";
import { decodeReturnTo } from "@/lib/return-to";

export const Route = createFileRoute("/_auth/sign-up")({
  validateSearch: (search: Record<string, unknown>): { returnTo?: string } => ({
    returnTo: typeof search.returnTo === "string" ? search.returnTo : undefined,
  }),
  beforeLoad: ({ context, search }) => {
    const returnTo = decodeReturnTo(search.returnTo);
    if (context.session) throw redirect({ href: returnTo ?? "/account" });
  },
  head: () => ({ meta: [{ title: "Sign Up — Identity" }] }),
  component: SignUpPage,
});

function SignUpPage() {
  const { returnTo } = Route.useSearch();
  const { providers } = Route.useRouteContext();
  return <SignUpForm returnTo={decodeReturnTo(returnTo)} providers={providers} />;
}
