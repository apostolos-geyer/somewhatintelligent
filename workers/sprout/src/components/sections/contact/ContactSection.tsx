import { useEffect, useMemo, useState } from "react";
import { type } from "arktype";
import {
  CalendarClock,
  CheckCircle2,
  MessageSquarePlus,
  MessageSquareText,
  ShieldCheck,
} from "lucide-react";
import { useAppForm } from "@greenroom/ui/hooks/use-app-form";
import { Card } from "@greenroom/ui/components/card";
import { Badge } from "@greenroom/ui/components/badge";
import { Skeleton } from "@greenroom/ui/components/skeleton";
import { surfaceMaterials } from "@greenroom/ui/lib/materials";
import { cn } from "@greenroom/ui/lib/utils";
import { usePortalContext } from "@/components/shell/portal-context";
import { useAuth } from "@/lib/auth-context";
import { SlotPicker } from "@/components/booking/SlotPicker";
import {
  CONTACT_AREAS,
  CONTACT_TOPICS,
  listMyThreads,
  sendContact,
  type ContactTopic,
  type ThreadStatus,
  type ThreadView,
} from "@/lib/contact.functions";

/** Request-type options for the select, derived from the closed topic set. */
const TOPIC_OPTIONS = CONTACT_TOPICS.map((t) => ({ value: t, label: t }));
/** Area-of-store options ("— Any —" first so the field is optional). */
const AREA_OPTIONS = [
  { value: "", label: "— Any —" },
  ...CONTACT_AREAS.map((a) => ({ value: a, label: a })),
];

/** Per-status badge variant for the thread history. */
const STATUS_BADGE: Record<
  ThreadStatus,
  { variant: "sprout" | "sprout-glass" | "info"; label: string }
> = {
  open: { variant: "sprout-glass", label: "Open" },
  replied: { variant: "sprout", label: "Replied" },
  closed: { variant: "info", label: "Closed" },
};

const contactSchema = type({
  name: "string >= 1",
  store: "string",
  areaOfStore: "string",
  email: "string >= 1",
  topic: "string >= 1",
  message: "string >= 1",
});

function formatWhen(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * The Get-in-Touch section (06) — rendered full-screen inside the SectionLayer via
 * the registry, so it takes no props. It is the IN-PLATFORM channel that reaches a
 * human (a Brand Admin): a budtender opens a thread, and the brand's reply comes
 * back as a notification on the Hub bell — there is NO email client anywhere.
 *
 * Left: one `useAppForm` (name/store/email pre-filled from the auth session + the
 * active org, topic select, message textarea). On submit it opens a thread via
 * `sendContact` (brand_id + user_id are the envelope's, never sent) and refreshes
 * the history. Right: the caller's own thread history (`listMyThreads`), each
 * thread showing its message + any brand replies marked with a "Team" badge.
 */
export function ContactSection() {
  const { brand } = usePortalContext();
  const { user } = useAuth();

  const [threads, setThreads] = useState<ThreadView[] | null>(null);
  const [store, setStore] = useState<string>("");
  const [storeLoaded, setStoreLoaded] = useState(false);
  const [mode, setMode] = useState<"message" | "call">("message");

  async function refresh() {
    try {
      setThreads(await listMyThreads());
    } catch {
      setThreads([]);
    }
  }

  useEffect(() => {
    let cancelled = false;
    setThreads(null);
    setStoreLoaded(false);
    void (async () => {
      try {
        const rows = await listMyThreads();
        if (cancelled) return;
        setThreads(rows);
        // Prefill the store field from the VIEWED brand's slug (route context),
        // replacing the old active-org lookup — same value, no server round-trip.
        setStore(brand?.slug ?? "");
      } catch {
        if (!cancelled) setThreads([]);
      } finally {
        if (!cancelled) setStoreLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [brand?.orgId, brand?.slug]);

  if (threads === null || !storeLoaded) {
    return (
      <div className="mx-auto grid max-w-5xl gap-8 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <Skeleton className="h-96 w-full rounded-md" />
        <div className="space-y-3">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-28 w-full rounded-md" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto grid max-w-5xl gap-8 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="space-y-4">
        {/* Two ways to reach the team: an in-platform message, or book a 1:1 call
            (booking-only — there is no instant call; INV-2). */}
        <div role="tablist" aria-label="Contact method" className="inline-flex gap-1">
          <ModeTab
            active={mode === "message"}
            onClick={() => setMode("message")}
            icon={MessageSquareText}
            label="Send a message"
          />
          <ModeTab
            active={mode === "call"}
            onClick={() => setMode("call")}
            icon={CalendarClock}
            label="Book a call"
          />
        </div>

        {mode === "message" ? (
          <ContactForm
            defaultName={user?.name ?? user?.email ?? ""}
            defaultEmail={user?.email ?? ""}
            defaultStore={store}
            brandName={brand?.name ?? null}
            onSent={() => void refresh()}
          />
        ) : (
          <BookCallCard brandName={brand?.name ?? null} />
        )}
      </div>
      <ThreadHistory threads={threads} />
    </div>
  );
}

/** One pill in the message/call tablist. */
function ModeTab({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof CalendarClock;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-sm font-medium transition-colors",
        active
          ? "bg-primary text-primary-foreground"
          : "border border-border text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="size-4" aria-hidden />
      {label}
    </button>
  );
}

/** The "Book a call" panel — the brand's bookable 1:1 slots via the shared
 *  `SlotPicker` (booking-only; the reply/booking confirmation rides the same
 *  in-platform channels). */
function BookCallCard({ brandName }: { brandName: string | null }) {
  return (
    <Card className={cn("flex flex-col gap-5 p-4 sm:p-6", surfaceMaterials.brutal)}>
      <header className="space-y-1">
        <h2 className="font-display text-xl font-bold tracking-tight">Book a call</h2>
        <p className="text-sm text-muted-foreground">
          Grab a 1:1 slot with the {brandName ?? "brand"} team. You'll get a reminder in your portal
          — there are no instant calls, only booked times.
        </p>
      </header>
      <SlotPicker />
    </Card>
  );
}

function ContactForm({
  defaultName,
  defaultEmail,
  defaultStore,
  brandName,
  onSent,
}: {
  defaultName: string;
  defaultEmail: string;
  defaultStore: string;
  brandName: string | null;
  onSent: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const form = useAppForm({
    defaultValues: {
      name: defaultName,
      store: defaultStore,
      areaOfStore: "",
      email: defaultEmail,
      topic: "General" as string,
      message: "",
    },
    validators: { onBlur: contactSchema },
    onSubmit: async ({ value, formApi }) => {
      setError(null);
      setSent(false);
      try {
        await sendContact({
          data: {
            name: value.name.trim(),
            ...(value.store.trim() ? { store: value.store.trim() } : {}),
            ...(value.areaOfStore ? { areaOfStore: value.areaOfStore } : {}),
            email: value.email.trim(),
            topic: value.topic as ContactTopic,
            message: value.message.trim(),
          },
        });
        // Keep the contact details; clear only the message so a follow-up is easy.
        formApi.setFieldValue("message", "");
        setSent(true);
        onSent();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't send your message.");
      }
    },
  });

  return (
    <Card className={cn("flex flex-col gap-5 p-4 sm:p-6", surfaceMaterials.brutal)}>
      <header className="space-y-1">
        <h2 className="font-display text-xl font-bold tracking-tight">Get in touch</h2>
        <p className="text-sm text-muted-foreground">
          Reach the {brandName ?? "brand"} team — restocks, events, asset requests, or feedback.
          Replies land right here in your portal.
        </p>
      </header>

      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void form.handleSubmit();
        }}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <form.AppField name="name">
            {(field) => <field.TextField label="Your name" placeholder="Jordan" />}
          </form.AppField>
          <form.AppField name="store">
            {(field) => <field.TextField label="Store" placeholder="Optional" />}
          </form.AppField>
        </div>

        <form.AppField name="email">{(field) => <field.EmailField label="Email" />}</form.AppField>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <form.AppField name="topic">
            {(field) => <field.SelectField label="Type of request" options={TOPIC_OPTIONS} />}
          </form.AppField>
          <form.AppField name="areaOfStore">
            {(field) => <field.SelectField label="Area of store" options={AREA_OPTIONS} />}
          </form.AppField>
        </div>

        <form.AppField name="message">
          {(field) => (
            <field.TextareaField
              label="Message"
              rows={5}
              placeholder="What can the team help with?"
            />
          )}
        </form.AppField>

        {error && <p className="text-sm text-destructive">{error}</p>}
        {sent && (
          <p className="flex items-center gap-2 text-sm text-success">
            <CheckCircle2 className="size-4" aria-hidden />
            Message sent — the team will reply in your portal.
          </p>
        )}

        <div className="flex justify-end">
          <form.AppForm>
            <form.SubmitButton label="Send message" loadingLabel="Sending…" />
          </form.AppForm>
        </div>
      </form>
    </Card>
  );
}

function ThreadHistory({ threads }: { threads: ThreadView[] }) {
  const hasThreads = threads.length > 0;
  const empty = useMemo(() => !hasThreads, [hasThreads]);

  return (
    <aside className="space-y-3 lg:sticky lg:top-6 lg:self-start">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Your messages
      </h3>

      {empty ? (
        <div className="flex flex-col items-center gap-3 rounded-sm border border-border py-12 text-center">
          <MessageSquarePlus className="size-8 text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">
            No messages yet. Anything you send shows up here, with the team's replies.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {threads.map((thread) => {
            const status = STATUS_BADGE[thread.status];
            return (
              <li
                key={thread.id}
                className={cn("flex flex-col gap-3 p-4", surfaceMaterials.brutal)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-sm font-semibold">{thread.topic}</p>
                    <p className="text-xs text-muted-foreground">{formatWhen(thread.createdAt)}</p>
                  </div>
                  <Badge variant={status.variant}>{status.label}</Badge>
                </div>
                <p className="whitespace-pre-wrap text-sm text-foreground">{thread.message}</p>

                {thread.replies.length > 0 && (
                  <ul className="space-y-2 border-t border-border pt-3">
                    {thread.replies.map((reply) => (
                      <li key={reply.id} className="rounded-md border border-border bg-card/50 p-3">
                        {reply.fromBrand && (
                          <span className="mb-1 inline-flex items-center gap-1 text-xs font-medium text-primary">
                            <ShieldCheck className="size-3.5" aria-hidden />
                            Team
                          </span>
                        )}
                        <p className="whitespace-pre-wrap text-sm text-foreground">{reply.body}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {formatWhen(reply.createdAt)}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
