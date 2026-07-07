import { createFileRoute, Outlet } from "@tanstack/react-router";
import { BRAND_NAME } from "@/lib/config";
import { VERSION_LABEL } from "@/lib/version";

export const Route = createFileRoute("/_public")({
  component: PublicLayout,
});

function PublicLayout() {
  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col">
      <main className="flex-1">
        <Outlet />
      </main>
      <footer className="border-border text-text-tertiary border-t px-6 py-8 text-center font-mono text-xs">
        <div>{BRAND_NAME} · printed in small runs · payment collected on confirmation</div>
        {/* Build stamp: version + short git sha (vite define, safe fallbacks). */}
        <div className="mt-1 opacity-60">{VERSION_LABEL}</div>
      </footer>
    </div>
  );
}
