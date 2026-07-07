/**
 * The SINGLE model seam (P4.D) — every AI generation + embedding in sprout flows
 * through `generate()` / `embed()` here, so swapping Workers AI for an external
 * LLM (OpenAI/Anthropic/AI Gateway) is a ONE-FILE change: re-implement these two
 * functions against the new provider and nothing else in the app moves.
 *
 * Today both run on Cloudflare Workers AI via the `env.AI` binding:
 *   - generate(messages) → @cf/meta/llama-3.1-8b-instruct (a chat completion)
 *   - embed(texts)       → @cf/baai/bge-base-en-v1.5 (768-dim sentence vectors)
 *
 * GUARD CONTRACT (09 §8 — gated bindings are inert in local dev): `env.AI` is
 * OPTIONAL. When it's absent (every local `wrangler dev` without the AI binding
 * provisioned) we DEGRADE rather than throw:
 *   - generate() returns a graceful canned "assistant is offline" answer,
 *   - embed() returns [] (the reindex job + retrieval both no-op cleanly).
 * No code path here ever throws on a missing binding — callers stay branch-free.
 *
 * To move off Workers AI: replace the two `env.AI.run(...)` calls with the new
 * provider's SDK (e.g. the Vercel AI SDK's `generateText`/`embedMany` against an
 * AI-Gateway model id). Keep the same signatures + the same offline fallbacks and
 * the rest of P4.D is untouched.
 */
import { env } from "cloudflare:workers";

/** The chat model the assistant grounds answers with. */
export const GENERATE_MODEL = "@cf/meta/llama-3.1-8b-instruct";
/** The embedding model (768-dim) — must match the Vectorize index dimensions. */
export const EMBED_MODEL = "@cf/baai/bge-base-en-v1.5";
/** bge-base-en-v1.5 emits 768-dim vectors; the Vectorize index is created to match. */
export const EMBED_DIM = 768;

/** The graceful answer returned when `env.AI` is inert (local dev / unprovisioned). */
export const OFFLINE_ANSWER =
  "The assistant is offline in this environment. Ask your team for product details, or book a call with a brand specialist below.";

/** A chat message in the seam's vocabulary (role-tagged plain text). */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Narrow the optional Workers AI binding — present only when provisioned. */
function getAi(): Ai | null {
  return (env as { AI?: Ai }).AI ?? null;
}

/** True when Workers AI is reachable in this isolate (drives degraded-mode copy). */
export function aiAvailable(): boolean {
  return getAi() != null;
}

/**
 * Generate a single (non-streamed) completion from the grounded chat messages.
 * Degrades to {@link OFFLINE_ANSWER} when `env.AI` is absent — never throws on a
 * missing binding. A model/runtime error is also swallowed into the offline
 * answer so a flaky inference never surfaces a 500 to the assistant panel.
 */
export async function generate(messages: ChatMessage[]): Promise<string> {
  const ai = getAi();
  if (!ai) return OFFLINE_ANSWER;
  try {
    const res = (await ai.run(GENERATE_MODEL, { messages })) as { response?: string };
    const text = res.response?.trim();
    return text && text.length > 0 ? text : OFFLINE_ANSWER;
  } catch (e) {
    console.error("[ai.generate] inference failed; returning offline answer", e);
    return OFFLINE_ANSWER;
  }
}

/**
 * Stream a grounded completion as text deltas. Yields the answer in chunks so the
 * assistant panel renders token-by-token. Degrades to a single yield of
 * {@link OFFLINE_ANSWER} when `env.AI` is absent, and falls back to the
 * non-streamed answer if the model can't stream — callers always get *some* text.
 */
export async function* generateStream(messages: ChatMessage[]): AsyncGenerator<string> {
  const ai = getAi();
  if (!ai) {
    yield OFFLINE_ANSWER;
    return;
  }
  try {
    const out = (await ai.run(GENERATE_MODEL, { messages, stream: true })) as unknown;
    if (out instanceof ReadableStream) {
      yield* readWorkersAiSse(out);
      return;
    }
    // Some runtimes return the whole object even with stream:true — emit it once.
    const text = (out as { response?: string }).response?.trim();
    yield text && text.length > 0 ? text : OFFLINE_ANSWER;
  } catch (e) {
    console.error("[ai.generateStream] inference failed; returning offline answer", e);
    yield OFFLINE_ANSWER;
  }
}

/**
 * Decode Workers AI's SSE stream (`data: {"response":"..."}` lines, terminated by
 * `data: [DONE]`) into the incremental `response` deltas. Tolerant of partial
 * frames split across chunks and of non-JSON keep-alives.
 */
async function* readWorkersAiSse(stream: ReadableStream): AsyncGenerator<string> {
  const reader = (stream as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]" || data.length === 0) continue;
        try {
          const parsed = JSON.parse(data) as { response?: string };
          if (parsed.response) yield parsed.response;
        } catch {
          // keep-alive / partial frame — ignore.
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Embed a batch of texts into 768-dim vectors. Returns one vector per input, in
 * order. Degrades to [] when `env.AI` is absent (the reindex job + retrieval both
 * treat [] as "skip" cleanly) — never throws on a missing binding. A runtime
 * failure also collapses to [] so a bad batch never poison-loops the embed job.
 */
export async function embed(texts: string[]): Promise<number[][]> {
  const ai = getAi();
  if (!ai || texts.length === 0) return [];
  try {
    const res = (await ai.run(EMBED_MODEL, { text: texts })) as { data?: number[][] };
    return Array.isArray(res.data) ? res.data : [];
  } catch (e) {
    console.error("[ai.embed] embedding failed; returning []", e);
    return [];
  }
}
