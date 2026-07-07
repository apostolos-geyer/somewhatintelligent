/**
 * SproutEnv is currently identical to the wrangler-generated `Env` (declared
 * globally in `worker-configuration.d.ts`). Kept as a named alias so adding
 * sprout-only fields from `.dev.vars` later is a one-file extension.
 */
export type SproutEnv = Env;

/**
 * The shape of messages the `SPROUT_JOBS_QUEUE` carries. Grows with the phases
 * that enqueue work; the queue dispatcher in `jobs/queue.ts` keeps an exhaustive
 * switch over `kind`.
 */
export type SproutJobMessage =
  | { kind: "noop"; note?: string }
  // P2.C — async deck derive: unpdf page_count + corpus text, Browser Rendering
  // page-1 PNG thumbnail → roadie put. Enqueued by finalizeDeckUpload.
  | { kind: "deck.derive"; deckId: string; brandId: string; referenceId: string }
  // P2.D/E — re-index user_brand_scores inputs + render cert badge on submit.
  | {
      kind: "attempt.completed";
      attemptId: string;
      userId: string;
      brandId: string | null;
      quizId: string;
      score: number;
      maxScore: number;
      passed: boolean;
    }
  // P4.D — (re)index one content row's chunks into Vectorize + ai_embeddings.
  // Enqueued by ai.functions.ts#reindexSource on content publish/edit + custom-QA
  // mutations. Inert when env.AI/env.VECTORIZE are absent (local dev) — skip+log.
  | {
      kind: "embed";
      brandId: string;
      sourceType: "product" | "deck" | "asset" | "custom_qa";
      sourceId: string;
    };
