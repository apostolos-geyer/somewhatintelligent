import { createFileRoute, Link } from "@tanstack/react-router";
import { Images, LayoutGrid, Megaphone } from "lucide-react";
import { Badge } from "@greenroom/ui/components/badge";
import { Button } from "@greenroom/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@greenroom/ui/components/card";
import { getAdminDashboardStats } from "@/lib/brand.functions";

/**
 * Brand-Admin dashboard home. Loads the gated stats rollup and surfaces the
 * Draft/Live state + three quick counts (hero slides, banners, enabled
 * sections). The loader calls a GET server fn; the component reads
 * `Route.useLoaderData()` — the established sprout route pattern.
 */
export const Route = createFileRoute("/admin/")({
  loader: () => getAdminDashboardStats(),
  component: AdminHome,
});

function AdminHome() {
  const stats = Route.useLoaderData();
  const isLive = stats.state === "live";

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <h1 className="font-display text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Your portal at a glance. Edit it in Setup, then publish.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant={isLive ? "sprout" : "sprout-glass"}>{isLive ? "Live" : "Draft"}</Badge>
          <Button nativeButton={false} render={<Link to="/admin/setup" />}>
            Edit portal
          </Button>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Publish state</CardTitle>
          <CardDescription>
            {isLive
              ? "Your portal is live. Unpublished draft edits won't show until you flip again."
              : "Your portal is in draft. Configure it in Setup, then flip Draft → Live."}
          </CardDescription>
        </CardHeader>
        {stats.livePublishedAt && (
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Last published{" "}
              <time dateTime={new Date(stats.livePublishedAt).toISOString()}>
                {new Date(stats.livePublishedAt).toLocaleString()}
              </time>
              .
            </p>
          </CardContent>
        )}
      </Card>

      <div className="grid gap-grid sm:grid-cols-3">
        <StatCard
          icon={<LayoutGrid className="size-5 text-primary" aria-hidden />}
          label="Sections enabled"
          value={`${stats.sectionsEnabled} / ${stats.sectionsTotal}`}
        />
        <StatCard
          icon={<Images className="size-5 text-primary" aria-hidden />}
          label="Hero slides"
          value={String(stats.heroSlides)}
        />
        <StatCard
          icon={<Megaphone className="size-5 text-primary" aria-hidden />}
          label="Banners"
          value={String(stats.banners)}
        />
      </div>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 py-5">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-sm bg-primary/10">
          {icon}
        </div>
        <div className="min-w-0">
          <div className="font-display text-2xl font-bold">{value}</div>
          <div className="text-sm text-muted-foreground">{label}</div>
        </div>
      </CardContent>
    </Card>
  );
}
