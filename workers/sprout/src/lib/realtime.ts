/**
 * The Cloudflare Realtime / RealtimeKit SEAM (P4.C). The in-platform call room
 * (1:1 bookings + group sessions) provisions a meeting + per-participant join
 * token through this module so no surface ever talks to the RealtimeKit API
 * directly. There is NO instant-call path anywhere — a session/booking is always
 * scheduled first; this seam only mints the room + token when a Join action is
 * already gated by `now >= starts_at`.
 *
 * All RealtimeKit calls go through the official `cloudflare` TypeScript SDK
 * (`client.realtimeKit.*`) rather than hand-rolled `fetch` — the SDK owns the
 * account-scoped URL (`/accounts/{acct}/realtime/kit/{app}/…`), the `Bearer`
 * auth header, and the typed `{ success, data }` envelope. The one remaining raw
 * `fetch` (in `archiveRecording`) pulls bytes from a presigned storage URL, which
 * is NOT a Cloudflare API call.
 *
 * Gated on RealtimeKit config read from env: the non-secret `CF_ACCOUNT_ID` +
 * `RTK_APP_ID` wrangler vars (from deploy.ts) and the `RTK_API_TOKEN` wrangler
 * secret. When any is absent — local dev, where it's inert — EVERY function
 * returns a graceful `{ available: false }`, NEVER throws: the call room degrades
 * to a "provision RealtimeKit" placeholder rather than crashing. The booking /
 * registration / lifecycle D1 paths all run locally regardless.
 *
 * Recording egress → roadie R2 (`archiveRecording`) is a PROVISIONING-GATED path
 * (09 §8: the RealtimeKit app id is a wrangler var + the API token a `provided`
 * wrangler secret, scoped to `['sprout']`; recordings are blocked without them).
 * When the RealtimeKit
 * recording credential OR the roadie R2 binding is absent — local dev — the
 * function returns a well-typed `{ available: false }`, exactly like the other
 * gated bindings here; it NEVER throws and is NOT a placeholder TODO. When BOTH
 * are provisioned, the cron `ended` transition calls it to fetch the finished
 * meeting's managed-recording download URL from RealtimeKit, stream those bytes
 * into roadie under `resourceType:"session-recording"`, and return the roadie
 * referenceId that `sessions`/`recordings` stamp into
 * `group_sessions.recording_ref`. Mirrors `lib/ai.ts`'s gated-binding posture.
 */
import { env } from "cloudflare:workers";
import Cloudflare from "cloudflare";
import { getRoadie } from "@/lib/roadie";
import { sha256Hex } from "@/lib/files";

interface RtkConfig {
  /** A `cloudflare` SDK client bound to the runtime `RTK_API_TOKEN`. */
  client: Cloudflare;
  /** Account id (rendered var) — the SDK takes it as the `account_id` path param. */
  accountId: string;
  /** RealtimeKit App id (`RTK_APP_ID`) — the SDK takes it as the leading arg. */
  appId: string;
}

/**
 * Read the (optional) RealtimeKit config off env and build an SDK client without
 * widening the typed Env. All three must be present: `CF_ACCOUNT_ID` is a rendered
 * var (set outside dev), `RTK_APP_ID` + `RTK_API_TOKEN` are `provided` secrets
 * scoped to staging/production. Absent any, the seam is inert (local dev) and
 * every fn degrades.
 *
 * The token authenticates the SDK as a `Bearer` Cloudflare API token carrying the
 * "Realtime / Realtime Admin" permission. The App, presets, and any webhook are
 * provisioned out-of-band by `scripts/provision-realtimekit.ts`.
 */
function rtkConfig(): RtkConfig | null {
  const e = env as { CF_ACCOUNT_ID?: string; RTK_APP_ID?: string; RTK_API_TOKEN?: string };
  if (!e.CF_ACCOUNT_ID || !e.RTK_APP_ID || !e.RTK_API_TOKEN) return null;
  // maxRetries:0 + a short timeout keep the seam's failure fast: a user-facing
  // Join must degrade to the placeholder promptly, so we suppress BOTH the SDK's
  // default retry backoff and its default 60s per-request timeout (a hung endpoint
  // would otherwise stall the Join for a full minute). The cron archive re-attempts
  // on its own tick, so a clipped request there is harmless too.
  const client = new Cloudflare({ apiToken: e.RTK_API_TOKEN, maxRetries: 0, timeout: 10_000 });
  return { client, accountId: e.CF_ACCOUNT_ID, appId: e.RTK_APP_ID };
}

export interface CreateSessionOpts {
  /** Brand scope — stamped into the meeting title for operator legibility. */
  brandId: string;
  /** Human-readable room title (session title / "1:1 with <host>"). */
  title: string;
  /** Whether RealtimeKit should record the room (group sessions → roadie later). */
  record?: boolean;
}

export type CreateSessionResult = { available: true; sessionId: string } | { available: false };

export type JoinTokenResult = { available: true; token: string } | { available: false };

/**
 * Mint a RealtimeKit meeting and return its id (stored as `realtime_session_id`
 * on the booking / group session). Returns `{ available: false }` when the
 * RealtimeKit secrets are absent (local dev) or the SDK call fails — the caller
 * persists nothing and the room renders the placeholder. NEVER throws.
 */
export async function createRealtimeSession(opts: CreateSessionOpts): Promise<CreateSessionResult> {
  const cfg = rtkConfig();
  if (!cfg) return { available: false }; // inert locally

  try {
    // Account-scoped create-meeting takes a title; auto-recording is initiated
    // separately via the recordings API (see archiveRecording), not on create.
    const res = await cfg.client.realtimeKit.meetings.create(cfg.appId, {
      account_id: cfg.accountId,
      title: `${opts.title} · ${opts.brandId}`,
    });
    const sessionId = res.data?.id;
    return sessionId ? { available: true, sessionId } : { available: false };
  } catch {
    // RealtimeKit unreachable / errored — degrade rather than break the Join action.
    return { available: false };
  }
}

/**
 * Mint a participant join token for `sessionId` scoped to `userId`. Returns
 * `{ available: false }` when secrets are absent (local dev) or the SDK call
 * fails. NEVER throws — the room shows the "provision RealtimeKit" placeholder.
 * The token is short-lived and minted per-join (no token is persisted in D1).
 */
export async function mintJoinToken(sessionId: string, userId: string): Promise<JoinTokenResult> {
  const cfg = rtkConfig();
  if (!cfg) return { available: false }; // inert locally

  try {
    const res = await cfg.client.realtimeKit.meetings.addParticipant(cfg.appId, sessionId, {
      account_id: cfg.accountId,
      name: userId,
      preset_name: "group_call_participant",
      custom_participant_id: userId,
    });
    const token = res.data?.token;
    return token ? { available: true, token } : { available: false };
  } catch {
    return { available: false };
  }
}

export type ArchiveRecordingResult =
  | { available: true; recordingRef: string }
  | { available: false };

/** Narrow the optional roadie R2 binding — present only when provisioned (09 §8). */
function roadieAvailable(): boolean {
  return (env as { ROADIE?: unknown }).ROADIE != null;
}

/**
 * Recording egress to roadie R2 — PROVISIONING-GATED (09 §8). Given a RealtimeKit
 * `sessionId` (the meeting id stored as `realtime_session_id`), fetch the finished
 * meeting's managed-recording download URL from RealtimeKit, stream those bytes
 * into roadie under `resourceType:"session-recording"` / `resourceId:sessionId`,
 * and return the roadie `referenceId` the caller stamps into
 * `group_sessions.recording_ref`.
 *
 * Returns a well-typed `{ available: false }` — never throws, never a TODO — when
 * EITHER the RealtimeKit credential (`RTK_APP_ID`/`RTK_API_TOKEN`) or the
 * roadie R2 binding (`env.ROADIE`) is absent (local dev / unprovisioned), or when
 * the meeting has no completed recording yet, or any egress step fails. A failed
 * archive must never block the cron `ended` transition — the pass simply leaves
 * `recording_ref` null and re-attempts on a later tick. Recordings above roadie's
 * single-part `put` ceiling degrade the same way (the `put` result is honoured,
 * not assumed).
 */
export async function archiveRecording(sessionId: string): Promise<ArchiveRecordingResult> {
  const cfg = rtkConfig();
  // Both the RealtimeKit recording credential AND the roadie R2 sink must be
  // provisioned for egress; absent either, degrade cleanly (09 §8).
  if (!cfg || !roadieAvailable()) return { available: false };

  try {
    // 1. List the meeting's recordings via the SDK. We ask the server for
    //    newest-first (so the latest take lands on the first page, ahead of any
    //    pagination cutoff) but don't rely on it: we re-sort by `invoked_time`
    //    DESC ourselves, then take the most recent UPLOADED one — the only status
    //    that carries a `download_url`. `?? []` guards a malformed envelope.
    const res = await cfg.client.realtimeKit.recordings.getRecordings(cfg.appId, {
      account_id: cfg.accountId,
      meeting_id: sessionId,
      sort_by: "invokedTime",
      sort_order: "DESC",
    });
    const finished = [...(res.data ?? [])]
      .sort((a, b) => (b.invoked_time ?? "").localeCompare(a.invoked_time ?? ""))
      .find((r) => r.download_url && r.status === "UPLOADED");
    const downloadUrl = finished?.download_url;
    if (!downloadUrl) return { available: false }; // no completed recording yet

    // 2. Pull the recording bytes (buffer once to derive hash + size for `put`).
    //    The download_url is a presigned storage URL (RealtimeKit's managed
    //    bucket / R2 / S3), NOT a Cloudflare API endpoint — so it stays a plain
    //    fetch rather than going through the SDK.
    const blobRes = await fetch(downloadUrl);
    if (!blobRes.ok) return { available: false };
    const contentType = blobRes.headers.get("content-type") ?? "video/mp4";
    const bytes = await blobRes.arrayBuffer();
    const hash = await sha256Hex(bytes);

    // 3. Stream into roadie under a stable per-session reference. A non-`ok`
    //    result (e.g. size over the single-part ceiling) degrades, never throws.
    const put = await getRoadie().put({
      hash,
      size: bytes.byteLength,
      contentType,
      application: {
        app: "sprout",
        resourceType: "session-recording",
        resourceId: sessionId,
      },
      body: bytes,
    });
    if (!put.ok) {
      console.error("[realtime.archiveRecording] roadie put failed", put.error);
      return { available: false };
    }
    return { available: true, recordingRef: put.value.referenceId };
  } catch (e) {
    // RealtimeKit/roadie unreachable or a transient error — degrade so the cron
    // `ended` pass leaves recording_ref null and retries; never block lifecycle.
    console.error("[realtime.archiveRecording] egress failed; leaving recording_ref null", e);
    return { available: false };
  }
}
