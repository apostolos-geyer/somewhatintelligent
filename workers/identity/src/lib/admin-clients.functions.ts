import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getGuestlist } from "@/lib/guestlist";
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
    const guestlist = getGuestlist();
    const res = await guestlist.api.admin.clients.get();
    return { clients: (res.data?.clients ?? []) as OAuthClientRow[] };
  });

export const getClient = createServerFn({ method: "GET" })
  .middleware([requireAdminMiddleware])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }): Promise<ClientDetailPayload> => {
    const guestlist = getGuestlist();
    const res = await guestlist.api.admin.clients({ id: data.id }).get();
    if (!res.data) throw notFound();
    const raw = res.data.client as Record<string, unknown>;
    return {
      client: {
        id: raw.id as string,
        clientId: raw.clientId as string,
        name: (raw.name ?? null) as string | null,
        redirectUris: toStringArray(raw.redirectUris),
        skipConsent: (raw.skipConsent ?? null) as boolean | null,
        referenceId: (raw.referenceId ?? null) as string | null,
      },
      tokenCount: res.data.tokenCount,
      consentCount: res.data.consentCount,
    };
  });

export const createClient = createServerFn({ method: "POST" })
  .middleware([requireAdminMiddleware])
  .inputValidator((data: CreateClientInput) => data)
  .handler(async ({ data }): Promise<CreateClientResult> => {
    const guestlist = getGuestlist();
    const res = await guestlist.api.admin.clients.post({
      name: data.name,
      redirectUris: data.redirectUris,
      skipConsent: data.skipConsent,
    });
    if (res.error) throw new Error(JSON.stringify(res.error.value));
    return { clientId: res.data.clientId, clientSecret: res.data.clientSecret };
  });

export const updateClient = createServerFn({ method: "POST" })
  .middleware([requireAdminMiddleware])
  .inputValidator(
    (data: { id: string; name?: string; redirectUris?: string[]; skipConsent?: boolean }) => data,
  )
  .handler(async ({ data }) => {
    const guestlist = getGuestlist();
    const res = await guestlist.api.admin.clients({ id: data.id }).patch({
      ...(data.name !== undefined && { name: data.name }),
      ...(data.redirectUris !== undefined && { redirectUris: data.redirectUris }),
      ...(data.skipConsent !== undefined && { skipConsent: data.skipConsent }),
    });
    if (res.error) throw new Error(JSON.stringify(res.error.value));
    return { success: true as const };
  });

export const rotateSecret = createServerFn({ method: "POST" })
  .middleware([requireAdminMiddleware])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }): Promise<{ clientSecret: string }> => {
    const guestlist = getGuestlist();
    const res = await guestlist.api.admin.clients({ id: data.id })["rotate-secret"].post();
    if (res.error) throw new Error(JSON.stringify(res.error.value));
    return { clientSecret: res.data.clientSecret };
  });

export const deleteClient = createServerFn({ method: "POST" })
  .middleware([requireAdminMiddleware])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const guestlist = getGuestlist();
    const res = await guestlist.api.admin.clients({ id: data.id }).delete();
    if (res.error) {
      const body = res.error.value as { error?: string } | null;
      if (body?.error === "managed_client") {
        throw new Error("Managed clients cannot be deleted");
      }
      throw new Error(body?.error ?? "Failed to delete client");
    }
    return { success: true as const };
  });
