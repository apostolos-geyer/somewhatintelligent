// Explicit env shape for Promoter. Mirrors the pattern used in
// `workers/roadie/src/roadie-env.ts` and `workers/guestlist/src/guestlist-env.ts`:
// consumers cross-wire promoter via `wrangler types -c ../promoter/wrangler.jsonc`
// and the generated worker-configuration.d.ts references `Promoter` by type,
// which compiles this file. When that happens the ambient `Env` global in the
// consumer's scope is not promoter's — so this file pins promoter's needs.
import type { CfEmailBinding } from "@greenroom/email";

export interface PromoterEnv {
  ENVIRONMENT: string;
  /** "resend" | "cloudflare". Selects the email transport; defaults to resend. */
  EMAIL_PROVIDER?: string;
  /** Resend API key — used when EMAIL_PROVIDER is "resend" (or unset). */
  RESEND_API_KEY?: string;
  /** Cloudflare Email Service `send_email` binding — used when EMAIL_PROVIDER
   *  is "cloudflare". Only bound in environments that enable Email Service. */
  EMAIL?: CfEmailBinding;
}
