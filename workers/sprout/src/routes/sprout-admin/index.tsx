import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { type } from "arktype";
import { Activity, Boxes, MessagesSquare, Sprout, Users } from "lucide-react";
import { useAppForm } from "@greenroom/ui/hooks/use-app-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@greenroom/ui/components/card";
import { Badge } from "@greenroom/ui/components/badge";
import { cn } from "@greenroom/ui/lib/utils";
import { surfaceMaterials } from "@greenroom/ui/lib/materials";
import {
  getCrossBrandStats,
  getSystemHealth,
  listBrands,
  provisionOrg,
  type BrandSummary,
  type CrossBrandStats,
  type SystemHealth,
} from "@/lib/sprout-admin.functions";

/**
 * The Sprout-Admin (platform-operator) overview. Nests under the `sprout-admin.tsx`
 * god-mode guard the Sprout-Admin stream owns. The loader fans out the three
 * cross-brand reads (all `requireAdminMiddleware`-gated, all intentionally
 * brand_id-unscoped) in parallel; the page renders a platform-health strip, the
 * all-brands monitoring table, the cross-brand engagement breakdown, and the
 * org-provisioning form. After a provision the loader is invalidated so the new
 * brand appears in the table without a manual refresh.
 *
 * NO chart library: the engagement breakdown is a token-driven horizontal bar
 * built from a plain div scaled by the per-type max — `--color-sprout` fill,
 * `rounded-sm`, tokens only.
 */
export const Route = createFileRoute("/sprout-admin/")({
  loader: async () => {
    const [brands, health, stats] = await Promise.all([
      listBrands(),
      getSystemHealth(),
      getCrossBrandStats({ data: {} }),
    ]);
    return { brands, health, stats };
  },
  component: SproutAdminOverview,
});

function SproutAdminOverview() {
  const { brands, health, stats } = Route.useLoaderData();
  const router = useRouter();

  return (
    <div className="flex flex-col gap-8">
      <header className="space-y-1">
        <h1 className="font-display text-2xl font-bold tracking-tight">Platform overview</h1>
        <p className="text-sm text-muted-foreground">
          Cross-brand monitoring for every tenant on Sprout. God-mode reads — not scoped to one
          brand.
        </p>
      </header>

      <HealthStrip health={health} />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Brands
        </h2>
        <BrandsTable brands={brands} />
      </section>

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <EngagementBreakdown stats={stats} />
        <ProvisionForm onProvisioned={() => void router.invalidate()} />
      </section>
    </div>
  );
}

// ─── platform-health strip ──────────────────────────────────────────────────

function HealthStrip({ health }: { health: SystemHealth }) {
  const cards = [
    {
      icon: <Sprout className="size-5 text-primary" aria-hidden />,
      label: "Brands",
      value: `${health.liveBrands} / ${health.brands}`,
      hint: "live / total",
    },
    {
      icon: <Users className="size-5 text-primary" aria-hidden />,
      label: "Active users",
      value: String(health.users),
      hint: "distinct actors",
    },
    {
      icon: <Boxes className="size-5 text-primary" aria-hidden />,
      label: "Products",
      value: String(health.products),
      hint: `${health.decks} decks · ${health.assets} assets`,
    },
    {
      icon: <MessagesSquare className="size-5 text-primary" aria-hidden />,
      label: "AI questions",
      value: String(health.aiQuestions),
      hint: `${health.sessions} sessions`,
    },
    {
      icon: <Activity className="size-5 text-primary" aria-hidden />,
      label: "Events (24h)",
      value: String(health.eventsLast24h),
      hint: `${health.events} all-time`,
    },
  ];

  return (
    <section className="grid gap-grid sm:grid-cols-2 lg:grid-cols-5">
      {cards.map((c) => (
        <Card key={c.label}>
          <CardContent className="flex items-center gap-4 py-5">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-sm bg-primary/10">
              {c.icon}
            </div>
            <div className="min-w-0">
              <div className="font-display text-2xl font-bold">{c.value}</div>
              <div className="text-sm text-muted-foreground">{c.label}</div>
              <div className="truncate text-xs text-muted-foreground/70">{c.hint}</div>
            </div>
          </CardContent>
        </Card>
      ))}
    </section>
  );
}

// ─── all-brands monitoring table (raw <table>, identity-admin pattern) ───────

function fmtDate(ms: number | null): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function BrandsTable({ brands }: { brands: BrandSummary[] }) {
  return (
    <div className="flex-1 overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-[760px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40">
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Brand</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">State</th>
            <th className="px-4 py-3 text-right font-medium text-muted-foreground">Products</th>
            <th className="px-4 py-3 text-right font-medium text-muted-foreground">Decks</th>
            <th className="px-4 py-3 text-right font-medium text-muted-foreground">Assets</th>
            <th className="px-4 py-3 text-right font-medium text-muted-foreground">Events</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Synced</th>
          </tr>
        </thead>
        <tbody>
          {brands.length === 0 && (
            <tr>
              <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                No brands provisioned yet. Provision your first tenant below.
              </td>
            </tr>
          )}
          {brands.map((b) => (
            <tr key={b.orgId} className="border-b border-border last:border-0">
              <td className="px-4 py-3">
                <div className="font-medium">{b.name}</div>
                <div className="font-mono text-xs text-muted-foreground">{b.slug}</div>
              </td>
              <td className="px-4 py-3">
                {!b.hasConfig ? (
                  <Badge variant="outline">Unconfigured</Badge>
                ) : b.state === "live" ? (
                  <Badge variant="sprout">Live</Badge>
                ) : (
                  <Badge variant="sprout-glass">Draft</Badge>
                )}
              </td>
              <td className="px-4 py-3 text-right font-mono text-xs">{b.products}</td>
              <td className="px-4 py-3 text-right font-mono text-xs">{b.decks}</td>
              <td className="px-4 py-3 text-right font-mono text-xs">{b.assets}</td>
              <td className="px-4 py-3 text-right font-mono text-xs">{b.events}</td>
              <td className="px-4 py-3 text-xs text-muted-foreground">{fmtDate(b.syncedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── cross-brand engagement breakdown (token-driven SVG-free bars) ───────────

function EngagementBreakdown({ stats }: { stats: CrossBrandStats }) {
  const max = stats.byType.reduce((m, t) => Math.max(m, t.count), 0);

  return (
    <Card className={cn(surfaceMaterials.brutal)}>
      <CardHeader className="border-b pb-4">
        <CardTitle>Engagement by type</CardTitle>
        <CardDescription>
          Every recorded event across all brands ({stats.total.toLocaleString()} total). Append-only
          stream — never mutated.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        {stats.byType.length === 0 ? (
          <p className="text-sm text-muted-foreground">No engagement events recorded yet.</p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {stats.byType.map((t) => (
              <li key={t.type} className="flex items-center gap-3">
                <span className="w-24 shrink-0 truncate font-mono text-xs text-muted-foreground sm:w-40">
                  {t.type}
                </span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-sm bg-muted">
                  <div
                    className="h-full rounded-sm bg-[var(--color-sprout)]"
                    style={{ width: `${max > 0 ? Math.max(2, (t.count / max) * 100) : 0}%` }}
                    aria-hidden
                  />
                </div>
                <span className="w-12 shrink-0 text-right font-mono text-xs tabular-nums">
                  {t.count}
                </span>
              </li>
            ))}
          </ul>
        )}

        {stats.brands.length > 0 && (
          <div className="mt-6 space-y-2 border-t border-border pt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Top brands by volume
            </h3>
            <ul className="flex flex-col gap-1.5">
              {stats.brands.slice(0, 5).map((b) => (
                <li key={b.brandId} className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate font-medium">{b.name}</span>
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">
                    {b.events.toLocaleString()} events · {b.activeUsers} users
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── org-provisioning form (useAppForm → provisionOrg) ───────────────────────

/** Slugify a brand name into the kebab-case host label guestlist accepts. */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// `slug` is permissive client-side (blank → derived from the name at submit;
// guestlist re-validates the kebab-case pattern + slug-collision server-side,
// which is the real boundary). `name`/`ownerUserId` are UX guardrails.
const provisionSchema = type({
  name: "string >= 2",
  slug: "string",
  ownerUserId: "string >= 1",
});

function ProvisionForm({ onProvisioned }: { onProvisioned: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const form = useAppForm({
    defaultValues: { name: "", slug: "", ownerUserId: "" },
    validators: { onBlur: provisionSchema },
    onSubmit: async ({ value, formApi }) => {
      setError(null);
      setNotice(null);
      try {
        const result = await provisionOrg({
          data: {
            name: value.name.trim(),
            slug: slugify(value.slug) || slugify(value.name),
            ownerUserId: value.ownerUserId.trim(),
          },
        });
        if (!result.ok) {
          setError(
            result.error === "slug_taken"
              ? "That slug is already taken — pick another."
              : result.message,
          );
          return;
        }
        setNotice(`Provisioned ${result.name} (${result.slug}).`);
        formApi.reset();
        onProvisioned();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
  });

  return (
    <Card className={cn(surfaceMaterials.brutal)}>
      <CardHeader className="border-b pb-4">
        <CardTitle>Provision a brand</CardTitle>
        <CardDescription>
          Creates the org in guestlist and seeds its runtime config + directory rows. The owner is
          an existing platform user (their identity user id).
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-4">
        {error && (
          <p
            role="alert"
            className="mb-4 rounded-sm bg-destructive/10 px-3 py-2 text-sm text-destructive"
          >
            {error}
          </p>
        )}
        {notice && (
          <p className="mb-4 rounded-sm bg-success-bg px-3 py-2 text-sm text-growth-700">
            {notice}
          </p>
        )}
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void form.handleSubmit();
          }}
        >
          <form.AppField name="name">
            {(field) => <field.TextField label="Brand name" placeholder="Acme Cannabis" />}
          </form.AppField>

          <form.AppField name="slug">
            {(field) => (
              <field.TextField
                label="Slug"
                placeholder="acme-cannabis"
                description="The host label (acme-cannabis.sproutportal.ca). Lowercase, hyphenated; blank derives from the name."
              />
            )}
          </form.AppField>

          <form.AppField name="ownerUserId">
            {(field) => (
              <field.TextField
                label="Owner user id"
                placeholder="usr_…"
                description="The identity user who owns this brand. They become its org owner."
              />
            )}
          </form.AppField>

          <form.AppForm>
            <div className="flex items-center gap-3">
              <form.SubmitButton label="Provision brand" loadingLabel="Provisioning…" />
            </div>
          </form.AppForm>
        </form>
      </CardContent>
    </Card>
  );
}
