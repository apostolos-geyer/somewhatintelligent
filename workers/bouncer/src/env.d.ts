// Bouncer secret contract — keeps the ambient `Env` type stable without `.dev.vars`.
//
// `wrangler types` builds the generated `Env` interface from wrangler.jsonc
// `vars` PLUS whatever keys happen to live in a local `.dev.vars`. `BNC_ATT_PRIV`
// (the Ed25519 PKCS8 private key that signs `x-platform-att` envelopes) is a
// real SECRET: it lives in `.dev.vars` locally and `wrangler secret put` in
// deployed envs, and is deliberately absent from wrangler.jsonc. So on a fresh
// clone / in CI — where no `.dev.vars` exists, or a cache-replayed `bun run
// bootstrap` printed "created .dev.vars" without re-writing the file —
// `wrangler types` omits it, the ambient `Env` loses `BNC_ATT_PRIV`, and
// `getStamper(env)` (which requires `StamperEnv`) fails to typecheck. Declaring
// it here makes the type a property of the source, not of whether `bun run
// bootstrap` happened to run — so `bun run typecheck` is identical locally and
// in CI, with the vp task cache warm or cold.
//
// `BNC_ATT_KID`, `ENVIRONMENT`, `IDENTITY_URL` are plain wrangler.jsonc `vars`,
// always present in the generated type — only the secret needs asserting here.
// This augmentation declaration-merges with the generated global `Env`; when a
// `.dev.vars` IS present the generated type already has `BNC_ATT_PRIV: string`,
// and an identical-typed merge is a no-op.
interface Env {
  /** Ed25519 PKCS8 private key (PEM) signing `x-platform-att` envelopes. */
  BNC_ATT_PRIV: string;
}
