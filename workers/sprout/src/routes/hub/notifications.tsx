import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, BellOff, CheckCheck } from "lucide-react";
import { Badge } from "@greenroom/ui/components/badge";
import { Button } from "@greenroom/ui/components/button";
import { Skeleton } from "@greenroom/ui/components/skeleton";
import { cn } from "@greenroom/ui/lib/utils";
import { surfaceMaterials } from "@greenroom/ui/lib/materials";
import {
  getNotificationPrefs,
  listNotifications,
  markAllRead,
  markRead,
  type NotificationPref,
  type NotificationView,
} from "@/lib/notifications.functions";
import type { NotificationType } from "@/lib/notify";
import { listMyPortals, type PortalSummary } from "@/lib/hub.functions";
import { NotificationSettings } from "@/components/hub/NotificationSettings";

/**
 * The Hub notification surface (P5.C) — the cross-brand FEED the bell opens, plus
 * the per-brand / per-type SETTINGS grid (moved here, off the Hub home community
 * scroll). Feed rows mark read on click and deep-link to the originating brand
 * portal via the server-derived `href`; settings persist per toggle.
 */
export const Route = createFileRoute("/hub/notifications")({
  component: NotificationsPage,
});

const TYPE_LABEL: Record<NotificationType, string> = {
  new_post: "New posts",
  new_comment: "New comments",
  chat: "Group chat",
  contact_reply: "Contact replies",
  session_reminder: "Session reminders",
  award: "Education Award",
  access_approved: "Access approved",
  fulfilment_status: "Fulfilment updates",
};

function NotificationsPage() {
  const [feed, setFeed] = useState<NotificationView[] | null>(null);
  const [portals, setPortals] = useState<PortalSummary[] | null>(null);
  const [prefs, setPrefs] = useState<NotificationPref[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [f, p, pr] = await Promise.all([
          listNotifications(),
          listMyPortals(),
          getNotificationPrefs(),
        ]);
        if (cancelled) return;
        setFeed(f);
        setPortals(p);
        setPrefs(pr);
      } catch {
        if (!cancelled) {
          setFeed([]);
          setPortals([]);
          setPrefs([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onRead(n: NotificationView) {
    if (!n.read) {
      setFeed((cur) => cur?.map((x) => (x.id === n.id ? { ...x, read: true } : x)) ?? cur);
      void markRead({ data: { id: n.id } });
    }
    if (n.href) window.location.assign(n.href);
  }

  async function onMarkAll() {
    setFeed((cur) => cur?.map((x) => ({ ...x, read: true })) ?? cur);
    await markAllRead({ data: {} });
  }

  const unread = useMemo(() => (feed ?? []).filter((n) => !n.read).length, [feed]);

  return (
    <div className="flex flex-col gap-section">
      <header className="space-y-2">
        <Link
          to="/hub"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Back to Hub
        </Link>
        <h1 className="font-display text-2xl font-bold tracking-tight">Notifications</h1>
        <p className="text-sm text-muted-foreground">
          Recent updates across every portal you belong to. Tune what reaches you, per brand and per
          type, below.
        </p>
      </header>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Recent {unread > 0 && <Badge variant="sprout">{unread} unread</Badge>}
          </h2>
          {unread > 0 && (
            <Button type="button" variant="ghost" size="sm" onClick={() => void onMarkAll()}>
              <CheckCheck className="size-4" aria-hidden />
              Mark all read
            </Button>
          )}
        </div>

        {feed === null && (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-14 w-full rounded-md" />
            ))}
          </div>
        )}
        {feed !== null && feed.length === 0 && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <BellOff className="size-4" aria-hidden />
            You're all caught up.
          </p>
        )}
        <ul className="space-y-2">
          {(feed ?? []).map((n) => (
            <li key={n.id}>
              <button
                type="button"
                onClick={() => void onRead(n)}
                className={cn(
                  "flex w-full items-start gap-3 p-3 text-left",
                  surfaceMaterials.brutal,
                  !n.read && "border-l-2 border-l-primary",
                )}
              >
                {!n.read && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{n.title}</p>
                  {n.body && <p className="text-sm text-muted-foreground">{n.body}</p>}
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {n.brandName ?? "—"} · {TYPE_LABEL[n.type]}
                  </p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </section>

      {/* Per-brand / per-type settings (moved here from the Hub home scroll). */}
      {portals !== null && prefs !== null ? (
        <NotificationSettings portals={portals} prefs={prefs} />
      ) : (
        <Skeleton className="h-48 w-full rounded-md" />
      )}
    </div>
  );
}
