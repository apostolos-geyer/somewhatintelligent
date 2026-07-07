/**
 * Sprout-local configuration — parallel to (not a replacement for)
 * `@greenroom/config`. The platform package owns brand/domain/cookie/auth; this
 * module owns the handful of sprout-specific runtime toggles.
 *
 * `loadConfig` takes a plain `{ ENVIRONMENT }` object (not the full Cloudflare
 * `Env`) so it stays trivially unit-testable without `cloudflare:workers`.
 * `assertConfigSafe` runs at Worker boot to brick a staging/prod deploy that
 * accidentally carries a local-only flag (console audit sink).
 */

export type Environment = "local" | "staging" | "prod";

export interface Config {
  environment: Environment;
  audit: { sink: "console" | "d1" };
}

function resolveEnvironment(raw: string | undefined): Environment {
  switch (raw) {
    case "production":
      return "prod";
    case "staging":
      return "staging";
    default:
      return "local";
  }
}

export function loadConfig(env: { ENVIRONMENT: string }): Config {
  const environment = resolveEnvironment(env.ENVIRONMENT);
  return {
    environment,
    audit: { sink: environment === "local" ? "console" : "d1" },
  };
}

export function assertConfigSafe(c: Config): void {
  if (c.environment !== "local" && c.audit.sink === "console") {
    throw new Error("console audit is local-only");
  }
}
