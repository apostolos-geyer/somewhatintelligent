export { createPlatformAuth } from "./server";
export type {
  CreatePlatformAuthOptions,
  PlatformAuthSendEmail,
  PlatformAuthSocialProviders,
} from "./server";
export type { PlatformAuth, PlatformSession, PlatformSessionData, PlatformUser } from "./types";

// --- Internal header contract ---
export { PLATFORM_HEADERS, type PlatformRequestContract } from "./platform-headers";

// --- Cookie helpers ---
export { parseRequestCookies } from "./cookies";

// --- Bouncer attestation envelope ---
export { createAttestationMinter } from "./envelope/mint";
export type {
  AttestationMinter,
  AttestationMinterOpts,
  MintAttestationInput,
} from "./envelope/mint";
export { createBouncerEnvelopeVerifier, EnvelopeRejection } from "./envelope/verify";
export type { BouncerEnvelopeVerifier, BouncerEnvelopeVerifierOpts } from "./envelope/verify";
export {
  createEnvelopeStamper,
  stampPlatformHeaders,
  toEnvelopeActor,
  toEnvelopeSession,
} from "./envelope/stamper";
export type {
  EnvelopeStamper,
  EnvelopeStamperOpts,
  StampResult,
  SessionResolver,
  SessionResolverResult,
  StampableSession,
  StampPlatformHeadersOpts,
} from "./envelope/stamper";
export type {
  EnvelopePayload,
  EnvelopeActor,
  EnvelopeActorUser,
  EnvelopeSessionData,
  EnvelopeData,
  EnvelopeResult,
  PlatformEnvironment,
} from "./envelope/types";
