import { Link, createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Card } from "@si/ui/components/card";
import { Badge } from "@si/ui/components/badge";
import { BoxesIcon, FileTextIcon, ReceiptIcon } from "lucide-react";
import type { PageKey } from "@si/contracts";
import { StatCard } from "@/components/stat-card";
import { RecentList, type RecentRow } from "@/components/recent-list";
import { OrderStatusBadge } from "@/components/order-status-badge";
import { listOrders } from "@/lib/orders.functions";
import { listProducts } from "@/lib/products.functions";
import { listTexts } from "@/lib/texts.functions";
import { listSoftware } from "@/lib/software.functions";
import { getPage } from "@/lib/pages.functions";
import { PAGE_KEYS, PAGE_KEY_LABELS } from "@/lib/page-forms";
import { formatCents } from "@/lib/format";

// Overview — a live dashboard over the existing operator read fns (no COUNT(*)
// RPC exists, so stat tiles show capped recent-list counts honestly, "5+" at the
// limit). Every panel is fetched in the loader and tolerates its own failure:
// one failed source renders an inline error instead of crashing the page.
type Panel<T> = { ok: true; items: T[]; capped: boolean } | { ok: false };

type PageAttention = { key: PageKey; kind: "missing" | "draft" };

function toPanel<T>(items: T[] | null, limit: number): Panel<T> {
  if (items === null) return { ok: false };
  return { ok: true, items, capped: items.length >= limit };
}

async function settle<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch {
    return null;
  }
}

export const Route = createFileRoute("/")({
  loader: async () => {
    const [pendingR, recentR, productsR, textsR, softwareR, pagesR] = await Promise.all([
      settle(listOrders({ data: { status: "pending", limit: 5 } })),
      settle(listOrders({ data: { status: "all", limit: 8 } })),
      settle(listProducts({ data: { status: "draft", limit: 5 } })),
      settle(listTexts({ data: { state: "draft", limit: 5 } })),
      settle(listSoftware({ data: { state: "draft", limit: 5 } })),
      settle(
        Promise.all(
          PAGE_KEYS.map((key) =>
            getPage({ data: { key } }).then(
              (r) => ({ key, ok: r.ok, activeVersion: r.ok ? r.value.activeVersion : null }),
              () => null,
            ),
          ),
        ),
      ),
    ]);

    const pages: Panel<PageAttention> =
      pagesR === null
        ? { ok: false }
        : {
            ok: true,
            capped: false,
            items: pagesR.flatMap((p): PageAttention[] => {
              if (p === null) return [];
              if (!p.ok) return [{ key: p.key, kind: "missing" }];
              return p.activeVersion === null ? [{ key: p.key, kind: "draft" }] : [];
            }),
          };

    return {
      pendingOrders: toPanel(pendingR?.ok ? pendingR.value.orders : null, 5),
      recentOrders: toPanel(recentR?.ok ? recentR.value.orders : null, 8),
      draftProducts: toPanel(productsR?.ok ? productsR.value.products : null, 5),
      draftTexts: toPanel(textsR?.ok ? textsR.value.texts : null, 5),
      draftSoftware: toPanel(softwareR?.ok ? softwareR.value.software : null, 5),
      pages,
    };
  },
  component: Overview,
});

function statValue(panel: Panel<unknown>): string {
  if (!panel.ok) return "—";
  return panel.capped ? `${panel.items.length}+` : `${panel.items.length}`;
}

// A dashboard panel: fixed header + a body that scrolls inside the card on wide
// screens (app-frame rule — scroll lives in inner regions, never the page).
function Panel({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-0 overflow-hidden p-0 lg:min-h-0">
      <div className="border-border flex shrink-0 items-center justify-between gap-2 border-b px-5 py-4">
        <h2 className="text-foreground font-medium">{title}</h2>
        {action}
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-5 py-4">{children}</div>
    </Card>
  );
}

function Overview() {
  const { actor } = Route.useRouteContext();
  const { pendingOrders, recentOrders, draftProducts, draftTexts, draftSoftware, pages } =
    Route.useLoaderData();

  const orderRows: RecentRow[] = recentOrders.ok
    ? recentOrders.items.map((o) => ({
        key: o.orderNumber,
        title: o.orderNumber,
        subtitle: o.email,
        meta: (
          <div className="flex items-center gap-3">
            <span className="text-foreground font-mono text-xs">{formatCents(o.totalCents)}</span>
            <OrderStatusBadge status={o.status} />
          </div>
        ),
        link: <Link to="/orders/$orderNumber" params={{ orderNumber: o.orderNumber }} />,
      }))
    : [];

  const draftBadge = (
    <Badge variant="warning-brutal" size="sm">
      Draft
    </Badge>
  );
  const attentionRows: RecentRow[] = [
    ...(draftTexts.ok
      ? draftTexts.items.map(
          (t): RecentRow => ({
            key: `text:${t.textId}`,
            title: t.title,
            subtitle: `text · ${t.slug}`,
            meta: draftBadge,
            link: <Link to="/texts/$textId" params={{ textId: t.textId }} />,
          }),
        )
      : []),
    ...(draftSoftware.ok
      ? draftSoftware.items.map(
          (s): RecentRow => ({
            key: `software:${s.softwareId}`,
            title: s.title,
            subtitle: `software · ${s.slug}`,
            meta: draftBadge,
            link: <Link to="/software/$softwareId" params={{ softwareId: s.softwareId }} />,
          }),
        )
      : []),
    ...(draftProducts.ok
      ? draftProducts.items.map(
          (p): RecentRow => ({
            key: `product:${p.productId}`,
            title: p.title,
            subtitle: `object · ${p.slug}`,
            meta: draftBadge,
            link: <Link to="/objects/$productId" params={{ productId: p.productId }} />,
          }),
        )
      : []),
    ...(pages.ok
      ? pages.items.map(
          (pg): RecentRow => ({
            key: `page:${pg.key}`,
            title: PAGE_KEY_LABELS[pg.key],
            subtitle: "page",
            meta:
              pg.kind === "missing" ? (
                <Badge variant="outline" size="sm">
                  Not created
                </Badge>
              ) : (
                draftBadge
              ),
            link: <Link to="/pages/$key" params={{ key: pg.key }} />,
          }),
        )
      : []),
  ];
  const attentionError = !draftTexts.ok && !draftSoftware.ok && !draftProducts.ok && !pages.ok;

  return (
    <div className="flex flex-col gap-6 lg:h-full lg:min-h-0">
      <div>
        <h1 className="text-foreground text-3xl font-light tracking-tight">Overview</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Signed in as <span className="text-foreground font-medium">{actor?.email}</span>
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Link to="/orders" search={{ status: "pending" }} className="block">
          <StatCard
            label="Pending orders"
            value={statValue(pendingOrders)}
            hint="awaiting payment"
            icon={<ReceiptIcon />}
          />
        </Link>
        <Link to="/objects" className="block">
          <StatCard
            label="Draft products"
            value={statValue(draftProducts)}
            hint="unpublished"
            icon={<BoxesIcon />}
          />
        </Link>
        <Link to="/texts" search={{ state: "draft" }} className="block">
          <StatCard
            label="Draft texts"
            value={statValue(draftTexts)}
            hint="unpublished"
            icon={<FileTextIcon />}
          />
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:min-h-0 lg:flex-1 lg:grid-cols-2">
        <Panel
          title="Recent orders"
          action={
            <Link
              to="/orders"
              search={{ status: "all" }}
              className="text-primary font-mono text-xs underline-offset-4 hover:underline"
            >
              all orders →
            </Link>
          }
        >
          <RecentList rows={orderRows} error={!recentOrders.ok} empty="No orders yet." />
        </Panel>

        <Panel
          title="Needs attention"
          action={
            <span className="text-muted-foreground font-mono text-[10px] uppercase tracking-wider">
              drafts & unpublished
            </span>
          }
        >
          <RecentList
            rows={attentionRows}
            error={attentionError}
            empty="Everything is published."
          />
        </Panel>
      </div>
    </div>
  );
}
