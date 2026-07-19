/**
 * Browser-side typed client for the public Store HTTP API (RFC-0001 D11),
 * reached same-origin through Bouncer's `/api/store` passthrough mount. Input and
 * output types come from the frozen `@si/contracts` DTOs (the SSOT); a thin
 * `fetch` wrapper keeps the client bundle small and leaves Site's track free of
 * any cross-worker source import.
 *
 * (A `hono/client` typed client against `StoreApiType` also resolves cleanly —
 * verified via `_scratch-typed-client.ts` — but this wrapper gives precise
 * discriminated-union return types and identical runtime without reaching into
 * Store's internal module graph.)
 *
 * Authenticated routes derive the customer from the Bouncer/Guestlist session
 * cookie (`credentials: "same-origin"`); this client never sends a user id.
 */
import type {
  CartV1,
  CheckoutErrorResponse,
  CheckoutSessionStatusResponse,
  CreateCheckoutSessionResponse,
  OrderDetailDTO,
  StorePublicConfig,
} from "@si/contracts";

const API_BASE = "/api/store";

const JSON_GET: RequestInit = {
  method: "GET",
  headers: { accept: "application/json" },
  credentials: "same-origin",
};

export type CheckoutSessionResult =
  | CreateCheckoutSessionResponse
  | CheckoutErrorResponse
  | { ok: false; error: "unauthorized" | "network" };

export type CheckoutStatusResult =
  | CheckoutSessionStatusResponse
  | { ok: false; error: "not_found" | "unauthorized" | "network" };

export type OrderResult =
  | { ok: true; order: OrderDetailDTO }
  | { ok: false; error: "not_found" | "unauthorized" | "network" };

/** `GET /api/store/config` — public, unauthenticated. `null` on any failure. */
export async function fetchStoreConfig(): Promise<StorePublicConfig | null> {
  try {
    const res = await fetch(`${API_BASE}/config`, JSON_GET);
    if (!res.ok) return null;
    return (await res.json()) as StorePublicConfig;
  } catch {
    return null;
  }
}

/** `POST /api/store/checkout-sessions` — sends only the CartV1 (INV-CART-1). */
export async function createCheckoutSession(cart: CartV1): Promise<CheckoutSessionResult> {
  try {
    const res = await fetch(`${API_BASE}/checkout-sessions`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ cart }),
    });
    if (res.status === 401) return { ok: false, error: "unauthorized" };
    return (await res.json()) as CreateCheckoutSessionResponse | CheckoutErrorResponse;
  } catch {
    return { ok: false, error: "network" };
  }
}

/** `GET /api/store/checkout-sessions/:sessionId` — owning customer only. */
export async function fetchCheckoutStatus(sessionId: string): Promise<CheckoutStatusResult> {
  try {
    const res = await fetch(
      `${API_BASE}/checkout-sessions/${encodeURIComponent(sessionId)}`,
      JSON_GET,
    );
    if (res.status === 401) return { ok: false, error: "unauthorized" };
    if (res.status === 404) return { ok: false, error: "not_found" };
    if (!res.ok) return { ok: false, error: "network" };
    return (await res.json()) as CheckoutSessionStatusResponse;
  } catch {
    return { ok: false, error: "network" };
  }
}

/** `GET /api/store/orders/:orderNumber` — owning customer only. */
export async function fetchOrder(orderNumber: string): Promise<OrderResult> {
  try {
    const res = await fetch(`${API_BASE}/orders/${encodeURIComponent(orderNumber)}`, JSON_GET);
    if (res.status === 401) return { ok: false, error: "unauthorized" };
    if (res.status === 404) return { ok: false, error: "not_found" };
    if (!res.ok) return { ok: false, error: "network" };
    return { ok: true, order: (await res.json()) as OrderDetailDTO };
  } catch {
    return { ok: false, error: "network" };
  }
}
