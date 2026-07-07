/**
 * Per-isolate cached envelope stamper. The CryptoKey import inside
 * `createEnvelopeStamper` is async; we memoize the resolved stamper per `Env`
 * reference so each isolate signs in <1ms after the first request.
 */
import { createEnvelopeStamper, type EnvelopeStamper } from "@greenroom/auth";
import { createBouncerSessionResolver } from "./session";

export interface StamperEnv {
  GUESTLIST: Fetcher;
  BNC_ATT_PRIV: string;
  BNC_ATT_KID: string;
  ENVIRONMENT: string;
}

const stamperCache = new WeakMap<StamperEnv, Promise<EnvelopeStamper>>();

export function getStamper(
  env: StamperEnv,
  resolveHost: (request: Request) => string,
): Promise<EnvelopeStamper> {
  let p = stamperCache.get(env);
  if (!p) {
    p = createEnvelopeStamper({
      sessionResolver: createBouncerSessionResolver(env),
      minter: { privPem: env.BNC_ATT_PRIV, kid: env.BNC_ATT_KID },
      resolveHost,
    });
    stamperCache.set(env, p);
  }
  return p;
}
