import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  beforeLoad: ({ context }) => {
    throw redirect({ href: context.session ? "/account" : "/sign-in" });
  },
});
