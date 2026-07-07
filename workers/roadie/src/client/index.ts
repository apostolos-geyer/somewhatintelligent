/**
 * Roadie consumer SDK. Wraps the `env.ROADIE` service binding so apps
 * stop hand-rolling `meta` on every call. See `foldAnonymous` for how the
 * client-side `anonymous` actor kind is bridged to Roadie's narrow
 * `user | service` contract.
 *
 *   export const roadie = createRoadieClient(env.ROADIE, {
 *     callerApp: "sprout",
 *     getRequestId: () => extractRequestId(getRequest()),
 *     getActor: resolveActor,  // reads ambient session, falls back to anon
 *   });
 *
 *   await roadie.getReadUrl({ referenceId, ... });               // ambient
 *   await roadie.signPart({ ... }, { kind: "anonymous", label }); // override
 */
import type { Actor } from "@greenroom/kit/request-context";
import type { Roadie } from "../index";

export type { Actor } from "@greenroom/kit/request-context";
export { ok, err, type Result } from "../result";

/** Actor at the consumer boundary. Anonymous is folded to a service actor on the way out. */
export type RoadieActor = Actor | { kind: "anonymous"; label: string };

export interface RoadieClientOpts {
  /** App identifier. Sets `meta.callerApp` and forms the anon-actor service prefix. */
  callerApp: string;
  /** Reads the active request's correlation id. */
  getRequestId: () => string;
  /**
   * Resolves the default actor for calls made without an override. Typically
   * reads the active session and falls back to an anonymous label derived
   * from the request. May be sync or async; cookie-cache reads keep the
   * per-call cost in the microseconds.
   */
  getActor: () => RoadieActor | Promise<RoadieActor>;
}

type Binding = Service<typeof Roadie>;
type Input<K extends keyof Roadie> = Roadie[K] extends (
  input: infer I,
  ...rest: unknown[]
) => unknown
  ? I
  : never;

export function createRoadieClient(binding: Binding, opts: RoadieClientOpts) {
  const buildMeta = async (override: RoadieActor | undefined) => {
    const actor = override ?? (await opts.getActor());
    return {
      actor: foldAnonymous(actor, opts.callerApp),
      requestId: opts.getRequestId(),
      callerApp: opts.callerApp,
    };
  };
  return {
    // upload
    registerUpload: async (input: Input<"registerUpload">, actor?: RoadieActor) =>
      binding.registerUpload(input, await buildMeta(actor)),
    signPart: async (input: Input<"signPart">, actor?: RoadieActor) =>
      binding.signPart(input, await buildMeta(actor)),
    recordPart: async (input: Input<"recordPart">, actor?: RoadieActor) =>
      binding.recordPart(input, await buildMeta(actor)),
    getMultipartStatus: async (input: Input<"getMultipartStatus">, actor?: RoadieActor) =>
      binding.getMultipartStatus(input, await buildMeta(actor)),
    finalize: async (input: Input<"finalize">, actor?: RoadieActor) =>
      binding.finalize(input, await buildMeta(actor)),
    abandon: async (input: Input<"abandon">, actor?: RoadieActor) =>
      binding.abandon(input, await buildMeta(actor)),
    put: async (input: Input<"put">, actor?: RoadieActor) =>
      binding.put(input, await buildMeta(actor)),
    // read
    getReadUrl: async (input: Input<"getReadUrl">, actor?: RoadieActor) =>
      binding.getReadUrl(input, await buildMeta(actor)),
    getReference: async (input: Input<"getReference">, actor?: RoadieActor) =>
      binding.getReference(input, await buildMeta(actor)),
    // refs
    addReference: async (input: Input<"addReference">, actor?: RoadieActor) =>
      binding.addReference(input, await buildMeta(actor)),
    removeReference: async (input: Input<"removeReference">, actor?: RoadieActor) =>
      binding.removeReference(input, await buildMeta(actor)),
    // admin
    adminUsage: async (input: Input<"adminUsage">, actor?: RoadieActor) =>
      binding.adminUsage(input, await buildMeta(actor)),
    adminListBlobs: async (input: Input<"adminListBlobs">, actor?: RoadieActor) =>
      binding.adminListBlobs(input, await buildMeta(actor)),
    adminForceDelete: async (input: Input<"adminForceDelete">, actor?: RoadieActor) =>
      binding.adminForceDelete(input, await buildMeta(actor)),
    adminTriggerTask: async (input: Input<"adminTriggerTask">, actor?: RoadieActor) =>
      binding.adminTriggerTask(input, await buildMeta(actor)),
  };
}

export type RoadieClient = ReturnType<typeof createRoadieClient>;

function foldAnonymous(actor: RoadieActor, callerApp: string): Actor {
  if (actor.kind === "anonymous") {
    return { kind: "service", serviceName: `${callerApp}-anon:${actor.label}` };
  }
  return actor;
}
