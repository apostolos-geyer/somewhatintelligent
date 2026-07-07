/**
 * Build the TSS `Register.server.requestContext` payload from an inbound
 * request's platform headers. Single source of truth for the shape app
 * workers pass to `startEntry.fetch(req, { context })` — keeps the
 * platform-header lookups out of app code.
 *
 * Both prod and dev-direct topologies populate the same headers at the edge
 * (bouncer in prod; the dev stamper in portless), so this reader is
 * topology-agnostic.
 */
import { PLATFORM_HEADERS } from "@si/auth";
import { extractPlatformRequestId } from "../request-context";

export interface PlatformStartContext {
  requestId: string;
  callerApp?: string;
}

export function extractPlatformStartContext(request: Request): PlatformStartContext {
  const callerApp = request.headers.get(PLATFORM_HEADERS.caller);
  return {
    requestId: extractPlatformRequestId(request),
    ...(callerApp != null && { callerApp }),
  };
}
