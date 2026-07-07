import { createFileRoute, useRouter } from "@tanstack/react-router";
import { getAdminPortalConfig, getAdminTheme } from "@/lib/brand.functions";
import { PortalSetupForm } from "@/components/admin/PortalSetupForm";

/**
 * Portal setup screen. Loads the TWO config paths in parallel — the theme
 * (draft + live, publish lifecycle) and the portal content config (live-edit:
 * name/tagline/feed label/sections) — and hands them to `PortalSetupForm`,
 * which owns one save path per card group. After any save the loader is
 * invalidated so the dashboard counts + publish state stay fresh.
 */
export const Route = createFileRoute("/admin/setup")({
  loader: async () => {
    const [theme, content] = await Promise.all([getAdminTheme(), getAdminPortalConfig()]);
    return { theme, content };
  },
  component: SetupScreen,
});

function SetupScreen() {
  const { theme, content } = Route.useLoaderData();
  const router = useRouter();

  return (
    <div className="flex flex-col gap-6">
      <header className="space-y-1">
        <h1 className="font-display text-2xl font-bold">Portal setup</h1>
        <p className="text-sm text-muted-foreground">
          Portal content (name, tagline, sections) saves live. The theme keeps a private draft you
          publish when it&rsquo;s ready.
        </p>
      </header>
      <PortalSetupForm theme={theme} content={content} onSaved={() => void router.invalidate()} />
    </div>
  );
}
