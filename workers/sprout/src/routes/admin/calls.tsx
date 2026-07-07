import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { type } from "arktype";
import { CalendarClock, CalendarDays, Plus, Users, Video } from "lucide-react";
import { useAppForm } from "@greenroom/ui/hooks/use-app-form";
import { Button } from "@greenroom/ui/components/button";
import { Badge } from "@greenroom/ui/components/badge";
import { Skeleton } from "@greenroom/ui/components/skeleton";
import { cn } from "@greenroom/ui/lib/utils";
import { surfaceMaterials } from "@greenroom/ui/lib/materials";
import { AdminPageHeader, ErrorBanner } from "@/components/admin/AdminScaffold";
import { RowEditButton } from "@/components/admin/ListRow";
import { FormDialog, useSaveHandler } from "@/components/admin/FormDialog";
import { parseDateTimeRange, toDateTimeLocal } from "@/components/admin/datetime";
import {
  listAdminGroupSessions,
  listAdminWindows,
  upsertAvailabilityWindow,
  upsertGroupSession,
  type AdminGroupSessionView,
  type AdminWindowView,
} from "@/lib/sessions.functions";

/**
 * Brand-Admin Calls management (P4.C). Nests under the pathless `admin.tsx` guard
 * — SELF-CONTAINED. Mutations are brand-role gated server-side (`decideBrandAdmin`);
 * brand_id is the envelope's activeOrgId, never sent. Manages two things:
 *
 *  - Availability windows — the source 1:1 bookable slots are derived from
 *    (`is_group = 0`). Each window is sliced into `slotMinutes` chunks.
 *  - Group sessions — scheduled live rooms budtenders register for then join once
 *    `now >= startsAt`. There is NO instant-call path; the lifecycle
 *    (scheduled → live → ended) is advanced by cron, so the admin only sets
 *    scheduled/cancelled here.
 */
export const Route = createFileRoute("/admin/calls")({
  component: AdminCallsPage,
});

function AdminCallsPage() {
  const [windows, setWindows] = useState<AdminWindowView[] | null>(null);
  const [sessions, setSessions] = useState<AdminGroupSessionView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingWindow, setEditingWindow] = useState<AdminWindowView | "new" | null>(null);
  const [editingSession, setEditingSession] = useState<AdminGroupSessionView | "new" | null>(null);

  async function refresh() {
    try {
      const [w, s] = await Promise.all([listAdminWindows(), listAdminGroupSessions()]);
      setWindows(w);
      setSessions(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load calls.");
      setWindows([]);
      setSessions([]);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <AdminPageHeader
        title="Calls"
        description="Open 1:1 availability windows and schedule group sessions. Budtenders book slots and register for sessions, then join once the start time arrives."
      />

      <ErrorBanner error={error} />

      {/* ── Availability windows ──────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <CalendarDays className="size-4" aria-hidden />
            Availability windows
          </h2>
          <Button type="button" variant="strong" size="sm" onClick={() => setEditingWindow("new")}>
            <Plus className="size-4" aria-hidden />
            New window
          </Button>
        </div>

        {windows === null && (
          <div className="space-y-2">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-14 w-full rounded-sm" />
            ))}
          </div>
        )}
        {windows !== null && windows.length === 0 && (
          <p className="text-sm text-muted-foreground">No windows yet. Open one above.</p>
        )}
        <ul className="space-y-2">
          {(windows ?? []).map((w) => (
            <li
              key={w.id}
              className={cn(
                "flex flex-wrap items-center gap-3 p-3 sm:flex-nowrap",
                surfaceMaterials.brutal,
              )}
            >
              <CalendarClock className="size-5 shrink-0 text-primary" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{formatRange(w.startsAt, w.endsAt)}</p>
                <p className="text-xs text-muted-foreground">
                  {w.slotMinutes}-min slots · host {shortId(w.hostId)}
                </p>
              </div>
              {w.isGroup ? (
                <Badge variant="info">Group</Badge>
              ) : (
                <Badge variant="secondary">1:1</Badge>
              )}
              <RowEditButton ariaLabel="Edit window" onClick={() => setEditingWindow(w)} />
            </li>
          ))}
        </ul>
      </section>

      {/* ── Group sessions ────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            <Users className="size-4" aria-hidden />
            Group sessions
          </h2>
          <Button type="button" variant="strong" size="sm" onClick={() => setEditingSession("new")}>
            <Plus className="size-4" aria-hidden />
            New session
          </Button>
        </div>

        {sessions === null && (
          <div className="space-y-2">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-16 w-full rounded-sm" />
            ))}
          </div>
        )}
        {sessions !== null && sessions.length === 0 && (
          <p className="text-sm text-muted-foreground">No sessions yet. Schedule one above.</p>
        )}
        <ul className="space-y-2">
          {(sessions ?? []).map((s) => (
            <li
              key={s.id}
              className={cn(
                "flex flex-wrap items-center gap-3 p-3 sm:flex-nowrap",
                surfaceMaterials.brutal,
                s.status === "cancelled" && "opacity-60",
              )}
            >
              <Video className="size-5 shrink-0 text-primary" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium" title={s.title}>
                  {s.title}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatRange(s.startsAt, s.endsAt)}
                  {s.capacity != null ? ` · cap ${s.capacity}` : ""}
                </p>
              </div>
              <SessionStatusBadge status={s.status} />
              {s.recordingRef && <Badge variant="outline">Recorded</Badge>}
              <RowEditButton ariaLabel={`Edit ${s.title}`} onClick={() => setEditingSession(s)} />
            </li>
          ))}
        </ul>
      </section>

      {editingWindow && (
        <WindowDialog
          window={editingWindow === "new" ? null : editingWindow}
          onClose={() => setEditingWindow(null)}
          onSaved={() => {
            setEditingWindow(null);
            void refresh();
          }}
        />
      )}

      {editingSession && (
        <SessionDialog
          session={editingSession === "new" ? null : editingSession}
          onClose={() => setEditingSession(null)}
          onSaved={() => {
            setEditingSession(null);
            void refresh();
          }}
        />
      )}
    </div>
  );
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function shortId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

function formatRange(startsAt: number, endsAt: number): string {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  const startStr = start.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const endStr = end.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${startStr} – ${endStr}`;
}

function SessionStatusBadge({ status }: { status: string }) {
  if (status === "live") return <Badge variant="growth">Live</Badge>;
  if (status === "ended") return <Badge variant="outline">Ended</Badge>;
  if (status === "cancelled") return <Badge variant="destructive">Cancelled</Badge>;
  return <Badge variant="info">Scheduled</Badge>;
}

// ─── availability window dialog ─────────────────────────────────────────────────

const windowSchema = type({
  hostId: "string",
  startsAt: "string >= 1",
  endsAt: "string >= 1",
  slotMinutes: "string",
  isGroup: "boolean",
  capacity: "string",
});

function parsePositiveInt(raw: string): number | undefined {
  const t = raw.trim();
  if (!t) return undefined;
  const n = Number(t);
  return Number.isInteger(n) && n >= 1 ? n : undefined;
}

function WindowDialog({
  window,
  onClose,
  onSaved,
}: {
  window: AdminWindowView | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { saveError, setSaveError, save } = useSaveHandler(onSaved);

  const form = useAppForm({
    defaultValues: {
      hostId: window?.hostId ?? "",
      startsAt: toDateTimeLocal(window?.startsAt),
      endsAt: toDateTimeLocal(window?.endsAt),
      slotMinutes: window?.slotMinutes != null ? String(window.slotMinutes) : "30",
      isGroup: window?.isGroup ?? false,
      capacity: window?.capacity != null ? String(window.capacity) : "1",
    },
    validators: { onBlur: windowSchema },
    onSubmit: async ({ value }) => {
      const range = parseDateTimeRange(value.startsAt, value.endsAt);
      if (!range.ok) {
        setSaveError(range.error);
        return;
      }
      await save(() =>
        upsertAvailabilityWindow({
          data: {
            ...(window ? { windowId: window.id } : {}),
            ...(value.hostId.trim() ? { hostId: value.hostId.trim() } : {}),
            startsAt: range.startsAt,
            endsAt: range.endsAt,
            ...(parsePositiveInt(value.slotMinutes) !== undefined
              ? { slotMinutes: parsePositiveInt(value.slotMinutes) }
              : {}),
            isGroup: value.isGroup,
            ...(parsePositiveInt(value.capacity) !== undefined
              ? { capacity: parsePositiveInt(value.capacity) }
              : {}),
          },
        }),
      );
    },
  });

  return (
    <FormDialog
      form={form}
      title={window ? "Edit window" : "New availability window"}
      description="1:1 windows are sliced into bookable slots of the chosen length. Group windows source group-session availability."
      onClose={onClose}
      error={saveError}
      contentClassName="max-h-[90vh] overflow-auto sm:max-w-lg"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <form.AppField name="startsAt">
          {(field) => <field.TextField label="Starts at" type="datetime-local" />}
        </form.AppField>
        <form.AppField name="endsAt">
          {(field) => <field.TextField label="Ends at" type="datetime-local" />}
        </form.AppField>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <form.AppField name="slotMinutes">
          {(field) => (
            <field.TextField
              label="Slot length (min)"
              placeholder="30"
              description="Length of each 1:1 slot."
            />
          )}
        </form.AppField>
        <form.AppField name="capacity">
          {(field) => (
            <field.TextField
              label="Capacity"
              placeholder="1"
              description="Group windows only; 1:1 stays 1."
            />
          )}
        </form.AppField>
      </div>

      <form.AppField name="hostId">
        {(field) => (
          <field.TextField
            label="Host id"
            placeholder="Defaults to you"
            description="The team member hosting these slots."
          />
        )}
      </form.AppField>

      <form.AppField name="isGroup">
        {(field) => (
          <field.SwitchField
            label="Group window"
            description="On = sources group-session availability instead of 1:1 slots."
          />
        )}
      </form.AppField>
    </FormDialog>
  );
}

// ─── group session dialog ───────────────────────────────────────────────────────

const sessionSchema = type({
  hostId: "string",
  title: "string >= 1",
  description: "string",
  startsAt: "string >= 1",
  endsAt: "string >= 1",
  capacity: "string",
  status: "string >= 1",
});

const STATUS_OPTIONS = [
  { value: "scheduled", label: "Scheduled" },
  { value: "cancelled", label: "Cancelled" },
];

function SessionDialog({
  session,
  onClose,
  onSaved,
}: {
  session: AdminGroupSessionView | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { saveError, setSaveError, save } = useSaveHandler(onSaved);
  // live/ended are cron-managed; only scheduled/cancelled are settable here.
  const initialStatus = session?.status === "cancelled" ? "cancelled" : "scheduled";

  const form = useAppForm({
    defaultValues: {
      hostId: session?.hostId ?? "",
      title: session?.title ?? "",
      description: session?.description ?? "",
      startsAt: toDateTimeLocal(session?.startsAt),
      endsAt: toDateTimeLocal(session?.endsAt),
      capacity: session?.capacity != null ? String(session.capacity) : "",
      status: initialStatus,
    },
    validators: { onBlur: sessionSchema },
    onSubmit: async ({ value }) => {
      const range = parseDateTimeRange(value.startsAt, value.endsAt);
      if (!range.ok) {
        setSaveError(range.error);
        return;
      }
      await save(() =>
        upsertGroupSession({
          data: {
            ...(session ? { sessionId: session.id } : {}),
            ...(value.hostId.trim() ? { hostId: value.hostId.trim() } : {}),
            title: value.title.trim(),
            ...(value.description.trim() ? { description: value.description.trim() } : {}),
            startsAt: range.startsAt,
            endsAt: range.endsAt,
            ...(parsePositiveInt(value.capacity) !== undefined
              ? { capacity: parsePositiveInt(value.capacity) }
              : {}),
            status: value.status === "cancelled" ? "cancelled" : "scheduled",
          },
        }),
      );
    },
  });

  return (
    <FormDialog
      form={form}
      title={session ? "Edit session" : "New group session"}
      description="Budtenders register, then join once the start time arrives. The live/ended lifecycle is advanced automatically — set only scheduled or cancelled here."
      onClose={onClose}
      error={saveError}
      contentClassName="max-h-[90vh] overflow-auto sm:max-w-lg"
    >
      <form.AppField name="title">
        {(field) => <field.TextField label="Title" placeholder="Terpene deep-dive" />}
      </form.AppField>

      <form.AppField name="description">
        {(field) => (
          <field.TextareaField label="Description" placeholder="What the session covers" rows={3} />
        )}
      </form.AppField>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <form.AppField name="startsAt">
          {(field) => <field.TextField label="Starts at" type="datetime-local" />}
        </form.AppField>
        <form.AppField name="endsAt">
          {(field) => <field.TextField label="Ends at" type="datetime-local" />}
        </form.AppField>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <form.AppField name="capacity">
          {(field) => (
            <field.TextField
              label="Capacity"
              placeholder="Unlimited"
              description="Blank = no cap."
            />
          )}
        </form.AppField>
        <form.AppField name="status">
          {(field) => <field.SelectField label="Status" options={STATUS_OPTIONS} />}
        </form.AppField>
      </div>

      <form.AppField name="hostId">
        {(field) => (
          <field.TextField
            label="Host id"
            placeholder="Defaults to you"
            description="The team member hosting the session."
          />
        )}
      </form.AppField>
    </FormDialog>
  );
}
