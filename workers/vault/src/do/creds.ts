// Destination OAuth client credentials, resolved from VaultEnv by the
// registry's clientIdVar/clientSecretVar NAMES (the registry itself never
// holds values — NFR-7).
import type { Destination } from "../registry";
import type { VaultEnv } from "../vault-env";

export interface ClientCreds {
  clientId: string;
  clientSecret: string;
}

export function oauthClientCreds(env: VaultEnv, dest: Destination): ClientCreds | undefined {
  if (!dest.oauth) return undefined;
  const bag = env as unknown as Record<string, unknown>;
  const clientId = bag[dest.oauth.clientIdVar];
  const clientSecret = bag[dest.oauth.clientSecretVar];
  if (typeof clientId !== "string" || clientId.length === 0) return undefined;
  if (typeof clientSecret !== "string" || clientSecret.length === 0) return undefined;
  return { clientId, clientSecret };
}
