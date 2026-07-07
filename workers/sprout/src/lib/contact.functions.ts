/**
 * Contact server functions (P4.B) — the in-platform "Get in Touch" thread that
 * reaches a HUMAN (a Brand Admin), with the reply delivered back through the
 * SAME in-platform notification channel. The product has NO email client, so
 * nothing here sends mail: a budtender's message lands as a `contact_threads`
 * row in the brand's inbox, and a Brand-Admin reply lands as a `contact_reply`
 * notification on the budtender's Hub bell. Two tenancy modes, per the §02
 * invariant (brand_id is NEVER input):
 *
 *  - The budtender writes/reads (`sendContact`, `listMyThreads`) gate with
 *    `requireUserMiddleware`. `sendContact` opens a thread scoped to the verified
 *    envelope's `activeOrgId` + `actor.id` (a forged brand/user is impossible —
 *    both come from the envelope, never the payload; the name/store/email the
 *    form pre-fills are only contact details, never identity). `listMyThreads`
 *    returns ONLY the caller's own threads, each with its replies.
 *  - The Brand-Admin reads/writes (`listInbox`, `replyContact`) additionally gate
 *    IN-HANDLER on `decideBrandAdmin({ actorRole, orgRole })` (owner|admin in the
 *    brand's BA org, or platform admin). `replyContact` INSERTs a brand reply,
 *    flips the thread to `replied`, and emits the `contact_reply` notification to
 *    the thread's author in ONE logical operation; it calls `writeAudit`.
 *
 * The topic is the closed Restocking|Events|Assets|Feedback|General set; the
 * thread status is open|replied|closed (the inbox filters by it).
 */
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { type } from "arktype";
import { and, asc, desc, eq, inArray, type SQL } from "drizzle-orm";
import { ulid } from "@greenroom/kit/ids";
import { createDb } from "@/lib/db";
import { contactReplies, contactThreads } from "@/schema";
import { requireBrandAudience, requireBrandAdmin } from "@/lib/middleware/auth";
import { assertBrandAdmin } from "@/lib/runtime.server";
import { nullableTrim } from "@/lib/strings";
import { writeAudit } from "@/lib/audit";
import { emitNotification } from "@/lib/notify";

/** The five request TYPES, in the order the form's select lists them. */
export const CONTACT_TOPICS = ["Restocking", "Events", "Assets", "Feedback", "General"] as const;
export type ContactTopic = (typeof CONTACT_TOPICS)[number];

export function isContactTopic(v: unknown): v is ContactTopic {
  return typeof v === "string" && (CONTACT_TOPICS as readonly string[]).includes(v);
}

/** Which AREA of the store a request is about (the "Choose Area of store" field). */
export const CONTACT_AREAS = [
  "Sales floor",
  "Back of house",
  "Manager office",
  "Online / eComm",
  "Whole store",
] as const;
export type ContactArea = (typeof CONTACT_AREAS)[number];

export function isContactArea(v: unknown): v is ContactArea {
  return typeof v === "string" && (CONTACT_AREAS as readonly string[]).includes(v);
}

/** Thread lifecycle as the inbox filters + badges it. */
export const THREAD_STATUSES = ["open", "replied", "closed"] as const;
export type ThreadStatus = (typeof THREAD_STATUSES)[number];

function asThreadStatus(v: string): ThreadStatus {
  return (THREAD_STATUSES as readonly string[]).includes(v) ? (v as ThreadStatus) : "open";
}

function asTopic(v: string): ContactTopic {
  return isContactTopic(v) ? v : "General";
}

/** One reply on a thread (a brand reply carries `fromBrand`, the Team marker). */
export interface ReplyView {
  id: string;
  threadId: string;
  authorId: string;
  fromBrand: boolean;
  body: string;
  createdAt: number;
}

/** A contact thread with its replies, as both the caller's history + the inbox render it. */
export interface ThreadView {
  id: string;
  authorName: string;
  store: string | null;
  /** Which area of the store the request is about, or null. */
  areaOfStore: string | null;
  email: string;
  topic: ContactTopic;
  message: string;
  status: ThreadStatus;
  createdAt: number;
  updatedAt: number;
  replies: ReplyView[];
}

// The typed (camelCase) projections Drizzle returns; mapped to the view at the edge.
interface ThreadRow {
  id: string;
  userId: string;
  authorName: string;
  store: string | null;
  areaOfStore: string | null;
  email: string;
  topic: string;
  message: string;
  status: string;
  createdAt: number;
  updatedAt: number;
}

interface ReplyRow {
  id: string;
  threadId: string;
  authorId: string;
  fromBrand: number;
  body: string;
  createdAt: number;
}

function mapReply(row: ReplyRow): ReplyView {
  return {
    id: row.id,
    threadId: row.threadId,
    authorId: row.authorId,
    fromBrand: row.fromBrand !== 0,
    body: row.body,
    createdAt: row.createdAt,
  };
}

function mapThread(row: ThreadRow, replies: ReplyView[]): ThreadView {
  return {
    id: row.id,
    authorName: row.authorName,
    store: row.store,
    areaOfStore: row.areaOfStore,
    email: row.email,
    topic: asTopic(row.topic),
    message: row.message,
    status: asThreadStatus(row.status),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    replies,
  };
}

/** The select projection for a contact thread (typed camelCase columns). */
const threadCols = {
  id: contactThreads.id,
  userId: contactThreads.userId,
  authorName: contactThreads.authorName,
  store: contactThreads.store,
  areaOfStore: contactThreads.areaOfStore,
  email: contactThreads.email,
  topic: contactThreads.topic,
  message: contactThreads.message,
  status: contactThreads.status,
  createdAt: contactThreads.createdAt,
  updatedAt: contactThreads.updatedAt,
} as const;

/** The select projection for a contact reply (typed camelCase columns). */
const replyCols = {
  id: contactReplies.id,
  threadId: contactReplies.threadId,
  authorId: contactReplies.authorId,
  fromBrand: contactReplies.fromBrand,
  body: contactReplies.body,
  createdAt: contactReplies.createdAt,
} as const;

/** Group ordered reply rows by thread id (each bucket already created_at-sorted). */
function groupReplies(rows: ReplyRow[]): Map<string, ReplyView[]> {
  const byThread = new Map<string, ReplyView[]>();
  for (const row of rows) {
    const reply = mapReply(row);
    const bucket = byThread.get(row.threadId);
    if (bucket) bucket.push(reply);
    else byThread.set(row.threadId, [reply]);
  }
  return byThread;
}

/**
 * Query threads matching `where` (newest-first) and hydrate each with its
 * replies in chronological order — the shared read shape behind both
 * `listMyThreads` and the admin `listInbox`. Tenancy lives in `where`: every
 * caller scopes it to the verified envelope's brand.
 */
async function loadThreads(db: ReturnType<typeof createDb>, where: SQL | undefined) {
  const rows = await db
    .select(threadCols)
    .from(contactThreads)
    .where(where)
    .orderBy(desc(contactThreads.createdAt), desc(contactThreads.id));

  if (rows.length === 0) return [];

  const ids = rows.map((t) => t.id);
  const replies = await db
    .select(replyCols)
    .from(contactReplies)
    .where(inArray(contactReplies.threadId, ids))
    .orderBy(asc(contactReplies.createdAt), asc(contactReplies.id));

  const byThread = groupReplies(replies);
  return rows.map((t) => mapThread(t, byThread.get(t.id) ?? []));
}

// ─── budtender writes + reads (authenticated, envelope-scoped) ──────────────

const sendContactInput = type({
  name: "string >= 1",
  "store?": "string",
  "areaOfStore?": "string",
  email: "string >= 1",
  topic: "'Restocking' | 'Events' | 'Assets' | 'Feedback' | 'General'",
  message: "string >= 1",
});

/**
 * Gated: open a contact thread to the brand's inbox. INSERTs a `contact_threads`
 * row with status='open'; brand = envelope `activeOrgId` and user = envelope
 * `actor.id`, NEVER input (the name/store/email the form pre-fills are only the
 * contact details a Brand Admin replies to, not identity). Nothing external is
 * sent — the reply, when it comes, rides the in-platform notification channel.
 */
export const sendContact = createServerFn({ method: "POST" })
  .middleware([requireBrandAudience])
  .inputValidator(sendContactInput)
  .handler(async ({ data, context }): Promise<{ ok: true; threadId: string }> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const userId = context.principal.actor.id; // NEVER from input

    const threadId = ulid();
    const now = Date.now();
    const db = createDb(env.DB);
    // Keep only a known area; anything else collapses to null.
    const areaOfStore = isContactArea(data.areaOfStore) ? data.areaOfStore : null;
    await db.insert(contactThreads).values({
      id: threadId,
      brandId,
      userId,
      authorName: data.name.trim(),
      store: nullableTrim(data.store),
      areaOfStore,
      email: data.email.trim(),
      topic: data.topic,
      message: data.message.trim(),
      status: "open",
      createdAt: now,
      updatedAt: now,
    });

    return { ok: true, threadId };
  });

/**
 * Gated: the caller's OWN contact threads (newest-first), each with its replies in
 * chronological order so the history reads as a conversation. Scoped to the
 * verified envelope's `activeOrgId` + `actor.id` — a budtender only ever sees
 * their own threads, never another budtender's or another brand's. No active org
 * → empty list.
 */
export const listMyThreads = createServerFn({ method: "GET" })
  .middleware([requireBrandAudience])
  .handler(async ({ context }): Promise<ThreadView[]> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const userId = context.principal.actor.id; // NEVER from input

    const db = createDb(env.DB);
    return loadThreads(
      db,
      and(eq(contactThreads.brandId, brandId), eq(contactThreads.userId, userId)),
    );
  });

// ─── admin inbox + reply (brand-role gated, in-handler decideBrandAdmin) ────

const listInboxInput = type({
  "status?": "'open' | 'replied' | 'closed'",
});

/**
 * Admin: the brand's contact inbox, optionally filtered by status (no filter →
 * all), newest-first, each thread with its replies in chronological order. brand =
 * envelope `activeOrgId`, never input. Brand-role gated so a plain budtender can't
 * enumerate the whole brand's threads (they use `listMyThreads` for their own).
 */
export const listInbox = createServerFn({ method: "GET" })
  .middleware([requireBrandAdmin])
  .inputValidator(listInboxInput)
  .handler(async ({ data, context }): Promise<ThreadView[]> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    await assertBrandAdmin(brandId, context.principal.actor.role);

    const db = createDb(env.DB);
    return loadThreads(
      db,
      data.status
        ? and(eq(contactThreads.brandId, brandId), eq(contactThreads.status, data.status))
        : eq(contactThreads.brandId, brandId),
    );
  });

const replyContactInput = type({
  threadId: "string >= 1",
  body: "string >= 1",
});

/**
 * Admin: reply to a contact thread. In ONE logical operation it INSERTs a
 * `contact_replies` row (`from_brand = 1`, the Team marker), flips the thread to
 * status='replied' + bumps `updated_at`, and emits the `contact_reply`
 * NOTIFICATION to the thread's author — that notification IS how the reply reaches
 * the budtender (the product has no email client; no new channel is created). The
 * thread must be the caller's brand's (the `brand_id` guard scopes the lookup → a
 * forged/foreign `threadId` resolves to "not found"). brand = envelope
 * `activeOrgId`, never input. Brand-Admin gated; audited.
 */
export const replyContact = createServerFn({ method: "POST" })
  .middleware([requireBrandAdmin])
  .inputValidator(replyContactInput)
  .handler(async ({ data, context }): Promise<{ ok: true; reply: ReplyView }> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const userId = context.principal.actor.id;
    await assertBrandAdmin(brandId, context.principal.actor.role);

    const db = createDb(env.DB);
    const thread = (
      await db
        .select({
          id: contactThreads.id,
          userId: contactThreads.userId,
          topic: contactThreads.topic,
        })
        .from(contactThreads)
        .where(and(eq(contactThreads.id, data.threadId), eq(contactThreads.brandId, brandId)))
        .limit(1)
    ).at(0);
    if (!thread) throw new Error("not_found");

    const replyId = ulid();
    const body = data.body.trim();
    const now = Date.now();
    await db.batch([
      db.insert(contactReplies).values({
        id: replyId,
        threadId: data.threadId,
        authorId: userId,
        fromBrand: 1,
        body,
        createdAt: now,
      }),
      db
        .update(contactThreads)
        .set({ status: "replied", updatedAt: now })
        .where(and(eq(contactThreads.id, data.threadId), eq(contactThreads.brandId, brandId))),
    ]);

    // The in-platform channel — this is how the reply reaches the budtender.
    await emitNotification({
      brandId,
      userId: thread.userId,
      type: "contact_reply",
      title: "You have a reply",
      body,
      refType: "thread",
      refId: data.threadId,
    });

    await writeAudit({
      brandId,
      action: "contact.reply",
      actorId: userId,
      targetType: "thread",
      targetId: data.threadId,
      meta: { topic: thread.topic },
    });

    return {
      ok: true,
      reply: {
        id: replyId,
        threadId: data.threadId,
        authorId: userId,
        fromBrand: true,
        body,
        createdAt: now,
      },
    };
  });
