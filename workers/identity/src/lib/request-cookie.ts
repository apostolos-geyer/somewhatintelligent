import { getRequestHeaders } from "@tanstack/react-start/server";

/**
 * Raw inbound `Cookie` header. The guestlist WorkerEntrypoint RPC methods
 * take the cookie as an explicit required input and derive identity from it
 * (the cookie is the sole credential — binding reachability grants nothing).
 * An empty string here means the `#user`/`#admin` gates reject with
 * `unauthorized`, so only call this inside a server-fn handler where the
 * request context is live.
 */
export function requestCookie(): string {
  return getRequestHeaders().get("cookie") ?? "";
}
