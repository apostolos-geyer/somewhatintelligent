// Avatar mutation server fns. Avatar operations are WorkerEntrypoint RPC
// only (no HTTP spelling), so the browser can't call guestlist directly:
// these server fns front register/confirm/remove and forward the inbound
// Cookie header, which is the sole credential the entrypoint gates on.
//
// register/confirm are the two halves the browser `setAvatar` driver
// (@somewhatintelligent/guestlist/client) drives via an AvatarTransport —
// see @/lib/avatar-transport.
import { createServerFn } from "@tanstack/react-start";
import { getResponseHeaders } from "@tanstack/react-start/server";
import { env } from "cloudflare:workers";
import type { AvatarContentType } from "@somewhatintelligent/guestlist/client";
import { requestCookie } from "@/lib/request-cookie";
import { rpcMessage } from "@/lib/rpc-error";
import { requireUserMiddleware } from "@/lib/middleware/auth";

export const registerAvatar = createServerFn({ method: "POST" })
  .middleware([requireUserMiddleware])
  .validator((data: { hash: string; size: number; contentType: AvatarContentType }) => data)
  .handler(async ({ data }) => {
    const res = await env.GUESTLIST.registerAvatarUpload({
      cookie: requestCookie(),
      hash: data.hash,
      size: data.size,
      contentType: data.contentType,
    });
    // Reshape the RPC union into a plain serializable object: forwarding the
    // stub value verbatim leaks `& Disposable` (Symbol.dispose) into the
    // server-fn return, which TanStack Start's serializable-return check rejects.
    if (!res.ok) return { ok: false as const, error: res.error, message: rpcMessage(res) };
    return { ok: true as const, referenceId: res.referenceId, upload: res.upload };
  });

export const confirmAvatar = createServerFn({ method: "POST" })
  .middleware([requireUserMiddleware])
  .validator((data: { referenceId: string }) => data)
  .handler(async ({ data }) => {
    const res = await env.GUESTLIST.confirmAvatar({
      cookie: requestCookie(),
      referenceId: data.referenceId,
    });
    if (!res.ok) return { ok: false as const, error: res.error, message: rpcMessage(res) };
    // Forward BA's session-cache refresh cookies onto this response so the
    // browser's cached session JWT reflects the new user.image immediately;
    // dropping them leaves the old image cached for up to the 5-min TTL.
    const headers = getResponseHeaders();
    for (const sc of res.setCookies) headers.append("set-cookie", sc);
    return { ok: true as const, image: res.image };
  });

export const removeAvatarFn = createServerFn({ method: "POST" })
  .middleware([requireUserMiddleware])
  .handler(async () => {
    const res = await env.GUESTLIST.removeAvatar({ cookie: requestCookie() });
    if (!res.ok) throw new Error(res.error);
    const headers = getResponseHeaders();
    for (const sc of res.setCookies) headers.append("set-cookie", sc);
    return { ok: true as const, image: res.image };
  });
