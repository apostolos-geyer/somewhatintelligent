/**
 * Pure planning layer: given an env and the currently-known values (dev
 * defaults + value store), expand the manifest into one {@link PlanEntry} per
 * (secret × consuming service), each tagged with whether its value is ready,
 * needs generating, or is missing. No I/O — this is what the tests pin down and
 * what `--dry-run` / `--status` print.
 */
import {
  DEV_DEFAULTS,
  SECRETS,
  SERVICE_DIR,
  sourceFor,
  workerName,
  type Env,
  type SecretKind,
  type SecretSpec,
  type ServiceName,
  type Source,
} from "./manifest";

export type Status = "ready" | "to-generate" | "missing";

export interface PlanEntry {
  secret: string;
  service: ServiceName;
  env: Env;
  /** local → `<dir>/.dev.vars`; remote → the deployed worker name. */
  target: string;
  status: Status;
  /** Present when status is "ready". */
  value?: string;
  required: boolean;
  source: Source;
  kind: SecretKind;
}

export interface PlanFilter {
  service?: ServiceName;
  secret?: string;
}

/** Resolve a single secret's value + status for an env from known values. */
export function resolveValue(
  spec: SecretSpec,
  env: Env,
  store: Record<string, string>,
): { status: Status; value?: string } {
  const source = sourceFor(spec, env);
  if (source === "devDefault") {
    const value = DEV_DEFAULTS[spec.name];
    return value !== undefined ? { status: "ready", value } : { status: "missing" };
  }
  const value = store[spec.name];
  if (value !== undefined && value.length > 0) return { status: "ready", value };
  return { status: source === "generate" ? "to-generate" : "missing" };
}

/** Expand the manifest into the full plan for an env. */
export function buildPlan(
  env: Env,
  store: Record<string, string>,
  filter: PlanFilter = {},
): PlanEntry[] {
  const entries: PlanEntry[] = [];
  for (const spec of SECRETS) {
    if (filter.secret !== undefined && spec.name !== filter.secret) continue;
    const services = spec.perEnv[env];
    if (services === undefined) continue;
    const { status, value } = resolveValue(spec, env, store);
    const source = sourceFor(spec, env);
    for (const service of services) {
      if (filter.service !== undefined && service !== filter.service) continue;
      entries.push({
        secret: spec.name,
        service,
        env,
        target: env === "local" ? `${SERVICE_DIR[service]}/.dev.vars` : workerName(service, env),
        status,
        value,
        required: spec.required,
        source,
        kind: spec.kind,
      });
    }
  }
  return entries;
}
