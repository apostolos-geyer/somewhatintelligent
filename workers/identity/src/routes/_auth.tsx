import { createFileRoute, Outlet } from "@tanstack/react-router";
import { loadProviders } from "@/lib/providers.functions";

export const Route = createFileRoute("/_auth")({
  beforeLoad: async () => ({ providers: await loadProviders() }),
  component: AuthLayout,
});

function AuthLayout() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-page">
      <div className="w-full max-w-[560px]">
        <Outlet />
      </div>
    </main>
  );
}
