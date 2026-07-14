import { createFileRoute, redirect } from "@tanstack/react-router";
import { CheckIcon } from "lucide-react";
import { STORE_LIVE } from "@/lib/config";

// Post-signup landing spot: identity's sign-up flow round-trips back here via
// `returnTo`. Only meaningful pre-launch and with a session — otherwise the
// index route (shop or landing) is the right place.
export const Route = createFileRoute("/_public/welcome")({
  beforeLoad: ({ context }) => {
    if (STORE_LIVE || !context.session) throw redirect({ to: "/" });
  },
  component: Welcome,
});

function Welcome() {
  const { session } = Route.useRouteContext();
  return (
    <div className="mx-auto flex max-w-6xl flex-col justify-center px-4 py-24 md:px-6 md:py-36">
      <section className="max-w-2xl">
        <h1 className="font-display text-foreground text-[clamp(36px,6vw,64px)] leading-[0.95] font-extralight tracking-tighter">
          You&rsquo;re on the list.
        </h1>
        <p className="text-muted-foreground mt-6 max-w-md text-lg">
          We&rsquo;ll email you when the first drop lands.
        </p>

        <div className="border-border bg-card mt-8 inline-flex items-center gap-3 rounded-md border px-4 py-3">
          <CheckIcon className="text-primary size-4 shrink-0" />
          <span className="text-foreground font-mono text-sm">{session?.user.email}</span>
        </div>
      </section>
    </div>
  );
}
