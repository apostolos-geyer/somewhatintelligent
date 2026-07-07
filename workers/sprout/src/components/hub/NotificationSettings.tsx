import { useState } from "react";
import { BellRing } from "lucide-react";
import { Card } from "@greenroom/ui/components/card";
import { Switch } from "@greenroom/ui/components/switch";
import { cn } from "@greenroom/ui/lib/utils";
import { surfaceMaterials } from "@greenroom/ui/lib/materials";
import type { PortalSummary } from "@/lib/hub.functions";
import {
  NOTIFICATION_TYPES,
  setNotificationPref,
  type NotificationPref,
} from "@/lib/notifications.functions";
import type { NotificationType } from "@/lib/notify";

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

const prefKey = (brandId: string, type: NotificationType) => `${brandId}:${type}`;

/**
 * Hub component #5 — the per-brand, per-type notification SETTINGS grid
 * (default-on; there is deliberately NO global switch — product rule). Settings
 * persist per toggle via `setNotificationPref` (membership re-asserted
 * server-side); a toggle is optimistic and rolls back on failure. Seeded from the
 * loader so it paints instantly with no client fetch flash.
 */
export function NotificationSettings({
  portals,
  prefs,
}: {
  portals: PortalSummary[];
  prefs: NotificationPref[];
}) {
  // Explicit OFF prefs (absent ⇒ default-on), keyed `${brandId}:${type}`.
  const [off, setOff] = useState<Set<string>>(
    () => new Set(prefs.filter((r) => !r.enabled).map((r) => prefKey(r.brandId, r.type))),
  );

  async function toggle(brandId: string, type: NotificationType, enabled: boolean) {
    const key = prefKey(brandId, type);
    setOff((cur) => {
      const next = new Set(cur);
      if (enabled) next.delete(key);
      else next.add(key);
      return next;
    });
    try {
      await setNotificationPref({ data: { brandId, type, enabled } });
    } catch {
      setOff((cur) => {
        const next = new Set(cur);
        if (enabled) next.add(key);
        else next.delete(key);
        return next;
      });
    }
  }

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h2 className="flex items-center gap-2 font-display text-2xl font-bold tracking-tight">
          <BellRing className="size-6 text-primary" aria-hidden />
          Notification Settings
        </h2>
        <p className="text-sm text-muted-foreground">
          Tune what reaches you per brand and per type. Updates also appear in the bell above.
        </p>
      </header>

      {portals.length === 0 ? (
        <p className="text-sm text-muted-foreground">Join a portal to tune its notifications.</p>
      ) : (
        <div className="grid gap-grid sm:grid-cols-2">
          {portals.map((p) => (
            <Card key={p.orgId} className={cn("p-4", surfaceMaterials.soft)}>
              <h3 className="mb-3 font-display font-bold">{p.name}</h3>
              <ul className="divide-y divide-border">
                {NOTIFICATION_TYPES.map((t) => {
                  const enabled = !off.has(prefKey(p.orgId, t));
                  return (
                    <li key={t} className="flex items-center justify-between py-2">
                      <span className="text-sm">{TYPE_LABEL[t]}</span>
                      <Switch
                        checked={enabled}
                        onCheckedChange={(v: boolean) => void toggle(p.orgId, t, v)}
                        aria-label={`${TYPE_LABEL[t]} for ${p.name}`}
                      />
                    </li>
                  );
                })}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
