// Guestlist log helpers. Two emission shapes:
//
//   - `emitHttp(...)` — canonical platform line shape for HTTP requests
//     (mirrors the kit's `withCanonicalLog` schema: service/event/operation/
//     outcome/duration_ms/request_id/actor_*). Used from Elysia's
//     `onError` + `onAfterHandle` hooks. Each call emits one line.
//     `request_id` is read from the active request context (opened at the
//     fetch boundary in index.ts via `withRequestContext`), so every line
//     emitted during a request shares the same id.
//
//   - `log.info/warn/error(event, fields)` — looser shape for ad-hoc
//     emissions (Better Auth's `backgroundTasks.handler` failure
//     notification, e.g.) that don't have a request_id at emit time and
//     aren't part of an inbound HTTP lifecycle.
import { withCanonicalLog } from "@si/kit/log";
import { extractRequestId, getActorId, getActorKind, getCallerApp } from "@si/kit/request-context";

type Level = "info" | "warn" | "error";
type Fields = Record<string, unknown>;

function emit(level: Level, event: string, fields: Fields = {}) {
  const line = { level, event, time: new Date().toISOString(), ...fields };
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  info: (event: string, fields?: Fields) => emit("info", event, fields),
  warn: (event: string, fields?: Fields) => emit("warn", event, fields),
  error: (event: string, fields?: Fields) => emit("error", event, fields),
};

export interface EmitHttpOpts {
  request: Request;
  // Captured at request start by the WeakMap state in index.ts.
  startMs: number;
  // Optional; falls back to the request URL pathname if absent.
  path?: string;
  // Final HTTP status — required for the success path, optional for errors
  // where Elysia hasn't yet resolved a status when onError fires.
  status?: number;
  // Error path only.
  errorCode?: string;
  errorMessage?: string;
}

// Emit one canonical http line. Uses kit's `withCanonicalLog` so the
// shape stays in lockstep with every other platform component (roadie,
// promoter, apps). `duration_ms` is computed from `startMs` and passed
// via `line.add` to override the kit's auto-computed value (which would
// reflect only the time spent inside this helper).
export async function emitHttp(opts: EmitHttpOpts): Promise<void> {
  const { request, startMs, status, errorCode, errorMessage } = opts;
  const url = new URL(request.url);
  const path = opts.path ?? url.pathname;
  const requestId = extractRequestId(request);
  // Read caller-app + actor from the request-context ALS opened at the
  // fetch boundary in index.ts. These were forwarded as headers by the
  // guestlist client (caller-asserted, log-correlation only). Falls back to
  // anonymous when the caller didn't set them (auth flows, direct browser
  // hits to public endpoints).
  await withCanonicalLog(
    {
      service: "guestlist",
      event: "http",
      operation: `guestlist.http.${request.method.toLowerCase()}`,
      requestId,
      callerApp: getCallerApp() ?? undefined,
      actorKind: getActorKind() ?? "anonymous",
      actorId: getActorId() ?? null,
    },
    async (line) => {
      line.add({
        method: request.method,
        path,
        ...(status !== undefined && { status }),
        ...(errorCode !== undefined && { error_code: errorCode }),
        ...(errorMessage !== undefined && { error_message: errorMessage }),
        duration_ms: Date.now() - startMs,
      });
      if (errorCode) {
        line.outcome(
          typeof status === "number" && status < 500 ? `http_${status}` : "internal_error",
        );
      } else if (typeof status === "number") {
        if (status >= 500) line.outcome("internal_error");
        else if (status >= 400) line.outcome(`http_${status}`);
        else line.outcome("ok");
      } else {
        line.outcome("ok");
      }
    },
  );
}
