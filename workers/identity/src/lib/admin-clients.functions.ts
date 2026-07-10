import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { requestCookie } from "@/lib/request-cookie";
import { rpcErrorMessage } from "@/lib/rpc-error";
import { requireAdminMiddleware } from "@/lib/middleware/auth";
import { toStringArray } from "@/lib/normalize";

export interface OAuthClientRow {
  id: string;
  clientId: string;
  name: string | null;
  type: string | null;
  referenceId: string | null;
}

export interface ClientDetail {
  id: string;
  clientId: string;
  name: string | null;
  redirectUris: string[];
  skipConsent: boolean | null;
  referenceId: string | null;
}

export interface ClientDetailPayload {
  client: ClientDetail;
  tokenCount: number;
  consentCount: number;
}

export interface CreateClientInput {
  name: string;
  redirectUris: string[];
  skipConsent: boolean;
}

export interface CreateClientResult {
  clientId: string;
  clientSecret: string;
}

export const getClients = createServerFn({ method: "GET" })
  .middleware([requireAdminMiddleware])
  .handler(async () => {
    // The RPC's success arm (drizzle rows) isn't `Rpc.Serializable`, so the
    // stub type drops it and leaves only the `RpcErr` arms; re-assert the
    // success shape so the guard narrows to it.
    const res = (await env.GUESTLIST.adminListClients({ cookie: requestCookie() })) as
      | { ok: true; clients: OAuthClientRow[] }
      | { ok: false; error: string };
    if (!res.ok) throw new Error(res.error);
    return { clients: res.clients };
  });

export const getClient = createServerFn({ method: "GET" })
  .middleware([requireAdminMiddleware])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }): Promise<ClientDetailPayload> => {
    // The RPC's success arm (a drizzle row) isn't `Rpc.Serializable`, so the
    // stub type drops it and leaves only the `RpcErr` arms; re-assert the
    // success shape so the guard narrows to it.
    const res = (await env.GUESTLIST.adminGetClient({ cookie: requestCookie(), id: data.id })) as
      | { ok: true; client: Record<string, unknown>; tokenCount: number; consentCount: number }
      | { ok: false; error: string };
    if (!res.ok) {
      if (res.error === "not_found") throw notFound();
      throw new Error(res.error);
    }
    const raw = res.client;
    return {
      client: {
        id: raw.id as string,
        clientId: raw.clientId as string,
        name: (raw.name ?? null) as string | null,
        redirectUris: toStringArray(raw.redirectUris),
        skipConsent: (raw.skipConsent ?? null) as boolean | null,
        referenceId: (raw.referenceId ?? null) as string | null,
      },
      tokenCount: res.tokenCount,
      consentCount: res.consentCount,
    };
  });

export const createClient = createServerFn({ method: "POST" })
  .middleware([requireAdminMiddleware])
  .inputValidator((data: CreateClientInput) => data)
  .handler(async ({ data }): Promise<CreateClientResult> => {
    const res = await env.GUESTLIST.adminCreateClient({
      cookie: requestCookie(),
      name: data.name,
      redirectUris: data.redirectUris,
      skipConsent: data.skipConsent,
    });
    if (!res.ok) throw new Error(rpcErrorMessage(res));
    return { clientId: res.clientId, clientSecret: res.clientSecret };
  });

export const updateClient = createServerFn({ method: "POST" })
  .middleware([requireAdminMiddleware])
  .inputValidator(
    (data: { id: string; name?: string; redirectUris?: string[]; skipConsent?: boolean }) => data,
  )
  .handler(async ({ data }) => {
    const res = await env.GUESTLIST.adminUpdateClient({
      cookie: requestCookie(),
      id: data.id,
      ...(data.name !== undefined && { name: data.name }),
      ...(data.redirectUris !== undefined && { redirectUris: data.redirectUris }),
      ...(data.skipConsent !== undefined && { skipConsent: data.skipConsent }),
    });
    if (!res.ok) throw new Error(rpcErrorMessage(res));
    return { success: true as const };
  });

export const rotateSecret = createServerFn({ method: "POST" })
  .middleware([requireAdminMiddleware])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }): Promise<{ clientSecret: string }> => {
    const res = await env.GUESTLIST.adminRotateClientSecret({
      cookie: requestCookie(),
      id: data.id,
    });
    if (!res.ok) throw new Error(rpcErrorMessage(res));
    return { clientSecret: res.clientSecret };
  });

export const deleteClient = createServerFn({ method: "POST" })
  .middleware([requireAdminMiddleware])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const res = await env.GUESTLIST.adminDeleteClient({ cookie: requestCookie(), id: data.id });
    if (!res.ok) {
      if (res.error === "managed_client") {
        throw new Error("Managed clients cannot be deleted");
      }
      throw new Error(res.error ?? "Failed to delete client");
    }
    return { success: true as const };
  });
