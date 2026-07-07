import { type ReactNode } from "react";
import { Trash2 } from "lucide-react";
import { Avatar, AvatarFallback } from "@greenroom/ui/components/avatar";
import { Badge } from "@greenroom/ui/components/badge";
import { Button } from "@greenroom/ui/components/button";
import { cn } from "@greenroom/ui/lib/utils";
import type { ChatMessageView } from "@/lib/chat.functions";
import { initialsFromName } from "@/lib/format";

// Deterministic per-user avatar colour. Hues are drawn from a curated set that
// reads well on the cream/light theme and deliberately AVOIDS the brand-green
// band (~95–150°) so a hashed user colour never masquerades as the sprout brand
// accent. Fixed 58% sat / 42% light keeps the cream initials legible across the
// whole palette.
const AVATAR_HUES = [8, 24, 200, 212, 224, 262, 280, 300, 320, 340] as const;

export function colorFromUserId(userId: string): string {
  let h = 0;
  for (const ch of userId) h = (h * 31 + ch.charCodeAt(0)) % 360;
  const hue = AVATAR_HUES[h % AVATAR_HUES.length] ?? AVATAR_HUES[0];
  return `hsl(${hue}deg 58% 42%)`;
}

// 12-hour ("1:23 PM") clock for the message timestamp — matches the chat app's
// MessageRow convention. `Intl.DateTimeFormat` is available in browsers + Workers.
const TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

const FULL_FORMAT = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

/** A live chat entry — the server view plus a client-side soft-delete flag a
 * `delete` frame flips on a message already on screen (history never returns
 * deleted rows, so the flag only ever arrives live). */
export type ChatEntry = ChatMessageView & { deleted?: boolean };

export interface MessageRowProps {
  message: ChatEntry;
  /** Whether the delete affordance is shown (author-own OR brand admin). */
  canDelete: boolean;
  onDelete: (messageId: string) => void;
}

/**
 * One group-chat message row,
 * trimmed to the group-chat surface (no reactions / pins / threads / edit). The
 * BRAND-TEAM marker — `message.team`, derived server-side from the author's org
 * role — renders a "Team" badge next to the author so budtenders can tell a brand
 * voice apart at a glance. The author's own row (and a brand admin's) shows a
 * soft-delete control on hover; everyone else's is read-only. A deleted message
 * collapses to "(deleted)" — the row is never removed (no hard-delete).
 */
export function MessageRow(props: MessageRowProps): ReactNode {
  const { message: m, canDelete, onDelete } = props;
  const isDeleted = m.deleted === true;
  const authorColor = colorFromUserId(m.userId);
  const createdAtDate = new Date(m.createdAt);
  const timeLabel = TIME_FORMAT.format(createdAtDate);
  const fullLabel = FULL_FORMAT.format(createdAtDate);

  return (
    <div className="group flex gap-2 rounded-sm px-1 py-0.5 text-sm hover:bg-muted/30">
      <Avatar size="sm" className="mt-0.5">
        <AvatarFallback
          className="font-medium"
          style={{ backgroundColor: authorColor, color: "var(--color-cream)" }}
        >
          {initialsFromName(m.authorName)}
        </AvatarFallback>
      </Avatar>
      {/* Author + meta + body share ONE baseline row on desktop (the compact
          chat-line look), but on a phone the body would be crushed to a
          word-per-line sliver next to the name/time — so it wraps to its own
          full-width line below the meta (`w-full sm:w-auto sm:flex-1`). */}
      <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="shrink-0 font-semibold" style={{ color: authorColor }}>
          {m.authorName}
        </span>
        {m.team && !isDeleted ? (
          <Badge variant="sprout-glass" className="shrink-0 px-1.5 py-0 text-[10px]">
            Team
          </Badge>
        ) : null}
        <time
          dateTime={createdAtDate.toISOString()}
          title={fullLabel}
          className="shrink-0 text-[11px] text-text-tertiary"
        >
          {timeLabel}
        </time>
        <span
          className={cn(
            "w-full whitespace-pre-wrap break-words sm:w-auto sm:flex-1",
            m.team && !isDeleted && "font-medium",
          )}
        >
          {isDeleted ? <em className="text-text-tertiary opacity-60">(deleted)</em> : m.body}
        </span>
        {canDelete && !isDeleted ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Delete message"
            className="size-7 shrink-0 text-destructive opacity-0 transition-opacity hover:bg-destructive/10 group-hover:opacity-100"
            onClick={() => onDelete(m.id)}
          >
            <Trash2 aria-hidden="true" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
