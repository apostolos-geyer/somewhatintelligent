/**
 * AI assistant server functions (P4.D) — RAG over the brand's OWN content, with a
 * hard tenancy boundary: every retrieval is filtered to the caller's brand and
 * NEVER crosses brands. The assistant grounds answers in (a) indexed content
 * chunks (Vectorize, brand_id metadata filter → ai_embeddings.content) and (b)
 * the brand's enabled custom Q&A; when neither helps it ESCALATES to a BOOKED
 * call — there is no instant-call path anywhere (the panel renders a SlotPicker).
 *
 * Three surfaces, two tenancy modes (the §02 invariant — brand_id is NEVER input,
 * always the verified envelope's `activeOrgId`):
 *
 *  - `askAssistant` (gated): the streamed answer. Retrieves the brand corpus,
 *    grounds the prompt, returns a STREAMED `Response` in the Vercel AI SDK data-
 *    stream protocol (consumed by `useChat`). It LOGS every turn to `ai_qa_log`
 *    (append-only) with the chosen source + kind, and emits an `ai_question`
 *    analytics event. The answer offers a booked slot, never an instant call.
 *  - `addCustomQA` / `listCustomQa` / `setCustomQaEnabled` (ADMIN): manage the
 *    custom Q&A grounding rows. Brand-Admin gated in-handler; every mutation
 *    audits + enqueues a re-index of the row.
 *  - `listQaLog` (ADMIN GET): the append-only question log for review.
 *
 * `reindexSource` is the content-change hook the content streams call to enqueue
 * an `embed` job (product/deck/asset/custom_qa). The actual embed + Vectorize
 * upsert happens off the queue (`jobs/queue.ts`) so a publish never blocks on AI.
 */
import { createServerFn, createServerOnlyFn } from "@tanstack/react-start";
import { createDataStreamResponse, formatDataStreamPart } from "ai";
import { env } from "cloudflare:workers";
import { type } from "arktype";
import { and, desc, eq, inArray } from "drizzle-orm";
import { ulid } from "@greenroom/kit/ids";
import { createDb } from "@/lib/db";
import { aiCustomQa, aiEmbeddings, aiQaLog } from "@/schema";
import { requireBrandAudience, requireBrandAdmin } from "@/lib/middleware/auth";
import { assertBrandAdmin } from "@/lib/runtime.server";
import { writeAudit } from "@/lib/audit";
import { emitEvent } from "@/lib/analytics";
import { embed, generateStream, aiAvailable, type ChatMessage } from "@/lib/ai";

// ─── shared types ───────────────────────────────────────────────────────────

/** The provenance of a grounded answer (mirrors ai_qa_log.source). */
export type QaSource = "product" | "deck" | "asset" | "custom_qa" | "navigation" | "none";

/** The closed set of indexable content origins (mirrors ai_embeddings.source_type). */
export const EMBED_SOURCE_TYPES = ["product", "deck", "asset", "custom_qa"] as const;
export type EmbedSourceType = (typeof EMBED_SOURCE_TYPES)[number];

/** An admin-facing custom Q&A row. */
export interface CustomQaView {
  id: string;
  question: string;
  answer: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

/** An admin-facing question-log row (append-only; never edited). */
export interface QaLogView {
  id: string;
  userId: string;
  question: string;
  answer: string;
  source: QaSource | null;
  sourceId: string | null;
  kind: string;
  escalatedBookingId: string | null;
  createdAt: number;
}

// Drizzle returns rows keyed by the schema's camelCase TS field names.
type CustomQaRow = Pick<
  typeof aiCustomQa.$inferSelect,
  "id" | "question" | "answer" | "enabled" | "createdAt" | "updatedAt"
>;

type QaLogRow = Pick<
  typeof aiQaLog.$inferSelect,
  | "id"
  | "userId"
  | "question"
  | "answer"
  | "source"
  | "sourceId"
  | "kind"
  | "escalatedBookingId"
  | "createdAt"
>;

function mapCustomQa(row: CustomQaRow): CustomQaView {
  return {
    id: row.id,
    question: row.question,
    answer: row.answer,
    enabled: row.enabled !== 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function asQaSource(v: string | null): QaSource | null {
  const set = ["product", "deck", "asset", "custom_qa", "navigation", "none"];
  return v && set.includes(v) ? (v as QaSource) : null;
}

function mapQaLog(row: QaLogRow): QaLogView {
  return {
    id: row.id,
    userId: row.userId,
    question: row.question,
    answer: row.answer,
    source: asQaSource(row.source),
    sourceId: row.sourceId,
    kind: row.kind,
    escalatedBookingId: row.escalatedBookingId,
    createdAt: row.createdAt,
  };
}

// ─── retrieval (brand-scoped; NEVER crosses brands) ─────────────────────────

/** How many vector matches to ground on, and the floor a match must clear. */
const RETRIEVE_TOP_K = 5;
const MIN_SCORE = 0.4;
/** How many enabled custom-Q&A rows to fold into the grounding context. */
const CUSTOM_QA_LIMIT = 20;

/** A grounded snippet the prompt is built from, with its provenance. */
interface Snippet {
  content: string;
  sourceType: EmbedSourceType;
  sourceId: string;
  score: number;
}

interface RetrievalResult {
  snippets: Snippet[];
  /** Enabled custom Q&A for the brand (always folded in — it's the authored truth). */
  customQa: Array<{ id: string; question: string; answer: string }>;
}

/**
 * Retrieve the brand's grounding corpus for `question`. The Vectorize query is
 * ALWAYS filtered to `brand_id = brandId` (the tenancy boundary — a vector from
 * another brand can never match), then joined back to `ai_embeddings.content` for
 * the chunk text (also re-checked against brand_id). Custom Q&A is read straight
 * from D1. Degrades to "custom-qa only" when `env.AI`/`env.VECTORIZE` is inert
 * (local dev): the vector arm no-ops and the authored Q&A still grounds answers.
 */
async function retrieve(brandId: string, question: string): Promise<RetrievalResult> {
  const db = createDb(env.DB);
  const customQa = await db
    .select({
      id: aiCustomQa.id,
      question: aiCustomQa.question,
      answer: aiCustomQa.answer,
    })
    .from(aiCustomQa)
    .where(and(eq(aiCustomQa.brandId, brandId), eq(aiCustomQa.enabled, 1)))
    .orderBy(desc(aiCustomQa.updatedAt), desc(aiCustomQa.id))
    .limit(CUSTOM_QA_LIMIT);

  const vectorize = (env as { VECTORIZE?: VectorizeIndex }).VECTORIZE;
  if (!vectorize || !aiAvailable()) {
    // No vector arm in this isolate — ground on authored Q&A only.
    return { snippets: [], customQa };
  }

  const [queryVec] = await embed([question]);
  if (!queryVec) return { snippets: [], customQa };

  let matches: VectorizeMatches;
  try {
    matches = await vectorize.query(queryVec, {
      topK: RETRIEVE_TOP_K,
      // The brand_id metadata filter is the tenancy boundary — retrieval is
      // physically incapable of returning another brand's vector.
      filter: { brand_id: brandId },
      returnMetadata: "none",
    });
  } catch (e) {
    console.error("[ai.retrieve] vectorize query failed; custom-qa only", e);
    return { snippets: [], customQa };
  }

  const hits = (matches.matches ?? []).filter((m) => m.score >= MIN_SCORE);
  if (hits.length === 0) return { snippets: [], customQa };

  // Join the matched vectorize ids back to their chunk text. The brand_id guard
  // is belt-and-braces: even a stale/foreign vector id resolves to no row here.
  const ids = hits.map((m) => m.id);
  const chunkRows = await db
    .select({
      vectorizeId: aiEmbeddings.vectorizeId,
      sourceType: aiEmbeddings.sourceType,
      sourceId: aiEmbeddings.sourceId,
      content: aiEmbeddings.content,
    })
    .from(aiEmbeddings)
    .where(and(eq(aiEmbeddings.brandId, brandId), inArray(aiEmbeddings.vectorizeId, ids)));

  const byVectorId = new Map(
    chunkRows.map((r) => [
      r.vectorizeId,
      { content: r.content, sourceType: r.sourceType, sourceId: r.sourceId },
    ]),
  );

  const snippets: Snippet[] = [];
  for (const m of hits) {
    const row = byVectorId.get(m.id);
    if (!row) continue;
    snippets.push({
      content: row.content,
      sourceType: asEmbedSourceType(row.sourceType),
      sourceId: row.sourceId,
      score: m.score,
    });
  }
  return { snippets, customQa };
}

function asEmbedSourceType(v: string): EmbedSourceType {
  return (EMBED_SOURCE_TYPES as readonly string[]).includes(v) ? (v as EmbedSourceType) : "product";
}

// ─── prompt assembly ────────────────────────────────────────────────────────

/** The line the assistant uses to escalate — the panel turns this into a SlotPicker. */
const ESCALATE_MARKER = "BOOK_A_CALL";

/**
 * Build the grounded system+user message set. The system prompt pins the
 * assistant to the brand's own corpus, forbids fabrication, and — crucially —
 * instructs it to ESCALATE TO A BOOKED CALL (never an instant call) when the
 * corpus doesn't answer. The retrieved snippets + authored Q&A are the ONLY
 * ground truth offered.
 */
function buildMessages(question: string, retrieval: RetrievalResult): ChatMessage[] {
  const corpus: string[] = [];
  for (const qa of retrieval.customQa) {
    corpus.push(`Q: ${qa.question}\nA: ${qa.answer}`);
  }
  for (const s of retrieval.snippets) {
    corpus.push(s.content);
  }
  const grounding =
    corpus.length > 0
      ? corpus.map((c, i) => `[${i + 1}] ${c}`).join("\n\n")
      : "(no brand content matched this question)";

  const system =
    "You are the in-portal assistant for a cannabis brand's budtender education portal. " +
    "Answer ONLY from the brand context below — never invent product facts, dosages, or claims. " +
    "Keep answers short and practical for a budtender on the floor. " +
    `If the context does not contain the answer, do NOT guess: reply briefly and end with the exact token ${ESCALATE_MARKER} on its own line so the portal can offer the budtender a booked call with a brand specialist. ` +
    "Never offer to call anyone right now — the only escalation is booking a scheduled slot.\n\n" +
    `Brand context:\n${grounding}`;

  return [
    { role: "system", content: system },
    { role: "user", content: question },
  ];
}

/** Pick the dominant provenance for the log row (custom Q&A wins; else top snippet). */
function pickSource(retrieval: RetrievalResult): { source: QaSource; sourceId: string | null } {
  if (retrieval.snippets.length > 0) {
    const top = retrieval.snippets[0]!;
    return { source: top.sourceType, sourceId: top.sourceId };
  }
  if (retrieval.customQa.length > 0) {
    return { source: "custom_qa", sourceId: retrieval.customQa[0]!.id };
  }
  return { source: "none", sourceId: null };
}

// ─── askAssistant (gated; streamed Response) ────────────────────────────────

const askInput = type({
  /** The user's question — taken from the last user message client-side. */
  question: "1 <= string <= 2000",
  /** "customer" = product question; "navigation" = "how do I find X in the portal". */
  "kind?": "'customer' | 'navigation'",
});

/**
 * Gated: answer a question grounded in the caller's brand corpus, STREAMED in the
 * Vercel AI SDK data-stream protocol (so `useChat` renders it token-by-token).
 * Retrieval is brand-scoped (NEVER crosses brands). The full answer is logged to
 * `ai_qa_log` (append-only) once the stream completes, with the chosen source +
 * kind, and an `ai_question` event is emitted. When the model escalates (the
 * grounding didn't answer) the answer carries the BOOK_A_CALL marker the panel
 * turns into a SlotPicker — there is NO instant-call path.
 *
 * brand = envelope `activeOrgId`, never input. No active org → a one-line guidance
 * stream (nothing to ground against).
 */
export const askAssistant = createServerFn({ method: "POST" })
  .middleware([requireBrandAudience])
  .inputValidator(askInput)
  .handler(async ({ data, context }): Promise<Response> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const userId = context.principal.actor.id;
    const kind = data.kind ?? "customer";
    const question = data.question.trim();

    const retrieval = await retrieve(brandId, question);
    const messages = buildMessages(question, retrieval);
    const { source, sourceId } = pickSource(retrieval);

    // Stream the answer; accumulate it so we can log the final text + detect the
    // escalation marker once the model is done. The data-stream Response passes
    // straight through TSS (raw Response) to `useChat`.
    return createDataStreamResponse({
      execute: async (stream) => {
        let full = "";
        for await (const delta of generateStream(messages)) {
          full += delta;
          stream.write(formatDataStreamPart("text", delta));
        }

        const escalated = full.includes(ESCALATE_MARKER);
        // Strip the control marker from the persisted answer — it's a protocol
        // token for the panel, not prose. The client strips it from the bubble too.
        const answer = full.split(ESCALATE_MARKER).join("").trim();

        // Tell the panel whether to surface the SlotPicker (booked call, never
        // instant). A message annotation rides the same data stream.
        stream.writeMessageAnnotation({ escalate: escalated, source });

        // Append-only log + analytics — best-effort so a logging hiccup never
        // breaks the answer the user already received.
        try {
          const db = createDb(env.DB);
          await db.insert(aiQaLog).values({
            id: ulid(),
            brandId,
            userId,
            question,
            answer,
            source: escalated ? "none" : source,
            sourceId: escalated ? null : sourceId,
            kind,
            escalatedBookingId: null,
            createdAt: Date.now(),
          });
          await emitEvent({
            brandId,
            actorId: userId,
            type: "ai_question",
            targetType: "ai",
            metadata: { kind, source: escalated ? "none" : source, escalated },
          });
        } catch (e) {
          console.error("[askAssistant] log/analytics write failed", e);
        }
      },
      onError: (e) => {
        console.error("[askAssistant] stream error", e);
        return "The assistant hit a snag. Try again, or book a call below.";
      },
    });
  });

// ─── admin: custom Q&A management (brand-role gated) ────────────────────────

/**
 * Admin: the brand's custom Q&A rows (enabled + disabled), newest-first. brand =
 * envelope `activeOrgId`, never input. Brand-role gated so a plain budtender can't
 * enumerate the grounding set.
 */
export const listCustomQa = createServerFn({ method: "GET" })
  .middleware([requireBrandAdmin])
  .handler(async ({ context }): Promise<CustomQaView[]> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    await assertBrandAdmin(brandId, context.principal.actor.role);

    const db = createDb(env.DB);
    const rows = await db
      .select({
        id: aiCustomQa.id,
        question: aiCustomQa.question,
        answer: aiCustomQa.answer,
        enabled: aiCustomQa.enabled,
        createdAt: aiCustomQa.createdAt,
        updatedAt: aiCustomQa.updatedAt,
      })
      .from(aiCustomQa)
      .where(eq(aiCustomQa.brandId, brandId))
      .orderBy(desc(aiCustomQa.updatedAt), desc(aiCustomQa.id));
    return rows.map(mapCustomQa);
  });

const addCustomQaInput = type({
  "qaId?": "string >= 1",
  question: "1 <= string <= 1000",
  answer: "1 <= string <= 4000",
  "enabled?": "boolean",
});

/**
 * Admin: create or edit a custom Q&A grounding row. Without `qaId` it INSERTs;
 * with one it UPDATEs the caller's brand's row (the `brand_id` guard makes a
 * cross-brand edit a no-op → 404). Every write audits + enqueues a re-index so the
 * row's embedding is refreshed. brand = envelope `activeOrgId`, never input.
 */
export const addCustomQA = createServerFn({ method: "POST" })
  .middleware([requireBrandAdmin])
  .inputValidator(addCustomQaInput)
  .handler(async ({ data, context }): Promise<{ ok: true; qaId: string }> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const userId = context.principal.actor.id;
    await assertBrandAdmin(brandId, context.principal.actor.role);

    const question = data.question.trim();
    const answer = data.answer.trim();
    const enabled = data.enabled === false ? 0 : 1;
    const now = Date.now();
    const db = createDb(env.DB);

    if (data.qaId) {
      const res = await db
        .update(aiCustomQa)
        .set({ question, answer, enabled, updatedAt: now })
        .where(and(eq(aiCustomQa.id, data.qaId), eq(aiCustomQa.brandId, brandId)));
      if (!res.meta.changes) throw new Error("not_found");

      await writeAudit({
        brandId,
        action: "ai.custom_qa.upsert",
        actorId: userId,
        targetType: "ai_custom_qa",
        targetId: data.qaId,
        meta: { enabled: enabled === 1 },
      });
      await reindexSource(brandId, "custom_qa", data.qaId);
      return { ok: true, qaId: data.qaId };
    }

    const qaId = ulid();
    await db.insert(aiCustomQa).values({
      id: qaId,
      brandId,
      question,
      answer,
      enabled,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
    });

    await writeAudit({
      brandId,
      action: "ai.custom_qa.upsert",
      actorId: userId,
      targetType: "ai_custom_qa",
      targetId: qaId,
      meta: { enabled: enabled === 1 },
    });
    await reindexSource(brandId, "custom_qa", qaId);
    return { ok: true, qaId };
  });

const setEnabledInput = type({ qaId: "string >= 1", enabled: "boolean" });

/**
 * Admin: toggle a custom Q&A row on/off (a disabled row drops out of grounding
 * but isn't deleted). brand = envelope `activeOrgId`; the UPDATE's `brand_id`
 * guard scopes the write. Re-indexes so a re-enabled row's vector is current.
 */
export const setCustomQaEnabled = createServerFn({ method: "POST" })
  .middleware([requireBrandAdmin])
  .inputValidator(setEnabledInput)
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    const userId = context.principal.actor.id;
    await assertBrandAdmin(brandId, context.principal.actor.role);

    const db = createDb(env.DB);
    const res = await db
      .update(aiCustomQa)
      .set({ enabled: data.enabled ? 1 : 0, updatedAt: Date.now() })
      .where(and(eq(aiCustomQa.id, data.qaId), eq(aiCustomQa.brandId, brandId)));
    if (!res.meta.changes) throw new Error("not_found");

    await writeAudit({
      brandId,
      action: "ai.custom_qa.toggle",
      actorId: userId,
      targetType: "ai_custom_qa",
      targetId: data.qaId,
      meta: { enabled: data.enabled },
    });
    await reindexSource(brandId, "custom_qa", data.qaId);
    return { ok: true };
  });

// ─── admin: question-log review ─────────────────────────────────────────────

const listQaLogInput = type({ "limit?": "1 <= number <= 200" });

/**
 * Admin: the append-only AI question log, newest-first, for review (the analytics
 * gold mine — what budtenders actually ask, and how often the assistant had to
 * escalate). brand = envelope `activeOrgId`, never input. Brand-role gated.
 */
export const listQaLog = createServerFn({ method: "GET" })
  .middleware([requireBrandAdmin])
  .inputValidator(listQaLogInput)
  .handler(async ({ data, context }): Promise<QaLogView[]> => {
    const brandId = context.brand.id; // authorized viewed brand, non-null
    await assertBrandAdmin(brandId, context.principal.actor.role);

    const limit = data.limit ?? 100;
    const db = createDb(env.DB);
    const rows = await db
      .select({
        id: aiQaLog.id,
        userId: aiQaLog.userId,
        question: aiQaLog.question,
        answer: aiQaLog.answer,
        source: aiQaLog.source,
        sourceId: aiQaLog.sourceId,
        kind: aiQaLog.kind,
        escalatedBookingId: aiQaLog.escalatedBookingId,
        createdAt: aiQaLog.createdAt,
      })
      .from(aiQaLog)
      .where(eq(aiQaLog.brandId, brandId))
      .orderBy(desc(aiQaLog.createdAt), desc(aiQaLog.id))
      .limit(limit);
    return rows.map(mapQaLog);
  });

// ─── reindex helper (content-change hook) ───────────────────────────────────

/**
 * Enqueue an `embed` job to (re)index one content row's chunks into Vectorize +
 * `ai_embeddings`. Called by the content streams on publish/edit and by the
 * custom-Q&A mutations above. Best-effort: a queue-send failure is logged and
 * swallowed (the content change still lands; the row is just stale in search
 * until the next reindex). brand_id is always the caller's brand — never input.
 *
 * Exported so the content/sessions streams can re-index their own rows without
 * re-deriving the embed contract.
 */
export const reindexSource = createServerOnlyFn(async function reindexSource(
  brandId: string,
  sourceType: EmbedSourceType,
  sourceId: string,
): Promise<void> {
  try {
    await env.SPROUT_JOBS_QUEUE.send({ kind: "embed", brandId, sourceType, sourceId });
  } catch (e) {
    console.error("[ai.reindexSource] enqueue embed failed", { sourceType, sourceId, e });
  }
});
