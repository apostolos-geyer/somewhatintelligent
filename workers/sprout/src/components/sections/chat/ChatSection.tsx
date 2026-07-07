import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePartySocket } from "partysocket/react";
import { ArrowDown, MessagesSquare } from "lucide-react";
import { Button } from "@greenroom/ui/components/button";
import { Skeleton } from "@greenroom/ui/components/skeleton";
import { cn } from "@greenroom/ui/lib/utils";
import { usePortalContext } from "@/components/shell/portal-context";
import { deleteMessage, getRoomHistory, sendMessage } from "@/lib/chat.functions";
import { getMyOrgRole } from "@/lib/portal.functions";
import { MessageRow, type ChatEntry } from "./MessageRow";
import { Composer } from "./Composer";

// Send at most one `typing` frame every 4s while the composer is active — the DO
// rebroadcasts each as an ephemeral ping; a 4s cadence keeps the indicator alive
// without spamming the relay.
const TYPING_THROTTLE_MS = 4000;
const TYPING_TTL_MS = 5000;
const HISTORY_PAGE_SIZE = 50;
// Within this many px of the bottom we treat the user as "at bottom" — new
// messages auto-scroll and the jump-to-latest pill stays hidden.
const SCROLL_BOTTOM_THRESHOLD_PX = 100;

/** The DO's wire frames for the brand chat keyspace (group chat, no postId). */
type ServerFrame =
  | {
      type: "session.init";
      you: { userId: string; displayName: string; team: boolean };
      messages: Array<{
        id: string;
        userId: string;
        authorName: string;
        body: string;
        team: boolean;
        heartCount: number;
        createdAt: number;
      }>;
      online: string[];
    }
  | {
      type: "message";
      id: string;
      userId: string;
      authorName: string;
      body: string;
      team: boolean;
      createdAt: number;
    }
  | { type: "delete"; id: string }
  | { type: "presence.joined"; userId: string; displayName: string }
  | { type: "presence.left"; userId: string }
  | { type: "typing"; userId: string; displayName: string };

/**
 * The DO-backed group-chat room (section 05) — rendered full-screen inside the
 * SectionLayer via the registry, so it takes no props. ONE persistent room per
 * brand: the socket subscribes to `party "group-chat-room"`, `room = brand orgId`
 * (`prefix: "ws"`, `host = window.location.host`), which resolves to the
 * GroupChatRoom DO instance `idFromName(brandId)`. The DO's `onConnect` is the
 * canonical tenant gate (host→brand + envelope.activeOrgId === brand), so a
 * cross-brand subscription is refused at the edge.
 *
 * Receive is socket-only: `session.init` seeds history + presence, `message`
 * appends, `delete` collapses a row to "(deleted)", `presence.joined/left` drives
 * the "N online" pill, `typing` drives the typing indicator. SEND is NOT over the
 * socket — the Composer calls the gated `sendMessage` server fn (D1 write →
 * fan-out), and only the ephemeral `typing` ping travels over the wire.
 *
 * `getRoomHistory` (brand-scoped by `activeOrgId` server-side — no brand id
 * passed) backs both the no-socket fallback (when the socket never opens) and
 * scroll-up paging. The brand-team marker rides on each message's `team` flag
 * (server-derived) and renders via `MessageRow`. Mobile = full screen.
 */
export function ChatSection() {
  const { brand } = usePortalContext();
  const brandOrgId = brand?.orgId ?? "";

  const [messages, setMessages] = useState<Array<ChatEntry>>([]);
  const [online, setOnline] = useState<Set<string>>(new Set());
  const [typers, setTypers] = useState<Record<string, { displayName: string; until: number }>>({});
  const [meId, setMeId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [historyStart, setHistoryStart] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [isScrolledUp, setIsScrolledUp] = useState(false);
  const [newMessageCount, setNewMessageCount] = useState(0);

  const logEnd = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLElement | null>(null);
  const lastTypingSentAt = useRef<number>(0);
  const wsRef = useRef<{ send: (msg: string) => void } | null>(null);
  // The socket's `onMessage` is bound once; mirror `meId` into a ref so the
  // handler reads the latest id (for own-message + self-typing checks) without
  // re-subscribing.
  const meIdRef = useRef<string | null>(null);
  // Snapshot of scrollHeight captured BEFORE a history page is prepended; restored
  // after commit so the viewport stays anchored on the message being read.
  const pendingScrollAnchor = useRef<number | null>(null);
  const bootstrappedRef = useRef(false);
  const prevMessageCountRef = useRef(0);

  // Resolve the caller's org role for the VIEWED brand once for the page lifetime
  // — owner|admin may delete ANY message (the server re-gates regardless; this
  // only drives chrome). Mirrors _portal.tsx's `getMyOrgRole` admin derivation.
  useEffect(() => {
    let cancelled = false;
    getMyOrgRole()
      .then((role) => {
        if (!cancelled) setIsAdmin(role === "owner" || role === "admin");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [brandOrgId]);

  // No-socket fallback: if `session.init` hasn't seeded within a beat, paint the
  // latest page from the gated history fn so the room is never blank when the WS
  // edge is unavailable (e.g. dev-direct without the bouncer-signed host).
  useEffect(() => {
    let cancelled = false;
    const handle = setTimeout(() => {
      if (sessionReady) return;
      getRoomHistory({ data: { limit: HISTORY_PAGE_SIZE } })
        .then((page) => {
          if (cancelled || sessionReady) return;
          setMessages(page.messages.map((m) => ({ ...m })));
          setHistoryStart(page.reachedStart);
        })
        .catch(() => {});
    }, 1500);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [brandOrgId, sessionReady]);

  const ws = usePartySocket({
    enabled: typeof window !== "undefined" && brandOrgId.length > 0,
    host: typeof window !== "undefined" ? window.location.host : "",
    party: "group-chat-room",
    room: brandOrgId,
    prefix: "ws",
    onMessage: (e: MessageEvent) => {
      const body = typeof e.data === "string" ? e.data : "";
      let parsed: ServerFrame;
      try {
        parsed = JSON.parse(body) as ServerFrame;
      } catch {
        return;
      }
      switch (parsed.type) {
        case "session.init":
          meIdRef.current = parsed.you.userId;
          setMeId(parsed.you.userId);
          setMessages(
            parsed.messages.map((m) => ({
              id: m.id,
              userId: m.userId,
              authorName: m.authorName,
              body: m.body,
              team: m.team,
              createdAt: m.createdAt,
              mine: m.userId === parsed.you.userId,
            })),
          );
          setOnline(new Set(parsed.online));
          setSessionReady(true);
          break;
        case "message": {
          const frame = parsed;
          setMessages((m) => {
            if (m.some((x) => x.id === frame.id)) return m; // de-dupe own optimistic echo
            return [
              ...m,
              {
                id: frame.id,
                userId: frame.userId,
                authorName: frame.authorName,
                body: frame.body,
                team: frame.team,
                createdAt: frame.createdAt,
                mine: frame.userId === meIdRef.current,
              },
            ];
          });
          break;
        }
        case "delete":
          setMessages((m) => m.map((x) => (x.id === parsed.id ? { ...x, deleted: true } : x)));
          break;
        case "presence.joined":
          setOnline((o) => {
            const next = new Set(o);
            next.add(parsed.userId);
            return next;
          });
          break;
        case "presence.left":
          setOnline((o) => {
            const next = new Set(o);
            next.delete(parsed.userId);
            return next;
          });
          break;
        case "typing": {
          if (parsed.userId === meIdRef.current) break;
          const frame = parsed;
          setTypers((t) => ({
            ...t,
            [frame.userId]: { displayName: frame.displayName, until: Date.now() + TYPING_TTL_MS },
          }));
          break;
        }
        default:
          break;
      }
    },
  });

  useEffect(() => {
    wsRef.current = ws;
  }, [ws]);

  // Expire stale typing indicators on their TTL.
  useEffect(() => {
    if (Object.keys(typers).length === 0) return;
    const now = Date.now();
    const nextDeadline = Math.min(...Object.values(typers).map((t) => t.until));
    const ms = Math.max(50, nextDeadline - now);
    const handle = setTimeout(() => {
      const now2 = Date.now();
      setTypers((t) => {
        const out: typeof t = {};
        for (const [k, v] of Object.entries(t)) {
          if (v.until > now2) out[k] = v;
        }
        return out;
      });
    }, ms);
    return () => clearTimeout(handle);
  }, [typers]);

  // Auto-scroll on append (and the initial seed); count "new" when scrolled up.
  useEffect(() => {
    const prev = prevMessageCountRef.current;
    prevMessageCountRef.current = messages.length;

    if (pendingScrollAnchor.current !== null) return; // history prepend → layout effect
    if (messages.length === 0) return;

    if (!bootstrappedRef.current) {
      logEnd.current?.scrollIntoView({ behavior: "smooth" });
      bootstrappedRef.current = true;
      return;
    }

    const appended = messages.length - prev;
    if (appended <= 0) return;

    const newest = messages[messages.length - 1];
    const isOwn = newest?.userId === meId;
    if (isScrolledUp && !isOwn) {
      setNewMessageCount((n) => n + appended);
    } else {
      logEnd.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isScrolledUp, meId]);

  // After a history-page prepend commits, restore the viewport so the message the
  // user was reading stays put. `pendingScrollAnchor` holds the pre-prepend
  // scrollHeight; add the height delta to the current scrollTop.
  useEffect(() => {
    const anchor = pendingScrollAnchor.current;
    if (anchor === null) return;
    const el = scrollContainerRef.current;
    if (el) el.scrollTop = el.scrollTop + (el.scrollHeight - anchor);
    pendingScrollAnchor.current = null;
  }, [messages]);

  const setScrollContainerEl = useCallback((el: HTMLElement | null) => {
    scrollContainerRef.current = el;
  }, []);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const handler = () => {
      const distance = el.scrollHeight - (el.scrollTop + el.clientHeight);
      const up = distance > SCROLL_BOTTOM_THRESHOLD_PX;
      setIsScrolledUp(up);
      if (!up) setNewMessageCount(0);
    };
    handler();
    el.addEventListener("scroll", handler, { passive: true });
    return () => el.removeEventListener("scroll", handler);
  }, [brandOrgId]);

  const jumpToLatest = useCallback(() => {
    logEnd.current?.scrollIntoView({ behavior: "smooth" });
    setNewMessageCount(0);
  }, []);

  const loadOlderHistory = useCallback(async () => {
    if (loadingHistory || historyStart || messages.length === 0) return;
    const beforeId = messages[0]?.id;
    if (!beforeId) return;
    const el = scrollContainerRef.current;
    pendingScrollAnchor.current = el ? el.scrollHeight : 0;
    setLoadingHistory(true);
    try {
      const page = await getRoomHistory({
        data: { beforeId, limit: HISTORY_PAGE_SIZE },
      });
      if (page.reachedStart) setHistoryStart(true);
      if (page.messages.length === 0) {
        pendingScrollAnchor.current = null;
        return;
      }
      setMessages((cur) => {
        const have = new Set(cur.map((m) => m.id));
        const prepend = page.messages
          .filter((m) => !have.has(m.id))
          .map<ChatEntry>((m) => ({ ...m }));
        if (prepend.length === 0) {
          pendingScrollAnchor.current = null;
          return cur;
        }
        return [...prepend, ...cur];
      });
    } catch {
      pendingScrollAnchor.current = null;
    } finally {
      setLoadingHistory(false);
    }
  }, [historyStart, loadingHistory, messages]);

  const sendTyping = useCallback(() => {
    const now = Date.now();
    if (now - lastTypingSentAt.current < TYPING_THROTTLE_MS) return;
    lastTypingSentAt.current = now;
    try {
      wsRef.current?.send(JSON.stringify({ type: "typing" }));
    } catch {
      // Typing is best-effort; a closed socket just drops the ping.
    }
  }, []);

  const onSend = useCallback(
    (bodyText: string) => {
      // Optimistic append; the server's `message` fan-out de-dupes on id.
      const optimisticId = `optimistic:${Date.now()}`;
      const optimistic: ChatEntry = {
        id: optimisticId,
        userId: meId ?? "me",
        authorName: "You",
        body: bodyText,
        team: isAdmin,
        createdAt: Date.now(),
        mine: true,
      };
      setMessages((m) => [...m, optimistic]);
      sendMessage({ data: { body: bodyText } })
        .then((res) => {
          // Swap the optimistic row for the canonical server message (real id).
          setMessages((m) =>
            m.some((x) => x.id === res.message.id)
              ? m.filter((x) => x.id !== optimisticId)
              : m.map((x) => (x.id === optimisticId ? { ...res.message } : x)),
          );
        })
        .catch(() => {
          // Roll the optimistic row back on failure.
          setMessages((m) => m.filter((x) => x.id !== optimisticId));
        });
    },
    [meId, isAdmin],
  );

  const onDelete = useCallback((messageId: string) => {
    // Optimistic collapse; the server's `delete` fan-out confirms for everyone.
    setMessages((m) => m.map((x) => (x.id === messageId ? { ...x, deleted: true } : x)));
    deleteMessage({ data: { messageId } }).catch(() => {
      // Restore on failure (e.g. not authorized).
      setMessages((m) => m.map((x) => (x.id === messageId ? { ...x, deleted: false } : x)));
    });
  }, []);

  const activeTypers = useMemo(
    () => Object.values(typers).filter((t) => t.until > Date.now()),
    [typers],
  );
  const onlineCount = online.size;

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col">
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-2">
        <div className="flex items-center gap-2">
          <MessagesSquare className="size-5 text-primary" aria-hidden />
          <h2 className="font-display text-lg font-bold">Group Chat</h2>
        </div>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span
            className={cn("size-2 rounded-full", onlineCount > 0 ? "bg-success" : "bg-muted")}
            aria-hidden
          />
          {onlineCount} online
        </span>
      </header>

      <main
        ref={setScrollContainerEl}
        className="relative flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-4"
      >
        {!historyStart && messages.length > 0 ? (
          <div className="flex shrink-0 items-center justify-center py-1 text-xs text-text-tertiary">
            {loadingHistory ? (
              <span>Loading earlier messages…</span>
            ) : (
              <Button
                variant="ghost"
                size="xs"
                className="text-muted-foreground"
                onClick={() => void loadOlderHistory()}
              >
                Load earlier
              </Button>
            )}
          </div>
        ) : null}

        {!sessionReady && messages.length === 0 ? (
          <div aria-busy="true" aria-label="Loading messages" className="flex flex-col gap-3 py-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-start gap-2">
                <Skeleton className="h-7 w-7 shrink-0 rounded-full" />
                <div className="flex flex-1 flex-col gap-1.5">
                  <Skeleton className="h-3 w-32" />
                  <Skeleton className={i === 1 ? "h-4 w-3/4" : "h-4 w-1/2"} />
                </div>
              </div>
            ))}
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-muted-foreground">
            <MessagesSquare className="size-8" aria-hidden />
            <p className="text-sm">No messages yet. Say hello to the group.</p>
          </div>
        ) : null}

        {messages.map((m) => (
          <MessageRow key={m.id} message={m} canDelete={m.mine || isAdmin} onDelete={onDelete} />
        ))}
        <div ref={logEnd} />
      </main>

      {isScrolledUp && !loadingHistory ? (
        <div className="relative">
          <Button
            variant="secondary"
            size="sm"
            onClick={jumpToLatest}
            className="absolute -top-12 left-1/2 z-10 -translate-x-1/2 shadow-soft-md"
            aria-label="Jump to latest"
          >
            <ArrowDown aria-hidden="true" />
            <span>
              Jump to latest
              {newMessageCount > 0 ? ` (${newMessageCount} new)` : ""}
            </span>
          </Button>
        </div>
      ) : null}

      {activeTypers.length > 0 ? (
        <div className="flex shrink-0 items-center gap-1.5 border-t border-border bg-muted px-4 py-1 text-xs italic text-text-tertiary">
          <span>
            {activeTypers
              .map((t) => t.displayName)
              .slice(0, 3)
              .join(", ")}
            {activeTypers.length === 1 ? " is" : " are"} typing
          </span>
          <span className="inline-flex items-center gap-0.5" aria-hidden="true">
            <span className="typing-dot" />
            <span className="typing-dot" />
            <span className="typing-dot" />
          </span>
        </div>
      ) : null}

      <Composer onSubmit={onSend} onTyping={sendTyping} disabled={brandOrgId.length === 0} />
    </div>
  );
}
