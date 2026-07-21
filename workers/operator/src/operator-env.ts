/**
 * Operator's env shape (RFC-0001 "Access configuration contract"). Hand-written
 * like roadie's `RoadieEnv`. The Access secrets are absent in development (the
 * fixed `DEV_OPERATOR` stands in) and required in staging/production, where the
 * setup script (T4) writes them.
 *
 * SCAFFOLD (exec-plan 0004 track T2). Track T22 adds the domain service
 * bindings — `STORE: Service<StoreOperatorEntrypoint>` and
 * `PUBLISHER: Service<PublisherOperatorEntrypoint>`. No D1/R2/Stripe/Guestlist
 * binding is ever added here (INV-OP-2).
 */
export interface OperatorEnv {
  ENVIRONMENT: "development" | "staging" | "production";
  OPERATOR_URL: string;
  /** Cloudflare Access application AUD tag — a wrangler secret in deployed envs (T4). */
  POLICY_AUD?: string;
  /** Zero Trust team domain, e.g. https://team.cloudflareaccess.com — secret in deployed envs (T4). */
  TEAM_DOMAIN?: string;
  /** Dev-only fixed operator, formatted `<sub>:<email>`; set ONLY in development. */
  DEV_OPERATOR?: string;
}
