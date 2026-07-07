import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { type } from "arktype";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { useAppForm } from "@greenroom/ui/hooks/use-app-form";
import { Button } from "@greenroom/ui/components/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@greenroom/ui/components/dialog";
import { Badge } from "@greenroom/ui/components/badge";
import { cn } from "@greenroom/ui/lib/utils";
import { surfaceMaterials } from "@greenroom/ui/lib/materials";
import { SECTION_KEYS, SECTION_META, type SectionKey } from "@/lib/sections";
import { SortableList } from "@/components/admin/SortableList";
import { AdminPageHeader, AdminSection, ErrorBanner } from "@/components/admin/AdminScaffold";
import { RowEditButton } from "@/components/admin/ListRow";
import { FormDialog, useSaveHandler } from "@/components/admin/FormDialog";
import { parseDateTime, toDateTimeLocal } from "@/components/admin/datetime";
import {
  deleteBanner,
  getBannerReport,
  listAdminBanners,
  upsertBanner,
  type AdminBannerView,
  type BannerReportRow,
  type BannerStatus,
} from "@/lib/banners.functions";

/**
 * Brand-Admin banner-card management (P3.D). Nests under the pathless `admin.tsx`
 * guard — SELF-CONTAINED (imports no Admin setup chrome). Mutations are brand-role
 * gated server-side (`decideBrandAdmin`); brand_id is the envelope's activeOrgId,
 * never sent.
 *
 * Banners flank the landing hero. Each is config (real DELETE, not soft-delete)
 * with an IN-PLATFORM `{ section, item }` jump target — never an external URL; the
 * section picker is constrained to the canonical six section keys. The keyboard-
 * first `SortableList` rewrites `order_idx` (persisted per row on reorder), and a
 * reporting table surfaces impressions / clicks / CTR per card.
 */
export const Route = createFileRoute("/admin/content/banners")({
  loader: async () => {
    const [banners, report] = await Promise.all([listAdminBanners(), getBannerReport()]);
    return { banners, report };
  },
  component: AdminBannersPage,
});

/** Section picker options — the six canonical keys plus a "no link" sentinel. */
const NO_SECTION = "__none__";
const SECTION_OPTIONS = [
  { value: NO_SECTION, label: "No link (informational)" },
  ...SECTION_KEYS.map((k) => ({
    value: k,
    label: `${SECTION_META[k].num} · ${SECTION_META[k].title}`,
  })),
];

const STATUS_BADGE: Record<
  BannerStatus,
  { label: string; variant: "info" | "growth" | "outline" }
> = {
  scheduled: { label: "Scheduled", variant: "info" },
  live: { label: "Live", variant: "growth" },
  expired: { label: "Expired", variant: "outline" },
};

/** Format a CTR ratio → percentage string; null (no impressions) → an em-dash. */
function formatCtr(ctr: number | null): string {
  return ctr == null ? "—" : `${(ctr * 100).toFixed(1)}%`;
}

function AdminBannersPage() {
  const { banners, report } = Route.useLoaderData();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminBannerView | "new" | null>(null);
  const [reordering, setReordering] = useState(false);

  /**
   * Persist a reorder: rewrite each card's `order_idx` to its new index via the
   * upsert fn (only the rows whose index actually changed are written), then
   * invalidate the route so the loader re-reads the new order.
   */
  async function onReorder(next: AdminBannerView[]) {
    setReordering(true);
    setError(null);
    try {
      await Promise.all(
        next.map((banner, index) =>
          banner.orderIdx === index
            ? null
            : upsertBanner({
                data: {
                  bannerId: banner.id,
                  headline: banner.headline,
                  ...(banner.categoryTag ? { categoryTag: banner.categoryTag } : {}),
                  ...(banner.line ? { line: banner.line } : {}),
                  ...(banner.section ? { section: banner.section } : {}),
                  ...(banner.section && banner.item ? { item: banner.item } : {}),
                  dismissible: banner.dismissible,
                  ...(banner.liveFrom != null ? { liveFrom: banner.liveFrom } : {}),
                  ...(banner.expiresAt != null ? { expiresAt: banner.expiresAt } : {}),
                  orderIdx: index,
                },
              }),
        ),
      );
      await router.invalidate();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reorder failed.");
      await router.invalidate();
    } finally {
      setReordering(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <AdminPageHeader
        title="Banner cards"
        description="The cards flanking the landing hero. Each links to an in-platform section, runs on a schedule, and reports its reach."
        action={
          <Button type="button" variant="strong" onClick={() => setEditing("new")}>
            <Plus className="size-4" aria-hidden />
            New banner
          </Button>
        }
      />

      <ErrorBanner error={error} />

      {banners.length === 0 && (
        <p className="text-sm text-muted-foreground">No banner cards yet. Add one above.</p>
      )}

      {banners.length > 0 && (
        <AdminSection title="Cards">
          <SortableList
            items={banners}
            getKey={(b) => b.id}
            getLabel={(b) => b.headline}
            onReorder={(next) => void onReorder(next)}
            renderItem={(banner) => (
              <BannerRow
                banner={banner}
                onEdit={() => setEditing(banner)}
                onChanged={() => void router.invalidate()}
              />
            )}
          />
          {reordering && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              Saving order…
            </p>
          )}
        </AdminSection>
      )}

      <ReportTable rows={report} />

      {editing && (
        <BannerDialog
          banner={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void router.invalidate();
          }}
        />
      )}
    </div>
  );
}

// ─── card row (label + meta + edit/delete) ──────────────────────────────────

function BannerRow({
  banner,
  onEdit,
  onChanged,
}: {
  banner: AdminBannerView;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const badge = STATUS_BADGE[banner.status];
  const target = banner.section
    ? `${SECTION_META[banner.section].title}${banner.item ? ` · ${banner.item}` : ""}`
    : "No link";

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium" title={banner.headline}>
          {banner.headline}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {banner.categoryTag ? `${banner.categoryTag} · ` : ""}
          {target} · {banner.impressions} impr · {banner.clicks} clicks · {formatCtr(banner.ctr)}{" "}
          CTR
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={badge.variant}>{badge.label}</Badge>
        {!banner.dismissible && <Badge variant="outline">Sticky</Badge>}
        <RowEditButton ariaLabel={`Edit ${banner.headline}`} onClick={onEdit} />
        <DeleteButton banner={banner} onDeleted={onChanged} />
      </div>
    </div>
  );
}

// ─── create / edit ──────────────────────────────────────────────────────────

const bannerSchema = type({
  headline: "string >= 1",
  line: "string",
  categoryTag: "string",
  section: "string >= 1",
  item: "string",
  dismissible: "boolean",
  liveFrom: "string",
  expiresAt: "string",
  orderIdx: "string",
});

/** Parse a non-negative integer text field; blank/invalid → undefined. */
function parseOrderIdx(raw: string): number | undefined {
  const t = raw.trim();
  if (!t) return undefined;
  const n = Number(t);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}

interface BannerFormValues {
  headline: string;
  line: string;
  categoryTag: string;
  section: string;
  item: string;
  dismissible: boolean;
  liveFrom: string;
  expiresAt: string;
  orderIdx: string;
}

const NEW_BANNER_DEFAULTS: BannerFormValues = {
  headline: "",
  line: "",
  categoryTag: "",
  section: NO_SECTION,
  item: "",
  dismissible: true,
  liveFrom: "",
  expiresAt: "",
  orderIdx: "",
};

function bannerDefaults(banner: AdminBannerView | null): BannerFormValues {
  if (!banner) return NEW_BANNER_DEFAULTS;
  return {
    headline: banner.headline,
    line: banner.line ?? "",
    categoryTag: banner.categoryTag ?? "",
    section: banner.section ?? NO_SECTION,
    item: banner.item ?? "",
    dismissible: banner.dismissible,
    liveFrom: toDateTimeLocal(banner.liveFrom),
    expiresAt: toDateTimeLocal(banner.expiresAt),
    orderIdx: String(banner.orderIdx),
  };
}

function buildBannerPayload(banner: AdminBannerView | null, value: BannerFormValues) {
  const liveFrom = parseDateTime(value.liveFrom);
  const expiresAt = parseDateTime(value.expiresAt);
  const section = value.section !== NO_SECTION ? (value.section as SectionKey) : null;
  const item = section ? value.item.trim() : "";
  const orderIdx = parseOrderIdx(value.orderIdx);
  return {
    ...(banner ? { bannerId: banner.id } : {}),
    headline: value.headline.trim(),
    ...(value.line.trim() ? { line: value.line.trim() } : {}),
    ...(value.categoryTag.trim() ? { categoryTag: value.categoryTag.trim() } : {}),
    ...(section ? { section } : {}),
    ...(section && item ? { item } : {}),
    dismissible: value.dismissible,
    ...(liveFrom != null ? { liveFrom } : {}),
    ...(expiresAt != null ? { expiresAt } : {}),
    ...(orderIdx !== undefined ? { orderIdx } : {}),
  };
}

function BannerDialog({
  banner,
  onClose,
  onSaved,
}: {
  banner: AdminBannerView | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { saveError, setSaveError, save } = useSaveHandler(onSaved);

  const form = useAppForm({
    defaultValues: bannerDefaults(banner),
    validators: { onBlur: bannerSchema },
    onSubmit: async ({ value }) => {
      const liveFrom = parseDateTime(value.liveFrom);
      const expiresAt = parseDateTime(value.expiresAt);
      if (liveFrom != null && expiresAt != null && expiresAt <= liveFrom) {
        setSaveError("Expiry must be after the go-live time.");
        return;
      }
      await save(() => upsertBanner({ data: buildBannerPayload(banner, value) }));
    },
  });

  return (
    <FormDialog
      form={form}
      title={banner ? "Edit banner" : "New banner"}
      description="Banners link to an in-platform section only — never an external URL."
      onClose={onClose}
      error={saveError}
      contentClassName="max-h-[90vh] overflow-auto sm:max-w-lg"
    >
      <form.AppField name="headline">
        {(field) => <field.TextField label="Headline" placeholder="New drop this Friday" />}
      </form.AppField>

      <form.AppField name="line">
        {(field) => <field.TextField label="Line" placeholder="Tap to see what's landing" />}
      </form.AppField>

      <form.AppField name="categoryTag">
        {(field) => (
          <field.TextField
            label="Category tag"
            placeholder="Announcement"
            description="A small label chip on the card. Optional."
          />
        )}
      </form.AppField>

      <form.AppField name="section">
        {(field) => (
          <field.SelectField
            label="Link target"
            options={SECTION_OPTIONS}
            description="The in-platform section this card jumps to."
          />
        )}
      </form.AppField>

      <form.Subscribe selector={(s) => s.values.section}>
        {(section) =>
          section !== NO_SECTION ? (
            <form.AppField name="item">
              {(field) => (
                <field.TextField
                  label="Item (optional)"
                  placeholder="Deep-link id within the section"
                  description="Opens this specific item in the linked section. Leave blank to land on the section."
                />
              )}
            </form.AppField>
          ) : null
        }
      </form.Subscribe>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <form.AppField name="liveFrom">
          {(field) => (
            <field.TextField
              label="Go live"
              type="text"
              placeholder="YYYY-MM-DDThh:mm"
              description="Blank = live now."
            />
          )}
        </form.AppField>
        <form.AppField name="expiresAt">
          {(field) => (
            <field.TextField
              label="Expires"
              type="text"
              placeholder="YYYY-MM-DDThh:mm"
              description="Blank = no expiry."
            />
          )}
        </form.AppField>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <form.AppField name="orderIdx">
          {(field) => (
            <field.TextField
              label="Order"
              type="text"
              placeholder="0"
              description="Lower sorts first. Or reorder with the arrows."
            />
          )}
        </form.AppField>
        <form.AppField name="dismissible">
          {(field) => (
            <field.SwitchField label="Dismissible" description="Lets a budtender hide the card." />
          )}
        </form.AppField>
      </div>
    </FormDialog>
  );
}

// ─── delete (real DELETE — banners are config) ──────────────────────────────

function DeleteButton({ banner, onDeleted }: { banner: AdminBannerView; onDeleted: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onDelete() {
    setBusy(true);
    try {
      await deleteBanner({ data: { bannerId: banner.id } });
      onDeleted();
    } catch {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={() => setConfirming(true)}
        aria-label={`Delete ${banner.headline}`}
      >
        <Trash2 className="size-4" aria-hidden />
        Delete
      </Button>
      {confirming && (
        <Dialog open onOpenChange={(open) => !open && !busy && setConfirming(false)}>
          <DialogContent showCloseButton>
            <DialogHeader>
              <DialogTitle>Delete this banner?</DialogTitle>
              <DialogDescription>
                “{banner.headline}” will be removed permanently — banners are config, not content,
                so this can't be undone.
              </DialogDescription>
            </DialogHeader>
            <div className="flex justify-end gap-2">
              <DialogClose render={<Button type="button" variant="outline" disabled={busy} />}>
                Cancel
              </DialogClose>
              <Button
                type="button"
                variant="destructive"
                disabled={busy}
                onClick={() => void onDelete()}
              >
                {busy ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Trash2 className="size-4" aria-hidden />
                )}
                Delete
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

// ─── reporting table (impressions / clicks / CTR) ───────────────────────────

function ReportTable({ rows }: { rows: BannerReportRow[] }) {
  return (
    <AdminSection title="Reporting">
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">No reach yet — banners report once live.</p>
      ) : (
        <div className={cn("overflow-x-auto", surfaceMaterials.brutal)}>
          <table className="w-full min-w-[32rem] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-3 py-2 font-semibold">Banner</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 text-right font-semibold">Impressions</th>
                <th className="px-3 py-2 text-right font-semibold">Clicks</th>
                <th className="px-3 py-2 text-right font-semibold">CTR</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const badge = STATUS_BADGE[row.status];
                return (
                  <tr key={row.id} className="border-b border-border/60 last:border-b-0">
                    <td
                      className="max-w-[14rem] truncate px-3 py-2 font-medium"
                      title={row.headline}
                    >
                      {row.headline}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={badge.variant}>{badge.label}</Badge>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.impressions}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.clicks}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatCtr(row.ctr)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </AdminSection>
  );
}
