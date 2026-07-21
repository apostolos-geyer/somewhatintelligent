/**
 * Operator's Cloudflare Access configuration contract (RFC-0001 "Access
 * configuration contract" / D6).
 *
 * Development may use `DEV_OPERATOR` without Access configuration. Staging and
 * production require both secrets and a valid `Cf-Access-Jwt-Assertion`; missing
 * configuration outside development fails closed before route handling.
 */
export interface OperatorAccessConfig {
  /** Example: https://team.cloudflareaccess.com */
  teamDomain: string;
  /** Access application AUD tag. */
  policyAud: string;
}

export interface OperatorEnv {
  ENVIRONMENT: "development" | "staging" | "production";
  POLICY_AUD?: string;
  TEAM_DOMAIN?: string;
}
